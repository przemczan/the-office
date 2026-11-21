// The Office device helper: the small program a Connected device runs for The Office (spec 2.13).
// It speaks frames (frames.go) on its standard input and output.
package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"syscall"
)

// version is set at build time: -ldflags "-X main.version=<version>".
var version = "dev"

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
	if len(args) == 0 || args[0] != "relay" {
		fmt.Fprintln(stderr, "usage: office-device-helper --version | relay --listen 127.0.0.1:<port> | adb-key")
		return 2
	}
	flags := flag.NewFlagSet("relay", flag.ContinueOnError)
	flags.SetOutput(stderr)
	address := flags.String("listen", "", "the address to listen on, 127.0.0.1:<port>")
	if err := flags.Parse(args[1:]); err != nil {
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
