//go:build linux

package main

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net"
	"os"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

var settings9600N1 = serialSettings{BaudRate: 9600, DataBits: 8, Parity: "none", StopBits: 1}

// sub is a COM-PORT-OPTION sub-negotiation as a client sends it.
func sub(command byte, value ...byte) []byte {
	out := []byte{telnetIAC, telnetSB, telnetComPort, command}
	return append(escapeIAC(out, value), telnetIAC, telnetSE)
}

// eventsText writes events as tests compare them.
func eventsText(t *testing.T, events []rfc2217Event) string {
	t.Helper()
	var parts []string
	for _, e := range events {
		var text []byte
		var err error
		switch {
		case e.data != nil:
			text = append([]byte("data "), e.data...)
		case e.settings != nil:
			text, err = json.Marshal(e.settings)
		case e.signals != nil:
			text, err = json.Marshal(e.signals)
		}
		if err != nil {
			t.Fatal(err)
		}
		parts = append(parts, string(text))
	}
	return strings.Join(parts, " | ")
}

func TestRfc2217NegotiatesOnlyWhatChanges(t *testing.T) {
	s := newRfc2217Server(settings9600N1)
	for _, c := range []struct {
		name        string
		input, want []byte
	}{
		{"DO ECHO", []byte{telnetIAC, telnetDo, 1}, []byte{telnetIAC, telnetWont, 1}},
		{"WILL ECHO", []byte{telnetIAC, telnetWill, 1}, []byte{telnetIAC, telnetDont, 1}},
		{"WILL TERMINAL-TYPE", []byte{telnetIAC, telnetWill, 24}, []byte{telnetIAC, telnetDont, 24}},
		{"DO COM-PORT, asked", []byte{telnetIAC, telnetDo, telnetComPort}, nil},
		{"WILL COM-PORT, asked", []byte{telnetIAC, telnetWill, telnetComPort}, nil},
		{"DO COM-PORT again", []byte{telnetIAC, telnetDo, telnetComPort}, nil},
		{"DO BINARY", []byte{telnetIAC, telnetDo, telnetBinary}, []byte{telnetIAC, telnetWill, telnetBinary}},
		{"DO BINARY again", []byte{telnetIAC, telnetDo, telnetBinary}, nil},
		{"WILL BINARY", []byte{telnetIAC, telnetWill, telnetBinary}, []byte{telnetIAC, telnetDo, telnetBinary}},
		{"DONT BINARY", []byte{telnetIAC, telnetDont, telnetBinary}, []byte{telnetIAC, telnetWont, telnetBinary}},
		{"DONT BINARY again", []byte{telnetIAC, telnetDont, telnetBinary}, nil},
		{"WONT BINARY", []byte{telnetIAC, telnetWont, telnetBinary}, []byte{telnetIAC, telnetDont, telnetBinary}},
		{"WONT BINARY again", []byte{telnetIAC, telnetWont, telnetBinary}, nil},
		{"WILL SGA", []byte{telnetIAC, telnetWill, telnetSuppressGoAhead}, []byte{telnetIAC, telnetDo, telnetSuppressGoAhead}},
		{"DO SGA", []byte{telnetIAC, telnetDo, telnetSuppressGoAhead}, []byte{telnetIAC, telnetWill, telnetSuppressGoAhead}},
	} {
		events, reply := s.feed(c.input)
		if !bytes.Equal(reply, c.want) || len(events) != 0 {
			t.Errorf("%s: answered % x with %d events, want % x", c.name, reply, len(events), c.want)
		}
	}
}

func TestRfc2217AnswersEachCommand(t *testing.T) {
	s := newRfc2217Server(settings9600N1)
	answer := func(command byte, value ...byte) []byte { return sub(command+comServerOffset, value...) }
	for _, c := range []struct {
		name   string
		input  []byte
		want   []byte
		events string
	}{
		{"baud query", sub(1, 0, 0, 0, 0), answer(1, 0, 0, 0x25, 0x80), ""},
		{"baud 115200", sub(1, 0, 1, 0xc2, 0), answer(1, 0, 1, 0xc2, 0), `{"baudRate":115200,"dataBits":8,"parity":"none","stopBits":1}`},
		{"baud 115200 again", sub(1, 0, 1, 0xc2, 0), answer(1, 0, 1, 0xc2, 0), ""},
		{"baud too short", sub(1, 0, 1), answer(1, 0, 1, 0xc2, 0), ""},
		{"data size 7", sub(2, 7), answer(2, 7), `{"baudRate":115200,"dataBits":7,"parity":"none","stopBits":1}`},
		{"data size query", sub(2, 0), answer(2, 7), ""},
		{"data size 9", sub(2, 9), answer(2, 7), ""},
		{"parity odd", sub(3, 2), answer(3, 2), `{"baudRate":115200,"dataBits":7,"parity":"odd","stopBits":1}`},
		{"parity even", sub(3, 3), answer(3, 3), `{"baudRate":115200,"dataBits":7,"parity":"even","stopBits":1}`},
		{"parity mark", sub(3, 4), answer(3, 3), ""},
		{"parity query", sub(3, 0), answer(3, 3), ""},
		{"parity none", sub(3, 1), answer(3, 1), `{"baudRate":115200,"dataBits":7,"parity":"none","stopBits":1}`},
		{"stop bits 2", sub(4, 2), answer(4, 2), `{"baudRate":115200,"dataBits":7,"parity":"none","stopBits":2}`},
		{"stop bits 1.5", sub(4, 3), answer(4, 2), ""},
		{"stop bits query", sub(4, 0), answer(4, 2), ""},
		{"DTR query", sub(5, 7), answer(5, 9), ""},
		{"RTS query", sub(5, 10), answer(5, 12), ""},
		{"DTR on", sub(5, 8), answer(5, 8), `{"dataTerminalReady":true,"requestToSend":false}`},
		{"DTR on again", sub(5, 8), answer(5, 8), `{"dataTerminalReady":true,"requestToSend":false}`},
		{"DTR query on", sub(5, 7), answer(5, 8), ""},
		{"RTS on", sub(5, 11), answer(5, 11), `{"dataTerminalReady":true,"requestToSend":true}`},
		{"RTS query on", sub(5, 10), answer(5, 11), ""},
		{"DTR off", sub(5, 9), answer(5, 9), `{"dataTerminalReady":false,"requestToSend":true}`},
		{"RTS off", sub(5, 12), answer(5, 12), `{"dataTerminalReady":false,"requestToSend":false}`},
		{"no flow control", sub(5, 1), answer(5, 1), ""},
		{"hardware flow control", sub(5, 3), answer(5, 1), ""},
		{"flow control query", sub(5, 0), answer(5, 1), ""},
		{"break on", sub(5, 5), answer(5, 6), ""},
		{"inbound flow control query", sub(5, 13), answer(5, 14), ""},
		{"line state", sub(6), answer(6, 0x60), ""},
		{"modem state", sub(7), answer(7, 0xb0), ""},
		{"flow control suspend", sub(8), nil, ""},
		{"flow control resume", sub(9), nil, ""},
		{"line state mask", sub(10, 0xff), answer(10, 0xff), ""},
		{"modem state mask", sub(11, 0x0f), answer(11, 0x0f), ""},
		{"purge both", sub(12, 3), answer(12, 3), ""},
		{"signature", sub(0, 'x'), answer(0, 'x'), ""},
		{"unknown", sub(42, 1, 2), answer(42, 1, 2), ""},
		{"another option", []byte{telnetIAC, telnetSB, 24, 1, telnetIAC, telnetSE}, nil, ""},
	} {
		events, reply := s.feed(c.input)
		if !bytes.Equal(reply, c.want) || eventsText(t, events) != c.events {
			t.Errorf("%s: answered % x with %q, want % x with %q", c.name, reply, eventsText(t, events), c.want, c.events)
		}
	}
}

func TestRfc2217UnescapesTheClientsBytesHoweverSplit(t *testing.T) {
	s := newRfc2217Server(settings9600N1)
	var got []string
	for _, input := range []string{"a\xff", "\xffb\xff", "\xf1c\xff\xfa\x2c\x01\x00", "\x00\x00\xff\xff\xff", "\xf0d"} {
		events, reply := s.feed([]byte(input))
		if len(events) > 0 {
			got = append(got, eventsText(t, events))
		}
		if len(reply) > 0 {
			got = append(got, hex.EncodeToString(reply))
		}
	}
	// IAC NOP is dropped; the baud rate 255 comes escaped both ways.
	want := []string{"data a", "data \xffb", "data c", `{"baudRate":255,"dataBits":8,"parity":"none","stopBits":1} | data d`, "fffa2c65000000fffffff0"}
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestRfc2217KeepsTheClientsOrder(t *testing.T) {
	s := newRfc2217Server(settings9600N1)
	input := append(append([]byte("x"), sub(5, 8)...), 'y')
	events, _ := s.feed(input)
	if got := eventsText(t, events); got != `data x | {"dataTerminalReady":true,"requestToSend":false} | data y` {
		t.Fatalf("events %q", got)
	}
}

func TestEscapeIACDoublesEach0xFF(t *testing.T) {
	if got := escapeIAC([]byte{1}, []byte{0xff, 2, 0xff}); !bytes.Equal(got, []byte{1, 0xff, 0xff, 2, 0xff, 0xff}) {
		t.Fatalf("% x", got)
	}
}

// dialRfc2217 connects to the helper's RFC 2217 port.
func (r *runningPty) dialRfc2217() net.Conn {
	r.t.Helper()
	address, found := strings.CutPrefix(r.rfc2217, "rfc2217://")
	if !found {
		r.t.Fatalf("no RFC 2217 address in READY: %q", r.rfc2217)
	}
	conn, err := net.Dial("tcp4", address)
	if err != nil {
		r.t.Fatal(err)
	}
	r.t.Cleanup(func() { _ = conn.Close() })
	return conn
}

// connectRfc2217 connects and reads the session's start and the server's greeting.
func (r *runningPty) connectRfc2217(channel uint32) net.Conn {
	r.t.Helper()
	conn := r.dialRfc2217()
	r.expect(frameOpen, channel, "")
	expectBytes(r.t, conn, rfc2217Greeting)
	return conn
}

func sendBytes(t *testing.T, conn net.Conn, data []byte) {
	t.Helper()
	if _, err := conn.Write(data); err != nil {
		t.Fatal(err)
	}
}

func expectBytes(t *testing.T, conn net.Conn, want []byte) {
	t.Helper()
	_ = conn.SetReadDeadline(time.Now().Add(frameWait))
	got := make([]byte, len(want))
	if n, err := io.ReadFull(conn, got); err != nil || !bytes.Equal(got, want) {
		t.Fatalf("the client read % x, %v; want % x", got[:n], err, want)
	}
}

// expectClosed checks that the server closed the connection without a byte.
func expectClosed(t *testing.T, conn net.Conn) {
	t.Helper()
	_ = conn.SetReadDeadline(time.Now().Add(frameWait))
	var one [1]byte
	if n, err := conn.Read(one[:]); n != 0 || err == nil || errors.Is(err, os.ErrDeadlineExceeded) {
		t.Fatalf("the connection is open: %d, %v", n, err)
	}
}

// replay plays a client's side of a recorded exchange (testdata's format).
func replay(t *testing.T, conn net.Conn, path string) {
	t.Helper()
	text, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	for number, line := range strings.Split(string(text), "\n") {
		line, _, _ = strings.Cut(line, "#")
		fields := strings.Fields(line)
		if len(fields) == 0 {
			continue
		}
		if fields[0] == "sleep" && len(fields) == 2 {
			wait, err := time.ParseDuration(fields[1])
			if err != nil {
				t.Fatalf("line %d: %v", number+1, err)
			}
			time.Sleep(wait)
			continue
		}
		data, err := hex.DecodeString(strings.Join(fields[1:], ""))
		if err != nil {
			t.Fatalf("line %d: %v", number+1, err)
		}
		switch fields[0] {
		case ">":
			sendBytes(t, conn, data)
		case "<":
			expectBytes(t, conn, data)
		default:
			t.Fatalf("line %d: %q", number+1, line)
		}
	}
}

func TestRfc2217TakesPyserialAndEsptoolThroughAReset(t *testing.T) {
	r := startPty(t, testPtyConfig(t))
	conn := r.dialRfc2217()
	replay(t, conn, "testdata/pyserial-esptool-rfc2217.txt")

	r.expect(frameOpen, 1, "")
	// pyserial raises the lines itself; the first settings are the ones the browser has.
	r.expect(frameSignals, 0, `{"dataTerminalReady":true,"requestToSend":false}`)
	r.expect(frameSignals, 0, signalsOn)
	r.expect(frameSettings, 0, `{"baudRate":115200,"dataBits":8,"parity":"none","stopBits":1}`)
	first := len(r.stamps)
	for _, signals := range []string{
		`{"dataTerminalReady":false,"requestToSend":true}`,
		`{"dataTerminalReady":false,"requestToSend":true}`,
		`{"dataTerminalReady":false,"requestToSend":true}`,
		signalsOn,
		`{"dataTerminalReady":true,"requestToSend":false}`,
		`{"dataTerminalReady":true,"requestToSend":false}`,
		signalsOff,
	} {
		r.expect(frameSignals, 0, signals)
	}
	reset := r.stamps[first:]
	if held := reset[3] - reset[2]; held < 99_000 {
		t.Errorf("the reset was held %d µs, want the client's 100 ms", held)
	}
	if delay := reset[6] - reset[5]; delay < 49_000 {
		t.Errorf("the bootloader pin was held %d µs, want the client's 50 ms", delay)
	}
	r.expectData(1, "\xc0\x00\x08\x24\x00\x00\x00\x00\x00\x07\x07\x12\x20"+strings.Repeat("\x55", 32)+"\xc0")

	_ = conn.Close()
	r.expect(frameSignals, 0, signalsOff)
	r.expect(frameClose, 1, "")
}

func TestRfc2217CarriesBytesBothWaysEscaped(t *testing.T) {
	r := startPty(t, testPtyConfig(t))
	conn := r.connectRfc2217(1)
	sendBytes(t, conn, []byte("a\xff\xffb"))
	r.expectData(1, "a\xffb")
	r.send(frame{typ: frameData, channel: 1, payload: []byte("\xffz")})
	expectBytes(t, conn, []byte("\xff\xffz"))
	_ = conn.Close()
	r.expect(frameSignals, 0, signalsOff)
	r.expect(frameClose, 1, "")
}

func TestRfc2217RefusesAClientWhileThePtyIsOpen(t *testing.T) {
	r := startPty(t, testPtyConfig(t))
	tool := r.openTool(1)
	expectClosed(t, r.dialRfc2217())
	r.expect(frameNotice, 0, `{"code":"port-busy"}`)
	write(t, tool, "still")
	r.expectData(1, "still")
	r.closeTool(tool, 1)
	r.expect(frameNotice, 0, `{"code":"no-answer-after-reset"}`)
	r.connectRfc2217(2)
}

func TestRfc2217RefusesASecondClient(t *testing.T) {
	r := startPty(t, testPtyConfig(t))
	conn := r.connectRfc2217(1)
	expectClosed(t, r.dialRfc2217())
	r.expect(frameNotice, 0, `{"code":"port-busy"}`)
	sendBytes(t, conn, sub(comSetControl, controlDTROn))
	expectBytes(t, conn, sub(comSetControl+comServerOffset, controlDTROn))
	r.expect(frameSignals, 0, `{"dataTerminalReady":true,"requestToSend":false}`)
}

func TestThePtyIsBusyWhileAnRfc2217ClientIsConnected(t *testing.T) {
	r := startPty(t, testPtyConfig(t))
	conn := r.connectRfc2217(1)
	// TIOCEXCL makes the open fail as a busy port's does, with no notice, as the helper can't see a
	// failed open; one with CAP_SYS_ADMIN gets through and is busy.
	tool, err := os.OpenFile(r.path, os.O_RDWR|syscall.O_NOCTTY, 0)
	switch {
	case errors.Is(err, syscall.EBUSY):
	case err != nil:
		t.Fatal(err)
	default:
		r.expect(frameNotice, 0, `{"code":"port-busy"}`)
		write(t, tool, "lost")
		// Give the helper the time to read what it drops.
		time.Sleep(50 * time.Millisecond)
		_ = tool.Close()
	}
	_ = conn.Close()
	r.expect(frameSignals, 0, signalsOff)
	r.expect(frameClose, 1, "")

	tool = r.openTool(2)
	write(t, tool, "found")
	r.expectData(2, "found")
}

func TestPtyReadyNamesItsRfc2217PortByItsNumber(t *testing.T) {
	config := testPtyConfig(t)
	if err := os.WriteFile(config.pathPrefix+"0", nil, 0o600); err != nil {
		t.Fatal(err)
	}
	port := freePort(t)
	config.rfc2217Base = port - 1
	r := startPty(t, config)
	if r.path != config.pathPrefix+"1" || r.rfc2217 != "rfc2217://127.0.0.1:"+strconv.Itoa(port) {
		t.Fatalf("READY is %q and %q", r.path, r.rfc2217)
	}
}

func TestPtyTakesTheNextFreeRfc2217Port(t *testing.T) {
	config := testPtyConfig(t)
	taken, port := takenPortBeforeAFreeOne(t)
	defer func() { _ = taken.Close() }()
	config.rfc2217Base = port
	r := startPty(t, config)
	if r.rfc2217 != "rfc2217://127.0.0.1:"+strconv.Itoa(port+1) {
		t.Fatalf("READY's second line is %q, want port %d", r.rfc2217, port+1)
	}
}

// takenPortBeforeAFreeOne listens on a port whose next one is free.
func takenPortBeforeAFreeOne(t *testing.T) (net.Listener, int) {
	t.Helper()
	for range 20 {
		taken, err := net.Listen("tcp4", "127.0.0.1:0")
		if err != nil {
			t.Fatal(err)
		}
		port := taken.Addr().(*net.TCPAddr).Port
		if next, err := net.Listen("tcp4", "127.0.0.1:"+strconv.Itoa(port+1)); err == nil {
			_ = next.Close()
			return taken, port
		}
		_ = taken.Close()
	}
	t.Fatal("no two free ports in a row")
	return nil, 0
}

func TestPtyReadyIsThePathAloneWithoutAnRfc2217Port(t *testing.T) {
	config := testPtyConfig(t)
	config.rfc2217Base = 70000
	r := startPty(t, config)
	if r.rfc2217 != "" || !strings.Contains(r.stderr.String(), "no RFC 2217 port") {
		t.Fatalf("READY's second line is %q; stderr %q", r.rfc2217, r.stderr.String())
	}
	r.openTool(1)
}
