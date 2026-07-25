import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { inputSchema, loadCatalogs, resolveUnityCli } from "./catalog.js";
import { versionMismatchWarning } from "./compatibility.js";
import { executeCatalogTool } from "./executor.js";
import { ToolkitError } from "./errors.js";
import { mergeLiveSchemas } from "./live-catalog.js";
import { parseMixedOutput } from "./output.js";
import { runProcess } from "./process.js";
import type { CatalogTool, ToolCatalog } from "./types.js";

const packageRoot =
  process.env.UNIGAME_UNITYCLI_ROOT ??
  join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const capabilityPath = join(
  packageRoot,
  "Documentation~",
  "unity-cli-capabilities.md",
);
const expectedCliVersion = "1.0.0-beta.2";

interface LiveRefreshStatus {
  editor: boolean;
  player: boolean;
  warnings: string[];
}

const serviceSchemas: Record<string, Record<string, unknown>> = {
  unity_catalog_status: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  unity_connection_status: {
    type: "object",
    properties: {
      projectPath: { type: "string" },
      runtimePath: { type: "string" },
      timeoutMs: { type: "integer", minimum: 100, maximum: 120_000 },
    },
    additionalProperties: false,
  },
  unity_capability_search: {
    type: "object",
    properties: {
      query: { type: "string", minLength: 1 },
      source: { enum: ["all", "cli", "editor", "player"], default: "all" },
      limit: { type: "integer", minimum: 1, maximum: 100, default: 25 },
    },
    required: ["query"],
    additionalProperties: false,
  },
};

const serviceDescriptions: Record<string, string> = {
  unity_catalog_status:
    "Report bundled catalog versions/counts and compare the installed Unity CLI version.",
  unity_connection_status:
    "Query connected Unity Editors and optionally enumerate a Development Player.",
  unity_capability_search:
    "Search all bundled CLI, Editor, and Player tool names and descriptions.",
};

function jsonContent(value: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

async function cliVersion(): Promise<{
  path: string | null;
  installed: string | null;
  matches: boolean;
}> {
  const path = await resolveUnityCli();
  if (!path) return { path: null, installed: null, matches: false };
  const result = await runProcess(path, ["--version"], { timeoutMs: 10_000 });
  const installed = result.exitCode === 0 ? result.stdout.trim() : null;
  return { path, installed, matches: installed === expectedCliVersion };
}

async function refreshLivePipelineSchemas(
  catalogs: ToolCatalog[],
): Promise<LiveRefreshStatus> {
  const status: LiveRefreshStatus = {
    editor: false,
    player: false,
    warnings: [],
  };
  const cli = await resolveUnityCli();
  if (!cli) return status;

  const targets = [
    {
      source: "editor" as const,
      value: process.env.UNITY_PROJECT_PATH,
      option: "--project-path",
    },
    {
      source: "player" as const,
      value: process.env.UNITY_RUNTIME_PATH,
      option: "--runtime-path",
    },
  ];
  for (const target of targets) {
    if (!target.value) continue;
    const result = await runProcess(
      cli,
      ["list", target.option, target.value, "--format", "json"],
      { timeoutMs: 30_000 },
    );
    if (result.exitCode !== 0) {
      status.warnings.push(
        `${target.source} live schema refresh failed; using bundled snapshot.`,
      );
      continue;
    }
    const parsed = parseMixedOutput(result.stdout).data as
      | { data?: { tools?: unknown[] }; tools?: unknown[] }
      | null;
    const liveTools = parsed?.data?.tools ?? parsed?.tools;
    const index = catalogs.findIndex((catalog) => catalog.source === target.source);
    if (!Array.isArray(liveTools) || index < 0) {
      status.warnings.push(
        `${target.source} live schema output was invalid; using bundled snapshot.`,
      );
      continue;
    }
    catalogs[index] = mergeLiveSchemas(
      catalogs[index],
      liveTools as Parameters<typeof mergeLiveSchemas>[1],
    );
    status[target.source] = true;
  }
  return status;
}

async function serviceCall(
  name: string,
  input: Record<string, unknown>,
  catalogs: ToolCatalog[],
  liveRefresh: LiveRefreshStatus,
  signal?: AbortSignal,
) {
  if (name === "unity_catalog_status") {
    const version = await cliVersion();
    const mismatch = versionMismatchWarning(expectedCliVersion, version.installed);
    return {
      ok: Boolean(version.path),
      expectedCliVersion,
      cli: version,
      catalogs: catalogs.map((catalog) => ({
        source: catalog.source,
        productVersion: catalog.productVersion,
        editorVersion: catalog.editorVersion ?? null,
        count: catalog.tools.length,
        liveSchema:
          catalog.source === "editor"
            ? liveRefresh.editor
            : catalog.source === "player"
              ? liveRefresh.player
              : false,
      })),
      warnings: [
        ...(mismatch ? [mismatch] : []),
        ...liveRefresh.warnings.map((message) => ({
          code: "UPSTREAM_FAILED",
          message,
        })),
      ],
    };
  }

  if (name === "unity_capability_search") {
    const query = String(input.query).toLowerCase();
    const source = String(input.source ?? "all");
    const limit = Number(input.limit ?? 25);
    return {
      ok: true,
      query,
      matches: catalogs
        .flatMap((catalog) => catalog.tools)
        .filter((tool) => source === "all" || tool.source === source)
        .filter((tool) =>
          `${tool.toolName} ${tool.name} ${tool.description}`
            .toLowerCase()
            .includes(query),
        )
        .slice(0, limit)
        .map((tool) => ({
          tool: tool.toolName,
          source: tool.source,
          command: tool.name,
          description: tool.description,
        })),
    };
  }

  if (name === "unity_connection_status") {
    const cli = await resolveUnityCli();
    if (!cli) {
      throw new ToolkitError(
        "CLI_NOT_FOUND",
        "Unity CLI was not found. Set UNITY_CLI_PATH or install it.",
      );
    }
    const timeoutMs = Number(input.timeoutMs ?? 30_000);
    const statusArgs = ["status", "--format", "json"];
    if (input.projectPath) statusArgs.push("--project", String(input.projectPath));
    const editor = await runProcess(cli, statusArgs, { timeoutMs, signal });
    let player = null;
    if (input.runtimePath) {
      player = await runProcess(
        cli,
        ["list", "--runtime-path", String(input.runtimePath), "--format", "json"],
        { timeoutMs, signal },
      );
    }
    return {
      ok: editor.exitCode === 0 && (!player || player.exitCode === 0),
      editor: {
        exitCode: editor.exitCode,
        output: editor.stdout.trim(),
      },
      player: player
        ? { exitCode: player.exitCode, output: player.stdout.trim() }
        : null,
    };
  }

  throw new ToolkitError("UPSTREAM_FAILED", `Unknown service tool: ${name}`);
}

export async function createServer(): Promise<Server> {
  const catalogs = await loadCatalogs();
  const liveRefresh = await refreshLivePipelineSchemas(catalogs);
  const catalogTools = catalogs.flatMap((catalog) => catalog.tools);
  const byName = new Map<string, CatalogTool>(
    catalogTools.map((tool) => [tool.toolName, tool]),
  );

  const server = new Server(
    { name: "unigame-unity-cli", version: "0.1.0" },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      ...Object.keys(serviceSchemas).map((name) => ({
        name,
        description: serviceDescriptions[name],
        inputSchema: serviceSchemas[name],
      })),
      ...catalogTools.map((tool) => ({
        name: tool.toolName,
        description: tool.description,
        inputSchema: inputSchema(tool),
      })),
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const name = request.params.name;
    const input = (request.params.arguments ?? {}) as Record<string, unknown>;
    try {
      if (name in serviceSchemas) {
        return jsonContent(
          await serviceCall(name, input, catalogs, liveRefresh, extra.signal),
        );
      }
      const tool = byName.get(name);
      if (!tool) {
        return jsonContent(
          { ok: false, code: "UPSTREAM_FAILED", message: `Unknown tool: ${name}` },
          true,
        );
      }
      const result = await executeCatalogTool(tool, input, extra.signal);
      return jsonContent(result, !result.ok);
    } catch (error) {
      if (error instanceof ToolkitError) {
        return jsonContent(
          {
            ok: false,
            code: error.code,
            message: error.message,
            details: error.details ?? null,
          },
          true,
        );
      }
      return jsonContent(
        {
          ok: false,
          code: "UPSTREAM_FAILED",
          message: error instanceof Error ? error.message : String(error),
        },
        true,
      );
    }
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      {
        uri: "unity-cli://capabilities",
        name: "Unity CLI capability map",
        description: "Versioned standalone, batch, Editor, and Player capabilities.",
        mimeType: "text/markdown",
      },
      ...catalogs.map((catalog) => ({
        uri: `unity-cli://catalog/${catalog.source}`,
        name: `${catalog.source} tool catalog`,
        description: `${catalog.tools.length} versioned ${catalog.source} tools.`,
        mimeType: "application/json",
      })),
    ],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    if (request.params.uri === "unity-cli://capabilities") {
      return {
        contents: [
          {
            uri: request.params.uri,
            mimeType: "text/markdown",
            text: await readFile(capabilityPath, "utf8"),
          },
        ],
      };
    }
    const source = request.params.uri.replace("unity-cli://catalog/", "");
    const catalog = catalogs.find((entry) => entry.source === source);
    if (!catalog) throw new Error(`Unknown resource: ${request.params.uri}`);
    return {
      contents: [
        {
          uri: request.params.uri,
          mimeType: "application/json",
          text: JSON.stringify(catalog, null, 2),
        },
      ],
    };
  });

  return server;
}
