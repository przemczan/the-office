import { describe, expect, it } from "vitest";
import { PAIR_WIRELESS_ERRORS } from "./device-words.ts";
import { phonePortOf, wirelessPairingOf } from "./wireless-pairing-fields.tsx";

describe("the pairing the fields make", () => {
  it("takes ports from 1 to 65535, an IPv6 address and a code with a space in it", () => {
    expect(
      wirelessPairingOf({
        address: " fd00::20 ",
        port: "1",
        pairingPort: "65535",
        pairingCode: "482 913",
      }),
    ).toEqual({
      pairing: { address: "fd00::20", port: 1, pairingPort: 65_535, pairingCode: "482913" },
    });
    expect(
      wirelessPairingOf({
        address: "10.0.0.2",
        port: "0",
        pairingPort: "5",
        pairingCode: "1234567",
      }),
    ).toEqual({
      errors: {
        port: PAIR_WIRELESS_ERRORS.badPort,
        pairingCode: PAIR_WIRELESS_ERRORS.badPairingCode,
      },
    });
  });
});

describe("a port on the phone", () => {
  it("is a number from 1 to 65535, or says what is wrong", () => {
    expect(phonePortOf(" 40111 ")).toBe(40_111);
    expect(phonePortOf("")).toBe(PAIR_WIRELESS_ERRORS.noPort);
    expect(phonePortOf("65536")).toBe(PAIR_WIRELESS_ERRORS.badPort);
    expect(phonePortOf("4a")).toBe(PAIR_WIRELESS_ERRORS.badPort);
  });
});
