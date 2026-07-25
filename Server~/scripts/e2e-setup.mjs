import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const serverRoot = resolve(import.meta.dirname, "..");
const packageRoot = resolve(serverRoot, "..");
const setupPath = join(serverRoot, "dist", "setup.js");
const root = await mkdtemp(join(tmpdir(), "unigame-unitycli-e2e-"));
const projectPath = join(root, "repo", "GameClient");
const homePath = join(root, "home");
const dataPath = join(root, "data");
let httpStarted = false;

try {
  await mkdir(join(root, "repo", ".git"), { recursive: true });
  await mkdir(join(projectPath, "Assets"), { recursive: true });
  const base = {
    projectPath,
    packageRoot,
    homePath,
    dataPath,
    agents: [
      "codex",
      "cursor",
      "vscode",
      "cline",
      "claude-code",
      "claude-desktop",
    ],
    installServer: true,
    installSkill: true,
  };

  const plan = await setup({ operation: "plan", ...base });
  assert(plan.ok && plan.changes.length >= 7, "setup preview is incomplete");
  const apply = await setup({
    operation: "apply",
    ...base,
    transport: "stdio",
    confirm: true,
  });
  assert(apply.ok, apply.errors.join("\n"));

  const current = JSON.parse(
    await readFile(join(dataPath, "unity-cli-mcp", "current.json"), "utf8"),
  );
  const installedRoot = resolve(current.serverPath, "..", "..");
  const stdioClient = new Client({ name: "unigame-setup-e2e", version: "1.0.0" });
  const stdio = new StdioClientTransport({
    command: process.execPath,
    args: [current.serverPath],
    env: {
      ...process.env,
      UNITY_PROJECT_PATH: projectPath,
      UNIGAME_UNITYCLI_ROOT: installedRoot,
    },
  });
  await stdioClient.connect(stdio);
  const stdioTools = await stdioClient.listTools();
  assert(stdioTools.tools.length === 269, `expected 269 tools, got ${stdioTools.tools.length}`);
  await stdioClient.close();

  const served = await setup({
    operation: "serve",
    ...base,
    confirm: true,
    port: 0,
    ownerPid: process.pid,
  });
  assert(served.ok && served.data.endpoint, "HTTP did not start");
  httpStarted = true;
  const tokenFile = join(dataPath, "unity-cli-mcp", "http-token");
  const httpClient = new Client({ name: "unigame-http-e2e", version: "1.0.0" });
  const http = new StreamableHTTPClientTransport(new URL(served.data.endpoint), {
    requestInit: {
      headers: { Authorization: `Bearer file:${tokenFile}` },
    },
  });
  await httpClient.connect(http);
  const httpTools = await httpClient.listTools();
  assert(httpTools.tools.length === 269, `HTTP expected 269 tools, got ${httpTools.tools.length}`);
  await httpClient.close();

  const stopped = await setup({
    operation: "serve",
    ...base,
    confirm: true,
    stop: true,
  });
  assert(stopped.ok, "HTTP did not stop");
  httpStarted = false;

  const removed = await setup({
    operation: "remove",
    ...base,
    confirm: true,
  });
  assert(removed.ok && removed.backup, "managed remove failed");
  const rolledBack = await setup({
    operation: "rollback",
    projectPath,
    packageRoot,
    homePath,
    dataPath,
    backupId: removed.backup,
    confirm: true,
  });
  assert(rolledBack.ok, "rollback failed");

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      tools: stdioTools.tools.length,
      agents: base.agents.length,
      stdio: true,
      http: true,
      rollback: true,
    })}\n`,
  );
} finally {
  if (httpStarted) {
    await setup({
      operation: "serve",
      projectPath,
      packageRoot,
      homePath,
      dataPath,
      confirm: true,
      stop: true,
    }).catch(() => undefined);
  }
  await rm(root, { recursive: true, force: true });
}

async function setup(request) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [setupPath], {
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("exit", () => {
      try {
        resolvePromise(JSON.parse(stdout));
      } catch {
        reject(new Error(stderr || stdout || "setup manager returned no JSON"));
      }
    });
    child.stdin.end(JSON.stringify(request));
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
