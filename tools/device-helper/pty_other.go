//go:build !linux

package main

import (
	"context"
	"fmt"
	"io"
)

// runPty needs Linux's pseudo-terminals and inotify; the helper only runs on Linux.
func runPty(_ context.Context, _ ptyConfig, _ io.Reader, _ io.Writer, stderr io.Writer) int {
	fmt.Fprintln(stderr, "office-device-helper: pty runs on Linux only")
	return 2
}
