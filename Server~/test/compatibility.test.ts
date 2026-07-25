import { describe, expect, it } from "vitest";
import {
  disconnectedTargetCode,
  versionMismatchWarning,
} from "../src/compatibility.js";

describe("compatibility diagnostics", () => {
  it("reports catalog version drift without blocking", () => {
    expect(versionMismatchWarning("1.0.0-beta.2", "1.0.0-beta.3")).toEqual({
      code: "VERSION_MISMATCH",
      message:
        "Installed CLI 1.0.0-beta.3 differs from snapshot 1.0.0-beta.2.",
    });
    expect(versionMismatchWarning("1.0.0-beta.2", "1.0.0-beta.2")).toBeNull();
  });

  it("classifies disconnected Editor and Player targets", () => {
    expect(
      disconnectedTargetCode(
        "editor",
        "No Pipeline instance found for project C:/Game",
      ),
    ).toBe("EDITOR_NOT_CONNECTED");
    expect(
      disconnectedTargetCode(
        "player",
        "No Development Player runtime descriptor was found",
      ),
    ).toBe("PLAYER_NOT_CONNECTED");
  });
});
