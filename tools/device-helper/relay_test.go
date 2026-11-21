package main

import (
	"context"
	"io"
	"net"
	"strings"
	"testing"
	"time"
)

type runningRelay struct {
	t      *testing.T
	stdin  *io.PipeWriter
	stdout *io.PipeReader
	exit   chan int
	cancel context.CancelFunc
}

func startRelay(t *testing.T) (*runningRelay, string) {
	t.Helper()
	listener, err := listenLocal("127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	stdinReader, stdinWriter := io.Pipe()
	stdoutReader, stdoutWriter := io.Pipe()
	ctx, cancel := context.WithCancel(context.Background())
	exit := make(chan int, 1)
	go func() {
		exit <- runRelay(ctx, listener, "1.2.3", stdinReader, stdoutWriter)
		_ = stdoutWriter.Close()
	}()
	r := &runningRelay{t: t, stdin: stdinWriter, stdout: stdoutReader, exit: exit, cancel: cancel}
	t.Cleanup(func() { cancel(); _ = stdinWriter.Close(); _ = stdoutReader.Close() })

	if hello := r.next(); hello.typ != frameHello || string(hello.payload) != "1.2.3" || hello.channel != 0 {
		t.Fatalf("first frame is %+v", hello)
	}
	ready := r.next()
	if ready.typ != frameReady || !strings.HasPrefix(string(ready.payload), "127.0.0.1:") {
		t.Fatalf("second frame is %+v", ready)
	}
	return r, string(ready.payload)
}

func (r *runningRelay) next() frame {
	r.t.Helper()
	f, err := readFrame(r.stdout)
	if err != nil {
		r.t.Fatalf("reading a frame: %v", err)
	}
	return f
}

func (r *runningRelay) send(f frame) {
	r.t.Helper()
	if err := writeFrame(r.stdin, f); err != nil {
		r.t.Fatal(err)
	}
}

func (r *runningRelay) exitCode() int {
	r.t.Helper()
	select {
	case code := <-r.exit:
		return code
	case <-time.After(5 * time.Second):
		r.t.Fatal("the relay did not exit")
		return -1
	}
}

func TestRelayCarriesBytesBothWaysAndClosesOnDisconnect(t *testing.T) {
	r, address := startRelay(t)
	conn, err := net.Dial("tcp", address)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()

	open := r.next()
	if open.typ != frameOpen || open.channel != 1 {
		t.Fatalf("want OPEN on 1, got %+v", open)
	}

	if _, err := conn.Write([]byte("ping")); err != nil {
		t.Fatal(err)
	}
	if data := r.next(); data.typ != frameData || data.channel != 1 || string(data.payload) != "ping" {
		t.Fatalf("want DATA ping, got %+v", data)
	}

	r.send(frame{typ: frameData, channel: 1, payload: []byte("pong")})
	reply := make([]byte, 4)
	if _, err := io.ReadFull(conn, reply); err != nil || string(reply) != "pong" {
		t.Fatalf("connection read %q, %v", reply, err)
	}

	_ = conn.Close()
	if closed := r.next(); closed.typ != frameClose || closed.channel != 1 {
		t.Fatalf("want CLOSE on 1, got %+v", closed)
	}
}

func TestRelayGivesEachConnectionItsOwnChannelAndClosesOnTheServicesClose(t *testing.T) {
	r, address := startRelay(t)
	first, _ := net.Dial("tcp", address)
	defer first.Close()
	if open := r.next(); open.typ != frameOpen || open.channel != 1 {
		t.Fatalf("got %+v", open)
	}
	second, _ := net.Dial("tcp", address)
	defer second.Close()
	if open := r.next(); open.typ != frameOpen || open.channel != 2 {
		t.Fatalf("got %+v", open)
	}

	// Frames for an unknown channel are ignored.
	r.send(frame{typ: frameData, channel: 99, payload: []byte("lost")})
	r.send(frame{typ: frameClose, channel: 1})
	_ = first.SetReadDeadline(time.Now().Add(5 * time.Second))
	if _, err := first.Read(make([]byte, 1)); err != io.EOF {
		t.Fatalf("the closed connection read %v", err)
	}
	// The service's CLOSE is not answered with one; the other connection still works.
	if _, err := second.Write([]byte("x")); err != nil {
		t.Fatal(err)
	}
	if data := r.next(); data.typ != frameData || data.channel != 2 {
		t.Fatalf("got %+v", data)
	}
}

func TestRelaySplitsLargeReadsIntoFramesWithinTheMaximum(t *testing.T) {
	r, address := startRelay(t)
	conn, _ := net.Dial("tcp", address)
	defer conn.Close()
	r.next() // OPEN
	const total = 3 * frameMaxPayloadBytes
	go func() { _, _ = conn.Write(make([]byte, total)) }()
	received := 0
	for received < total {
		f := r.next()
		if f.typ != frameData || len(f.payload) > frameMaxPayloadBytes {
			t.Fatalf("got %d, %d bytes", f.typ, len(f.payload))
		}
		received += len(f.payload)
	}
}

func TestRelayEndsWithExitZeroWhenStdinCloses(t *testing.T) {
	r, address := startRelay(t)
	_ = r.stdin.Close()
	ended := r.next()
	if ended.typ != frameEnded || string(ended.payload) != "stdin closed" {
		t.Fatalf("got %+v", ended)
	}
	if code := r.exitCode(); code != 0 {
		t.Fatalf("exit %d", code)
	}
	if conn, err := net.Dial("tcp", address); err == nil {
		_ = conn.Close()
		t.Fatal("the listener is still open")
	}
}

func TestRelayEndsWithExitZeroWhenTerminated(t *testing.T) {
	r, _ := startRelay(t)
	r.cancel()
	if ended := r.next(); ended.typ != frameEnded || string(ended.payload) != "terminated" {
		t.Fatalf("got %+v", ended)
	}
	if code := r.exitCode(); code != 0 {
		t.Fatalf("exit %d", code)
	}
}

func TestRelayEndsWithExitOneOnAMalformedFrame(t *testing.T) {
	r, _ := startRelay(t)
	go func() { _, _ = r.stdin.Write([]byte{12, 0, 0, 0, 0, 0, 0, 0, 0}) }()
	ended := r.next()
	if ended.typ != frameEnded || !strings.Contains(string(ended.payload), "unknown frame type 12") {
		t.Fatalf("got %+v: %s", ended, ended.payload)
	}
	if code := r.exitCode(); code != 1 {
		t.Fatalf("exit %d", code)
	}
}

func TestRelayEndsWithExitOneOnAnOversizeFrame(t *testing.T) {
	r, _ := startRelay(t)
	go func() { _, _ = r.stdin.Write([]byte{4, 0, 0, 0, 1, 0, 0x10, 0, 1}) }()
	if ended := r.next(); ended.typ != frameEnded {
		t.Fatalf("got %+v", ended)
	}
	if code := r.exitCode(); code != 1 {
		t.Fatalf("exit %d", code)
	}
}

func TestListeningIsOn127001Only(t *testing.T) {
	for _, address := range []string{"0.0.0.0:0", ":0", "localhost:0", "[::1]:0", "192.168.1.5:0", "127.0.0.1"} {
		if listener, err := listenLocal(address); err == nil {
			_ = listener.Close()
			t.Errorf("%q was accepted", address)
		}
	}
	listener, err := listenLocal("127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	if !strings.HasPrefix(listener.Addr().String(), "127.0.0.1:") {
		t.Fatalf("listening on %s", listener.Addr())
	}
}

func TestTheCommandLine(t *testing.T) {
	var out, errs strings.Builder
	if code := run([]string{"--version"}, strings.NewReader(""), &out, &errs); code != 0 || out.String() != version+"\n" {
		t.Fatalf("--version: %d %q", code, out.String())
	}
	out.Reset()
	if code := run([]string{"relay", "--listen", "0.0.0.0:0"}, strings.NewReader(""), &out, &errs); code == 0 || !strings.Contains(errs.String(), "127.0.0.1") || out.Len() != 0 {
		t.Fatalf("relay on 0.0.0.0: %d %q %q", code, out.String(), errs.String())
	}
	if code := run([]string{"nonsense"}, strings.NewReader(""), &out, &errs); code == 0 {
		t.Fatal("an unknown command succeeded")
	}
}
