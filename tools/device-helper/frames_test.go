package main

import (
	"bytes"
	"encoding/binary"
	"errors"
	"io"
	"testing"
	"testing/iotest"
)

func TestFrameRoundTrip(t *testing.T) {
	want := frame{typ: frameData, channel: 0x01020304, payload: []byte("hello")}
	encoded, err := encodeFrame(want)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(encoded[:9], []byte{4, 1, 2, 3, 4, 0, 0, 0, 5}) {
		t.Fatalf("header is %v", encoded[:9])
	}
	got, err := readFrame(bytes.NewReader(encoded))
	if err != nil {
		t.Fatal(err)
	}
	if got.typ != want.typ || got.channel != want.channel || !bytes.Equal(got.payload, want.payload) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

func TestEmptyPayloadAndMaximumPayload(t *testing.T) {
	for _, size := range []int{0, frameMaxPayloadBytes} {
		encoded, err := encodeFrame(frame{typ: frameData, channel: 1, payload: make([]byte, size)})
		if err != nil {
			t.Fatalf("size %d: %v", size, err)
		}
		got, err := readFrame(bytes.NewReader(encoded))
		if err != nil || len(got.payload) != size {
			t.Fatalf("size %d: %v, %d bytes", size, err, len(got.payload))
		}
	}
}

func TestOversizeFramesAreRefusedBothWays(t *testing.T) {
	if _, err := encodeFrame(frame{typ: frameData, payload: make([]byte, frameMaxPayloadBytes+1)}); !errors.Is(err, errRefused) {
		t.Fatalf("encode: %v", err)
	}
	header := make([]byte, frameHeaderBytes)
	header[0] = byte(frameData)
	binary.BigEndian.PutUint32(header[5:], frameMaxPayloadBytes+1)
	if _, err := readFrame(bytes.NewReader(header)); !errors.Is(err, errRefused) {
		t.Fatalf("read: %v", err)
	}
}

func TestUnknownTypesAreRefused(t *testing.T) {
	if _, err := encodeFrame(frame{typ: 0}); !errors.Is(err, errRefused) {
		t.Fatalf("encode: %v", err)
	}
	if _, err := readFrame(bytes.NewReader([]byte{7, 0, 0, 0, 1, 0, 0, 0, 0})); !errors.Is(err, errRefused) {
		t.Fatalf("read: %v", err)
	}
}

func TestFramesReadHoweverTheStreamIsSplit(t *testing.T) {
	var stream bytes.Buffer
	for _, f := range []frame{
		{typ: frameOpen, channel: 1},
		{typ: frameData, channel: 1, payload: []byte("abc")},
		{typ: frameClose, channel: 1},
	} {
		if err := writeFrame(&stream, f); err != nil {
			t.Fatal(err)
		}
	}
	reader := iotest.OneByteReader(&stream)
	for _, typ := range []frameType{frameOpen, frameData, frameClose} {
		f, err := readFrame(reader)
		if err != nil || f.typ != typ {
			t.Fatalf("want %d: %+v, %v", typ, f, err)
		}
	}
	if _, err := readFrame(reader); err != io.EOF {
		t.Fatalf("at the end: %v", err)
	}
}

func TestATruncatedFrameIsAnUnexpectedEnd(t *testing.T) {
	encoded, _ := encodeFrame(frame{typ: frameData, channel: 1, payload: []byte("abcdef")})
	for _, cut := range []int{3, frameHeaderBytes, len(encoded) - 1} {
		if _, err := readFrame(bytes.NewReader(encoded[:cut])); err != io.ErrUnexpectedEOF {
			t.Fatalf("cut at %d: %v", cut, err)
		}
	}
}
