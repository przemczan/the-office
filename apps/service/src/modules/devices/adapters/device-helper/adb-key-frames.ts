import { Injectable } from "@nestjs/common";
import { DEVICE_FRAME_TYPES, encodeFrame } from "@the-office/contracts";
import type { AdbKey } from "../../domain/adb-key.js";
import { AdbKeyInput } from "../../ports/adb-key-input.js";

/** The helper's `adb-key` mode reads the private key on channel 1 and the public key on 2. */
const PRIVATE_KEY_CHANNEL = 1;
const PUBLIC_KEY_CHANNEL = 2;

/** The key as device frames (`tools/device-helper/adbkey.go`). */
@Injectable()
export class AdbKeyFrames extends AdbKeyInput {
  of(key: AdbKey): readonly Uint8Array[] {
    return [
      encodeFrame({
        type: DEVICE_FRAME_TYPES.data,
        channel: PRIVATE_KEY_CHANNEL,
        payload: Buffer.from(key.privateKey),
      }),
      encodeFrame({
        type: DEVICE_FRAME_TYPES.data,
        channel: PUBLIC_KEY_CHANNEL,
        payload: Buffer.from(key.publicKey),
      }),
    ];
  }
}
