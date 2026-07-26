#!/usr/bin/env node

// src/setup/manager.ts
import { createHash as createHash4, randomBytes, randomUUID as randomUUID2 } from "node:crypto";
import {
  access as access2,
  copyFile,
  cp,
  mkdir as mkdir2,
  readFile as readFile4,
  readdir as readdir3,
  rename as rename2,
  rm as rm2,
  stat as stat3,
  writeFile as writeFile2
} from "node:fs/promises";
import { closeSync, constants as constants2, existsSync as existsSync3, openSync } from "node:fs";
import { spawn as spawn2 } from "node:child_process";
import { dirname as dirname4, join as join6, resolve as resolve3 } from "node:path";

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

// src/editor-registry.ts
import { createHash } from "node:crypto";
import { readdir, readFile as readFile2, stat } from "node:fs/promises";
import { isAbsolute, join as join2, normalize, resolve } from "node:path";
import { homedir } from "node:os";
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
    return resolve(process.env.UNIGAME_UNITYCLI_DATA_PATH);
  if (process.platform === "win32")
    return join2(process.env.LOCALAPPDATA ?? homedir(), "UniGame");
  return join2(homedir(), ".local", "share", "unigame");
}
function normalizeProjectPath(path) {
  let value = normalize(resolve(path)).replaceAll("\\", "/");
  if (process.platform === "win32") value = value.toLowerCase();
  return value.replace(/\/+$/, "");
}
function projectId(path) {
  return createHash("sha256").update(normalizeProjectPath(path)).digest("hex");
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
  const root = join2(options.dataPath ?? defaultDataPath(), "unity-cli-mcp", "registry", "editors");
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
    const projectRoot = join2(root, projectDirectory.name);
    let files;
    try {
      files = await readdir(projectRoot, { withFileTypes: true });
    } catch (error) {
      snapshot.corrupt_entries.push({ path: projectRoot, error: String(error) });
      continue;
    }
    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith(".json")) continue;
      const path = join2(projectRoot, file.name);
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

// src/process.ts
import { spawn } from "node:child_process";
function runProcess(executable, args, options = {}) {
  const started = Date.now();
  const timeoutMs = options.timeoutMs ?? 3e4;
  const maxOutputBytes = options.maxOutputBytes ?? 1e6;
  return new Promise((resolve4, reject) => {
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
      resolve4({
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
import { join as join3 } from "node:path";
var supportedAgents = [
  "codex",
  "cursor",
  "vscode",
  "cline",
  "claude-code",
  "claude-desktop"
];
var aliases = {
  codex: "codex",
  cursor: "cursor",
  vscode: "vscode",
  "vs-code": "vscode",
  "visual-studio-code": "vscode",
  copilot: "vscode",
  cline: "cline",
  claude: "claude-desktop",
  "claude-code": "claude-code",
  "claude-desktop": "claude-desktop"
};
function parseOfficialClientList(value) {
  const result = /* @__PURE__ */ new Map();
  const root = value;
  const items = Array.isArray(root) ? root : root && typeof root === "object" ? root.data ?? root.clients ?? root.agents ?? root.items ?? root.configurators : [];
  if (!Array.isArray(items)) return result;
  for (const item of items) {
    const object = typeof item === "string" ? { id: item } : item;
    const raw = String(
      object.key ?? object.id ?? object.name ?? object.client ?? object.agent ?? ""
    ).trim().toLowerCase().replaceAll("_", "-").replace(/\s+/g, "-");
    const id = aliases[raw];
    if (!id) continue;
    const status = String(object.status ?? "").toLowerCase();
    const detected = Boolean(
      object.installed || object.detected || object.available || object.found
    ) || Boolean(object.configPath ?? object.config_path) && status !== "file-not-found" && status !== "no-file";
    result.set(id, detected);
  }
  return result;
}
function discoverAgents(context, official = /* @__PURE__ */ new Map()) {
  const appData = process.platform === "win32" ? join3(context.home_path, "AppData", "Roaming") : join3(context.home_path, ".config");
  const definitions = [
    adapter("codex", "Codex", join3(context.home_path, ".codex", "config.toml"), "toml", "mcpServers", true, existsSync(join3(context.home_path, ".codex"))),
    adapter("cursor", "Cursor", join3(context.home_path, ".cursor", "mcp.json"), "jsonc", "mcpServers", true, existsSync(join3(context.home_path, ".cursor"))),
    adapter("vscode", "VS Code / Copilot", join3(appData, "Code", "User", "mcp.json"), "jsonc", "servers", true, existsSync(join3(appData, "Code"))),
    adapter("cline", "Cline", join3(appData, "Code", "User", "settings.json"), "jsonc", "cline.mcpServers", true, existsSync(join3(appData, "Code"))),
    adapter("claude-code", "Claude Code", join3(context.home_path, ".claude.json"), "json", "mcpServers", true, existsSync(join3(context.home_path, ".claude"))),
    adapter("claude-desktop", "Claude Desktop", join3(appData, "Claude", "claude_desktop_config.json"), "json", "mcpServers", true, existsSync(join3(appData, "Claude")))
  ];
  return definitions.map((entry) => ({
    ...entry,
    detected: official.get(entry.agent_id) === true || entry.detected,
    official_id: entry.agent_id
  })).sort(
    (left, right) => Number(right.detected) - Number(left.detected) || left.display_name.localeCompare(right.display_name)
  );
}
function registrationValue(context, unityCli, transport, broker) {
  if (transport === "http") {
    return {
      type: "http",
      url: `http://127.0.0.1:${broker.port}/mcp`,
      headers: { Authorization: `Bearer file:${broker.token_file}` }
    };
  }
  return {
    command: unityCli,
    args: ["mcp", "--project-path", context.project_path]
  };
}
function adapter(agent_id, display_name, fallback, format, key, restart_required, detected) {
  const envName = `UNIGAME_${agent_id.toUpperCase().replaceAll("-", "_")}_CONFIG`;
  return {
    agent_id,
    display_name,
    detected,
    config_path: process.env[envName] || fallback,
    format,
    key,
    restart_required
  };
}

// src/setup/config.ts
import { createHash as createHash2 } from "node:crypto";
var managedMarker = "unigame-unitycli-mcp";
function fingerprint(value) {
  return createHash2("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
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

// src/setup/broker.ts
import { randomUUID } from "node:crypto";
import { mkdir, readFile as readFile3, readdir as readdir2, rename, rm, stat as stat2, writeFile } from "node:fs/promises";
import { dirname as dirname2, join as join4 } from "node:path";
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
    const path = join4(directory, file);
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
  await mkdir(dirname2(path), { recursive: true });
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
    await atomicWrite(join4(path, "owner.json"), JSON.stringify(lock));
    return lock;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  let existing = null;
  let age = Number.POSITIVE_INFINITY;
  try {
    existing = JSON.parse(
      await readFile3(join4(path, "owner.json"), "utf8")
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
      await readFile3(join4(path, "owner.json"), "utf8")
    );
    if (existing.token !== lock.token) return false;
    await rm(path, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

// src/setup/project.ts
import { createHash as createHash3 } from "node:crypto";
import { existsSync as existsSync2 } from "node:fs";
import { homedir as homedir2 } from "node:os";
import { dirname as dirname3, join as join5, resolve as resolve2 } from "node:path";
var toolkitVersion = "0.1.0";
function findProjectRoot(projectPath) {
  const unityProject = resolve2(projectPath);
  let current = unityProject;
  while (true) {
    if (existsSync2(join5(current, ".git")) || existsSync2(join5(current, ".agents")))
      return current;
    const parent = dirname3(current);
    if (parent === current) return unityProject;
    current = parent;
  }
}
function projectServerName(projectPath) {
  const absolute = resolve2(projectPath);
  const normalized = absolute.replaceAll("\\", "/").toLowerCase();
  const slug = absolute.split(/[\\/]/).filter(Boolean).at(-1)?.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "unity_project";
  const hash = createHash3("sha256").update(normalized).digest("hex").slice(0, 8);
  return `unigame_unity_cli_${slug}_${hash}`;
}
function createContext(request) {
  if (!request.project_path) throw new Error("project_path is required");
  if (!request.package_root) throw new Error("package_root is required");
  const project_path = resolve2(request.project_path);
  const home_path = resolve2(request.home_path ?? homedir2());
  const data_path = resolve2(
    request.data_path ?? (process.platform === "win32" ? join5(process.env.LOCALAPPDATA ?? home_path, "UniGame") : join5(home_path, ".local", "share", "unigame"))
  );
  return {
    project_path,
    project_root: findProjectRoot(project_path),
    package_root: resolve2(request.package_root),
    home_path,
    data_path,
    install_root: join5(data_path, "unity-cli-mcp"),
    registration_name: projectServerName(project_path)
  };
}

// src/setup/manager.ts
async function executeSetup(request) {
  const response = baseResponse(request.operation);
  try {
    if (request.operation === "handshake") {
      response.data.official_mcp = {
        protocol_version: 2,
        toolkit_version: toolkitVersion,
        canonical_contract: "snake_case"
      };
      return response;
    }
    const context = createContext(request);
    if (request.operation === "rollback")
      return await rollback(context, request, response);
    if (request.operation === "serve")
      return await serve(context, request, response);
    const snapshot = await inspect(context);
    response.data = snapshot.response_data;
    if (request.operation === "probe" || request.operation === "health")
      return response;
    const plan = await buildPlan(context, request, snapshot);
    response.changes = plan.changes;
    response.warnings.push(...plan.warnings);
    if (request.operation === "plan" || request.operation === "repair" && !request.confirm)
      return response;
    if (!request.confirm) throw new Error("CONFIRMATION_REQUIRED");
    const backup = await createBackup(context, plan.paths);
    response.backup = backup.id;
    try {
      await applyPlan(context, request, snapshot, plan);
    } catch (error) {
      await restoreBackup(context, backup.id);
      throw error;
    }
    const refreshed = await inspect(context);
    response.data = refreshed.response_data;
    response.restart_required = plan.enable_agents.filter((entry) => entry.restart_required).map((entry) => entry.display_name);
    return response;
  } catch (error) {
    response.ok = false;
    response.errors.push(error instanceof Error ? error.message : String(error));
    return response;
  }
}
async function inspect(context) {
  const cli_path = await resolveUnityCli();
  const [version, status, officialClients, registry, broker] = await Promise.all([
    cli_path ? safeRun(cli_path, ["--version", "--no-banner"], 5e3) : Promise.resolve(null),
    cli_path ? safeRun(
      cli_path,
      ["status", "--project", context.project_path, "--format", "json", "--no-banner"],
      1e4
    ) : Promise.resolve(null),
    discoverOfficialClients(cli_path),
    discoverEditors({ dataPath: context.data_path }),
    brokerStatus(context)
  ]);
  const agents = discoverAgents(context, officialClients);
  const agent_statuses = await Promise.all(
    agents.map((agent) => inspectAgent(context, agent))
  );
  const skill_statuses = await Promise.all(
    skillIds.map((id) => inspectSkill(context, id))
  );
  const pipeline_version = await installedPipelineVersion(context.project_path);
  const current_editor = registry.active_editors.find(
    (editor) => resolve3(editor.project_path) === context.project_path
  ) ?? null;
  const editor_ready = current_editor?.connection_state === "ready";
  return {
    cli_path,
    agents,
    agent_statuses,
    skill_statuses,
    response_data: {
      unity_cli: {
        installed: Boolean(cli_path),
        path: cli_path,
        version: version?.exitCode === 0 ? redact(version.stdout.trim(), 1e3) : null,
        ready: Boolean(cli_path && version?.exitCode === 0),
        error: cli_path ? null : "CLI_NOT_FOUND"
      },
      pipeline: {
        installed: Boolean(pipeline_version),
        version: pipeline_version,
        ready: Boolean(pipeline_version),
        error: pipeline_version ? null : "PIPELINE_NOT_INSTALLED",
        status: status?.exitCode === 0 ? parseLooseJson(status.stdout) : null
      },
      current_editor: current_editor ? {
        ...current_editor,
        state: current_editor.connection_state,
        ready: editor_ready,
        error: editor_ready ? null : "EDITOR_NOT_READY"
      } : null,
      official_mcp: {
        available: Boolean(cli_path),
        state: cli_path && pipeline_version && editor_ready ? "ready" : "not_ready",
        tool_count: current_editor?.tool_count ?? 0,
        error: !cli_path ? "CLI_NOT_FOUND" : !pipeline_version ? "PIPELINE_NOT_INSTALLED" : !editor_ready ? "EDITOR_NOT_READY" : null,
        registration_name: context.registration_name,
        command: cli_path,
        args: ["mcp", "--project-path", context.project_path],
        discovery_source: officialClients.size > 0 ? "unity_cli" : "safe_adapters",
        legacy_global_detected: (await Promise.all(agents.map((agent) => hasLegacyGlobal(agent)))).some(Boolean)
      },
      agents: agent_statuses,
      skills: skill_statuses,
      advanced_broker: broker
    }
  };
}
async function buildPlan(context, request, snapshot) {
  const enabledAgentIds = selectedAgentIds(request, snapshot.agents);
  const disabledAgentIds = selectedDisabledAgentIds(request);
  const enabledSkillIds = selectedSkillIds(request);
  const disabledSkillIds = selectedDisabledSkillIds(request);
  const enable_agents = snapshot.agents.filter(
    (entry) => enabledAgentIds.includes(entry.agent_id)
  );
  const disable_agents = snapshot.agents.filter(
    (entry) => disabledAgentIds.includes(entry.agent_id)
  );
  const changes = [];
  const warnings = [];
  const paths = /* @__PURE__ */ new Set();
  if (request.operation !== "remove") {
    if (enable_agents.length && !snapshot.cli_path && request.transport !== "http")
      warnings.push("CLI_NOT_FOUND: official stdio registration cannot be applied.");
    for (const agent of enable_agents) {
      const state = snapshot.agent_statuses.find(
        (entry) => entry.agent_id === agent.agent_id
      );
      changes.push({
        kind: state.registration_state === "not_configured" ? "create" : "update",
        target: agent.config_path,
        summary: `Configure official Unity MCP for ${agent.display_name}.`,
        agent_id: agent.agent_id,
        conflict: state.registration_state === "conflict"
      });
      if (state.registration_state === "conflict" && !request.force)
        warnings.push(`CONFLICT:${agent.agent_id}`);
      paths.add(agent.config_path);
      paths.add(markerPath(context, agent.agent_id));
    }
  }
  const removals = request.operation === "remove" ? enable_agents : disable_agents;
  for (const agent of removals) {
    changes.push({
      kind: "remove",
      target: agent.config_path,
      summary: `Remove the managed Unity MCP registration for ${agent.display_name}.`,
      agent_id: agent.agent_id
    });
    paths.add(agent.config_path);
    paths.add(markerPath(context, agent.agent_id));
  }
  const skillRemovals = request.operation === "remove" ? enabledSkillIds : disabledSkillIds;
  if (request.operation !== "remove") {
    for (const id of enabledSkillIds) {
      const status = snapshot.skill_statuses.find((entry) => entry.skill_id === id);
      changes.push({
        kind: status.state === "not_installed" ? "create" : "update",
        target: status.install_path,
        summary: `${request.operation === "repair" ? "Repair" : "Install or update"} ${id}.`,
        skill_id: id,
        conflict: status.state === "modified"
      });
      if (status.state === "modified" && request.operation !== "repair" && !request.force)
        warnings.push(`SKILL_CONFLICT:${id}`);
      for (const target of skillTargets(context, id)) paths.add(target);
    }
  }
  for (const id of skillRemovals) {
    const status = snapshot.skill_statuses.find((entry) => entry.skill_id === id);
    changes.push({
      kind: "remove",
      target: status.install_path,
      summary: `Remove managed skill ${id}.`,
      skill_id: id
    });
    for (const target of skillTargets(context, id)) paths.add(target);
  }
  if (request.install_server) {
    changes.push({
      kind: "update",
      target: installedServer(context),
      summary: "Install the optional advanced broker bundle."
    });
    paths.add(join6(context.install_root, "current.json"));
  }
  return {
    changes,
    warnings,
    paths: [...paths],
    enable_agents,
    disable_agents: removals,
    enable_skills: request.operation === "remove" ? [] : enabledSkillIds,
    disable_skills: skillRemovals
  };
}
async function applyPlan(context, request, snapshot, plan) {
  if (request.install_server) await installBundle(context);
  const state = await readJson(statePath(context));
  const port = request.port && request.port > 0 ? request.port : state?.port ?? 0;
  if (request.transport === "http" && plan.enable_agents.length && port <= 0)
    throw new Error("HTTP_ENDPOINT_NOT_READY");
  if (request.transport !== "http" && plan.enable_agents.length && !snapshot.cli_path)
    throw new Error("CLI_NOT_FOUND");
  for (const agent of plan.enable_agents) {
    const status = snapshot.agent_statuses.find(
      (entry) => entry.agent_id === agent.agent_id
    );
    if (status.registration_state === "conflict" && !request.force)
      throw new Error(`CONFLICT:${agent.agent_id}`);
    const value = registrationValue(
      context,
      snapshot.cli_path ?? "",
      request.transport ?? "stdio",
      {
        token_file: join6(context.install_root, "http-token"),
        port
      }
    );
    await writeRegistration(context, agent, value);
  }
  for (const agent of plan.disable_agents)
    if (await isManaged(context, agent))
      await writeRegistration(context, agent, void 0);
  for (const id of plan.enable_skills) {
    const status = snapshot.skill_statuses.find((entry) => entry.skill_id === id);
    if (status.state === "modified" && request.operation !== "repair" && !request.force)
      throw new Error(`SKILL_CONFLICT:${id}`);
    await installSkill(context, id);
  }
  for (const id of plan.disable_skills)
    await removeSkill(context, id);
}
async function discoverOfficialClients(cliPath) {
  if (!cliPath) return /* @__PURE__ */ new Map();
  const result = await safeRun(
    cliPath,
    ["mcp", "configure", "--list", "--format", "json", "--no-banner"],
    1e4
  );
  if (!result || result.exitCode !== 0) return /* @__PURE__ */ new Map();
  return parseOfficialClientList(parseLooseJson(result.stdout));
}
function parseLooseJson(text) {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const object = trimmed.indexOf("{");
    const array = trimmed.indexOf("[");
    const start = object < 0 ? array : array < 0 ? object : Math.min(object, array);
    if (start < 0) return null;
    try {
      return JSON.parse(trimmed.slice(start));
    } catch {
      return null;
    }
  }
}
async function inspectAgent(context, agent) {
  const managed = await isManaged(context, agent);
  const ownEntry = await readEntry(agent, context.registration_name);
  const conflict = ownEntry !== void 0 && !managed;
  return {
    agent_id: agent.agent_id,
    display_name: agent.display_name,
    detected: agent.detected,
    registration_state: !agent.detected && ownEntry === void 0 ? "not_installed" : conflict ? "conflict" : managed ? "configured" : "not_configured",
    managed,
    restart_required: false
  };
}
async function hasLegacyGlobal(agent) {
  if (!existsSync3(agent.config_path)) return false;
  return (await readText(agent.config_path)).includes("unity_cli_mcp");
}
async function readEntry(agent, name) {
  if (!existsSync3(agent.config_path)) return void 0;
  const text = await readText(agent.config_path);
  if (agent.format === "toml")
    return managedTomlFingerprint(text, name) ?? void 0;
  try {
    return parseJsonc(text)[agent.key]?.[name];
  } catch {
    return void 0;
  }
}
async function isManaged(context, agent) {
  const marker = await readJson(markerPath(context, agent.agent_id));
  if (marker?.managed_by !== "com.unigame.unitycli.mcp" || marker.registration_name !== context.registration_name || !marker.fingerprint)
    return false;
  if (agent.format === "toml")
    return managedTomlFingerprint(
      await readText(agent.config_path),
      context.registration_name
    ) === marker.fingerprint;
  const entry = await readEntry(agent, context.registration_name);
  return entry !== void 0 && fingerprint(entry) === marker.fingerprint;
}
async function writeRegistration(context, agent, value) {
  const text = await readText(agent.config_path);
  if (agent.format === "toml") {
    const item = value;
    const block = value ? managedTomlBlock(context.registration_name, {
      command: item.command ?? "",
      args: item.args ?? [],
      env: {},
      url: item.url,
      headers: item.headers
    }) : "";
    await atomicWrite2(
      agent.config_path,
      patchManagedToml(text, context.registration_name, block)
    );
  } else {
    await atomicWrite2(
      agent.config_path,
      patchServerJsonc(text, agent.key, context.registration_name, value)
    );
  }
  if (!value) {
    await rm2(markerPath(context, agent.agent_id), { force: true });
    return;
  }
  await atomicWrite2(
    markerPath(context, agent.agent_id),
    JSON.stringify(
      {
        managed_by: "com.unigame.unitycli.mcp",
        version: toolkitVersion,
        agent_id: agent.agent_id,
        registration_name: context.registration_name,
        config_path: agent.config_path,
        fingerprint: registrationFingerprint(agent, value)
      },
      null,
      2
    ) + "\n"
  );
}
function registrationFingerprint(agent, value) {
  if (agent.format !== "toml" || "url" in value) return fingerprint(value);
  return fingerprint({ ...value, env: value.env ?? {} });
}
var skillIds = ["operate-unity-cli", "operate-unity-mcp"];
async function inspectSkill(context, id) {
  const targets = skillTargets(context, id);
  const install_path = targets[0];
  if (!targets.some((target) => existsSync3(target)))
    return {
      skill_id: id,
      display_name: displaySkill(id),
      state: "not_installed",
      managed: false,
      install_path
    };
  const sourceHash = await skillSourceHash(context, id);
  let managed = true;
  let modified = false;
  let updateAvailable = false;
  for (const target of targets) {
    if (!existsSync3(target)) {
      managed = false;
      updateAvailable = true;
      continue;
    }
    const manifest = await readJson(join6(target, ".unigame-managed.json"));
    const targetManaged = manifest?.managed_by === "com.unigame.unitycli.mcp" && Boolean(manifest.source_hash);
    managed = managed && targetManaged;
    if (!targetManaged || await directoryHash(target) !== manifest?.source_hash) {
      modified = true;
      continue;
    }
    if (sourceHash !== manifest?.source_hash)
      updateAvailable = true;
  }
  const state = modified ? "modified" : updateAvailable ? "update_available" : "installed";
  return {
    skill_id: id,
    display_name: displaySkill(id),
    state,
    managed,
    install_path
  };
}
function skillSource(context, id) {
  return join6(context.package_root, "skills", id);
}
function skillTargets(context, id) {
  const root = context.project_root;
  return [
    join6(root, ".agents", "skills", id),
    join6(root, ".claude", "skills", id),
    join6(root, ".cline", "skills", id)
  ];
}
async function installSkill(context, id) {
  const source = skillSource(context, id);
  const source_hash = await skillSourceHash(context, id);
  for (const target of skillTargets(context, id)) {
    const temporary = `${target}.tmp-${process.pid}-${randomUUID2()}`;
    await rm2(temporary, { recursive: true, force: true });
    await mkdir2(dirname4(temporary), { recursive: true });
    await cp(source, temporary, {
      recursive: true,
      filter: (entry) => !entry.endsWith(".meta")
    });
    if (id === "operate-unity-mcp") {
      const capabilityMap = join6(
        context.package_root,
        "Documentation~",
        "unity-cli-capabilities.md"
      );
      await mkdir2(join6(temporary, "references"), { recursive: true });
      await copyFile(
        capabilityMap,
        join6(temporary, "references", "unity-cli-capabilities.md")
      );
    }
    await writeFile2(
      join6(temporary, ".unigame-managed.json"),
      JSON.stringify(
        {
          managed_by: "com.unigame.unitycli.mcp",
          skill_id: id,
          version: toolkitVersion,
          source_hash
        },
        null,
        2
      ) + "\n"
    );
    await rm2(target, { recursive: true, force: true });
    await mkdir2(dirname4(target), { recursive: true });
    await rename2(temporary, target);
  }
}
async function skillSourceHash(context, id) {
  const extras = id === "operate-unity-mcp" ? [{
    logical_path: "references/unity-cli-capabilities.md",
    source_path: join6(
      context.package_root,
      "Documentation~",
      "unity-cli-capabilities.md"
    )
  }] : [];
  return await directoryHash(skillSource(context, id), extras);
}
async function removeSkill(context, id) {
  for (const target of skillTargets(context, id)) {
    const manifest = await readJson(join6(target, ".unigame-managed.json"));
    if (manifest?.managed_by === "com.unigame.unitycli.mcp")
      await rm2(target, { recursive: true, force: true });
  }
}
function selectedAgentIds(request, agents) {
  if (request.target_kind === "skill" || request.target_kind === "broker")
    return [];
  if (request.target_kind === "agent" && request.target_id)
    return supportedAgents.includes(request.target_id) ? [request.target_id] : [];
  if (request.agent_ids) return request.agent_ids;
  return request.target_kind === "all" ? agents.filter((entry) => entry.detected).map((entry) => entry.agent_id) : [];
}
function selectedDisabledAgentIds(request) {
  return request.target_kind === "agent" || request.target_kind === "all" ? request.disabled_agent_ids ?? [] : [];
}
function selectedSkillIds(request) {
  if (request.target_kind === "agent" || request.target_kind === "broker")
    return [];
  if (request.target_kind === "skill" && request.target_id)
    return skillIds.includes(request.target_id) ? [request.target_id] : [];
  return request.skill_ids ?? (request.target_kind === "all" ? skillIds : []);
}
function selectedDisabledSkillIds(request) {
  return request.target_kind === "skill" || request.target_kind === "all" ? request.disabled_skill_ids ?? [] : [];
}
function displaySkill(id) {
  return id === "operate-unity-mcp" ? "Operate Unity MCP" : "Operate Unity CLI";
}
async function createBackup(context, paths) {
  const id = `${Date.now()}-${process.pid}-${randomUUID2().slice(0, 8)}`;
  const root = join6(context.install_root, "backups", id);
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
  if (!request.backup_id) throw new Error("backup_id is required");
  const manifest = await restoreBackup(context, request.backup_id);
  response.backup = request.backup_id;
  response.changes = manifest.files.map((file) => ({
    kind: "update",
    target: file.source,
    summary: "Restored from backup."
  }));
  response.data = (await inspect(context)).response_data;
  return response;
}
async function restoreBackup(context, backupId) {
  const root = join6(context.install_root, "backups", backupId);
  const manifest = JSON.parse(
    await readFile4(join6(root, "manifest.json"), "utf8")
  );
  for (const file of manifest.files) {
    await rm2(file.source, { recursive: true, force: true });
    if (file.existed) {
      await mkdir2(dirname4(file.source), { recursive: true });
      await cp(file.backup, file.source, { recursive: true });
    }
  }
  return manifest;
}
async function installBundle(context) {
  const target = join6(context.install_root, "versions", toolkitVersion);
  const temporary = `${target}.tmp-${process.pid}-${randomUUID2()}`;
  await rm2(temporary, { recursive: true, force: true });
  await mkdir2(join6(temporary, "dist"), { recursive: true });
  const dist = join6(context.package_root, "Server~", "dist", "index.js");
  const source = existsSync3(dist) ? dist : join6(context.package_root, "Server~", "build", "index.js");
  await copyFile(source, join6(temporary, "dist", "index.js"));
  await cp(
    join6(context.package_root, "Server~", "catalogs"),
    join6(temporary, "catalogs"),
    { recursive: true }
  );
  await cp(
    join6(context.package_root, "Server~", "schemas"),
    join6(temporary, "schemas"),
    { recursive: true }
  );
  await mkdir2(dirname4(target), { recursive: true });
  await rm2(target, { recursive: true, force: true });
  await rename2(temporary, target);
  await atomicWrite2(
    join6(context.install_root, "current.json"),
    JSON.stringify(
      {
        version: toolkitVersion,
        server_path: installedServer(context),
        installed_at_utc: (/* @__PURE__ */ new Date()).toISOString()
      },
      null,
      2
    ) + "\n"
  );
}
async function serve(context, request, response) {
  const state = await readJson(statePath(context));
  const leaseDirectory = join6(context.install_root, "broker-leases");
  const ownerPid = request.owner_pid ?? process.pid;
  const ownerStartedAtUtc = request.owner_started_at_utc ?? (ownerPid === process.pid ? processStartedAtUtc() : null);
  const leaseId = (request.editor_instance_id ?? (ownerPid === process.pid ? randomUUID2() : "")).replace(/[^a-zA-Z0-9._-]/g, "_");
  if (!leaseId)
    throw new Error("editor_instance_id is required for an external HTTP lease");
  if (!ownerStartedAtUtc)
    throw new Error("owner_started_at_utc is required for an external HTTP lease");
  const leasePath = join6(leaseDirectory, `${leaseId}.json`);
  if (request.stop) {
    if (!request.confirm) throw new Error("CONFIRMATION_REQUIRED");
    await rm2(leasePath, { force: true });
    response.data.advanced_broker = await brokerStatus(context);
    return response;
  }
  if (!request.confirm) throw new Error("CONFIRMATION_REQUIRED");
  await mkdir2(leaseDirectory, { recursive: true });
  const now = /* @__PURE__ */ new Date();
  await atomicWrite2(
    leasePath,
    JSON.stringify(
      {
        schema_version: 1,
        editor_instance_id: leaseId,
        owner_pid: ownerPid,
        owner_started_at_utc: ownerStartedAtUtc,
        heartbeat_at_utc: now.toISOString(),
        lease_expires_at_utc: new Date(now.getTime() + 1e4).toISOString()
      },
      null,
      2
    ) + "\n"
  );
  if (state?.pid && isAlive(state.pid)) {
    response.data.advanced_broker = await brokerStatus(context);
    return response;
  }
  const lockPath = join6(context.install_root, "broker-start.lock");
  const lock = await acquireBrokerStartLock(lockPath, {
    ownerPid: process.pid,
    ownerStartedAtUtc: processStartedAtUtc()
  });
  if (!lock) throw new Error("BROKER_START_IN_PROGRESS");
  try {
    await installBundle(context);
    const tokenFile = join6(context.install_root, "http-token");
    await ensureToken(tokenFile);
    const logPath = join6(context.install_root, "logs", "advanced-broker.log");
    await mkdir2(dirname4(logPath), { recursive: true });
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
        String(Boolean(request.keep_alive))
      ],
      {
        detached: true,
        stdio: ["ignore", log, log],
        env: {
          ...process.env,
          UNIGAME_UNITYCLI_ROOT: join6(
            context.install_root,
            "versions",
            toolkitVersion
          ),
          UNIGAME_UNITYCLI_DATA_PATH: context.data_path
        },
        shell: false
      }
    );
    closeSync(log);
    child.unref();
    response.changes.push({
      kind: "process",
      target: String(child.pid),
      summary: "Started the opt-in loopback MCP broker."
    });
    for (let attempt = 0; attempt < 30; attempt++) {
      const current = await readJson(statePath(context));
      if (current) break;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    }
    response.data.advanced_broker = await brokerStatus(context);
    return response;
  } finally {
    await releaseBrokerStartLock(lockPath, lock);
  }
}
async function brokerStatus(context) {
  const state = await readJson(statePath(context));
  const leases = await liveBrokerLeases(
    join6(context.install_root, "broker-leases"),
    { cleanupStale: false }
  );
  return {
    opt_in: true,
    installed: existsSync3(installedServer(context)),
    state: state ? { ...state, alive: Boolean(state.pid && isAlive(state.pid)) } : null,
    live_lease_count: leases.length
  };
}
function installedServer(context) {
  return join6(
    context.install_root,
    "versions",
    toolkitVersion,
    "dist",
    "index.js"
  );
}
function statePath(context) {
  return join6(context.install_root, "http-state.json");
}
function markerPath(context, id) {
  return join6(
    context.install_root,
    "registrations",
    `${context.registration_name}.${id}.json`
  );
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
async function directoryHash(root, extras = []) {
  const hash = createHash4("sha256");
  const files = [];
  async function visit(path) {
    const details = await stat3(path);
    if (details.isDirectory()) {
      const entries = (await readdir3(path, { withFileTypes: true })).sort(
        (left, right) => left.name.localeCompare(right.name)
      );
      for (const entry of entries) {
        if (entry.name === ".unigame-managed.json" || entry.name.endsWith(".meta"))
          continue;
        await visit(join6(path, entry.name));
      }
      return;
    }
    files.push({
      logical_path: path.slice(root.length).replaceAll("\\", "/").replace(/^\/+/, ""),
      content: await readFile4(path)
    });
  }
  await visit(root);
  for (const extra of extras) {
    files.push({
      logical_path: extra.logical_path.replaceAll("\\", "/"),
      content: await readFile4(extra.source_path)
    });
  }
  files.sort((left, right) => left.logical_path.localeCompare(right.logical_path));
  for (const file of files) {
    hash.update(file.logical_path);
    hash.update(file.content);
  }
  return hash.digest("hex");
}
async function safeRun(executable, args, timeoutMs) {
  try {
    return await runProcess(executable, args, { timeoutMs });
  } catch {
    return null;
  }
}
async function ensureToken(path) {
  if (existsSync3(path)) return;
  await mkdir2(dirname4(path), { recursive: true });
  await writeFile2(path, randomBytes(32).toString("base64url"), { mode: 384 });
}
async function atomicWrite2(path, content) {
  await mkdir2(dirname4(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${randomUUID2()}`;
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
function baseResponse(operation) {
  return {
    ok: true,
    operation,
    changes: [],
    warnings: [],
    errors: [],
    backup: null,
    restart_required: [],
    data: {
      unity_cli: {},
      pipeline: {},
      current_editor: null,
      official_mcp: {},
      agents: [],
      skills: [],
      advanced_broker: {}
    }
  };
}

// src/setup.ts
var input = await readStdin();
try {
  const request = normalizeLegacyRequest(JSON.parse(input));
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
      restart_required: [],
      data: {
        unity_cli: {},
        pipeline: {},
        current_editor: null,
        official_mcp: {},
        agents: [],
        skills: [],
        advanced_broker: {}
      }
    })}
`
  );
  process.exitCode = 1;
}
function normalizeLegacyRequest(input2) {
  const aliases2 = {
    projectPath: "project_path",
    packageRoot: "package_root",
    homePath: "home_path",
    dataPath: "data_path",
    agents: "agent_ids",
    disabledAgents: "disabled_agent_ids",
    skills: "skill_ids",
    disabledSkills: "disabled_skill_ids",
    targetKind: "target_kind",
    targetId: "target_id",
    installServer: "install_server",
    installSkill: "install_skill",
    ownerPid: "owner_pid",
    editorInstanceId: "editor_instance_id",
    ownerStartedAtUtc: "owner_started_at_utc",
    keepAlive: "keep_alive",
    backupId: "backup_id"
  };
  const normalized = { ...input2 };
  for (const [legacy, canonical] of Object.entries(aliases2)) {
    if (normalized[canonical] === void 0 && normalized[legacy] !== void 0)
      normalized[canonical] = normalized[legacy];
    delete normalized[legacy];
  }
  if (input2.installSkill === true && normalized.skill_ids === void 0)
    normalized.skill_ids = ["operate-unity-cli"];
  return normalized;
}
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}
export {
  normalizeLegacyRequest
};
