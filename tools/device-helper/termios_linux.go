//go:build linux

package main

import (
	"syscall"
	"unsafe"
)

// termios2 is the kernel's struct termios2 (asm-generic, as on amd64 and arm64). TCGETS2 gives the
// speed of a BOTHER line, which the struct TCGETS fills has no room for.
type termios2 struct {
	Iflag, Oflag, Cflag, Lflag uint32
	Line                       uint8
	Cc                         [19]uint8
	Ispeed, Ospeed             uint32
}

const (
	tcgets2 = 0x802c542a // _IOR('T', 0x2A, struct termios2) on amd64 and arm64
	cbaud   = 0x100f
	bother  = 0x1000
	tcflsh  = 0x540b
)

var baudRates = map[uint32]int{
	syscall.B50: 50, syscall.B75: 75, syscall.B110: 110, syscall.B134: 134, syscall.B150: 150,
	syscall.B200: 200, syscall.B300: 300, syscall.B600: 600, syscall.B1200: 1200,
	syscall.B1800: 1800, syscall.B2400: 2400, syscall.B4800: 4800, syscall.B9600: 9600,
	syscall.B19200: 19200, syscall.B38400: 38400, syscall.B57600: 57600,
	syscall.B115200: 115200, syscall.B230400: 230400, syscall.B460800: 460800,
	syscall.B500000: 500000, syscall.B576000: 576000, syscall.B921600: 921600,
	syscall.B1000000: 1000000, syscall.B1152000: 1152000, syscall.B1500000: 1500000,
	syscall.B2000000: 2000000, syscall.B2500000: 2500000, syscall.B3000000: 3000000,
	syscall.B3500000: 3500000, syscall.B4000000: 4000000,
}

var dataBitsOf = map[uint32]int{syscall.CS5: 5, syscall.CS6: 6, syscall.CS7: 7, syscall.CS8: 8}

func ioctl(fd int, request uintptr, argument unsafe.Pointer) error {
	if _, _, errno := syscall.Syscall(syscall.SYS_IOCTL, uintptr(fd), request, uintptr(argument)); errno != 0 {
		return errno
	}
	return nil
}

func unlockPty(fd int) error {
	var unlock int32
	return ioctl(fd, syscall.TIOCSPTLCK, unsafe.Pointer(&unlock))
}

func ptyNumber(fd int) (uint32, error) {
	var number uint32
	err := ioctl(fd, syscall.TIOCGPTN, unsafe.Pointer(&number))
	return number, err
}

// makeRaw sets a terminal as cfmakeraw does, at 9600 baud 8N1 with the receiver on and the modem
// lines ignored: how a ttyACM starts.
func makeRaw(fd int) error {
	var t syscall.Termios
	if err := ioctl(fd, syscall.TCGETS, unsafe.Pointer(&t)); err != nil {
		return err
	}
	t.Iflag &^= syscall.IGNBRK | syscall.BRKINT | syscall.PARMRK | syscall.ISTRIP | syscall.INLCR | syscall.IGNCR | syscall.ICRNL | syscall.IXON
	t.Oflag &^= syscall.OPOST
	t.Lflag &^= syscall.ECHO | syscall.ECHONL | syscall.ICANON | syscall.ISIG | syscall.IEXTEN
	t.Cflag &^= syscall.CSIZE | syscall.PARENB | syscall.CSTOPB | cbaud
	t.Cflag |= syscall.CS8 | syscall.CREAD | syscall.CLOCAL | syscall.B9600
	t.Cc[syscall.VMIN] = 1
	t.Cc[syscall.VTIME] = 0
	return ioctl(fd, syscall.TCSETS, unsafe.Pointer(&t))
}

// readTermios reads a terminal's settings; on a pseudo-terminal's master, its slave's.
func readTermios(fd int) (termios2, error) {
	var t termios2
	err := ioctl(fd, tcgets2, unsafe.Pointer(&t))
	return t, err
}

// flushInput discards what a terminal received and nobody read (tcflush TCIFLUSH).
func flushInput(fd int) error {
	if _, _, errno := syscall.Syscall(syscall.SYS_IOCTL, uintptr(fd), tcflsh, syscall.TCIFLUSH); errno != 0 {
		return errno
	}
	return nil
}

// baudRate is a line's speed, 0 when it is hung up (B0) or unknown.
func baudRate(t termios2) int {
	code := t.Cflag & cbaud
	if code == bother {
		return int(t.Ospeed)
	}
	return baudRates[code]
}

// settingsOf reads a line's settings as SETTINGS carries them; false for a line of no known speed.
// On a pseudo-terminal the kernel keeps CS8 without parity whatever a tool sets, so from a tool only
// the speed and the stop bits change.
func settingsOf(t termios2) (serialSettings, bool) {
	baud := baudRate(t)
	if baud <= 0 {
		return serialSettings{}, false
	}
	settings := serialSettings{BaudRate: baud, DataBits: dataBitsOf[t.Cflag&syscall.CSIZE], Parity: "none", StopBits: 1}
	if t.Cflag&syscall.PARENB != 0 {
		settings.Parity = "even"
		if t.Cflag&syscall.PARODD != 0 {
			settings.Parity = "odd"
		}
	}
	if t.Cflag&syscall.CSTOPB != 0 {
		settings.StopBits = 2
	}
	return settings, true
}

// setExclusive makes the terminal's further opens fail with EBUSY, as a busy port's do (TIOCEXCL),
// or lets them again (TIOCNXCL). Only an open with CAP_SYS_ADMIN still succeeds.
func setExclusive(fd int, exclusive bool) error {
	request := uintptr(syscall.TIOCNXCL)
	if exclusive {
		request = syscall.TIOCEXCL
	}
	return ioctl(fd, request, nil)
}
