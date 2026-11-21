package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"sync"
)

const copyChunkBytes = 64 * 1024

// listenLocal listens on a loopback address the helper allows: host 127.0.0.1 only.
func listenLocal(address string) (net.Listener, error) {
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return nil, fmt.Errorf("--listen %q is not host:port: %w", address, err)
	}
	if host != "127.0.0.1" {
		return nil, fmt.Errorf("--listen host must be 127.0.0.1, not %q", host)
	}
	return net.Listen("tcp4", address)
}

// frameSender serializes the frames written to the output, and drops every one after ENDED.
type frameSender struct {
	mutex sync.Mutex
	out   io.Writer
	ended bool
}

func (s *frameSender) send(f frame) error {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	if s.ended {
		return nil
	}
	return writeFrame(s.out, f)
}

// end writes ENDED, the last frame, and then no other.
func (s *frameSender) end(why string) {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	if s.ended {
		return
	}
	s.ended = true
	_ = writeFrame(s.out, frame{typ: frameEnded, channel: controlChannel, payload: []byte(why)})
}

type relay struct {
	sender      *frameSender
	listener    net.Listener
	mutex       sync.Mutex
	connections map[uint32]net.Conn
	next        uint32
}

// runRelay relays the listener's connections over `in` and `out` until `in` ends, ctx is done or a
// frame is refused. It returns the exit status: 0 for the first two, 1 otherwise.
func runRelay(ctx context.Context, listener net.Listener, version string, in io.Reader, out io.Writer) int {
	r := &relay{
		sender:      &frameSender{out: out},
		listener:    listener,
		connections: map[uint32]net.Conn{},
		next:        firstConnectionChannel,
	}
	if err := r.sender.send(frame{typ: frameHello, channel: controlChannel, payload: []byte(version)}); err != nil {
		return 1
	}
	if err := r.sender.send(frame{typ: frameReady, channel: controlChannel, payload: []byte(listener.Addr().String())}); err != nil {
		return 1
	}

	stopped := make(chan struct {
		why  string
		code int
	}, 1)
	go r.acceptLoop()
	go func() {
		why, code := r.readInput(in)
		stopped <- struct {
			why  string
			code int
		}{why, code}
	}()

	var why string
	var code int
	select {
	case s := <-stopped:
		why, code = s.why, s.code
	case <-ctx.Done():
		why, code = "terminated", 0
	}
	_ = listener.Close()
	r.closeAll()
	r.sender.end(why)
	return code
}

func (r *relay) acceptLoop() {
	for {
		conn, err := r.listener.Accept()
		if err != nil {
			return
		}
		r.mutex.Lock()
		channel := r.next
		r.next++
		r.connections[channel] = conn
		r.mutex.Unlock()
		if err := r.sender.send(frame{typ: frameOpen, channel: channel}); err != nil {
			_ = conn.Close()
			return
		}
		go r.pump(channel, conn)
	}
}

// pump sends what a connection reads as DATA, and CLOSE when it ends, unless the service closed it.
func (r *relay) pump(channel uint32, conn net.Conn) {
	buffer := make([]byte, copyChunkBytes)
	for {
		n, err := conn.Read(buffer)
		if n > 0 {
			if sendErr := r.sender.send(frame{typ: frameData, channel: channel, payload: append([]byte(nil), buffer[:n]...)}); sendErr != nil {
				return
			}
		}
		if err != nil {
			break
		}
	}
	if r.forget(channel) {
		_ = conn.Close()
		_ = r.sender.send(frame{typ: frameClose, channel: channel})
	}
}

// forget removes a channel, reporting whether it was still there.
func (r *relay) forget(channel uint32) bool {
	r.mutex.Lock()
	defer r.mutex.Unlock()
	_, present := r.connections[channel]
	delete(r.connections, channel)
	return present
}

func (r *relay) connection(channel uint32) net.Conn {
	r.mutex.Lock()
	defer r.mutex.Unlock()
	return r.connections[channel]
}

func (r *relay) closeAll() {
	r.mutex.Lock()
	defer r.mutex.Unlock()
	for channel, conn := range r.connections {
		_ = conn.Close()
		delete(r.connections, channel)
	}
}

// readInput handles the service's frames until the input ends, and says why it did.
func (r *relay) readInput(in io.Reader) (string, int) {
	for {
		f, err := readFrame(in)
		if errors.Is(err, io.EOF) {
			return "stdin closed", 0
		}
		if err != nil {
			return "bad frame on stdin: " + err.Error(), 1
		}
		conn := r.connection(f.channel)
		if conn == nil {
			continue
		}
		switch f.typ {
		case frameData:
			if _, err := conn.Write(f.payload); err != nil && r.forget(f.channel) {
				_ = conn.Close()
				_ = r.sender.send(frame{typ: frameClose, channel: f.channel})
			}
		case frameClose:
			if r.forget(f.channel) {
				_ = conn.Close()
			}
		}
	}
}
