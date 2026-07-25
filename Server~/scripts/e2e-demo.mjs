#!/usr/bin/env node

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const here = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(here, "..");

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length
    ? process.argv[index + 1]
    : fallback;
}

const projectPath = resolve(
  option("--project", process.env.UNITY_PROJECT_PATH ?? ""),
);
const cliPath = option("--cli", process.env.UNITY_CLI_PATH ?? "");

if (!option("--project", process.env.UNITY_PROJECT_PATH)) {
  throw new Error("Pass --project <absolute-project-path> or set UNITY_PROJECT_PATH.");
}
if (!cliPath) {
  throw new Error("Pass --cli <unity-cli-path> or set UNITY_CLI_PATH.");
}

function pyramidPositions() {
  const positions = [];
  for (let layer = 0; layer < 5; layer += 1) {
    const size = 5 - layer;
    const offset = (size - 1) / 2;
    for (let z = 0; z < size; z += 1) {
      for (let x = 0; x < size; x += 1) {
        positions.push([
          Number(((x - offset) * 1.1).toFixed(4)),
          Number((layer * 1.1).toFixed(4)),
          Number(((z - offset) * 1.1).toFixed(4)),
        ]);
      }
    }
  }
  return positions;
}

function contentJson(result, tool) {
  const text = result.content?.find((item) => item.type === "text")?.text;
  if (!text) throw new Error(`${tool} returned no text content.`);
  const parsed = JSON.parse(text);
  if (result.isError || parsed.ok === false) {
    throw new Error(`${tool} failed: ${JSON.stringify(parsed)}`);
  }
  return parsed;
}

function findNodes(value, matches = []) {
  if (Array.isArray(value)) {
    for (const entry of value) findNodes(entry, matches);
  } else if (value && typeof value === "object") {
    if (typeof value.name === "string") matches.push(value);
    for (const entry of Object.values(value)) findNodes(entry, matches);
  }
  return matches;
}

function extractEvalText(value) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  for (const key of ["result", "value", "output", "data"]) {
    const found = extractEvalText(value[key]);
    if (found) return found;
  }
  return "";
}

const expectedPositions = pyramidPositions();
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(serverRoot, "build", "index.js")],
  cwd: serverRoot,
  env: {
    UNITY_CLI_PATH: cliPath,
    UNITY_PROJECT_PATH: projectPath,
  },
  stderr: "pipe",
});
const client = new Client({
  name: "unigame-unitycli-e2e",
  version: "0.1.0",
});

async function call(name, args = {}) {
  return contentJson(
    await client.callTool({ name, arguments: args }),
    name,
  );
}

try {
  await client.connect(transport);
  const listed = await client.listTools();
  if (listed.tools.length !== 269) {
    throw new Error(`Expected 269 MCP tools, received ${listed.tools.length}.`);
  }

  const catalog = await call("unity_catalog_status");
  const counts = Object.fromEntries(
    catalog.catalogs.map((entry) => [entry.source, entry.count]),
  );
  if (counts.cli !== 112 || counts.editor !== 140 || counts.player !== 14) {
    throw new Error(`Unexpected catalog counts: ${JSON.stringify(counts)}`);
  }
  if (!catalog.catalogs.find((entry) => entry.source === "editor")?.liveSchema) {
    throw new Error("Connected Editor schemas were not refreshed from unity list.");
  }

  await call("unity_connection_status", { projectPath, timeoutMs: 30_000 });
  await call("unity_editor_menu", {
    projectPath,
    path: "UniGame/Unity CLI MCP",
    confirm: true,
  });
  const setupWindow = await call("unity_editor_eval", {
    projectPath,
    code: [
      "var found = false;",
      "foreach (var window in UnityEngine.Resources.FindObjectsOfTypeAll<UnityEditor.EditorWindow>()) {",
      '  if (window.titleContent != null && window.titleContent.text == "Unity CLI MCP") {',
      "    found = true;",
      "    window.Close();",
      "  }",
      "}",
      'return found ? "true" : "false";',
    ].join("\n"),
    confirm: true,
  });
  if (extractEvalText(setupWindow.data) !== "true") {
    throw new Error("Unity CLI Control Center did not open through its menu item.");
  }
  await call("unity_editor_create_folder", {
    projectPath,
    path: "UnityCliDemo",
    confirm: true,
  });
  await call("unity_editor_set_authoring_root", {
    projectPath,
    root: "Assets/UnityCliDemo",
    confirm: true,
  });
  await call("unity_editor_create_folder", {
    projectPath,
    path: "Scenes",
    confirm: true,
  });
  await call("unity_editor_create_scene", {
    projectPath,
    path: "Scenes/CubePyramid.unity",
    template: "empty",
    confirm: true,
  });
  await call("unity_editor_create_gameobject", {
    projectPath,
    name: "CubePyramid",
    confirm: true,
  });
  await call("unity_editor_create_gameobjects", {
    projectPath,
    name: "Cube",
    primitive: "cube",
    parent: "/CubePyramid",
    count: 55,
    positions: expectedPositions,
    confirm: true,
    timeoutMs: 120_000,
  });
  await call("unity_editor_save_scene", {
    projectPath,
    path: "Scenes/CubePyramid.unity",
    confirm: true,
  });

  const hierarchy = await call("unity_editor_get_scene_hierarchy", {
    projectPath,
    path: "Scenes/CubePyramid.unity",
  });
  const nodes = findNodes(hierarchy.data);
  const cubes = nodes.filter((node) => /^Cube\d+$/.test(node.name));
  const names = new Set(cubes.map((node) => node.name));
  if (cubes.length !== 55 || names.size !== 55) {
    throw new Error(
      `Expected 55 uniquely named cubes; got ${cubes.length}/${names.size}.`,
    );
  }

  const evalCode = [
    'var root = UnityEngine.GameObject.Find("CubePyramid");',
    'var values = new System.Collections.Generic.List<string>();',
    "for (var i = 0; i < root.transform.childCount; i++) {",
    "  var child = root.transform.GetChild(i);",
    "  var p = child.localPosition;",
    '  values.Add(child.name + ":" + p.x.ToString("R", System.Globalization.CultureInfo.InvariantCulture) + "," + p.y.ToString("R", System.Globalization.CultureInfo.InvariantCulture) + "," + p.z.ToString("R", System.Globalization.CultureInfo.InvariantCulture));',
    "}",
    'return string.Join("|", values);',
  ].join("\n");
  const evaluated = await call("unity_editor_eval", {
    projectPath,
    code: evalCode,
    timeout: 15_000,
    timeoutMs: 30_000,
    confirm: true,
  });
  const positionText = extractEvalText(evaluated.data);
  const actual = new Map(
    positionText
      .split("|")
      .filter(Boolean)
      .map((entry) => {
        const [name, coordinates] = entry.split(":");
        return [name, coordinates.split(",").map(Number)];
      }),
  );
  if (actual.size !== 55) {
    throw new Error(`Expected 55 transform results; got ${actual.size}.`);
  }
  expectedPositions.forEach((position, index) => {
    const value = actual.get(`Cube${index + 1}`);
    if (
      !value ||
      value.some((component, axis) => Math.abs(component - position[axis]) > 0.0001)
    ) {
      throw new Error(
        `Position mismatch for Cube${index + 1}: ${JSON.stringify(value)}.`,
      );
    }
  });

  await call("unity_editor_recompile", {
    projectPath,
    confirm: true,
    timeoutMs: 120_000,
  });
  let compileStatus = null;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    compileStatus = await call("unity_editor_recompile_status", { projectPath });
    const status = JSON.stringify(compileStatus.data).toLowerCase();
    if (status.includes("completed") || status.includes("up_to_date")) break;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000));
  }
  const errors = await call("unity_editor_get_console_logs", {
    projectPath,
    severity: "error",
    limit: 100,
  });
  const errorEntries =
    errors.data?.result?.entries ??
    errors.data?.entries ??
    errors.data?.result ??
    [];
  if (Array.isArray(errorEntries) && errorEntries.length > 0) {
    throw new Error(`Unity reported compile errors: ${JSON.stringify(errorEntries)}`);
  }

  console.log(JSON.stringify({
    ok: true,
    tools: listed.tools.length,
    catalogs: counts,
    scenePath: "Assets/UnityCliDemo/Scenes/CubePyramid.unity",
    cubes: cubes.length,
    uniqueNames: names.size,
    verifiedPositions: actual.size,
    compileStatus: compileStatus?.data ?? null,
    compileErrors: 0,
  }, null, 2));
} finally {
  await transport.close();
}
