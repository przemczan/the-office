//go:build linux

package main

// The pty mode's RFC 2217 server: a pseudo-terminal can't carry a tool's baud rate changes to a
// real line, nor DTR and RTS at all, so esptool, pyserial and PlatformIO open
// `rfc2217://127.0.0.1:<port>` instead and set them over telnet's COM-PORT-OPTION. A connection is
// a session of the board on its own channel of the same stream, as a pty session is; what it sets
// goes out as SETTINGS and SIGNALS on channel 0, under the port's mutex, in the order it came.
//
// One user at a time: while a tool has the pty open, or another client is connected, a connection
// is closed at once with NOTICE port-busy; while a client is connected, the pty is exclusive, so a
// tool's open fails with EBUSY. That refusal sends no notice: a failed open makes no inotify
// event, and seeing it otherwise needs CAP_SYS_ADMIN, which the run environment doesn't grant.
//
// The server is written to pyserial's client (serial/rfc2217.py, 3.5), which waits for an answer
// to every sub-negotiation it sends and checks that the answer starts with what it asked for.

import (
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"strconv"
	"syscall"
)

const (
	telnetSE   = 240
	telnetSB   = 250
	telnetWill = 251
	telnetWont = 252
	telnetDo   = 253
	telnetDont = 254
	telnetIAC  = 255

	telnetBinary          = 0
	telnetSuppressGoAhead = 3
	telnetComPort         = 44
)

// The COM-PORT-OPTION commands a client sends; the server answers each with it plus 100.
const (
	comSetBaudRate        = 1
	comSetDataSize        = 2
	comSetParity          = 3
	comSetStopSize        = 4
	comSetControl         = 5
	comNotifyLineState    = 6
	comNotifyModemState   = 7
	comFlowControlSuspend = 8
	comFlowControlResume  = 9
	comServerOffset       = 100
)

// SET-CONTROL's values.
const (
	controlNoFlowControl        = 1
	controlBreakOff             = 6
	controlQueryDTR             = 7
	controlDTROn                = 8
	controlDTROff               = 9
	controlQueryRTS             = 10
	controlRTSOn                = 11
	controlRTSOff               = 12
	controlNoInboundFlowControl = 14
)

// The line and modem states the server reports, as Web Serial tells the helper neither: nothing
// waiting to be sent, and a board that is there (carrier, data set ready, clear to send).
const (
	lineStateIdle   = 0x60
	modemStateReady = 0xB0
)

var (
	rfc2217Greeting = []byte{telnetIAC, telnetWill, telnetComPort, telnetIAC, telnetDo, telnetComPort}
	parityCodes     = map[byte]string{1: "none", 2: "odd", 3: "even"}
	stopBitsCodes   = map[byte]int{1: 1, 2: 2}
)

type telnetMode uint8

const (
	modeData       telnetMode = iota
	modeCommand               // after IAC
	modeOption                // after IAC and WILL, WONT, DO or DONT
	modeSub                   // inside IAC SB
	modeSubCommand            // after IAC inside IAC SB
)

type optionState uint8

const (
	optionOff optionState = iota
	optionAsked
	optionOn
)

// rfc2217Event is one thing the client did, in its order: bytes for the board, new line settings,
// or a SET-CONTROL of DTR or RTS (each one, changed or not, as a real port's ioctl would be).
type rfc2217Event struct {
	data     []byte
	settings *serialSettings
	signals  *serialSignals
}

// rfc2217Server is one connection's telnet and COM-PORT-OPTION state; it knows nothing of the port.
type rfc2217Server struct {
	settings serialSettings
	signals  serialSignals
	mode     telnetMode
	verb     byte
	sub      []byte
	ours     [256]optionState // what the server does (WILL)
	theirs   [256]optionState // what the client does (DO)
	data     []byte
	events   []rfc2217Event
	reply    []byte
}

// newRfc2217Server starts from the settings the browser has and the lines a session's end left
// down, having asked for COM-PORT-OPTION both ways with rfc2217Greeting.
func newRfc2217Server(settings serialSettings) *rfc2217Server {
	s := &rfc2217Server{settings: settings}
	s.ours[telnetComPort], s.theirs[telnetComPort] = optionAsked, optionAsked
	return s
}

// feed takes the client's bytes however they are split, and returns what they did and the answer.
func (s *rfc2217Server) feed(input []byte) ([]rfc2217Event, []byte) {
	for _, b := range input {
		s.take(b)
	}
	s.flushData()
	events, reply := s.events, s.reply
	s.events, s.reply = nil, nil
	return events, reply
}

func (s *rfc2217Server) take(b byte) {
	switch s.mode {
	case modeData:
		if b == telnetIAC {
			s.mode = modeCommand
		} else {
			s.data = append(s.data, b)
		}
	case modeCommand:
		s.mode = modeData
		switch b {
		case telnetIAC:
			s.data = append(s.data, b)
		case telnetSB:
			s.mode, s.sub = modeSub, s.sub[:0]
		case telnetWill, telnetWont, telnetDo, telnetDont:
			s.mode, s.verb = modeOption, b
		}
		// Telnet's other commands (NOP, break, are-you-there) mean nothing here.
	case modeOption:
		s.mode = modeData
		s.negotiate(s.verb, b)
	case modeSub:
		if b == telnetIAC {
			s.mode = modeSubCommand
		} else {
			s.sub = append(s.sub, b)
		}
	case modeSubCommand:
		s.mode = modeSub
		switch b {
		case telnetIAC:
			s.sub = append(s.sub, b)
		case telnetSE:
			s.mode = modeData
			s.subnegotiate(s.sub)
		}
	}
}

func (s *rfc2217Server) negotiate(verb, option byte) {
	switch verb {
	case telnetDo:
		s.ours[option] = s.agree(s.ours[option], option, telnetWill, telnetWont)
	case telnetWill:
		s.theirs[option] = s.agree(s.theirs[option], option, telnetDo, telnetDont)
	case telnetDont:
		s.ours[option] = s.refuse(s.ours[option], option, telnetWont)
	case telnetWont:
		s.theirs[option] = s.refuse(s.theirs[option], option, telnetDont)
	}
}

// agree answers a request to turn an option on: no to one the server hasn't, and yes only when it
// was off, as the answer to the server's own request needs none; so the two sides never loop.
func (s *rfc2217Server) agree(state optionState, option, yes, no byte) optionState {
	if option != telnetBinary && option != telnetSuppressGoAhead && option != telnetComPort {
		s.reply = append(s.reply, telnetIAC, no, option)
		return optionOff
	}
	if state == optionOff {
		s.reply = append(s.reply, telnetIAC, yes, option)
	}
	return optionOn
}

// refuse turns an option off, answering only when it was on.
func (s *rfc2217Server) refuse(state optionState, option, no byte) optionState {
	if state == optionOn {
		s.reply = append(s.reply, telnetIAC, no, option)
	}
	return optionOff
}

func (s *rfc2217Server) subnegotiate(sub []byte) {
	if len(sub) < 2 || sub[0] != telnetComPort {
		return
	}
	command, value := sub[1], sub[2:]
	// The bytes before a change are sent before it.
	s.flushData()
	var answer []byte
	switch command {
	case comSetBaudRate:
		answer = s.setBaudRate(value)
	case comSetDataSize:
		answer = s.setDataSize(value)
	case comSetParity:
		answer = s.setParity(value)
	case comSetStopSize:
		answer = s.setStopSize(value)
	case comSetControl:
		answer = s.setControl(value)
	case comNotifyLineState:
		answer = []byte{lineStateIdle}
	case comNotifyModemState:
		answer = []byte{modemStateReady}
	case comFlowControlSuspend, comFlowControlResume:
		// The client tells the server to hold or go on sending, and RFC 2217 has no answer to it;
		// the helper keeps sending, as the client's socket buffers what it doesn't read.
		return
	default:
		// The masks and PURGE-DATA (nothing waits to be purged) are taken as asked, and a command
		// the server doesn't know is answered with its own value, so the client never waits.
		answer = value
	}
	s.reply = append(s.reply, telnetIAC, telnetSB, telnetComPort, command+comServerOffset)
	s.reply = append(escapeIAC(s.reply, answer), telnetIAC, telnetSE)
}

// setBaudRate and the other SET commands take a value they can carry, and answer with the line's
// value then, so a query (0) or a value refused is answered with the current one.
func (s *rfc2217Server) setBaudRate(value []byte) []byte {
	if len(value) == 4 {
		if baud := binary.BigEndian.Uint32(value); baud > 0 {
			next := s.settings
			next.BaudRate = int(baud)
			s.changeSettings(next)
		}
	}
	return binary.BigEndian.AppendUint32(nil, uint32(s.settings.BaudRate))
}

func (s *rfc2217Server) setDataSize(value []byte) []byte {
	if len(value) == 1 && value[0] >= 5 && value[0] <= 8 {
		next := s.settings
		next.DataBits = int(value[0])
		s.changeSettings(next)
	}
	return []byte{byte(s.settings.DataBits)}
}

// setParity takes none, odd and even; mark and space, which Web Serial can't set, are answered
// with the current parity, which pyserial takes as refused.
func (s *rfc2217Server) setParity(value []byte) []byte {
	if len(value) == 1 {
		if parity, known := parityCodes[value[0]]; known {
			next := s.settings
			next.Parity = parity
			s.changeSettings(next)
		}
	}
	for code, parity := range parityCodes {
		if parity == s.settings.Parity {
			return []byte{code}
		}
	}
	return []byte{0}
}

// setStopSize takes one and two stop bits; 1.5, which Web Serial can't set, is refused the same way.
func (s *rfc2217Server) setStopSize(value []byte) []byte {
	if len(value) == 1 {
		if stopBits, known := stopBitsCodes[value[0]]; known {
			next := s.settings
			next.StopBits = stopBits
			s.changeSettings(next)
		}
	}
	return []byte{byte(s.settings.StopBits)}
}

// setControl sets DTR and RTS and answers their queries; the line has no flow control and no
// break, so any other value is answered with that.
func (s *rfc2217Server) setControl(value []byte) []byte {
	var command byte
	if len(value) > 0 {
		command = value[0]
	}
	switch command {
	case controlDTROn, controlDTROff:
		s.setSignals(serialSignals{DataTerminalReady: command == controlDTROn, RequestToSend: s.signals.RequestToSend})
	case controlRTSOn, controlRTSOff:
		s.setSignals(serialSignals{DataTerminalReady: s.signals.DataTerminalReady, RequestToSend: command == controlRTSOn})
	}
	switch {
	case command >= controlQueryDTR && command <= controlDTROff:
		return []byte{lineCode(s.signals.DataTerminalReady, controlDTROn, controlDTROff)}
	case command >= controlQueryRTS && command <= controlRTSOff:
		return []byte{lineCode(s.signals.RequestToSend, controlRTSOn, controlRTSOff)}
	case command >= 4 && command <= controlBreakOff:
		return []byte{controlBreakOff}
	case command >= 13 && command <= 16:
		return []byte{controlNoInboundFlowControl}
	}
	return []byte{controlNoFlowControl}
}

func lineCode(on bool, onCode, offCode byte) byte {
	if on {
		return onCode
	}
	return offCode
}

func (s *rfc2217Server) changeSettings(next serialSettings) {
	if next == s.settings {
		return
	}
	s.settings = next
	s.events = append(s.events, rfc2217Event{settings: &next})
}

func (s *rfc2217Server) setSignals(next serialSignals) {
	s.signals = next
	s.events = append(s.events, rfc2217Event{signals: &next})
}

func (s *rfc2217Server) flushData() {
	if len(s.data) == 0 {
		return
	}
	s.events = append(s.events, rfc2217Event{data: s.data})
	s.data = nil
}

// escapeIAC appends data to dst with each 0xFF doubled, as telnet carries it.
func escapeIAC(dst, data []byte) []byte {
	for _, b := range data {
		dst = append(dst, b)
		if b == telnetIAC {
			dst = append(dst, b)
		}
	}
	return dst
}

// rfc2217Connection is a connected client: the board's session while it lasts.
type rfc2217Connection struct {
	conn    net.Conn
	channel uint32
	server  *rfc2217Server
}

// toClient writes what the board sent, without the port's mutex; a client that is gone drops it.
func (c *rfc2217Connection) toClient(data []byte) {
	_, _ = c.conn.Write(escapeIAC(nil, data))
}

// listenRfc2217 listens on 127.0.0.1 at base plus the port's number, or the next free port up.
func listenRfc2217(base, number int) (net.Listener, error) {
	first := base + number
	last := min(first+maxPortNumber, 65536)
	for port := first; port < last; port++ {
		listener, err := net.Listen("tcp4", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)))
		if err == nil {
			return listener, nil
		}
		if !errors.Is(err, syscall.EADDRINUSE) {
			return nil, err
		}
	}
	return nil, fmt.Errorf("no free port from %d", first)
}

// listen opens the RFC 2217 port; without one, READY carries the path alone.
func (p *ptyPort) listen(stderr io.Writer) {
	listener, err := listenRfc2217(p.config.rfc2217Base, p.number)
	if err != nil {
		fmt.Fprintln(stderr, "office-device-helper: no RFC 2217 port:", err)
		return
	}
	p.listener = listener
}

// acceptRfc2217 takes the clients as they come, until the listener is closed.
func (p *ptyPort) acceptRfc2217() {
	for {
		conn, err := p.listener.Accept()
		if err != nil {
			return
		}
		if c := p.admit(conn); c != nil {
			go p.serveRfc2217(c)
		}
	}
}

// admit makes a client the board's session, or closes it with NOTICE port-busy when a tool has
// the pty open or another client is connected.
func (p *ptyPort) admit(conn net.Conn) *rfc2217Connection {
	p.mutex.Lock()
	defer p.mutex.Unlock()
	if p.closed {
		_ = conn.Close()
		return nil
	}
	// An open the kernel already did is counted first.
	_ = p.takeEvents()
	if p.opens > 0 || p.rfc2217 != nil {
		_ = conn.Close()
		_ = p.sendControl(frameNotice, deviceNotice{Code: noticePortBusy})
		return nil
	}
	_ = setExclusive(p.slaveFd, true)
	c := &rfc2217Connection{conn: conn, channel: p.nextChannel, server: newRfc2217Server(p.sentSettings)}
	p.nextChannel++
	p.rfc2217 = c
	_ = p.sender.send(frame{typ: frameOpen, channel: c.channel})
	return c
}

// serveRfc2217 reads the client until it goes or the port is shut.
func (p *ptyPort) serveRfc2217(c *rfc2217Connection) {
	defer func() { _ = c.conn.Close() }()
	if _, err := c.conn.Write(rfc2217Greeting); err == nil {
		buffer := make([]byte, copyChunkBytes)
		for {
			n, err := c.conn.Read(buffer)
			if n > 0 && !p.fromClient(c, buffer[:n]) {
				break
			}
			if err != nil {
				break
			}
		}
	}
	p.endRfc2217(c)
}

// fromClient sends what the client did as frames, then its answer, which pyserial waits for, so
// the browser has a change before the client goes on. It is false once the port is shut.
func (p *ptyPort) fromClient(c *rfc2217Connection, input []byte) bool {
	p.mutex.Lock()
	if p.closed {
		p.mutex.Unlock()
		return false
	}
	events, reply := c.server.feed(input)
	for _, event := range events {
		switch {
		case event.data != nil:
			_ = p.sender.send(frame{typ: frameData, channel: c.channel, payload: event.data})
		case event.settings != nil && *event.settings != p.sentSettings:
			p.sentSettings = *event.settings
			_ = p.sendSettings(p.sentSettings)
		case event.signals != nil:
			_ = p.sendSignals(*event.signals)
		}
	}
	p.mutex.Unlock()
	if len(reply) == 0 {
		return true
	}
	_, err := c.conn.Write(reply)
	return err == nil
}

// endRfc2217 ends the client's session as a real port's close does: DTR and RTS drop (HUPCL).
func (p *ptyPort) endRfc2217(c *rfc2217Connection) {
	p.mutex.Lock()
	defer p.mutex.Unlock()
	p.rfc2217 = nil
	if p.closed {
		return
	}
	_ = setExclusive(p.slaveFd, false)
	_ = p.sendSignals(serialSignals{})
	_ = p.sender.send(frame{typ: frameClose, channel: c.channel})
}

func (p *ptyPort) rfc2217On(channel uint32) *rfc2217Connection {
	p.mutex.Lock()
	defer p.mutex.Unlock()
	if p.closed || p.rfc2217 == nil || p.rfc2217.channel != channel {
		return nil
	}
	return p.rfc2217
}
