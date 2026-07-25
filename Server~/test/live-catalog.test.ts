import { describe, expect, it } from "vitest";
import { mergeLiveSchemas } from "../src/live-catalog.js";
import type { ToolCatalog } from "../src/types.js";

describe("live Pipeline schemas", () => {
  it("refreshes known schemas while preserving the published tool set", () => {
    const snapshot: ToolCatalog = {
      schemaVersion: 1,
      source: "editor",
      productVersion: "0.4.0-exp.1",
      generatedAt: "snapshot",
      tools: [
        {
          name: "create_scene",
          toolName: "unity_editor_create_scene",
          description: "old",
          source: "editor",
          command: ["create_scene"],
          parameters: [],
        },
      ],
    };
    const merged = mergeLiveSchemas(snapshot, [
      {
        name: "create_scene",
        description: "live",
        parameters: [
          {
            name: "path",
            type: "string",
            description: "Scene path",
            required: true,
          },
        ],
      },
      {
        name: "future_tool",
        description: "not published by this pinned release",
      },
    ]);
    expect(merged.tools).toHaveLength(1);
    expect(merged.tools[0]).toMatchObject({
      description: "live",
      parameters: [{ name: "path", required: true }],
    });
  });
});
