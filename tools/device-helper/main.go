// The Office device helper: the small program a Connected device runs for The Office (spec 2.13).
// It speaks frames (frames.go) on its standard input and output.
package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// version is set at build time: -ldflags "-X main.version=<version>".
var version = "dev"

const usage = "usage: office-device-helper --version | relay --listen 127.0.0.1:<port> | pty [--path-prefix /dev/ttyACM] [--owner <uid>:<gid>] | adb-key"

// ptyConfig is what the pty mode (pty.go) runs with; tests point its paths and intervals elsewhere.
type ptyConfig struct {
	version      string
	pathPrefix   string     // the port's stable path is this and the lowest free number
	owner        *fileOwner // who the port's pseudo-terminal is given to, or nil to keep its owner
	ptmxPath     string
	ptsDir       string // with its trailing slash
	settingsPoll time.Duration
	pingInterval time.Duration
	lookPath     func(file string) (string, error)
	rfc2217Base  int // the RFC 2217 port of `<pathPrefix><n>` is this plus n, or the next free one
}

type fileOwner struct{ uid, gid int }

func defaultPtyConfig() ptyConfig {
	return ptyConfig{
		version:      version,
		pathPrefix:   "/dev/ttyACM",
		ptmxPath:     "/dev/ptmx",
		ptsDir:       "/dev/pts/",
		settingsPoll: 10 * time.Millisecond,
		pingInterval: 5 * time.Second,
		lookPath:     exec.LookPath,
		rfc2217Base:  2217,
	}
}

func main() {
	os.Exit(run(os.Args[1:], os.Stdin, os.Stdout, os.Stderr))
}

func run(args []string, stdin io.Reader, stdout, stderr io.Writer) int {
	if len(args) == 1 && args[0] == "--version" {
		fmt.Fprintln(stdout, version)
		return 0
	}
	if len(args) == 1 && args[0] == "adb-key" {
		return runAdbKey(stdin, stdout, stderr, os.UserHomeDir)
	}
	if len(args) > 0 {
		switch args[0] {
		case "relay":
			return runRelayCommand(args[1:], stdin, stdout, stderr)
		case "pty":
			return runPtyCommand(args[1:], stdin, stdout, stderr)
		}
	}
	fmt.Fprintln(stderr, usage)
	return 2
}

func runRelayCommand(args []string, stdin io.Reader, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("relay", flag.ContinueOnError)
	flags.SetOutput(stderr)
	address := flags.String("listen", "", "the address to listen on, 127.0.0.1:<port>")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	listener, err := listenLocal(*address)
	if err != nil {
		fmt.Fprintln(stderr, "office-device-helper:", err)
		return 2
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	return runRelay(ctx, listener, version, stdin, stdout)
}

func runPtyCommand(args []string, stdin io.Reader, stdout, stderr io.Writer) int {
	config := defaultPtyConfig()
	flags := flag.NewFlagSet("pty", flag.ContinueOnError)
	flags.SetOutput(stderr)
	flags.StringVar(&config.pathPrefix, "path-prefix", config.pathPrefix, "the port's path without its number")
	owner := flags.String("owner", "", "who the port is given to, <uid>:<gid>")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	if flags.NArg() > 0 || config.pathPrefix == "" {
		fmt.Fprintln(stderr, usage)
		return 2
	}
	if *owner != "" {
		parsed, err := parseOwner(*owner)
		if err != nil {
			fmt.Fprintln(stderr, "office-device-helper:", err)
			return 2
		}
		config.owner = parsed
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	return runPty(ctx, config, stdin, stdout, stderr)
}

func parseOwner(text string) (*fileOwner, error) {
	uidText, gidText, found := strings.Cut(text, ":")
	uid, uidErr := strconv.Atoi(uidText)
	gid, gidErr := strconv.Atoi(gidText)
	if !found || uidErr != nil || gidErr != nil || uid < 0 || gid < 0 {
		return nil, fmt.Errorf("--owner %q is not <uid>:<gid>", text)
	}
	return &fileOwner{uid: uid, gid: gid}, nil
}
