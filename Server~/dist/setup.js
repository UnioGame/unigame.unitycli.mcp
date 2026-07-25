#!/usr/bin/env node

// src/setup/manager.ts
import { createHash as createHash4, randomBytes, randomUUID as randomUUID2 } from "node:crypto";
import {
  access as access2,
  copyFile,
  cp,
  mkdir as mkdir2,
  readFile as readFile4,
  rename as rename2,
  rm as rm2,
  stat as stat3,
  writeFile as writeFile2
} from "node:fs/promises";
import { closeSync, constants as constants2, existsSync as existsSync3, openSync } from "node:fs";
import { dirname as dirname5, join as join6 } from "node:path";
import { spawn as spawn2 } from "node:child_process";

// src/catalog.ts
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import process2 from "node:process";
var catalogDirectory = join(dirname(fileURLToPath(import.meta.url)), "..", "catalogs");
async function executableExists(path) {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
async function resolveUnityCli() {
  const executable = process2.platform === "win32" ? "unity.exe" : "unity";
  const candidates = [
    process2.env.UNITY_CLI_PATH,
    ...(process2.env.PATH ?? "").split(delimiter).filter(Boolean).map((path) => join(path, executable))
  ];
  if (process2.platform === "win32") {
    candidates.push(join(process2.env.LOCALAPPDATA ?? "", "Unity", "bin", "unity.exe"));
  } else {
    candidates.push(
      join(process2.env.HOME ?? "", ".local", "bin", "unity"),
      "/usr/local/bin/unity",
      "/opt/unity/bin/unity"
    );
  }
  for (const candidate of candidates.filter((value) => Boolean(value))) {
    if (await executableExists(candidate)) return candidate;
    if (process2.platform === "win32" && !extname(candidate)) {
      const withExtension = `${candidate}.exe`;
      if (await executableExists(withExtension)) return withExtension;
    }
  }
  return null;
}

// src/process.ts
import { spawn } from "node:child_process";
function runProcess(executable, args, options = {}) {
  const started = Date.now();
  const timeoutMs = options.timeoutMs ?? 3e4;
  const maxOutputBytes = options.maxOutputBytes ?? 1e6;
  return new Promise((resolve3, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let settled = false;
    const append = (target, chunk, isStdout) => {
      const current = isStdout ? stdoutBytes : stderrBytes;
      if (current >= maxOutputBytes) return;
      const remaining = maxOutputBytes - current;
      const kept = chunk.subarray(0, remaining);
      target.push(kept);
      if (isStdout) stdoutBytes += kept.length;
      else stderrBytes += kept.length;
    };
    child.stdout.on("data", (chunk) => append(stdout, chunk, true));
    child.stderr.on("data", (chunk) => append(stderr, chunk, false));
    const terminate = () => {
      if (!child.killed) child.kill();
    };
    const abort = () => terminate();
    options.signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, timeoutMs);
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      reject(error);
    });
    child.on("close", (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      resolve3({
        exitCode,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        timedOut,
        durationMs: Date.now() - started
      });
    });
  });
}

// src/redaction.ts
var secretPatterns = [
  [/(--?(?:access-?token|token|serial|password|secret)\s+)(\S+)/gi, "$1<redacted>"],
  [/(https?:\/\/[^:\s/@]+:)([^@\s]+)(@)/gi, "$1<redacted>$3"],
  [/\bey[A-Za-z0-9_-]{20,}\b/g, "<redacted-token>"],
  [
    /("(?:accessToken|evalToken|token|serial|password|secret)"\s*:\s*")[^"]+(")/gi,
    "$1<redacted>$2"
  ],
  [/\b(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1<redacted>"],
  [
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    "<redacted-email>"
  ]
];
function redact(value, maxLength = 1e6) {
  let result = value.slice(0, maxLength);
  for (const [pattern, replacement] of secretPatterns) {
    result = result.replace(pattern, replacement);
  }
  if (value.length > maxLength) result += "\n<truncated>";
  return result;
}

// src/setup/agents.ts
import { existsSync } from "node:fs";
import { dirname as dirname2, join as join2 } from "node:path";
var supportedAgents = [
  "codex",
  "cursor",
  "vscode",
  "cline",
  "claude-code",
  "claude-desktop"
];
function discoverAgents(context) {
  const appData = process.platform === "win32" ? join2(context.homePath, "AppData", "Roaming") : join2(context.homePath, ".config");
  const definitions = [
    {
      id: "codex",
      displayName: "Codex",
      installed: existsAny(join2(context.homePath, ".codex"), "codex"),
      configPath: envOr("UNIGAME_CODEX_CONFIG", join2(context.homePath, ".codex", "config.toml")),
      format: "toml",
      key: "mcpServers",
      restartRequired: true
    },
    {
      id: "cursor",
      displayName: "Cursor",
      installed: existsAny(join2(context.homePath, ".cursor"), "cursor"),
      configPath: envOr("UNIGAME_CURSOR_CONFIG", join2(context.homePath, ".cursor", "mcp.json")),
      format: "jsonc",
      key: "mcpServers",
      restartRequired: true
    },
    {
      id: "vscode",
      displayName: "VS Code / Copilot",
      installed: existsAny(join2(appData, "Code"), "code"),
      configPath: envOr("UNIGAME_VSCODE_CONFIG", join2(appData, "Code", "User", "mcp.json")),
      format: "jsonc",
      key: "servers",
      restartRequired: true
    },
    {
      id: "cline",
      displayName: "Cline",
      installed: existsSync(join2(context.homePath, ".cline")),
      configPath: envOr(
        "UNIGAME_CLINE_CONFIG",
        join2(context.homePath, ".cline", "data", "settings", "cline_mcp_settings.json")
      ),
      format: "json",
      key: "mcpServers",
      restartRequired: true
    },
    {
      id: "claude-code",
      displayName: "Claude Code",
      installed: existsAny(join2(context.homePath, ".claude"), "claude"),
      configPath: envOr("UNIGAME_CLAUDE_CONFIG", join2(context.homePath, ".claude.json")),
      format: "json",
      key: "mcpServers",
      restartRequired: true
    },
    {
      id: "claude-desktop",
      displayName: "Claude Desktop",
      installed: existsSync(join2(appData, "Claude")),
      configPath: join2(context.installRoot, "exports", `${context.serverName}.dxt.json`),
      format: "dxt",
      key: "mcpServers",
      restartRequired: false
    }
  ];
  return definitions;
}
function registrationValue(context, transport, serverPath, tokenFile, port = 0) {
  const env = {
    UNIGAME_UNITYCLI_ROOT: dirname2(dirname2(serverPath)),
    UNIGAME_UNITYCLI_DATA_PATH: context.dataPath
  };
  const value = transport === "http" ? {
    type: "http",
    url: `http://127.0.0.1:${port}/mcp`,
    headers: { Authorization: `Bearer file:${tokenFile}` }
  } : {
    command: process.execPath,
    args: [serverPath],
    env
  };
  return value;
}
function envOr(name, fallback) {
  return process.env[name] || fallback;
}
function existsAny(directory, executable) {
  if (existsSync(directory)) return true;
  const extensions = process.platform === "win32" ? [".exe", ".cmd", ""] : [""];
  return (process.env.PATH ?? "").split(process.platform === "win32" ? ";" : ":").some((entry) => extensions.some((ext) => existsSync(join2(entry, executable + ext))));
}

// src/setup/config.ts
import { createHash } from "node:crypto";
var managedMarker = "unigame-unitycli-mcp";
function fingerprint(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}
function stripJsonComments(text) {
  let result = "";
  let string = false;
  let escape = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    const next = text[index + 1];
    if (string) {
      result += char;
      if (escape) escape = false;
      else if (char === "\\") escape = true;
      else if (char === '"') string = false;
      continue;
    }
    if (char === '"') {
      string = true;
      result += char;
      continue;
    }
    if (char === "/" && next === "/") {
      while (index < text.length && text[index] !== "\n") index++;
      result += "\n";
      continue;
    }
    if (char === "/" && next === "*") {
      index += 2;
      while (index < text.length && !(text[index] === "*" && text[index + 1] === "/"))
        index++;
      index++;
      continue;
    }
    result += char;
  }
  return result.replace(/,\s*([}\]])/g, "$1");
}
function parseJsonc(text) {
  if (!text.trim()) return {};
  return JSON.parse(stripJsonComments(text));
}
function patchServerJsonc(text, property, serverName, value) {
  const parsed = parseJsonc(text);
  const servers = parsed[property] && typeof parsed[property] === "object" ? parsed[property] : {};
  if (value === void 0) delete servers[serverName];
  else servers[serverName] = value;
  parsed[property] = servers;
  const comments = extractComments(text);
  return `${comments.length ? `${comments.join("\n")}
` : ""}${JSON.stringify(parsed, null, 2)}
`;
}
function managedTomlBlock(name, value) {
  if (!value) return "";
  const begin = `# ${managedMarker}:${name}:begin`;
  const end = `# ${managedMarker}:${name}:end`;
  if (value.url) {
    const headers = value.headers && Object.keys(value.headers).length ? `http_headers = { ${Object.entries(value.headers).map(([key, entry]) => `${tomlKey(key)} = ${quote(entry)}`).join(", ")} }
` : "";
    return `${begin}
[mcp_servers.${tomlKey(name)}]
url = ${quote(value.url)}
${headers}${end}
`;
  }
  return `${begin}
[mcp_servers.${tomlKey(name)}]
command = ${quote(value.command)}
args = [${value.args.map(quote).join(", ")}]
env = { ${Object.entries(value.env).map(([key, entry]) => `${key} = ${quote(entry)}`).join(", ")} }
${end}
`;
}
function patchManagedToml(text, name, block) {
  const begin = `# ${managedMarker}:${name}:begin`;
  const end = `# ${managedMarker}:${name}:end`;
  const start = text.indexOf(begin);
  const finish = text.indexOf(end);
  let base = text;
  if (start >= 0 && finish >= start) {
    const lineEnd = text.indexOf("\n", finish);
    base = text.slice(0, start) + text.slice(lineEnd < 0 ? text.length : lineEnd + 1);
  }
  return `${base.trimEnd()}${base.trim() && block ? "\n\n" : ""}${block}`;
}
function managedTomlFingerprint(text, name) {
  const begin = `# ${managedMarker}:${name}:begin`;
  const end = `# ${managedMarker}:${name}:end`;
  const start = text.indexOf(begin);
  const finish = text.indexOf(end, start + begin.length);
  if (start < 0 || finish < 0) return null;
  const block = text.slice(start, finish + end.length);
  const url = scalar(block, "url");
  if (url !== null) {
    return fingerprint({
      type: "http",
      url,
      headers: inlineTable(block, "http_headers")
    });
  }
  const command = scalar(block, "command");
  const argsMatch = block.match(/^args\s*=\s*(\[[^\r\n]*\])/m);
  if (command === null || !argsMatch) return null;
  let args;
  try {
    args = JSON.parse(argsMatch[1]);
  } catch {
    return null;
  }
  return fingerprint({
    command,
    args,
    env: inlineTable(block, "env")
  });
}
function scalar(block, key) {
  const match = block.match(new RegExp(`^${key}\\s*=\\s*("(?:\\\\.|[^"])*")`, "m"));
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}
function inlineTable(block, key) {
  const match = block.match(new RegExp(`^${key}\\s*=\\s*\\{([^\\r\\n]*)\\}`, "m"));
  if (!match) return {};
  const result = {};
  const entries = match[1].matchAll(
    /("(?:\\.|[^"])*"|[A-Za-z_][A-Za-z0-9_-]*)\s*=\s*("(?:\\.|[^"])*")/g
  );
  for (const entry of entries) {
    try {
      const keyName = entry[1].startsWith('"') ? JSON.parse(entry[1]) : entry[1];
      result[keyName] = JSON.parse(entry[2]);
    } catch {
      return {};
    }
  }
  return result;
}
function quote(value) {
  return JSON.stringify(value);
}
function tomlKey(value) {
  return JSON.stringify(value);
}
function extractComments(text) {
  const comments = [];
  const pattern = /(?:^|\s)(\/\/[^\r\n]*|\/\*[\s\S]*?\*\/)/gm;
  for (const match of text.matchAll(pattern)) comments.push(match[1].trim());
  return [...new Set(comments)].filter(
    (comment) => !comment.includes(managedMarker)
  );
}

// src/setup/project.ts
import { createHash as createHash2 } from "node:crypto";
import { existsSync as existsSync2 } from "node:fs";
import { dirname as dirname3, join as join3, resolve } from "node:path";
import { homedir } from "node:os";
var toolkitVersion = "0.1.0";
function findProjectRoot(projectPath) {
  const unityProject = resolve(projectPath);
  let current = unityProject;
  while (true) {
    if (existsSync2(join3(current, ".git"))) return current;
    const parent = dirname3(current);
    if (parent === current) return unityProject;
    current = parent;
  }
}
function projectServerName(projectPath) {
  const normalized = resolve(projectPath).replaceAll("\\", "/").toLowerCase();
  const slug = resolve(projectPath).split(/[\\/]/).filter(Boolean).at(-1)?.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 32) || "UnityProject";
  const hash = createHash2("sha256").update(normalized).digest("hex").slice(0, 8);
  return `unigameUnityCli_${slug}_${hash}`;
}
function createContext(request) {
  if (!request.projectPath) throw new Error("projectPath is required");
  if (!request.packageRoot) throw new Error("packageRoot is required");
  const projectPath = resolve(request.projectPath);
  const homePath = resolve(request.homePath ?? homedir());
  const dataPath = resolve(
    request.dataPath ?? (process.platform === "win32" ? join3(process.env.LOCALAPPDATA ?? homePath, "UniGame") : join3(homePath, ".local", "share", "unigame"))
  );
  return {
    projectPath,
    projectRoot: findProjectRoot(projectPath),
    packageRoot: resolve(request.packageRoot),
    homePath,
    dataPath,
    installRoot: join3(dataPath, "unity-cli-mcp"),
    serverName: "unity_cli_mcp",
    legacyServerName: projectServerName(projectPath)
  };
}

// src/editor-registry.ts
import { createHash as createHash3 } from "node:crypto";
import { readdir, readFile as readFile2, stat } from "node:fs/promises";
import { isAbsolute, join as join4, normalize, resolve as resolve2 } from "node:path";
import { homedir as homedir2 } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
var editorMetadataSchemaVersion = 1;
var editorLeaseExpiryMs = 1e4;
var metadataKeys = /* @__PURE__ */ new Set([
  "schema_version",
  "metadata_revision",
  "project_id",
  "project_name",
  "project_path",
  "editor_instance_id",
  "editor_pid",
  "editor_started_at_utc",
  "editor_version",
  "package_version",
  "pipeline_version",
  "connection_state",
  "heartbeat_at_utc",
  "lease_expires_at_utc",
  "pipeline_descriptor_path",
  "capability_catalog_hash",
  "tool_count",
  "is_playing",
  "is_compiling",
  "compile_errors_count"
]);
var stringKeys = [
  "project_id",
  "project_name",
  "project_path",
  "editor_instance_id",
  "editor_started_at_utc",
  "editor_version",
  "package_version",
  "pipeline_version",
  "connection_state",
  "heartbeat_at_utc",
  "lease_expires_at_utc",
  "pipeline_descriptor_path",
  "capability_catalog_hash"
];
function defaultDataPath() {
  if (process.env.UNIGAME_UNITYCLI_DATA_PATH)
    return resolve2(process.env.UNIGAME_UNITYCLI_DATA_PATH);
  if (process.platform === "win32")
    return join4(process.env.LOCALAPPDATA ?? homedir2(), "UniGame");
  return join4(homedir2(), ".local", "share", "unigame");
}
function normalizeProjectPath(path) {
  let value = normalize(resolve2(path)).replaceAll("\\", "/");
  if (process.platform === "win32") value = value.toLowerCase();
  return value.replace(/\/+$/, "");
}
function projectId(path) {
  return createHash3("sha256").update(normalizeProjectPath(path)).digest("hex");
}
function validateEditorMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("metadata must be an object");
  const object = value;
  for (const key of Object.keys(object))
    if (!metadataKeys.has(key))
      throw new Error(`additional property is not allowed: ${key}`);
  for (const key of metadataKeys)
    if (!(key in object)) throw new Error(`required property is missing: ${key}`);
  if (object.schema_version !== editorMetadataSchemaVersion)
    throw new Error(`unsupported schema_version: ${String(object.schema_version)}`);
  for (const key of stringKeys)
    if (typeof object[key] !== "string" || !object[key])
      throw new Error(`${key} must be a non-empty string`);
  for (const key of ["metadata_revision", "editor_pid", "tool_count", "compile_errors_count"])
    if (!Number.isInteger(object[key]) || Number(object[key]) < 0)
      throw new Error(`${key} must be a non-negative integer`);
  if (Number(object.editor_pid) < 1)
    throw new Error("editor_pid must be a positive integer");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(object.editor_instance_id)))
    throw new Error("editor_instance_id must be a UUID");
  for (const key of ["is_playing", "is_compiling"])
    if (typeof object[key] !== "boolean") throw new Error(`${key} must be a boolean`);
  for (const key of ["editor_started_at_utc", "heartbeat_at_utc", "lease_expires_at_utc"])
    if (!Number.isFinite(Date.parse(String(object[key]))))
      throw new Error(`${key} must be an ISO timestamp`);
  if (!isAbsolute(String(object.project_path)) || projectId(String(object.project_path)) !== object.project_id)
    throw new Error("project_id does not match normalized project_path");
  if (!isAbsolute(String(object.pipeline_descriptor_path)))
    throw new Error("pipeline_descriptor_path must be absolute");
  return object;
}
var execFileAsync = promisify(execFile);
async function processMatchesStart(pid, startedAtUtc) {
  try {
    process.kill(pid, 0);
    let output;
    if (process.platform === "win32") {
      const result = await execFileAsync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().ToString('O')`
        ],
        { windowsHide: true, timeout: 2e3 }
      );
      output = result.stdout.trim();
    } else {
      const result = await execFileAsync(
        "ps",
        ["-o", "lstart=", "-p", String(pid)],
        { timeout: 2e3 }
      );
      output = result.stdout.trim();
    }
    const actual = Date.parse(output);
    const claimed = Date.parse(startedAtUtc);
    return Number.isFinite(actual) && Number.isFinite(claimed) && Math.abs(actual - claimed) <= 2e3;
  } catch {
    return false;
  }
}
async function defaultProcessMatches(metadata) {
  return processMatchesStart(metadata.editor_pid, metadata.editor_started_at_utc);
}
async function descriptorIsReadable(metadata) {
  try {
    const details = await stat(metadata.pipeline_descriptor_path);
    return details.isFile() && details.size > 0;
  } catch {
    return false;
  }
}
async function discoverEditors(options = {}) {
  const root = join4(options.dataPath ?? defaultDataPath(), "unity-cli-mcp", "registry", "editors");
  const snapshot = {
    active_editors: [],
    stale_editors: [],
    corrupt_entries: []
  };
  let projectDirectories;
  try {
    projectDirectories = await readdir(root, { withFileTypes: true });
  } catch {
    return snapshot;
  }
  const now = (options.now ?? /* @__PURE__ */ new Date()).getTime();
  const processMatches = options.processMatches ?? defaultProcessMatches;
  for (const projectDirectory of projectDirectories) {
    if (!projectDirectory.isDirectory()) continue;
    const projectRoot = join4(root, projectDirectory.name);
    let files;
    try {
      files = await readdir(projectRoot, { withFileTypes: true });
    } catch (error) {
      snapshot.corrupt_entries.push({ path: projectRoot, error: String(error) });
      continue;
    }
    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith(".json")) continue;
      const path = join4(projectRoot, file.name);
      let metadata;
      try {
        metadata = validateEditorMetadata(JSON.parse(await readFile2(path, "utf8")));
        if (projectDirectory.name !== metadata.project_id || file.name !== `${metadata.editor_instance_id}.json`)
          throw new Error("registry path does not match metadata identity");
      } catch (error) {
        snapshot.corrupt_entries.push({
          path,
          error: error instanceof Error ? error.message : String(error)
        });
        continue;
      }
      let staleReason = "";
      if (Date.parse(metadata.lease_expires_at_utc) <= now || now - Date.parse(metadata.heartbeat_at_utc) > editorLeaseExpiryMs)
        staleReason = "lease_expired";
      else if (!await processMatches(metadata))
        staleReason = "editor_process_mismatch";
      else if (metadata.connection_state === "ready" && !await descriptorIsReadable(metadata))
        staleReason = "pipeline_descriptor_unavailable";
      if (staleReason)
        snapshot.stale_editors.push({ ...metadata, stale_reason: staleReason });
      else
        snapshot.active_editors.push(metadata);
    }
  }
  snapshot.active_editors.sort((a, b) => a.project_id.localeCompare(b.project_id) || a.editor_instance_id.localeCompare(b.editor_instance_id));
  return snapshot;
}

// src/setup/broker.ts
import { randomUUID } from "node:crypto";
import { mkdir, readFile as readFile3, readdir as readdir2, rename, rm, stat as stat2, writeFile } from "node:fs/promises";
import { dirname as dirname4, join as join5 } from "node:path";
function validateBrokerLease(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("lease must be an object");
  const object = value;
  const keys = /* @__PURE__ */ new Set([
    "schema_version",
    "editor_instance_id",
    "owner_pid",
    "owner_started_at_utc",
    "heartbeat_at_utc",
    "lease_expires_at_utc"
  ]);
  for (const key of Object.keys(object))
    if (!keys.has(key)) throw new Error(`additional property: ${key}`);
  for (const key of keys)
    if (!(key in object)) throw new Error(`missing property: ${key}`);
  if (object.schema_version !== 1) throw new Error("unsupported schema_version");
  if (typeof object.editor_instance_id !== "string" || !object.editor_instance_id)
    throw new Error("editor_instance_id must be a string");
  if (!Number.isInteger(object.owner_pid) || Number(object.owner_pid) < 1)
    throw new Error("owner_pid must be positive");
  for (const key of ["owner_started_at_utc", "heartbeat_at_utc", "lease_expires_at_utc"])
    if (typeof object[key] !== "string" || !Number.isFinite(Date.parse(object[key])))
      throw new Error(`${key} must be an ISO timestamp`);
  return object;
}
async function liveBrokerLeases(directory, options = {}) {
  let files;
  try {
    files = await readdir2(directory);
  } catch {
    return [];
  }
  const now = (options.now ?? /* @__PURE__ */ new Date()).getTime();
  const processMatches = options.processMatches ?? ((lease) => processMatchesStart(lease.owner_pid, lease.owner_started_at_utc));
  const live = [];
  for (const file of files.filter((entry) => entry.endsWith(".json"))) {
    const path = join5(directory, file);
    try {
      const lease = validateBrokerLease(JSON.parse(await readFile3(path, "utf8")));
      if (file !== `${lease.editor_instance_id}.json` || Date.parse(lease.lease_expires_at_utc) <= now || now - Date.parse(lease.heartbeat_at_utc) > 1e4 || !await processMatches(lease))
        throw new Error("stale lease");
      live.push(lease);
    } catch {
      if (options.cleanupStale !== false)
        await rm(path, { force: true });
    }
  }
  return live.sort((a, b) => a.editor_instance_id.localeCompare(b.editor_instance_id));
}
async function atomicWrite(path, content) {
  await mkdir(dirname4(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, path);
}
async function acquireBrokerStartLock(path, options = {}) {
  const now = options.now ?? /* @__PURE__ */ new Date();
  const lock = {
    token: randomUUID(),
    owner_pid: options.ownerPid ?? process.pid,
    owner_started_at_utc: options.ownerStartedAtUtc ?? now.toISOString(),
    acquired_at_utc: now.toISOString()
  };
  try {
    await mkdir(path);
    await atomicWrite(join5(path, "owner.json"), JSON.stringify(lock));
    return lock;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  let existing = null;
  let age = Number.POSITIVE_INFINITY;
  try {
    existing = JSON.parse(
      await readFile3(join5(path, "owner.json"), "utf8")
    );
    age = now.getTime() - Date.parse(existing.acquired_at_utc);
  } catch {
    try {
      age = now.getTime() - (await stat2(path)).mtimeMs;
    } catch {
      age = Number.POSITIVE_INFINITY;
    }
  }
  const processMatches = options.processMatches ?? ((entry) => processMatchesStart(entry.owner_pid, entry.owner_started_at_utc));
  const live = existing ? await processMatches(existing) : false;
  if (live || age <= (options.staleAfterMs ?? 1e4))
    return null;
  await rm(path, { recursive: true, force: true });
  return acquireBrokerStartLock(path, options);
}
async function releaseBrokerStartLock(path, lock) {
  try {
    const existing = JSON.parse(
      await readFile3(join5(path, "owner.json"), "utf8")
    );
    if (existing.token !== lock.token) return false;
    await rm(path, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

// src/setup/manager.ts
async function executeSetup(request) {
  const response = baseResponse(request.operation);
  try {
    if (request.operation === "handshake") {
      response.data = { protocolVersion: 1, toolkitVersion, node: process.version };
      return response;
    }
    const context = createContext(request);
    if (request.operation === "probe") return await probe(context, response);
    if (request.operation === "health") return await health(context, response);
    if (request.operation === "rollback")
      return await rollback(context, request, response);
    if (request.operation === "serve")
      return await serve(context, request, response);
    const plan = await buildPlan(context, request);
    response.changes = plan.changes;
    response.warnings.push(...plan.warnings);
    response.data = plan.data;
    if (request.operation === "plan" || request.operation === "repair" && !request.confirm)
      return response;
    if (!request.confirm) {
      response.ok = false;
      response.errors.push("CONFIRMATION_REQUIRED");
      return response;
    }
    const backup = await createBackup(context, plan.paths);
    response.backup = backup.id;
    try {
      if (request.operation === "remove") {
        await removeManaged(context, request, plan.registrations);
      } else {
        await applyManaged(
          context,
          request,
          plan.enabledRegistrations,
          plan.disabledRegistrations
        );
      }
    } catch (error) {
      await restoreBackup(context, backup.id);
      throw error;
    }
    response.restartRequired = plan.registrations.filter((entry) => entry.restartRequired).map((entry) => entry.displayName);
    return await health(context, response);
  } catch (error) {
    response.ok = false;
    response.errors.push(error instanceof Error ? error.message : String(error));
    return response;
  }
}
async function probe(context, response) {
  const registrations = await Promise.all(
    discoverAgents(context).map(async (registration) => ({
      ...registration,
      configured: await containsManaged(registration, context),
      conflict: await hasConflict(registration, context)
    }))
  );
  const cliPath = await resolveUnityCli();
  const cliVersion = cliPath ? await runProcess(cliPath, ["--version"], { timeoutMs: 5e3 }) : null;
  const editorStatus = cliPath ? await runProcess(cliPath, ["status", "--format", "json"], {
    timeoutMs: 1e4
  }) : null;
  const pipelineVersion = await installedPipelineVersion(context.projectPath);
  const registry = await discoverEditors({ dataPath: context.dataPath });
  const leaseCounts = await brokerLeaseCounts(context);
  response.data = {
    toolkitVersion,
    node: { path: process.execPath, version: process.version, supported: major() >= 20 },
    unityCli: {
      path: cliPath,
      version: cliVersion?.exitCode === 0 ? redact(cliVersion.stdout.trim(), 1e3) : null,
      expected: "1.0.0-beta.2"
    },
    pipeline: {
      installed: Boolean(pipelineVersion),
      version: pipelineVersion,
      expected: "0.4.0-exp.1"
    },
    editor: {
      connected: editorStatus?.exitCode === 0,
      status: editorStatus?.exitCode === 0 ? redact(editorStatus.stdout.trim(), 4e3) : null
    },
    projectPath: context.projectPath,
    projectRoot: context.projectRoot,
    serverName: context.serverName,
    installRoot: context.installRoot,
    serverInstalled: existsSync3(installedServer(context)),
    agents: registrations,
    skillInstalled: existsSync3(skillPath(context)),
    http: await readJson(statePath(context)),
    registry,
    ...leaseCounts
  };
  response.warnings = major() < 20 ? ["Node 20 or newer is required."] : [];
  return response;
}
async function buildPlan(context, request) {
  const selected = request.agents ?? supportedAgents;
  const disabled = (request.disabledAgents ?? []).filter(
    (id) => !selected.includes(id)
  );
  const discovered = discoverAgents(context);
  const enabledRegistrations = discovered.filter(
    (entry) => selected.includes(entry.id)
  );
  const disabledRegistrations = [];
  for (const registration of discovered) {
    if (disabled.includes(registration.id) && await containsManaged(registration, context))
      disabledRegistrations.push(registration);
  }
  const registrations = request.operation === "remove" ? enabledRegistrations : [...enabledRegistrations, ...disabledRegistrations];
  const changes = [];
  const warnings = [];
  const paths = [];
  const httpState = request.transport === "http" ? await readJson(statePath(context)) : null;
  const httpPort = request.port && request.port > 0 ? request.port : httpState?.port ?? 0;
  if (request.operation !== "remove" && request.transport === "http" && enabledRegistrations.some((entry) => Boolean(entry.configPath)) && httpPort <= 0) {
    warnings.push(
      "HTTP_ENDPOINT_NOT_READY: start the shared broker first or choose a fixed port before Apply."
    );
  }
  if (request.installServer !== false) {
    changes.push({
      kind: existsSync3(installedServer(context)) ? "update" : "create",
      target: installedServer(context),
      summary: "Install the self-contained MCP server bundle."
    });
    paths.push(join6(context.installRoot, "current.json"));
  }
  for (const registration of enabledRegistrations) {
    if (!registration.configPath) continue;
    const conflict = await hasConflict(registration, context);
    changes.push({
      kind: request.operation === "remove" ? "remove" : existsSync3(registration.configPath) ? "update" : "create",
      target: registration.configPath,
      summary: registration.format === "dxt" ? "Export a global dynamic-registry Claude Desktop extension manifest." : `Manage private ${registration.displayName} registration ${context.serverName}.`,
      agent: registration.id,
      conflict
    });
    if (conflict && !request.force)
      warnings.push(`${registration.displayName} has an unmanaged registration with the same name.`);
    paths.push(registration.configPath);
    paths.push(registrationMarkerPath(context, registration.id));
    paths.push(...await legacyRegistrationMarkerPaths(context, registration.id));
  }
  if (request.operation !== "remove") {
    for (const registration of disabledRegistrations) {
      if (!registration.configPath) continue;
      changes.push({
        kind: "remove",
        target: registration.configPath,
        summary: `Disable MCP for ${registration.displayName}.`,
        agent: registration.id
      });
      paths.push(registration.configPath);
      paths.push(registrationMarkerPath(context, registration.id));
    }
  }
  if (request.installSkill) {
    changes.push({
      kind: request.operation === "remove" ? "remove" : existsSync3(skillPath(context)) ? "update" : "create",
      target: skillPath(context),
      summary: "Manage the project-local operate-unity-cli skill and agent mirrors."
    });
    paths.push(skillPath(context), ...skillMirrors(context));
  }
  return {
    changes,
    warnings,
    paths,
    registrations,
    enabledRegistrations,
    disabledRegistrations,
    data: {
      serverName: context.serverName,
      projectRoot: context.projectRoot,
      enabledAgents: enabledRegistrations.map((entry) => entry.id),
      disabledAgents: disabledRegistrations.map((entry) => entry.id),
      ...request.transport === "http" ? { httpPort } : {}
    }
  };
}
async function applyManaged(context, request, enabledRegistrations, disabledRegistrations) {
  for (const registration of enabledRegistrations) {
    if (registration.configPath && await hasConflict(registration, context) && !request.force)
      throw new Error(`CONFLICT:${registration.id}`);
  }
  const state = await readJson(statePath(context));
  const httpPort = request.port && request.port > 0 ? request.port : state?.port ?? 0;
  if (request.transport === "http" && enabledRegistrations.some((entry) => Boolean(entry.configPath)) && httpPort <= 0) {
    throw new Error(
      "HTTP_ENDPOINT_NOT_READY: start the shared broker first or choose a fixed port before Apply."
    );
  }
  if (request.installServer !== false) await installBundle(context);
  const serverPath = installedServer(context);
  const tokenFile = join6(context.installRoot, "http-token");
  await ensureToken(tokenFile);
  for (const registration of enabledRegistrations) {
    if (!registration.configPath) continue;
    await removeLegacyManagedRegistration(registration, context);
    const value = registrationValue(
      context,
      request.transport ?? "stdio",
      serverPath,
      tokenFile,
      httpPort
    );
    await writeRegistration(registration, context, value);
  }
  for (const registration of disabledRegistrations) {
    if (registration.configPath && await containsManaged(registration, context))
      await writeRegistration(registration, context, void 0);
  }
  if (request.installSkill) await installSkill(context, Boolean(request.force));
}
async function removeManaged(context, request, registrations) {
  for (const registration of registrations)
    if (registration.configPath && await containsManaged(registration, context))
      await writeRegistration(registration, context, void 0);
  if (request.installSkill) {
    for (const path of [skillPath(context), ...skillMirrors(context)])
      await rm2(path, { recursive: true, force: true });
  }
}
async function writeRegistration(registration, context, value) {
  const path = registration.configPath;
  await mkdir2(dirname5(path), { recursive: true });
  const text = await readText(path);
  if (registration.format === "toml") {
    const stdio = value;
    const block = value ? managedTomlBlock(context.serverName, {
      command: stdio.command ?? "",
      args: stdio.args ?? [],
      env: stdio.env ?? {},
      url: stdio.url,
      headers: stdio.headers
    }) : "";
    await atomicWrite2(path, patchManagedToml(text, context.serverName, block));
    await writeRegistrationMarker(registration, context, value);
    return;
  }
  if (registration.format === "dxt") {
    if (!value) await rm2(path, { force: true });
    else
      await atomicWrite2(
        path,
        JSON.stringify(
          {
            dxt_version: "0.1",
            name: context.serverName,
            display_name: `UniGame Unity CLI \u2014 ${context.serverName}`,
            version: toolkitVersion,
            description: "Global Unity CLI MCP broker with dynamic Editor discovery.",
            server: value
          },
          null,
          2
        ) + "\n"
      );
    await writeRegistrationMarker(registration, context, value);
    return;
  }
  const key = registration.key;
  await atomicWrite2(path, patchServerJsonc(text, key, context.serverName, value));
  await writeRegistrationMarker(registration, context, value);
}
async function installBundle(context) {
  const versions = join6(context.installRoot, "versions");
  const target = join6(versions, toolkitVersion);
  const temporary = `${target}.tmp-${process.pid}`;
  await rm2(temporary, { recursive: true, force: true });
  await mkdir2(temporary, { recursive: true });
  const source = existsSync3(join6(context.packageRoot, "Server~", "dist", "index.js")) ? join6(context.packageRoot, "Server~", "dist", "index.js") : join6(context.packageRoot, "Server~", "build", "index.js");
  await mkdir2(join6(temporary, "dist"), { recursive: true });
  await copyFile(source, join6(temporary, "dist", "index.js"));
  await cp(join6(context.packageRoot, "Server~", "catalogs"), join6(temporary, "catalogs"), { recursive: true });
  await cp(join6(context.packageRoot, "Server~", "schemas"), join6(temporary, "schemas"), { recursive: true });
  await cp(join6(context.packageRoot, "Documentation~"), join6(temporary, "Documentation~"), { recursive: true });
  await mkdir2(versions, { recursive: true });
  await mkdir2(join6(context.installRoot, "logs"), { recursive: true });
  await mkdir2(join6(context.installRoot, "backups"), { recursive: true });
  await mkdir2(join6(context.installRoot, "registrations"), { recursive: true });
  if (existsSync3(target)) {
    const rollbackTarget = join6(
      context.installRoot,
      "rollback",
      `${toolkitVersion}-${Date.now()}`
    );
    await mkdir2(dirname5(rollbackTarget), { recursive: true });
    await rename2(target, rollbackTarget);
  }
  await rename2(temporary, target);
  const bundleHash = createHash4("sha256").update(await readFile4(join6(target, "dist", "index.js"))).digest("hex");
  await atomicWrite2(
    join6(context.installRoot, "current.json"),
    JSON.stringify(
      {
        version: toolkitVersion,
        serverPath: join6(target, "dist", "index.js"),
        bundleHash,
        installedAt: (/* @__PURE__ */ new Date()).toISOString()
      },
      null,
      2
    ) + "\n"
  );
}
async function installSkill(context, force) {
  const source = join6(context.packageRoot, "skills", "operate-unity-cli");
  const targets = [skillPath(context), ...skillMirrors(context)];
  const sourceHash = await directoryHash(source);
  for (const target of targets) {
    if (existsSync3(target)) {
      const manifest = await readJson(join6(target, ".unigame-managed.json"));
      const currentHash = await directoryHash(target);
      if (!force && (!manifest || manifest.sourceHash && manifest.sourceHash !== currentHash))
        throw new Error(`SKILL_CONFLICT:${target}`);
    }
    await rm2(target, { recursive: true, force: true });
    await mkdir2(dirname5(target), { recursive: true });
    await cp(source, target, { recursive: true, filter: (entry) => !entry.endsWith(".meta") });
    await writeFile2(
      join6(target, ".unigame-managed.json"),
      JSON.stringify(
        {
          package: "com.unigame.unitycli.mcp",
          version: toolkitVersion,
          sourceHash
        },
        null,
        2
      )
    );
  }
}
async function createBackup(context, paths) {
  const id = `${Date.now()}-${process.pid}`;
  const root = join6(context.installRoot, "backups", id);
  const manifest = { id, files: [] };
  await mkdir2(root, { recursive: true });
  for (let index = 0; index < paths.length; index++) {
    const source = paths[index];
    const backup = join6(root, String(index));
    const existed = existsSync3(source);
    if (existed) await cp(source, backup, { recursive: true });
    manifest.files.push({ source, backup, existed });
  }
  await writeFile2(join6(root, "manifest.json"), JSON.stringify(manifest, null, 2));
  return manifest;
}
async function rollback(context, request, response) {
  if (!request.confirm) throw new Error("CONFIRMATION_REQUIRED");
  if (!request.backupId) throw new Error("backupId is required");
  const manifest = await restoreBackup(context, request.backupId);
  response.backup = request.backupId;
  response.changes = manifest.files.map((file) => ({
    kind: "update",
    target: file.source,
    summary: "Restored from backup."
  }));
  return response;
}
async function restoreBackup(context, backupId) {
  const root = join6(context.installRoot, "backups", backupId);
  const manifest = JSON.parse(await readFile4(join6(root, "manifest.json"), "utf8"));
  for (const file of manifest.files) {
    await rm2(file.source, { recursive: true, force: true });
    if (file.existed) {
      await mkdir2(dirname5(file.source), { recursive: true });
      await cp(file.backup, file.source, { recursive: true });
    }
  }
  return manifest;
}
async function serve(context, request, response) {
  const state = await readJson(statePath(context));
  const leaseDirectory = join6(context.installRoot, "broker-leases");
  const ownerPid = request.ownerPid ?? process.pid;
  const ownerStartedAtUtc = request.ownerStartedAtUtc ?? (ownerPid === process.pid ? processStartedAtUtc() : null);
  const leaseId = (request.editorInstanceId ?? (ownerPid === process.pid ? randomUUID2() : "")).replace(/[^a-zA-Z0-9._-]/g, "_");
  if (!leaseId)
    throw new Error("editorInstanceId is required for an external HTTP lease");
  if (!ownerStartedAtUtc)
    throw new Error("ownerStartedAtUtc is required for an external HTTP lease");
  const leasePath = join6(leaseDirectory, `${leaseId}.json`);
  if (request.stop) {
    if (!request.confirm) throw new Error("CONFIRMATION_REQUIRED");
    await rm2(leasePath, { force: true });
    response.data = {
      stopped: true,
      brokerStillRunning: Boolean(state?.pid && isAlive(state.pid))
    };
    return response;
  }
  if (!request.confirm) throw new Error("CONFIRMATION_REQUIRED");
  await mkdir2(leaseDirectory, { recursive: true });
  const leaseNow = /* @__PURE__ */ new Date();
  await atomicWrite2(
    leasePath,
    JSON.stringify({
      schema_version: 1,
      editor_instance_id: leaseId,
      owner_pid: ownerPid,
      owner_started_at_utc: ownerStartedAtUtc,
      heartbeat_at_utc: leaseNow.toISOString(),
      lease_expires_at_utc: new Date(leaseNow.getTime() + 1e4).toISOString()
    }, null, 2) + "\n"
  );
  if (state?.pid && isAlive(state.pid)) {
    response.data = { alreadyRunning: true, ...state };
    return response;
  }
  const lockPath = join6(context.installRoot, "broker-start.lock");
  const lock = await acquireBrokerStartLock(lockPath, {
    ownerPid: process.pid,
    ownerStartedAtUtc: processStartedAtUtc()
  });
  if (!lock) {
    for (let attempt = 0; attempt < 50; attempt++) {
      const current = await readJson(statePath(context));
      if (current?.pid && isAlive(current.pid)) {
        response.data = { alreadyRunning: true, ...current };
        return response;
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    }
    throw new Error("BROKER_START_IN_PROGRESS");
  }
  try {
    await installBundle(context);
    const tokenFile = join6(context.installRoot, "http-token");
    await ensureToken(tokenFile);
    await mkdir2(join6(context.installRoot, "logs"), { recursive: true });
    const logPath = join6(
      context.installRoot,
      "logs",
      `${context.serverName}.http.log`
    );
    const log = openSync(logPath, "a", 384);
    const child = spawn2(
      process.execPath,
      [
        installedServer(context),
        "--transport",
        "http",
        "--port",
        String(request.port ?? 0),
        "--token-file",
        tokenFile,
        "--state-file",
        statePath(context),
        "--lease-dir",
        leaseDirectory,
        "--keep-alive",
        String(Boolean(request.keepAlive))
      ],
      {
        detached: true,
        stdio: ["ignore", log, log],
        env: {
          ...process.env,
          UNIGAME_UNITYCLI_ROOT: join6(context.installRoot, "versions", toolkitVersion),
          UNIGAME_UNITYCLI_DATA_PATH: context.dataPath
        },
        shell: false
      }
    );
    closeSync(log);
    child.unref();
    response.changes.push({
      kind: "process",
      target: String(child.pid),
      summary: "Started loopback Streamable HTTP MCP server."
    });
    response.data = { pid: child.pid, pendingHealth: true };
    for (let attempt = 0; attempt < 30; attempt++) {
      const current = await readJson(statePath(context));
      if (current) {
        response.data = { ...current, pendingHealth: false };
        break;
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    }
    return response;
  } finally {
    await releaseBrokerStartLock(lockPath, lock);
  }
}
async function health(context, response) {
  const state = await readJson(statePath(context));
  const serverExists = existsSync3(installedServer(context));
  const agents = discoverAgents(context);
  const registry = await discoverEditors({ dataPath: context.dataPath });
  const leaseCounts = await brokerLeaseCounts(context);
  response.data = {
    ...response.data,
    serverExists,
    serverExecutable: serverExists && await canRead(installedServer(context)),
    http: state ? { ...state, alive: Boolean(state.pid && isAlive(state.pid)) } : null,
    registrations: await Promise.all(
      agents.map(async (agent) => ({
        id: agent.id,
        configured: agent.configPath ? await containsManaged(agent, context) : false
      }))
    ),
    skillInstalled: existsSync3(skillPath(context)),
    registry,
    ...leaseCounts
  };
  response.ok = response.errors.length === 0;
  return response;
}
async function hasConflict(agent, context) {
  if (!agent.configPath || !existsSync3(agent.configPath)) return false;
  const text = await readText(agent.configPath);
  if (!text.includes(context.serverName)) return false;
  return !await containsManaged(agent, context);
}
async function containsManaged(agent, context) {
  const text = await readText(agent.configPath);
  if (!text.includes(context.serverName))
    return false;
  const marker = await readJson(registrationMarkerPath(context, agent.id));
  if (marker?.managedBy !== "com.unigame.unitycli.mcp" || marker.serverName !== context.serverName || typeof marker.fingerprint !== "string")
    return false;
  if (agent.format === "toml") {
    return managedTomlFingerprint(text, context.serverName) === marker.fingerprint;
  }
  try {
    const parsed = parseJsonc(text);
    const value = agent.format === "dxt" ? parsed.server : parsed[agent.key]?.[context.serverName];
    return value !== void 0 && fingerprint(value) === marker.fingerprint;
  } catch {
    return false;
  }
}
function installedServer(context) {
  return join6(context.installRoot, "versions", toolkitVersion, "dist", "index.js");
}
function statePath(context) {
  return join6(context.installRoot, "http-state.json");
}
function skillPath(context) {
  return join6(context.projectRoot, ".agents", "skills", "operate-unity-cli");
}
function skillMirrors(context) {
  return [
    join6(context.projectRoot, ".cline", "skills", "operate-unity-cli"),
    join6(context.projectRoot, ".claude", "skills", "operate-unity-cli")
  ];
}
function registrationMarkerPath(context, agent) {
  return join6(
    context.installRoot,
    "registrations",
    `${context.serverName}.${agent}.json`
  );
}
async function brokerLeaseCounts(context) {
  const directory = join6(context.installRoot, "broker-leases");
  let entries;
  try {
    entries = await (await import("node:fs/promises")).readdir(directory, {
      withFileTypes: true
    });
  } catch {
    return { live_lease_count: 0, lease_count: 0 };
  }
  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json"));
  const live = await liveBrokerLeases(directory, { cleanupStale: false });
  return { live_lease_count: live.length, lease_count: files.length };
}
function legacyRegistrationMarkerPath(context, agent) {
  return join6(
    context.installRoot,
    "registrations",
    `${context.legacyServerName}.${agent}.json`
  );
}
async function legacyRegistrationMarkerPaths(context, agent) {
  const directory = join6(context.installRoot, "registrations");
  try {
    return (await (await import("node:fs/promises")).readdir(directory)).filter((file) => file.startsWith("unigameUnityCli_") && file.endsWith(`.${agent}.json`)).map((file) => join6(directory, file));
  } catch {
    return [legacyRegistrationMarkerPath(context, agent)];
  }
}
async function removeLegacyManagedRegistration(registration, context) {
  if (!registration.configPath)
    return false;
  const markerDirectory = join6(context.installRoot, "registrations");
  let markerFiles;
  try {
    markerFiles = await (await import("node:fs/promises")).readdir(markerDirectory);
  } catch {
    return false;
  }
  let removed = false;
  for (const markerFile of markerFiles) {
    if (!markerFile.startsWith("unigameUnityCli_") || !markerFile.endsWith(`.${registration.id}.json`))
      continue;
    const markerPath = join6(markerDirectory, markerFile);
    const marker = await readJson(markerPath);
    const legacyName = marker?.serverName;
    if (marker?.managedBy !== "com.unigame.unitycli.mcp" || !legacyName?.startsWith("unigameUnityCli_") || typeof marker.fingerprint !== "string")
      continue;
    const text = await readText(registration.configPath);
    if (registration.format === "toml") {
      if (managedTomlFingerprint(text, legacyName) !== marker.fingerprint)
        continue;
      await atomicWrite2(
        registration.configPath,
        patchManagedToml(text, legacyName, "")
      );
    } else if (registration.format === "json" || registration.format === "jsonc") {
      let value;
      try {
        const parsed = parseJsonc(text);
        value = parsed[registration.key]?.[legacyName];
      } catch {
        continue;
      }
      if (value === void 0 || fingerprint(value) !== marker.fingerprint)
        continue;
      await atomicWrite2(
        registration.configPath,
        patchServerJsonc(text, registration.key, legacyName, void 0)
      );
    } else {
      continue;
    }
    await rm2(markerPath, { force: true });
    removed = true;
  }
  return removed;
}
async function writeRegistrationMarker(registration, context, value) {
  const path = registrationMarkerPath(context, registration.id);
  if (!value) {
    await rm2(path, { force: true });
    return;
  }
  await atomicWrite2(
    path,
    JSON.stringify(
      {
        managedBy: "com.unigame.unitycli.mcp",
        version: toolkitVersion,
        agent: registration.id,
        serverName: context.serverName,
        configPath: registration.configPath,
        fingerprint: fingerprint(value)
      },
      null,
      2
    ) + "\n"
  );
}
async function ensureToken(path) {
  if (existsSync3(path)) return;
  await mkdir2(dirname5(path), { recursive: true });
  await writeFile2(path, randomBytes(32).toString("base64url"), { mode: 384 });
}
async function atomicWrite2(path, content) {
  await mkdir2(dirname5(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile2(temporary, content, "utf8");
  await rename2(temporary, path);
}
async function readText(path) {
  try {
    return await readFile4(path, "utf8");
  } catch {
    return "";
  }
}
async function readJson(path) {
  try {
    return JSON.parse(await readFile4(path, "utf8"));
  } catch {
    return null;
  }
}
async function canRead(path) {
  try {
    await access2(path, constants2.R_OK);
    return true;
  } catch {
    return false;
  }
}
function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
function processStartedAtUtc() {
  return new Date(Date.now() - process.uptime() * 1e3).toISOString();
}
function major() {
  return Number(process.versions.node.split(".")[0]);
}
async function directoryHash(root) {
  const hash = createHash4("sha256");
  async function visit(path) {
    const details = await stat3(path);
    if (details.isDirectory()) {
      const entries = (await import("node:fs/promises")).readdir(path, {
        withFileTypes: true
      });
      for (const entry of (await entries).sort(
        (left, right) => left.name.localeCompare(right.name)
      )) {
        if (entry.name === ".unigame-managed.json" || entry.name.endsWith(".meta"))
          continue;
        await visit(join6(path, entry.name));
      }
      return;
    }
    hash.update(path.slice(root.length).replaceAll("\\", "/"));
    hash.update(await readFile4(path));
  }
  await visit(root);
  return hash.digest("hex");
}
async function installedPipelineVersion(projectPath) {
  for (const file of [
    join6(projectPath, "Packages", "packages-lock.json"),
    join6(projectPath, "Packages", "manifest.json")
  ]) {
    const value = await readJson(file);
    const dependencies = value?.dependencies;
    const pipeline = dependencies?.["com.unity.pipeline"];
    if (typeof pipeline === "string") return pipeline;
    if (pipeline?.version) return pipeline.version;
  }
  return null;
}
function baseResponse(operation) {
  return {
    ok: true,
    operation,
    changes: [],
    warnings: [],
    errors: [],
    backup: null,
    restartRequired: [],
    data: {}
  };
}

// src/setup.ts
var input = await readStdin();
try {
  const request = JSON.parse(input);
  const response = await executeSetup(request);
  process.stdout.write(`${JSON.stringify(response)}
`);
  process.exitCode = response.ok ? 0 : 1;
} catch (error) {
  process.stdout.write(
    `${JSON.stringify({
      ok: false,
      operation: "handshake",
      changes: [],
      warnings: [],
      errors: [error instanceof Error ? error.message : String(error)],
      backup: null,
      restartRequired: [],
      data: {}
    })}
`
  );
  process.exitCode = 1;
}
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}
