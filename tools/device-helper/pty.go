//go:build linux

package main

// The pty mode: a serial board the browser has open with Web Serial, shown in the run environment
// as a pseudo-terminal at a stable path (`/dev/ttyACM0`), so the Project's tools use it unchanged.
// The JSON of its control frames is the Go twin of packages/contracts/src/device-control.ts. Each
// SETTINGS and SIGNALS carries `at`, when the helper saw the change: microseconds on its monotonic
// clock since it started, so the browser can replay a reset's timing.
//
// READY carries the port's path and, on a second line, its RFC 2217 address (rfc2217.go):
// `/dev/ttyACM0\nrfc2217://127.0.0.1:2217`, or the path alone when no port could be listened on.
//
// A session is from the first open of the port by another process to the last close, or an RFC
// 2217 connection's life; the board has one at a time. One mutex guards the port's state, and
// every read of the master, of the inotify events and of an RFC 2217 client happens under it, so
// the frames go out in the order the tools and the kernel did things.

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

const (
	noticeNoAnswerAfterReset  = "no-answer-after-reset"
	noticeTouch1200           = "touch-1200"
	noticeEsptoolSyncNoAnswer = "esptool-sync-no-answer"
	noticeNoUploadTool        = "no-upload-tool"
	noticePortBusy            = "port-busy"

	maxPortNumber = 256
)

// The start of esptool's SLIP SYNC request, and of the board's answer to it.
var (
	esptoolSyncRequest  = []byte{0xC0, 0x00, 0x08}
	esptoolSyncResponse = []byte{0xC0, 0x01, 0x08}
)

var uploadTools = []string{"avrdude", "arduino-cli"}

type serialSettings struct {
	BaudRate int    `json:"baudRate"`
	DataBits int    `json:"dataBits"`
	Parity   string `json:"parity"`
	StopBits int    `json:"stopBits"`
}

type serialSignals struct {
	DataTerminalReady bool `json:"dataTerminalReady"`
	RequestToSend     bool `json:"requestToSend"`
}

// stampedSettings and stampedSignals are SETTINGS and SIGNALS as they go out, with `at`.
type stampedSettings struct {
	serialSettings
	At int64 `json:"at"`
}

type stampedSignals struct {
	serialSignals
	At int64 `json:"at"`
}

type devicePing struct {
	ID int `json:"id"`
}

type deviceNotice struct {
	Code string `json:"code"`
}

type stopReason struct {
	why  string
	code int
}

type serialSession struct {
	channel       uint32
	toolWrote     bool
	boardAnswered bool
	syncRequest   byteWatch // in what the tool wrote
	syncResponse  byteWatch // in what the board sent
}

// byteWatch notices a pattern in a stream however it is split into reads.
type byteWatch struct {
	pattern []byte
	tail    []byte
	seen    bool
}

func (w *byteWatch) feed(data []byte) {
	if w.seen || len(data) == 0 {
		return
	}
	keep := len(w.pattern) - 1
	edge := append(append([]byte(nil), w.tail...), data[:min(len(data), keep)]...)
	if bytes.Contains(edge, w.pattern) || bytes.Contains(data, w.pattern) {
		w.seen = true
		return
	}
	if len(data) >= keep {
		w.tail = append(w.tail[:0], data[len(data)-keep:]...)
	} else {
		w.tail = append(w.tail[:0], edge[max(0, len(edge)-keep):]...)
	}
}

type ptyPort struct {
	config     ptyConfig
	sender     *frameSender
	path       string // the stable path claimed, a symlink to slavePath
	number     int    // the path's number
	start      time.Time
	slavePath  string
	master     *os.File
	masterFd   int
	masterConn syscall.RawConn
	slaveFd    int // held for the helper's life, so the master never reads EIO between tools
	events     *os.File
	eventsFd   int
	eventsConn syscall.RawConn
	listener   net.Listener // RFC 2217's, or nil

	mutex          sync.Mutex
	closed         bool
	opens          int
	session        *serialSession
	rfc2217        *rfc2217Connection
	nextChannel    uint32
	sentSettings   serialSettings
	esptoolNoticed bool
	buffer         []byte
}

// runPty shows a serial board as a pseudo-terminal over `in` and `out` until `in` ends, ctx is
// done or a frame is refused. It returns the exit status: 0 for the first two, 1 otherwise, and 2
// when the port can't be set up.
func runPty(ctx context.Context, config ptyConfig, in io.Reader, out, stderr io.Writer) int {
	port, err := openPort(config)
	if err != nil {
		fmt.Fprintln(stderr, "office-device-helper:", err)
		return 2
	}
	port.listen(stderr)
	return port.serve(ctx, in, out)
}

func openPort(config ptyConfig) (port *ptyPort, err error) {
	p := &ptyPort{
		config:      config,
		masterFd:    -1,
		slaveFd:     -1,
		eventsFd:    -1,
		nextChannel: firstConnectionChannel,
		buffer:      make([]byte, copyChunkBytes),
		start:       time.Now(),
	}
	defer func() {
		if err != nil {
			p.release()
		}
	}()
	if err = p.openPair(); err != nil {
		return nil, err
	}
	if err = p.share(); err != nil {
		return nil, err
	}
	removeStaleLinks(config.pathPrefix, config.ptsDir)
	if p.path, p.number, err = claimPath(config.pathPrefix, p.slavePath); err != nil {
		return nil, err
	}
	if err = p.watchSlave(); err != nil {
		return nil, err
	}
	return p, nil
}

func (p *ptyPort) openPair() error {
	fd, err := syscall.Open(p.config.ptmxPath, syscall.O_RDWR|syscall.O_NOCTTY|syscall.O_CLOEXEC|syscall.O_NONBLOCK, 0)
	if err != nil {
		return fmt.Errorf("opening %s: %w", p.config.ptmxPath, err)
	}
	p.master, p.masterFd = os.NewFile(uintptr(fd), p.config.ptmxPath), fd
	if p.masterConn, err = p.master.SyscallConn(); err != nil {
		return err
	}
	if err := unlockPty(fd); err != nil {
		return fmt.Errorf("unlocking the pseudo-terminal: %w", err)
	}
	number, err := ptyNumber(fd)
	if err != nil {
		return fmt.Errorf("reading the pseudo-terminal's number: %w", err)
	}
	p.slavePath = p.config.ptsDir + strconv.FormatUint(uint64(number), 10)
	if p.slaveFd, err = syscall.Open(p.slavePath, syscall.O_RDWR|syscall.O_NOCTTY|syscall.O_CLOEXEC, 0); err != nil {
		p.slaveFd = -1
		return fmt.Errorf("opening %s: %w", p.slavePath, err)
	}
	return makeRaw(p.slaveFd)
}

func (p *ptyPort) share() error {
	if owner := p.config.owner; owner != nil {
		if err := os.Chown(p.slavePath, owner.uid, owner.gid); err != nil {
			return err
		}
	}
	return os.Chmod(p.slavePath, 0o660)
}

// watchSlave counts the others' opens: the helper's own open of the slave came before the watch.
func (p *ptyPort) watchSlave() error {
	fd, err := syscall.InotifyInit1(syscall.IN_CLOEXEC | syscall.IN_NONBLOCK)
	if err != nil {
		return fmt.Errorf("starting inotify: %w", err)
	}
	p.events, p.eventsFd = os.NewFile(uintptr(fd), "inotify"), fd
	if p.eventsConn, err = p.events.SyscallConn(); err != nil {
		return err
	}
	if _, err := syscall.InotifyAddWatch(fd, p.slavePath, syscall.IN_OPEN|syscall.IN_CLOSE_WRITE|syscall.IN_CLOSE_NOWRITE); err != nil {
		return fmt.Errorf("watching %s: %w", p.slavePath, err)
	}
	return nil
}

// removeStaleLinks removes `<prefix><n>` links to a pseudo-terminal that is gone, left by a helper
// that didn't end cleanly.
func removeStaleLinks(prefix, ptsDir string) {
	dir, base := filepath.Dir(prefix), filepath.Base(prefix)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, entry := range entries {
		number, found := strings.CutPrefix(entry.Name(), base)
		if !found || !isDigits(number) {
			continue
		}
		path := filepath.Join(dir, entry.Name())
		target, err := os.Readlink(path)
		if err != nil || !strings.HasPrefix(target, ptsDir) {
			continue
		}
		if _, err := os.Stat(target); errors.Is(err, fs.ErrNotExist) {
			_ = os.Remove(path)
		}
	}
}

func isDigits(text string) bool {
	if text == "" {
		return false
	}
	for _, r := range text {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

// claimPath links the lowest free `<prefix><n>` to target; the link's creation is the claim, so
// two helpers never take the same number.
func claimPath(prefix, target string) (string, int, error) {
	for n := 0; n < maxPortNumber; n++ {
		path := prefix + strconv.Itoa(n)
		err := os.Symlink(target, path)
		if err == nil {
			return path, n, nil
		}
		if !errors.Is(err, fs.ErrExist) {
			return "", 0, fmt.Errorf("linking %s: %w", path, err)
		}
	}
	return "", 0, fmt.Errorf("no free path from %s0 to %s%d", prefix, prefix, maxPortNumber-1)
}

func (p *ptyPort) serve(ctx context.Context, in io.Reader, out io.Writer) int {
	p.sender = &frameSender{out: out}
	if err := p.greet(); err != nil {
		p.release()
		return 1
	}
	done := make(chan struct{})
	go p.watchOpens()
	go p.readTool()
	go p.tick(done)
	if p.listener != nil {
		go p.acceptRfc2217()
	}
	stopped := make(chan stopReason, 1)
	go func() {
		why, code := p.readInput(in)
		stopped <- stopReason{why, code}
	}()

	var reason stopReason
	select {
	case reason = <-stopped:
	case <-ctx.Done():
		reason = stopReason{"terminated", 0}
	}
	close(done)
	p.shutdown()
	p.sender.end(reason.why)
	return reason.code
}

func (p *ptyPort) greet() error {
	if err := p.sender.send(frame{typ: frameHello, channel: controlChannel, payload: []byte(p.config.version)}); err != nil {
		return err
	}
	ready := p.path
	if p.listener != nil {
		ready += "\nrfc2217://" + p.listener.Addr().String()
	}
	if err := p.sender.send(frame{typ: frameReady, channel: controlChannel, payload: []byte(ready)}); err != nil {
		return err
	}
	if settings, ok := p.currentSettings(); ok {
		p.sentSettings = settings
		if err := p.sendSettings(settings); err != nil {
			return err
		}
	}
	if !p.uploadToolFound() {
		return p.sendControl(frameNotice, deviceNotice{Code: noticeNoUploadTool})
	}
	return nil
}

func (p *ptyPort) uploadToolFound() bool {
	for _, tool := range uploadTools {
		if _, err := p.config.lookPath(tool); err == nil {
			return true
		}
	}
	return false
}

func (p *ptyPort) sendControl(typ frameType, value any) error {
	payload, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return p.sender.send(frame{typ: typ, channel: controlChannel, payload: payload})
}

// sendSettings and sendSignals stamp the change; the mutex is held (or nothing else runs yet), so
// the stamps go out in order.
func (p *ptyPort) sendSettings(settings serialSettings) error {
	return p.sendControl(frameSettings, stampedSettings{serialSettings: settings, At: p.stamp()})
}

func (p *ptyPort) sendSignals(signals serialSignals) error {
	return p.sendControl(frameSignals, stampedSignals{serialSignals: signals, At: p.stamp()})
}

func (p *ptyPort) stamp() int64 { return time.Since(p.start).Microseconds() }

func (p *ptyPort) shutdown() {
	p.mutex.Lock()
	p.closed = true
	if p.rfc2217 != nil {
		_ = p.rfc2217.conn.Close()
	}
	p.mutex.Unlock()
	p.release()
}

func (p *ptyPort) release() {
	if p.listener != nil {
		_ = p.listener.Close()
	}
	if p.master != nil {
		_ = p.master.Close()
	}
	if p.events != nil {
		_ = p.events.Close()
	}
	if p.slaveFd >= 0 {
		_ = syscall.Close(p.slaveFd)
	}
	if p.path == "" {
		return
	}
	if target, err := os.Readlink(p.path); err == nil && target == p.slavePath {
		_ = os.Remove(p.path)
	}
}

// watchOpens takes the inotify events as they come, until the port is shut.
func (p *ptyPort) watchOpens() {
	_ = p.eventsConn.Read(func(uintptr) bool {
		p.mutex.Lock()
		defer p.mutex.Unlock()
		return p.closed || p.takeEvents() != nil
	})
}

// readTool forwards what the tool writes, until the port is shut.
func (p *ptyPort) readTool() {
	_ = p.masterConn.Read(func(uintptr) bool {
		p.mutex.Lock()
		defer p.mutex.Unlock()
		if p.closed {
			return true
		}
		// The open is queued before the tool can write, so taking it first keeps the tool's
		// first bytes in its session.
		if err := p.takeEvents(); err != nil {
			return true
		}
		return p.drainTool() != nil
	})
}

// takeEvents handles the queued inotify events; the mutex is held. It returns nil once the queue
// is empty.
func (p *ptyPort) takeEvents() error {
	var buffer [4096]byte
	for {
		n, err := syscall.Read(p.eventsFd, buffer[:])
		switch {
		case err == syscall.EAGAIN:
			return nil
		case err == syscall.EINTR:
			continue
		case err != nil:
			return err
		}
		for offset := 0; offset+syscall.SizeofInotifyEvent <= n; {
			mask := binary.NativeEndian.Uint32(buffer[offset+4:])
			nameBytes := binary.NativeEndian.Uint32(buffer[offset+12:])
			p.onEvent(mask)
			offset += syscall.SizeofInotifyEvent + int(nameBytes)
		}
	}
}

// onEvent counts one open file description per open; the mutex is held. An open while an RFC 2217
// client has the board (one with CAP_SYS_ADMIN gets past TIOCEXCL) is busy: it starts no session, so nothing
// it writes reaches the board.
func (p *ptyPort) onEvent(mask uint32) {
	switch {
	case mask&syscall.IN_OPEN != 0:
		p.opens++
		switch {
		case p.rfc2217 != nil:
			_ = p.sendControl(frameNotice, deviceNotice{Code: noticePortBusy})
		case p.session == nil:
			p.beginSession()
		}
	case mask&(syscall.IN_CLOSE_WRITE|syscall.IN_CLOSE_NOWRITE) != 0 && p.opens > 0:
		p.opens--
		if p.opens == 0 && p.session != nil {
			p.endSession()
		}
	}
}

// drainTool reads the master until it is empty; the mutex is held. A read that finds nothing
// first flushes the kernel's pending input, so nothing the tool wrote is left behind.
func (p *ptyPort) drainTool() error {
	for {
		n, err := syscall.Read(p.masterFd, p.buffer)
		if n > 0 {
			p.fromTool(p.buffer[:n])
		}
		switch {
		case err == syscall.EAGAIN:
			return nil
		case err == syscall.EINTR:
			continue
		case err != nil:
			return err
		case n == 0:
			return io.EOF
		}
	}
}

// fromTool sends what the tool wrote to the board, after the settings it wrote them with; the
// mutex is held. Outside a session there is no board to send it to.
func (p *ptyPort) fromTool(data []byte) {
	if p.session == nil {
		return
	}
	p.reportSettings()
	p.session.toolWrote = true
	p.session.syncRequest.feed(data)
	_ = p.sender.send(frame{typ: frameData, channel: p.session.channel, payload: append([]byte(nil), data...)})
}

func (p *ptyPort) beginSession() {
	p.session = &serialSession{
		channel:      p.nextChannel,
		syncRequest:  byteWatch{pattern: esptoolSyncRequest},
		syncResponse: byteWatch{pattern: esptoolSyncResponse},
	}
	p.nextChannel++
	_ = p.sender.send(frame{typ: frameOpen, channel: p.session.channel})
	// A real ttyACM's open drops DTR and RTS and raises them, which resets a board wired to reset
	// on DTR.
	_ = p.sendSignals(serialSignals{})
	_ = p.sendSignals(serialSignals{DataTerminalReady: true, RequestToSend: true})
}

func (p *ptyPort) endSession() {
	_ = p.drainTool()
	p.reportSettings()
	session := p.session
	p.session = nil
	_ = p.sendSignals(serialSignals{})
	_ = p.sender.send(frame{typ: frameClose, channel: session.channel})
	// A closed real port keeps nothing the board sends; the next session starts empty too.
	_ = flushInput(p.slaveFd)
	baud := 0
	if t, err := readTermios(p.masterFd); err == nil {
		baud = baudRate(t)
	}
	notice := closingNotice(session, baud, p.esptoolNoticed)
	if notice == noticeEsptoolSyncNoAnswer {
		p.esptoolNoticed = true
	}
	if notice != "" {
		_ = p.sendControl(frameNotice, deviceNotice{Code: notice})
	}
}

// closingNotice is what a session's end says, if anything; it reads only the bytes, never their
// timing.
func closingNotice(session *serialSession, baud int, esptoolNoticed bool) string {
	switch {
	case baud == 1200:
		return noticeTouch1200
	case !esptoolNoticed && session.syncRequest.seen && !session.syncResponse.seen:
		return noticeEsptoolSyncNoAnswer
	case session.toolWrote && !session.boardAnswered:
		return noticeNoAnswerAfterReset
	}
	return ""
}

func (p *ptyPort) currentSettings() (serialSettings, bool) {
	t, err := readTermios(p.masterFd)
	if err != nil {
		return serialSettings{}, false
	}
	return settingsOf(t)
}

// reportSettings sends SETTINGS when the tool changed them; the mutex is held.
func (p *ptyPort) reportSettings() {
	settings, ok := p.currentSettings()
	if !ok || settings == p.sentSettings {
		return
	}
	p.sentSettings = settings
	_ = p.sendSettings(settings)
}

// tick polls the settings while a session is open, as a tool may change them without writing, and
// pings, until done.
func (p *ptyPort) tick(done <-chan struct{}) {
	poll := time.NewTicker(p.config.settingsPoll)
	defer poll.Stop()
	ping := time.NewTicker(p.config.pingInterval)
	defer ping.Stop()
	pings := 0
	for {
		select {
		case <-done:
			return
		case <-poll.C:
			p.mutex.Lock()
			if !p.closed && p.session != nil {
				p.reportSettings()
			}
			p.mutex.Unlock()
		case <-ping.C:
			pings++
			_ = p.sendControl(framePing, devicePing{ID: pings})
		}
	}
}

// readInput handles the browser's frames until the input ends, and says why it did.
func (p *ptyPort) readInput(in io.Reader) (string, int) {
	for {
		f, err := readFrame(in)
		if errors.Is(err, io.EOF) {
			return "stdin closed", 0
		}
		if err != nil {
			return "bad frame on stdin: " + err.Error(), 1
		}
		if f.typ != frameData {
			continue
		}
		if p.fromBoard(f.channel, f.payload) {
			p.writeToBoard(f.channel, f.payload)
		} else if c := p.rfc2217On(f.channel); c != nil {
			c.toClient(f.payload)
		}
	}
}

// fromBoard takes note of what the board sent, and says whether it goes to the tool: only on the
// open session's channel, as a closed real port drops what the board sends.
func (p *ptyPort) fromBoard(channel uint32, data []byte) bool {
	p.mutex.Lock()
	defer p.mutex.Unlock()
	if p.closed || p.session == nil || p.session.channel != channel {
		return false
	}
	if len(data) > 0 {
		p.session.boardAnswered = true
	}
	p.session.syncResponse.feed(data)
	return true
}

// writeToBoard writes to the tool without the mutex, so a tool that doesn't read can't hold up its
// own close; what is left when its session ends is dropped.
func (p *ptyPort) writeToBoard(channel uint32, data []byte) {
	_ = p.masterConn.Write(func(fd uintptr) bool {
		for len(data) > 0 && p.inSession(channel) {
			n, err := syscall.Write(int(fd), data)
			if n > 0 {
				data = data[n:]
			}
			if err == syscall.EAGAIN {
				return false
			}
			if err != nil && err != syscall.EINTR {
				return true
			}
		}
		return true
	})
}

func (p *ptyPort) inSession(channel uint32) bool {
	p.mutex.Lock()
	defer p.mutex.Unlock()
	return !p.closed && p.session != nil && p.session.channel == channel
}
