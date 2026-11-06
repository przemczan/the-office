import { describe, expect, it } from "vitest";
import { chatDrawerLayout } from "./chat-drawer-width.ts";

describe("chatDrawerLayout", () => {
  it("keeps the remembered width when there is room", () => {
    expect(chatDrawerLayout("beside", 1600, 500)).toEqual({
      place: "beside",
      width: 500,
      most: 720,
    });
  });

  it("leaves the page room to lay itself out beside it", () => {
    expect(chatDrawerLayout("beside", 1000, 700)).toMatchObject({ width: 520, most: 520 });
  });

  it("leaves some of the page in view when it lies over it", () => {
    expect(chatDrawerLayout("over", 700, 700)).toMatchObject({ width: 460, most: 460 });
  });

  it("never goes under its least, however little room there is", () => {
    expect(chatDrawerLayout("beside", 700, 420)).toMatchObject({ width: 360, most: 360 });
  });
});
