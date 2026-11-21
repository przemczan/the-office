import { DEFAULT_TEST_INSTANCE_SETTINGS } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import {
  portCountWords,
  problemsOfRefusal,
  settingsWithPorts,
} from "./test-instance-settings-draft.ts";

const SHOWN = DEFAULT_TEST_INSTANCE_SETTINGS;

describe("the Test instances card's Proxy ports", () => {
  it("saves the whole set with the ports as typed", () => {
    expect(settingsWithPorts(SHOWN, { first: "5000", last: "5009" })).toEqual({
      settings: { ...SHOWN, firstProxyPort: 5000, lastProxyPort: 5009 },
    });
    expect(portCountWords({ first: "5000", last: "5009" })).toBe("10 ports");
  });

  it("sends nothing when the ports are as saved", () => {
    expect(settingsWithPorts(SHOWN, { first: "4400", last: "4419" })).toBeUndefined();
  });

  it("refuses a port out of range, or a range reversed, naming the field", () => {
    expect(settingsWithPorts(SHOWN, { first: "1023", last: "1100" })).toEqual({
      problems: [
        {
          field: "firstProxyPort",
          words: "First proxy port: A Proxy port is a whole number from 1024 to 65535.",
        },
      ],
    });
    expect(settingsWithPorts(SHOWN, { first: "4400", last: "4300" })).toEqual({
      problems: [
        {
          field: "lastProxyPort",
          words: "Last proxy port: The last Proxy port can't be below the first.",
        },
      ],
    });
    expect(settingsWithPorts(SHOWN, { first: "44a0", last: "4419" })).toHaveProperty("problems");
  });

  it("names the field the service's refusal names", () => {
    expect(
      problemsOfRefusal("firstProxyPort: The Proxy ports can't hold The Office's own port, 4392."),
    ).toEqual([
      {
        field: "firstProxyPort",
        words: "First proxy port: The Proxy ports can't hold The Office's own port, 4392.",
      },
    ]);
  });
});
