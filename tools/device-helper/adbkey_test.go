package main

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const (
	testPrivateKey = "-----BEGIN PRIVATE KEY-----\nsecret-private-material\n-----END PRIVATE KEY-----\n"
	testPublicKey  = "QAAAAsecretpublicmaterial= user@host\n"
)

func keyFrames(t *testing.T, frames ...frame) *bytes.Buffer {
	t.Helper()
	var in bytes.Buffer
	for _, f := range frames {
		if err := writeFrame(&in, f); err != nil {
			t.Fatal(err)
		}
	}
	return &in
}

func dataFrame(channel uint32, payload string) frame {
	return frame{typ: frameData, channel: channel, payload: []byte(payload)}
}

func runKeys(t *testing.T, home string, frames ...frame) (code int, stdout, stderr string) {
	t.Helper()
	var out, errOut bytes.Buffer
	code = runAdbKey(keyFrames(t, frames...), &out, &errOut, func() (string, error) { return home, nil })
	return code, out.String(), errOut.String()
}

func goodFrames() []frame {
	return []frame{dataFrame(1, testPrivateKey), dataFrame(2, testPublicKey)}
}

func assertKey(t *testing.T, path, contents string) {
	t.Helper()
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != contents {
		t.Fatalf("%s holds the wrong contents", path)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("%s has mode %v", path, info.Mode().Perm())
	}
}

func TestAdbKeyFirstWriteCreatesTheDirectoryAndBothFiles(t *testing.T) {
	home := t.TempDir()
	code, stdout, stderr := runKeys(t, home, goodFrames()...)
	if code != 0 || stdout != "written\n" || stderr != "" {
		t.Fatalf("exit %d, stdout %q, stderr %q", code, stdout, stderr)
	}
	dir := filepath.Join(home, ".android")
	info, err := os.Stat(dir)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o700 {
		t.Fatalf("directory has mode %v", info.Mode().Perm())
	}
	assertKey(t, filepath.Join(dir, "adbkey"), testPrivateKey)
	assertKey(t, filepath.Join(dir, "adbkey.pub"), testPublicKey)
	entries, _ := os.ReadDir(dir)
	if len(entries) != 2 {
		t.Fatalf("directory holds %d files, want 2", len(entries))
	}
}

func TestAdbKeySameKeysChangeNothing(t *testing.T) {
	home := t.TempDir()
	runKeys(t, home, goodFrames()...)
	path := filepath.Join(home, ".android", "adbkey")
	before, _ := os.Stat(path)
	code, stdout, _ := runKeys(t, home, goodFrames()...)
	if code != 0 || stdout != "same\n" {
		t.Fatalf("exit %d, stdout %q", code, stdout)
	}
	after, _ := os.Stat(path)
	if !os.SameFile(before, after) || !before.ModTime().Equal(after.ModTime()) {
		t.Fatal("the file was replaced")
	}
}

func TestAdbKeyChangedKeyIsWritten(t *testing.T) {
	home := t.TempDir()
	runKeys(t, home, goodFrames()...)
	code, stdout, _ := runKeys(t, home, dataFrame(1, "new private\n"), dataFrame(2, testPublicKey))
	if code != 0 || stdout != "written\n" {
		t.Fatalf("exit %d, stdout %q", code, stdout)
	}
	assertKey(t, filepath.Join(home, ".android", "adbkey"), "new private\n")
	assertKey(t, filepath.Join(home, ".android", "adbkey.pub"), testPublicKey)
}

func TestAdbKeyWrongModeWithSameContentIsFixed(t *testing.T) {
	home := t.TempDir()
	runKeys(t, home, goodFrames()...)
	path := filepath.Join(home, ".android", "adbkey")
	if err := os.Chmod(path, 0o644); err != nil {
		t.Fatal(err)
	}
	code, stdout, _ := runKeys(t, home, goodFrames()...)
	if code != 0 || stdout != "same\n" {
		t.Fatalf("exit %d, stdout %q", code, stdout)
	}
	assertKey(t, path, testPrivateKey)
}

func TestAdbKeyBadInputExits1WithoutEchoingTheKey(t *testing.T) {
	cases := map[string][]frame{
		"missing public key":  {dataFrame(1, testPrivateKey)},
		"missing private key": {dataFrame(2, testPublicKey)},
		"empty key":           {dataFrame(1, testPrivateKey), dataFrame(2, "")},
		"wrong channel":       {dataFrame(1, testPrivateKey), dataFrame(3, testPublicKey)},
		"wrong frame type":    {dataFrame(1, testPrivateKey), {typ: frameClose, channel: 2}},
		"repeated key":        {dataFrame(1, testPrivateKey), dataFrame(1, testPrivateKey), dataFrame(2, testPublicKey)},
	}
	for name, frames := range cases {
		t.Run(name, func(t *testing.T) {
			home := t.TempDir()
			code, stdout, stderr := runKeys(t, home, frames...)
			if code != 1 || stdout != "" || stderr == "" {
				t.Fatalf("exit %d, stdout %q, stderr %q", code, stdout, stderr)
			}
			if strings.Contains(stderr, "secret") {
				t.Fatalf("stderr echoes a key: %q", stderr)
			}
			if _, err := os.Stat(filepath.Join(home, ".android")); !errors.Is(err, os.ErrNotExist) {
				t.Fatal("something was written")
			}
		})
	}
}

func TestAdbKeyTruncatedStreamExits1(t *testing.T) {
	var out, errOut bytes.Buffer
	in := bytes.NewReader([]byte{byte(frameData), 0, 0, 0, 1, 0, 0, 0, 9, 'a'})
	code := runAdbKey(in, &out, &errOut, func() (string, error) { return t.TempDir(), nil })
	if code != 1 || out.Len() != 0 {
		t.Fatalf("exit %d, stdout %q", code, out.String())
	}
}
