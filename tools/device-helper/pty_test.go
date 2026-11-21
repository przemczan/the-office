//go:build linux

package main

import (
	"context"
	"errors"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
	"unsafe"
)

const (
	signalsOff   = `{"dataTerminalReady":false,"requestToSend":false}`
	signalsOn    = `{"dataTerminalReady":true,"requestToSend":true}`
	settings9600 = `{"baudRate":9600,"dataBits":8,"parity":"none","stopBits":1}`
	frameWait    = 5 * time.Second
)

type runningPty struct {
	t         *testing.T
	stdin     *io.PipeWriter
	frames    chan frame
	exited    chan struct{}
	code      int
	stderr    strings.Builder
	cancel    context.CancelFunc
	path      string
	keepPings bool
}

func testPtyConfig(t *testing.T) ptyConfig {
	t.Helper()
	config := defaultPtyConfig()
	config.version = "1.2.3"
	config.pathPrefix = filepath.Join(t.TempDir(), "ttyACM")
	config.pingInterval = time.Hour
	config.lookPath = func(string) (string, error) { return "/usr/bin/avrdude", nil }
	return config
}

// startPty runs the helper and reads its greeting up to the first SETTINGS.
func startPty(t *testing.T, config ptyConfig) *runningPty {
	t.Helper()
	stdinReader, stdinWriter := io.Pipe()
	stdoutReader, stdoutWriter := io.Pipe()
	ctx, cancel := context.WithCancel(context.Background())
	r := &runningPty{t: t, stdin: stdinWriter, frames: make(chan frame, 1024), exited: make(chan struct{}), cancel: cancel}
	go func() {
		r.code = runPty(ctx, config, stdinReader, stdoutWriter, &r.stderr)
		close(r.exited)
		_ = stdoutWriter.Close()
	}()
	go func() {
		defer close(r.frames)
		for {
			f, err := readFrame(stdoutReader)
			if err != nil {
				return
			}
			r.frames <- f
		}
	}()
	t.Cleanup(func() {
		cancel()
		_ = stdinWriter.Close()
		select {
		case <-r.exited:
		case <-time.After(frameWait):
			t.Error("the helper did not exit")
		}
		_ = stdoutReader.Close()
	})

	r.expect(frameHello, 0, "1.2.3")
	ready := r.next()
	if ready.typ != frameReady || !strings.HasPrefix(string(ready.payload), config.pathPrefix) {
		t.Fatalf("second frame is %d %q", ready.typ, ready.payload)
	}
	r.path = string(ready.payload)
	r.expect(frameSettings, 0, settings9600)
	return r
}

func (r *runningPty) next() frame {
	r.t.Helper()
	deadline := time.After(frameWait)
	for {
		select {
		case f, ok := <-r.frames:
			if !ok {
				r.t.Fatalf("the helper's output ended: %s", r.stderrIfExited())
			}
			if f.typ == framePing && !r.keepPings {
				continue
			}
			return f
		case <-deadline:
			r.t.Fatal("no frame came")
		}
	}
}

func (r *runningPty) stderrIfExited() string {
	select {
	case <-r.exited:
		return r.stderr.String()
	default:
		return ""
	}
}

func (r *runningPty) expect(typ frameType, channel uint32, payload string) {
	r.t.Helper()
	f := r.next()
	if f.typ != typ || f.channel != channel || string(f.payload) != payload {
		r.t.Fatalf("want %d on %d %q, got %d on %d %q", typ, channel, payload, f.typ, f.channel, f.payload)
	}
}

// expectData reads DATA frames on the channel until they carry want.
func (r *runningPty) expectData(channel uint32, want string) {
	r.t.Helper()
	var got []byte
	for len(got) < len(want) {
		f := r.next()
		if f.typ != frameData || f.channel != channel {
			r.t.Fatalf("want DATA on %d, got %d on %d %q", channel, f.typ, f.channel, f.payload)
		}
		got = append(got, f.payload...)
	}
	if string(got) != want {
		r.t.Fatalf("DATA carried %q, want %q", got, want)
	}
}

func (r *runningPty) send(f frame) {
	r.t.Helper()
	if err := writeFrame(r.stdin, f); err != nil {
		r.t.Fatal(err)
	}
}

func (r *runningPty) exitCode() int {
	r.t.Helper()
	select {
	case <-r.exited:
		return r.code
	case <-time.After(frameWait):
		r.t.Fatal("the helper did not exit")
		return -1
	}
}

// openTool opens the port as a tool does and reads the session's start.
func (r *runningPty) openTool(channel uint32) *os.File {
	r.t.Helper()
	tool, err := os.OpenFile(r.path, os.O_RDWR|syscall.O_NOCTTY, 0)
	if err != nil {
		r.t.Fatal(err)
	}
	r.t.Cleanup(func() { _ = tool.Close() })
	r.expect(frameOpen, channel, "")
	r.expect(frameSignals, 0, signalsOff)
	r.expect(frameSignals, 0, signalsOn)
	return tool
}

// closeTool closes the port and reads the session's end, up to its CLOSE.
func (r *runningPty) closeTool(tool *os.File, channel uint32) {
	r.t.Helper()
	if err := tool.Close(); err != nil {
		r.t.Fatal(err)
	}
	r.expect(frameSignals, 0, signalsOff)
	r.expect(frameClose, channel, "")
}

func write(t *testing.T, tool *os.File, data string) {
	t.Helper()
	if _, err := tool.Write([]byte(data)); err != nil {
		t.Fatal(err)
	}
}

func readExactly(t *testing.T, tool *os.File, want string) {
	t.Helper()
	_ = tool.SetReadDeadline(time.Now().Add(frameWait))
	got := make([]byte, len(want))
	if _, err := io.ReadFull(tool, got); err != nil || string(got) != want {
		t.Fatalf("the tool read %q, %v; want %q", got, err, want)
	}
}

// setLine sets the port's line as a tool's tcsetattr does.
func setLine(t *testing.T, tool *os.File, flags uint32) {
	t.Helper()
	conn, err := tool.SyscallConn()
	if err != nil {
		t.Fatal(err)
	}
	if controlErr := conn.Control(func(fd uintptr) {
		var termios syscall.Termios
		if err = ioctl(int(fd), syscall.TCGETS, unsafe.Pointer(&termios)); err != nil {
			return
		}
		termios.Cflag = termios.Cflag&^(cbaud|syscall.CSIZE|syscall.PARENB|syscall.PARODD|syscall.CSTOPB) | flags
		err = ioctl(int(fd), syscall.TCSETS, unsafe.Pointer(&termios))
	}); controlErr != nil {
		t.Fatal(controlErr)
	}
	if err != nil {
		t.Fatal(err)
	}
}

func TestPtyClaimsTheLowestFreePath(t *testing.T) {
	config := testPtyConfig(t)
	if err := os.WriteFile(config.pathPrefix+"0", nil, 0o600); err != nil {
		t.Fatal(err)
	}
	r := startPty(t, config)
	if r.path != config.pathPrefix+"1" {
		t.Fatalf("claimed %s", r.path)
	}
	if target, err := os.Readlink(r.path); err != nil || !strings.HasPrefix(target, "/dev/pts/") {
		t.Fatalf("the link is to %q, %v", target, err)
	}
}

func TestPtyRemovesStaleLinksAndReusesTheirNumber(t *testing.T) {
	config := testPtyConfig(t)
	stale := config.pathPrefix + "0"
	kept := []string{config.pathPrefix + "1", config.pathPrefix + "x"}
	for path, target := range map[string]string{stale: "/dev/pts/987654", kept[0]: "/nowhere/987654", kept[1]: "/dev/pts/987654"} {
		if err := os.Symlink(target, path); err != nil {
			t.Fatal(err)
		}
	}
	r := startPty(t, config)
	if r.path != stale {
		t.Fatalf("claimed %s", r.path)
	}
	if target, err := os.Readlink(stale); err != nil || target == "/dev/pts/987654" {
		t.Fatalf("the stale link is still to %q, %v", target, err)
	}
	for _, path := range kept {
		if _, err := os.Lstat(path); err != nil {
			t.Fatalf("%s was removed: %v", path, err)
		}
	}
}

func TestPtyGivesThePortToItsOwner(t *testing.T) {
	config := testPtyConfig(t)
	root := os.Geteuid() == 0
	if root {
		config.owner = &fileOwner{uid: 1234, gid: 5678}
	}
	r := startPty(t, config)
	info, err := os.Stat(r.path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o660 {
		t.Fatalf("mode %v", info.Mode())
	}
	if !root {
		t.Skip("chown needs root")
	}
	if stat := info.Sys().(*syscall.Stat_t); stat.Uid != 1234 || stat.Gid != 5678 {
		t.Fatalf("owned by %d:%d", stat.Uid, stat.Gid)
	}
}

func TestPtyOpensAndClosesASessionWithTheSignalsOfARealPort(t *testing.T) {
	r := startPty(t, testPtyConfig(t))
	tool := r.openTool(1)
	// A second open of the same session is no new session.
	second, err := os.OpenFile(r.path, os.O_RDONLY|syscall.O_NOCTTY, 0)
	if err != nil {
		t.Fatal(err)
	}
	_ = second.Close()
	r.closeTool(tool, 1)
	r.openTool(2)
}

func TestPtyCarriesBytesBothWays(t *testing.T) {
	r := startPty(t, testPtyConfig(t))
	r.send(frame{typ: frameData, channel: 1, payload: []byte("early")})
	// The helper reads a frame only once it handled the one before.
	r.send(frame{typ: framePong, channel: 0, payload: []byte(`{"id":1}`)})
	tool := r.openTool(1)
	write(t, tool, "hello")
	r.expectData(1, "hello")
	r.send(frame{typ: frameData, channel: 99, payload: []byte("lost")})
	r.send(frame{typ: frameData, channel: 1, payload: []byte("world")})
	readExactly(t, tool, "world")
}

func TestPtySendsSettingsBeforeTheDataWrittenAfterThem(t *testing.T) {
	r := startPty(t, testPtyConfig(t))
	tool := r.openTool(1)
	// The kernel keeps a pseudo-terminal at CS8 without parity, whatever a tool sets.
	setLine(t, tool, syscall.B115200|syscall.CS7|syscall.PARENB|syscall.CSTOPB)
	write(t, tool, "x")
	r.expect(frameSettings, 0, `{"baudRate":115200,"dataBits":8,"parity":"none","stopBits":2}`)
	r.expectData(1, "x")
	// Settings changed without a write are polled.
	setLine(t, tool, syscall.B57600|syscall.CS8)
	r.expect(frameSettings, 0, `{"baudRate":57600,"dataBits":8,"parity":"none","stopBits":1}`)
}

func TestSettingsAreReadFromTheLine(t *testing.T) {
	for _, c := range []struct {
		cflag, ospeed uint32
		want          serialSettings
		known         bool
	}{
		{syscall.B9600 | syscall.CS8, 0, serialSettings{9600, 8, "none", 1}, true},
		{syscall.B115200 | syscall.CS7 | syscall.PARENB | syscall.CSTOPB, 0, serialSettings{115200, 7, "even", 2}, true},
		{syscall.B4000000 | syscall.CS5 | syscall.PARENB | syscall.PARODD, 0, serialSettings{4000000, 5, "odd", 1}, true},
		{bother | syscall.CS6, 250000, serialSettings{250000, 6, "none", 1}, true},
		{syscall.B0 | syscall.CS8, 0, serialSettings{}, false},
	} {
		got, known := settingsOf(termios2{Cflag: c.cflag, Ospeed: c.ospeed})
		if got != c.want || known != c.known {
			t.Errorf("cflag %#x: %+v %v, want %+v %v", c.cflag, got, known, c.want, c.known)
		}
	}
}

func TestPtyForwardsWhatAToolWroteBeforeClosing(t *testing.T) {
	r := startPty(t, testPtyConfig(t))
	tool := r.openTool(1)
	write(t, tool, strings.Repeat("z", 3000))
	_ = tool.Close()
	r.expectData(1, strings.Repeat("z", 3000))
	r.expect(frameSignals, 0, signalsOff)
	r.expect(frameClose, 1, "")
}

func TestPtyNoticesA1200BaudTouch(t *testing.T) {
	r := startPty(t, testPtyConfig(t))
	tool := r.openTool(1)
	setLine(t, tool, syscall.B1200|syscall.CS8)
	r.expect(frameSettings, 0, `{"baudRate":1200,"dataBits":8,"parity":"none","stopBits":1}`)
	r.closeTool(tool, 1)
	r.expect(frameNotice, 0, `{"code":"touch-1200"}`)
}

func TestPtyNoticesABoardThatDoesNotAnswer(t *testing.T) {
	r := startPty(t, testPtyConfig(t))
	tool := r.openTool(1)
	write(t, tool, "abc")
	r.expectData(1, "abc")
	r.closeTool(tool, 1)
	r.expect(frameNotice, 0, `{"code":"no-answer-after-reset"}`)

	// The board answers: nothing to notice, so the next frame is the next session's.
	tool = r.openTool(2)
	write(t, tool, "abc")
	r.expectData(2, "abc")
	r.send(frame{typ: frameData, channel: 2, payload: []byte("ok")})
	readExactly(t, tool, "ok")
	r.closeTool(tool, 2)
	r.openTool(3)
}

func TestPtyNoticesAnUnansweredEsptoolSyncOnce(t *testing.T) {
	r := startPty(t, testPtyConfig(t))
	sync := string([]byte{0xC0, 0x00, 0x08, 0x24, 0x00})

	tool := r.openTool(1)
	write(t, tool, sync)
	r.expectData(1, sync)
	r.send(frame{typ: frameData, channel: 1, payload: []byte{0xC0, 0x01}})
	r.send(frame{typ: frameData, channel: 1, payload: []byte{0x08, 0x04}})
	readExactly(t, tool, string([]byte{0xC0, 0x01, 0x08, 0x04}))
	r.closeTool(tool, 1)

	tool = r.openTool(2)
	write(t, tool, sync)
	r.expectData(2, sync)
	r.closeTool(tool, 2)
	r.expect(frameNotice, 0, `{"code":"esptool-sync-no-answer"}`)

	tool = r.openTool(3)
	write(t, tool, sync)
	r.expectData(3, sync)
	r.closeTool(tool, 3)
	r.expect(frameNotice, 0, `{"code":"no-answer-after-reset"}`)
}

func TestPtyNoticesNoUploadTool(t *testing.T) {
	config := testPtyConfig(t)
	t.Setenv("PATH", t.TempDir())
	config.lookPath = exec.LookPath
	r := startPty(t, config)
	r.expect(frameNotice, 0, `{"code":"no-upload-tool"}`)
}

func TestPtyNoticesNoMissingUploadToolWhenAvrdudeIsThere(t *testing.T) {
	config := testPtyConfig(t)
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "avrdude"), []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir)
	config.lookPath = exec.LookPath
	r := startPty(t, config)
	r.openTool(1)
}

func TestPtyPingsTheBrowser(t *testing.T) {
	config := testPtyConfig(t)
	config.pingInterval = 20 * time.Millisecond
	r := startPty(t, config)
	r.keepPings = true
	r.expect(framePing, 0, `{"id":1}`)
	r.expect(framePing, 0, `{"id":2}`)
}

func TestPtyEndsWhenStdinClosesAndRemovesItsLink(t *testing.T) {
	r := startPty(t, testPtyConfig(t))
	_ = r.stdin.Close()
	r.expect(frameEnded, 0, "stdin closed")
	if code := r.exitCode(); code != 0 {
		t.Fatalf("exit %d", code)
	}
	if _, err := os.Lstat(r.path); !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("the link is still there: %v", err)
	}
}

func TestPtyEndsWhenTerminated(t *testing.T) {
	r := startPty(t, testPtyConfig(t))
	r.openTool(1)
	r.cancel()
	r.expect(frameEnded, 0, "terminated")
	if code := r.exitCode(); code != 0 {
		t.Fatalf("exit %d", code)
	}
	if _, err := os.Lstat(r.path); !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("the link is still there: %v", err)
	}
}

func TestPtyEndsWithExitOneOnAMalformedFrame(t *testing.T) {
	r := startPty(t, testPtyConfig(t))
	go func() { _, _ = r.stdin.Write([]byte{12, 0, 0, 0, 0, 0, 0, 0, 0}) }()
	f := r.next()
	if f.typ != frameEnded || !strings.Contains(string(f.payload), "unknown frame type 12") {
		t.Fatalf("got %d %q", f.typ, f.payload)
	}
	if code := r.exitCode(); code != 1 {
		t.Fatalf("exit %d", code)
	}
}

func TestByteWatchMatchesAcrossReads(t *testing.T) {
	for _, reads := range [][]string{
		{"\xc0\x00\x08"},
		{"ab\xc0", "\x00\x08cd"},
		{"\xc0", "\x00", "\x08"},
		{"x\xc0\x00", "\x08"},
	} {
		watch := byteWatch{pattern: esptoolSyncRequest}
		for _, read := range reads {
			watch.feed([]byte(read))
		}
		if !watch.seen {
			t.Errorf("%q not seen", reads)
		}
	}
	watch := byteWatch{pattern: esptoolSyncRequest}
	for _, read := range []string{"\xc0", "\x01", "\x08", "\xc0\x00", "x\x08"} {
		watch.feed([]byte(read))
	}
	if watch.seen {
		t.Error("seen in bytes that don't hold it")
	}
}

func TestThePtyCommandLine(t *testing.T) {
	var out, errs strings.Builder
	if code := run([]string{"pty", "--owner", "nobody"}, strings.NewReader(""), &out, &errs); code != 2 || !strings.Contains(errs.String(), "--owner") || out.Len() != 0 {
		t.Fatalf("a bad owner: %d %q %q", code, out.String(), errs.String())
	}
	if owner, err := parseOwner("1000:1001"); err != nil || *owner != (fileOwner{uid: 1000, gid: 1001}) {
		t.Fatalf("parsed %+v, %v", owner, err)
	}
}
