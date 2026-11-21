package main

// The adb-key mode: puts the adb key pair a Task's run environment uses on the device, so the
// device's adb server presents the same key every time and the phone's "allow USB debugging"
// is asked once. It reads DATA frames on its standard input until EOF, channel 1 the private key
// and channel 2 the public key, writes them to $HOME/.android and says `written` or `same`.
// Key contents are never printed, not even in an error.

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

const (
	adbPrivateKeyChannel = 1
	adbPublicKeyChannel  = 2
	adbKeyMode           = 0o600
	adbDirMode           = 0o700
)

// runAdbKey is the adb-key mode: it exits 0 after `written\n` or `same\n`, and 1 with a short
// message on stderr when the input is not exactly the two keys or they can't be written.
func runAdbKey(stdin io.Reader, stdout, stderr io.Writer, homeDir func() (string, error)) int {
	private, public, err := readAdbKeyFrames(stdin)
	if err != nil {
		fmt.Fprintln(stderr, "office-device-helper: adb-key:", err)
		return 1
	}
	home, err := homeDir()
	if err != nil {
		fmt.Fprintln(stderr, "office-device-helper: adb-key: no home directory")
		return 1
	}
	changed, err := writeAdbKey(home, private, public)
	if err != nil {
		fmt.Fprintln(stderr, "office-device-helper: adb-key:", err)
		return 1
	}
	if changed {
		fmt.Fprintln(stdout, "written")
	} else {
		fmt.Fprintln(stdout, "same")
	}
	return 0
}

// readAdbKeyFrames reads to EOF and returns the two keys, refusing any other frame, a repeated
// key, and a missing or empty one. Its errors never carry a payload.
func readAdbKeyFrames(r io.Reader) (private, public []byte, err error) {
	for {
		f, err := readFrame(r)
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, nil, fmt.Errorf("reading frames: %w", err)
		}
		if f.typ != frameData {
			return nil, nil, fmt.Errorf("unexpected frame type %d", f.typ)
		}
		switch f.channel {
		case adbPrivateKeyChannel:
			if private != nil {
				return nil, nil, errors.New("the private key came twice")
			}
			private = f.payload
		case adbPublicKeyChannel:
			if public != nil {
				return nil, nil, errors.New("the public key came twice")
			}
			public = f.payload
		default:
			return nil, nil, fmt.Errorf("unexpected channel %d", f.channel)
		}
	}
	if len(private) == 0 {
		return nil, nil, errors.New("the private key is missing or empty")
	}
	if len(public) == 0 {
		return nil, nil, errors.New("the public key is missing or empty")
	}
	return private, public, nil
}

// writeAdbKey puts the keys in <home>/.android as adbkey and adbkey.pub, each only when it is
// missing or differs, and says whether it wrote either.
func writeAdbKey(home string, private, public []byte) (changed bool, err error) {
	dir := filepath.Join(home, ".android")
	if err := os.MkdirAll(dir, adbDirMode); err != nil {
		return false, fmt.Errorf("creating %s: %w", dir, err)
	}
	for _, key := range []struct {
		name     string
		contents []byte
	}{{"adbkey", private}, {"adbkey.pub", public}} {
		wrote, err := writeKeyFile(dir, key.name, key.contents)
		if err != nil {
			return changed, fmt.Errorf("writing %s: %w", key.name, err)
		}
		changed = changed || wrote
	}
	return changed, nil
}

// writeKeyFile writes dir/name through a temporary file in the same directory, mode 0600,
// synced and renamed. A file with the same contents is left, its mode fixed when it is not 0600.
func writeKeyFile(dir, name string, contents []byte) (bool, error) {
	path := filepath.Join(dir, name)
	if current, err := os.ReadFile(path); err == nil && string(current) == string(contents) {
		info, err := os.Stat(path)
		if err != nil {
			return false, err
		}
		if info.Mode().Perm() != adbKeyMode {
			return false, os.Chmod(path, adbKeyMode)
		}
		return false, nil
	}
	temp, err := os.CreateTemp(dir, name+".tmp-*")
	if err != nil {
		return false, err
	}
	done := false
	defer func() {
		if !done {
			_ = temp.Close()
			_ = os.Remove(temp.Name())
		}
	}()
	if err := temp.Chmod(adbKeyMode); err != nil {
		return false, err
	}
	if _, err := temp.Write(contents); err != nil {
		return false, err
	}
	if err := temp.Sync(); err != nil {
		return false, err
	}
	if err := temp.Close(); err != nil {
		return false, err
	}
	if err := os.Rename(temp.Name(), path); err != nil {
		return false, err
	}
	done = true
	return true, nil
}
