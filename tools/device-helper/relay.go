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

// connectionQueueFrames is how many of the service's DATA frames a connection may have waiting for
// its writer. A connection slow to read fills only its own queue; only once that is full does the
// service's input wait for it, so one slow connection doesn't hold the others back.
const connectionQueueFrames = 64

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

// connection is one accepted connection, written by a goroutine of its own.
type connection struct {
	conn net.Conn
	// writes holds the service's bytes for the writer, in order; only readInput sends on it, and
	// closes it at the service's CLOSE, so the writer writes what is queued and then closes conn.
	writes chan []byte
	// gone is closed when the connection is dropped (it ended, a write failed, the relay ends), so
	// the writer stops and readInput no longer waits on a full queue.
	gone chan struct{}
	// closedByService is set, under the relay's mutex, at the service's CLOSE: the channel takes no
	// more DATA and its end isn't answered with a CLOSE.
	closedByService bool
}

type relay struct {
	sender      *frameSender
	listener    net.Listener
	mutex       sync.Mutex
	connections map[uint32]*connection
	next        uint32
}

// runRelay relays the listener's connections over `in` and `out` until `in` ends, ctx is done or a
// frame is refused. It returns the exit status: 0 for the first two, 1 otherwise.
func runRelay(ctx context.Context, listener net.Listener, version string, in io.Reader, out io.Writer) int {
	r := &relay{
		sender:      &frameSender{out: out},
		listener:    listener,
		connections: map[uint32]*connection{},
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
		c := &connection{
			conn:   conn,
			writes: make(chan []byte, connectionQueueFrames),
			gone:   make(chan struct{}),
		}
		r.mutex.Lock()
		channel := r.next
		r.next++
		r.connections[channel] = c
		r.mutex.Unlock()
		if err := r.sender.send(frame{typ: frameOpen, channel: channel}); err != nil {
			r.drop(channel)
			return
		}
		go r.pump(channel, conn)
		go r.write(channel, c)
	}
}

// write writes the service's bytes to the connection in order. At the service's CLOSE it closes the
// connection once what was queued before it is written; a failed write drops it and sends CLOSE.
func (r *relay) write(channel uint32, c *connection) {
	for {
		select {
		case payload, open := <-c.writes:
			if !open {
				r.drop(channel)
				return
			}
			if _, err := c.conn.Write(payload); err != nil {
				if r.drop(channel) {
					_ = r.sender.send(frame{typ: frameClose, channel: channel})
				}
				return
			}
		case <-c.gone:
			return
		}
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
	if r.drop(channel) {
		_ = r.sender.send(frame{typ: frameClose, channel: channel})
	}
}

// drop removes a channel and closes its connection at once, stopping its writer; it reports whether
// its end is the service's to hear: the channel was still there, and the service didn't close it.
func (r *relay) drop(channel uint32) bool {
	r.mutex.Lock()
	c := r.connections[channel]
	delete(r.connections, channel)
	r.mutex.Unlock()
	if c == nil {
		return false
	}
	close(c.gone)
	_ = c.conn.Close()
	// Set only under the mutex while the channel was in the map; no one sets it once it is out.
	return !c.closedByService
}

// connection answers a channel's connection while it takes the service's DATA, else nil.
func (r *relay) connection(channel uint32) *connection {
	r.mutex.Lock()
	defer r.mutex.Unlock()
	c := r.connections[channel]
	if c == nil || c.closedByService {
		return nil
	}
	return c
}

// closedByService marks the service's CLOSE of a channel, reporting whether it was open until now.
func (r *relay) closedByService(channel uint32) bool {
	r.mutex.Lock()
	defer r.mutex.Unlock()
	c := r.connections[channel]
	if c == nil || c.closedByService {
		return false
	}
	c.closedByService = true
	return true
}

func (r *relay) closeAll() {
	r.mutex.Lock()
	channels := make([]uint32, 0, len(r.connections))
	for channel := range r.connections {
		channels = append(channels, channel)
	}
	r.mutex.Unlock()
	for _, channel := range channels {
		r.drop(channel)
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
		c := r.connection(f.channel)
		if c == nil {
			continue
		}
		switch f.typ {
		case frameData:
			// Waits only while this connection's queue is full, and not once it is dropped.
			select {
			case c.writes <- f.payload:
			case <-c.gone:
			}
		case frameClose:
			// Not answered with a CLOSE; the writer closes the connection after what is queued.
			if r.closedByService(f.channel) {
				close(c.writes)
			}
		}
	}
}
