package main

// The frames the helper speaks on its standard input and output. This file is the Go twin of
// packages/contracts/src/device-frames.ts; change both together.
//
// A frame is `u8 type | u32 channel | u32 length | payload`, big-endian. Channel 0 carries the
// helper's own frames (HELLO, READY, ENDED); each relayed connection gets a channel from 1 up.

import (
	"encoding/binary"
	"errors"
	"fmt"
	"io"
)

type frameType uint8

const (
	frameHello frameType = 1 // helper to service, first: the helper's version
	frameReady frameType = 2 // helper to service: the endpoint it listens on
	frameOpen  frameType = 3 // helper to service: a connection was accepted on the channel
	frameData  frameType = 4 // either way: bytes on the channel
	frameClose frameType = 5 // either way: the channel is closed
	frameEnded frameType = 6 // helper to service, last: why it ends
)

const (
	frameHeaderBytes       = 9
	frameMaxPayloadBytes   = 1024 * 1024
	controlChannel         = 0
	firstConnectionChannel = 1
)

// errRefused is a frame of an unknown type or over the maximum payload, or one that can't be
// written; the stream can't be read on after it.
var errRefused = errors.New("frame refused")

type frame struct {
	typ     frameType
	channel uint32
	payload []byte
}

func (t frameType) valid() bool { return t >= frameHello && t <= frameEnded }

func encodeFrame(f frame) ([]byte, error) {
	if !f.typ.valid() {
		return nil, fmt.Errorf("%w: unknown frame type %d", errRefused, f.typ)
	}
	if len(f.payload) > frameMaxPayloadBytes {
		return nil, fmt.Errorf("%w: a frame of %d bytes is over the %d-byte maximum", errRefused, len(f.payload), frameMaxPayloadBytes)
	}
	bytes := make([]byte, frameHeaderBytes+len(f.payload))
	bytes[0] = byte(f.typ)
	binary.BigEndian.PutUint32(bytes[1:5], f.channel)
	binary.BigEndian.PutUint32(bytes[5:9], uint32(len(f.payload)))
	copy(bytes[frameHeaderBytes:], f.payload)
	return bytes, nil
}

func writeFrame(w io.Writer, f frame) error {
	bytes, err := encodeFrame(f)
	if err != nil {
		return err
	}
	_, err = w.Write(bytes)
	return err
}

// readFrame reads one frame however the stream is chunked. It returns io.EOF at a frame boundary,
// io.ErrUnexpectedEOF inside a frame, and an error wrapping errRefused for a frame it refuses.
func readFrame(r io.Reader) (frame, error) {
	var header [frameHeaderBytes]byte
	if _, err := io.ReadFull(r, header[:]); err != nil {
		return frame{}, err
	}
	typ := frameType(header[0])
	length := binary.BigEndian.Uint32(header[5:9])
	if !typ.valid() {
		return frame{}, fmt.Errorf("%w: unknown frame type %d", errRefused, typ)
	}
	if length > frameMaxPayloadBytes {
		return frame{}, fmt.Errorf("%w: a frame of %d bytes is over the %d-byte maximum", errRefused, length, frameMaxPayloadBytes)
	}
	payload := make([]byte, length)
	if _, err := io.ReadFull(r, payload); err != nil {
		if errors.Is(err, io.EOF) {
			err = io.ErrUnexpectedEOF
		}
		return frame{}, err
	}
	return frame{typ: typ, channel: binary.BigEndian.Uint32(header[1:5]), payload: payload}, nil
}
