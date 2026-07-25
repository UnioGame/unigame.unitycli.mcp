import { describe, expect, it } from "vitest";
import { requireConfirmation } from "../src/safety.js";
import { ToolkitError } from "../src/errors.js";
import type { CatalogTool } from "../src/types.js";

const dangerousTool: CatalogTool = {
  name: "delete_asset",
  toolName: "unity_editor_delete_asset",
  description: "Delete asset",
  source: "editor",
  command: ["delete_asset"],
  dangerous: true,
  parameters: [],
};

describe("requireConfirmation", () => {
  it("rejects unconfirmed high-risk operations", () => {
    expect(() => requireConfirmation(dangerousTool, {})).toThrowError(
      ToolkitError,
    );
  });

  it("accepts explicit confirmation", () => {
    expect(() =>
      requireConfirmation(dangerousTool, { confirm: true }),
    ).not.toThrow();
  });
});
