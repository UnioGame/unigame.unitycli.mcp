import { describe, expect, it } from "vitest";
import {
  inputSchema,
  loadCatalogs,
  normalizeToolName,
} from "../src/catalog.js";

describe("catalogs", () => {
  it("contains complete versioned snapshots with unique MCP names", async () => {
    const catalogs = await loadCatalogs();
    const counts = Object.fromEntries(
      catalogs.map((catalog) => [catalog.source, catalog.tools.length]),
    );
    expect(counts).toEqual({ cli: 112, editor: 140, player: 14 });

    const names = catalogs.flatMap((catalog) =>
      catalog.tools.map((tool) => tool.toolName),
    );
    expect(new Set(names).size).toBe(names.length);
  });

  it("adds common controls to every command schema", async () => {
    const [catalog] = await loadCatalogs();
    const schema = inputSchema(catalog.tools[0]) as {
      properties: Record<string, unknown>;
    };
    expect(schema.properties).toHaveProperty("timeoutMs");
    expect(schema.properties).toHaveProperty("confirm");
    expect(schema.properties).toHaveProperty("extraArgs");
    expect(schema.properties).toHaveProperty("includeLogs");
  });

  it("exposes Pipeline vector matrices as numeric nested arrays", async () => {
    const catalogs = await loadCatalogs();
    const editor = catalogs.find((catalog) => catalog.source === "editor");
    const tool = editor?.tools.find((entry) => entry.name === "create_gameobjects");
    const schema = inputSchema(tool!) as {
      properties: Record<string, unknown>;
    };
    expect(schema.properties.positions).toMatchObject({
      type: "array",
      items: {
        type: "array",
        items: { type: "number" },
      },
    });
  });

  it("normalizes command aliases into stable MCP identifiers", () => {
    expect(normalizeToolName("projects link-vcs")).toBe("projects_link_vcs");
  });
});
