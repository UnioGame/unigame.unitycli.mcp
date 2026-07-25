import { createHash, randomBytes } from "node:crypto";
import {
  access,
  copyFile,
  cp,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { closeSync, constants, existsSync, openSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { resolveUnityCli } from "../catalog.js";
import { runProcess } from "../process.js";
import { redact } from "../redaction.js";
import { discoverAgents, registrationValue, supportedAgents } from "./agents.js";
import {
  managedTomlBlock,
  managedMarker,
  fingerprint,
  parseJsonc,
  patchManagedToml,
  patchServerJsonc,
} from "./config.js";
import { createContext, toolkitVersion } from "./project.js";
import type {
  AgentId,
  AgentRegistration,
  PlannedChange,
  SetupContext,
  SetupRequest,
  SetupResponse,
} from "./types.js";

interface BackupManifest {
  id: string;
  files: Array<{ source: string; backup: string; existed: boolean }>;
}

export async function executeSetup(request: SetupRequest): Promise<SetupResponse> {
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
    if (request.operation === "plan") return response;
    if (!request.confirm) {
      response.ok = false;
      response.errors.push("CONFIRMATION_REQUIRED");
      return response;
    }
    const backup = await createBackup(context, plan.paths);
    response.backup = backup.id;
    if (request.operation === "remove") {
      await removeManaged(context, request, plan.registrations);
    } else {
      await applyManaged(context, request, plan.registrations);
    }
    response.restartRequired = plan.registrations
      .filter((entry) => entry.restartRequired)
      .map((entry) => entry.displayName);
    return await health(context, response);
  } catch (error) {
    response.ok = false;
    response.errors.push(error instanceof Error ? error.message : String(error));
    return response;
  }
}

async function probe(
  context: SetupContext,
  response: SetupResponse,
): Promise<SetupResponse> {
  const registrations = discoverAgents(context);
  const cliPath = await resolveUnityCli();
  const cliVersion = cliPath
    ? await runProcess(cliPath, ["--version"], { timeoutMs: 5_000 })
    : null;
  const editorStatus = cliPath
    ? await runProcess(cliPath, ["status", "--format", "json"], {
        timeoutMs: 10_000,
      })
    : null;
  const pipelineVersion = await installedPipelineVersion(context.projectPath);
  response.data = {
    toolkitVersion,
    node: { path: process.execPath, version: process.version, supported: major() >= 20 },
    unityCli: {
      path: cliPath,
      version:
        cliVersion?.exitCode === 0 ? redact(cliVersion.stdout.trim(), 1_000) : null,
      expected: "1.0.0-beta.2",
    },
    pipeline: {
      installed: Boolean(pipelineVersion),
      version: pipelineVersion,
      expected: "0.4.0-exp.1",
    },
    editor: {
      connected: editorStatus?.exitCode === 0,
      status:
        editorStatus?.exitCode === 0
          ? redact(editorStatus.stdout.trim(), 4_000)
          : null,
    },
    projectPath: context.projectPath,
    projectRoot: context.projectRoot,
    serverName: context.serverName,
    installRoot: context.installRoot,
    serverInstalled: existsSync(installedServer(context)),
    agents: registrations,
    skillInstalled: existsSync(skillPath(context)),
    http: await readJson(statePath(context)),
  };
  response.warnings = major() < 20 ? ["Node 20 or newer is required."] : [];
  return response;
}

async function buildPlan(context: SetupContext, request: SetupRequest) {
  const selected = request.agents ?? supportedAgents;
  const registrations = discoverAgents(context).filter((entry) =>
    selected.includes(entry.id),
  );
  const changes: PlannedChange[] = [];
  const warnings: string[] = [];
  const paths: string[] = [];
  if (request.installServer !== false) {
    changes.push({
      kind: existsSync(installedServer(context)) ? "update" : "create",
      target: installedServer(context),
      summary: "Install the self-contained MCP server bundle.",
    });
    paths.push(join(context.installRoot, "current.json"));
  }
  for (const registration of registrations) {
    if (!registration.configPath) continue;
    const conflict = await hasConflict(registration, context);
    changes.push({
      kind: request.operation === "remove" ? "remove" : existsSync(registration.configPath) ? "update" : "create",
      target: registration.configPath,
      summary:
        registration.format === "dxt"
          ? "Export a project-pinned Claude Desktop extension manifest."
          : `Manage private ${registration.displayName} registration ${context.serverName}.`,
      agent: registration.id,
      conflict,
    });
    if (conflict && !request.force)
      warnings.push(`${registration.displayName} has an unmanaged registration with the same name.`);
    paths.push(registration.configPath);
    paths.push(registrationMarkerPath(context, registration.id));
  }
  if (request.installSkill) {
    changes.push({
      kind: request.operation === "remove" ? "remove" : existsSync(skillPath(context)) ? "update" : "create",
      target: skillPath(context),
      summary: "Manage the project-local operate-unity-cli skill and agent mirrors.",
    });
    paths.push(skillPath(context), ...skillMirrors(context));
  }
  return {
    changes,
    warnings,
    paths,
    registrations,
    data: { serverName: context.serverName, projectRoot: context.projectRoot },
  };
}

async function applyManaged(
  context: SetupContext,
  request: SetupRequest,
  registrations: AgentRegistration[],
): Promise<void> {
  if (request.installServer !== false) await installBundle(context);
  const serverPath = installedServer(context);
  const tokenFile = join(context.installRoot, "http-token");
  await ensureToken(tokenFile);
  const state = (await readJson(statePath(context))) as { port?: number } | null;
  for (const registration of registrations) {
    if (!registration.configPath) continue;
    if ((await hasConflict(registration, context)) && !request.force)
      throw new Error(`CONFLICT:${registration.id}`);
    const value = registrationValue(
      context,
      request.transport ?? "stdio",
      serverPath,
      tokenFile,
      request.port && request.port > 0 ? request.port : state?.port ?? 0,
    );
    await writeRegistration(registration, context, value);
  }
  if (request.installSkill) await installSkill(context, Boolean(request.force));
}

async function removeManaged(
  context: SetupContext,
  request: SetupRequest,
  registrations: AgentRegistration[],
): Promise<void> {
  for (const registration of registrations)
    if (registration.configPath)
      await writeRegistration(registration, context, undefined);
  if (request.installSkill) {
    for (const path of [skillPath(context), ...skillMirrors(context)])
      await rm(path, { recursive: true, force: true });
  }
}

async function writeRegistration(
  registration: AgentRegistration,
  context: SetupContext,
  value: Record<string, unknown> | undefined,
): Promise<void> {
  const path = registration.configPath!;
  await mkdir(dirname(path), { recursive: true });
  const text = await readText(path);
  if (registration.format === "toml") {
    const stdio = value as {
      command?: string;
      args?: string[];
      env?: Record<string, string>;
      url?: string;
      headers?: Record<string, string>;
    };
    const block = value
      ? managedTomlBlock(context.serverName, {
          command: stdio.command ?? "",
          args: stdio.args ?? [],
          env: stdio.env ?? {},
          url: stdio.url,
          headers: stdio.headers,
        })
      : "";
    await atomicWrite(path, patchManagedToml(text, context.serverName, block));
    await writeRegistrationMarker(registration, context, value);
    return;
  }
  if (registration.format === "dxt") {
    if (!value) await rm(path, { force: true });
    else
      await atomicWrite(
        path,
        JSON.stringify(
          {
            dxt_version: "0.1",
            name: context.serverName,
            display_name: `UniGame Unity CLI — ${context.serverName}`,
            version: toolkitVersion,
            description: "Project-pinned Unity CLI MCP server.",
            server: value,
          },
          null,
          2,
        ) + "\n",
      );
    await writeRegistrationMarker(registration, context, value);
    return;
  }
  const key = registration.key;
  await atomicWrite(path, patchServerJsonc(text, key, context.serverName, value));
  await writeRegistrationMarker(registration, context, value);
}

async function installBundle(context: SetupContext): Promise<void> {
  const versions = join(context.installRoot, "versions");
  const target = join(versions, toolkitVersion);
  const temporary = `${target}.tmp-${process.pid}`;
  await rm(temporary, { recursive: true, force: true });
  await mkdir(temporary, { recursive: true });
  const source = existsSync(join(context.packageRoot, "Server~", "dist", "index.js"))
    ? join(context.packageRoot, "Server~", "dist", "index.js")
    : join(context.packageRoot, "Server~", "build", "index.js");
  await mkdir(join(temporary, "dist"), { recursive: true });
  await copyFile(source, join(temporary, "dist", "index.js"));
  await cp(join(context.packageRoot, "Server~", "catalogs"), join(temporary, "catalogs"), { recursive: true });
  await cp(join(context.packageRoot, "Documentation~"), join(temporary, "Documentation~"), { recursive: true });
  await mkdir(versions, { recursive: true });
  await mkdir(join(context.installRoot, "logs"), { recursive: true });
  await mkdir(join(context.installRoot, "backups"), { recursive: true });
  await mkdir(join(context.installRoot, "registrations"), { recursive: true });
  if (existsSync(target)) {
    const rollbackTarget = join(
      context.installRoot,
      "rollback",
      `${toolkitVersion}-${Date.now()}`,
    );
    await mkdir(dirname(rollbackTarget), { recursive: true });
    await rename(target, rollbackTarget);
  }
  await rename(temporary, target);
  const bundleHash = createHash("sha256")
    .update(await readFile(join(target, "dist", "index.js")))
    .digest("hex");
  await atomicWrite(
    join(context.installRoot, "current.json"),
    JSON.stringify(
      {
        version: toolkitVersion,
        serverPath: join(target, "dist", "index.js"),
        bundleHash,
        installedAt: new Date().toISOString(),
      },
      null,
      2,
    ) + "\n",
  );
}

async function installSkill(context: SetupContext, force: boolean): Promise<void> {
  const source = join(context.packageRoot, "skills", "operate-unity-cli");
  const targets = [skillPath(context), ...skillMirrors(context)];
  const sourceHash = await directoryHash(source);
  for (const target of targets) {
    if (existsSync(target)) {
      const manifest = (await readJson(join(target, ".unigame-managed.json"))) as {
        sourceHash?: string;
      } | null;
      const currentHash = await directoryHash(target);
      if (
        !force &&
        (!manifest || (manifest.sourceHash && manifest.sourceHash !== currentHash))
      )
        throw new Error(`SKILL_CONFLICT:${target}`);
    }
    await rm(target, { recursive: true, force: true });
    await mkdir(dirname(target), { recursive: true });
    await cp(source, target, { recursive: true, filter: (entry) => !entry.endsWith(".meta") });
    await writeFile(
      join(target, ".unigame-managed.json"),
      JSON.stringify(
        {
          package: "com.unigame.unitycli.mcp",
          version: toolkitVersion,
          sourceHash,
        },
        null,
        2,
      ),
    );
  }
}

async function createBackup(
  context: SetupContext,
  paths: string[],
): Promise<BackupManifest> {
  const id = `${Date.now()}-${process.pid}`;
  const root = join(context.installRoot, "backups", id);
  const manifest: BackupManifest = { id, files: [] };
  await mkdir(root, { recursive: true });
  for (let index = 0; index < paths.length; index++) {
    const source = paths[index];
    const backup = join(root, String(index));
    const existed = existsSync(source);
    if (existed) await cp(source, backup, { recursive: true });
    manifest.files.push({ source, backup, existed });
  }
  await writeFile(join(root, "manifest.json"), JSON.stringify(manifest, null, 2));
  return manifest;
}

async function rollback(
  context: SetupContext,
  request: SetupRequest,
  response: SetupResponse,
): Promise<SetupResponse> {
  if (!request.confirm) throw new Error("CONFIRMATION_REQUIRED");
  if (!request.backupId) throw new Error("backupId is required");
  const root = join(context.installRoot, "backups", request.backupId);
  const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8")) as BackupManifest;
  for (const file of manifest.files) {
    await rm(file.source, { recursive: true, force: true });
    if (file.existed) {
      await mkdir(dirname(file.source), { recursive: true });
      await cp(file.backup, file.source, { recursive: true });
    }
  }
  response.backup = request.backupId;
  response.changes = manifest.files.map((file) => ({
    kind: "update",
    target: file.source,
    summary: "Restored from backup.",
  }));
  return response;
}

async function serve(
  context: SetupContext,
  request: SetupRequest,
  response: SetupResponse,
): Promise<SetupResponse> {
  const state = (await readJson(statePath(context))) as { pid?: number; port?: number } | null;
  if (request.stop) {
    if (state?.pid && isAlive(state.pid)) process.kill(state.pid, "SIGTERM");
    response.data = { stopped: Boolean(state?.pid) };
    return response;
  }
  if (!request.confirm) throw new Error("CONFIRMATION_REQUIRED");
  if (state?.pid && isAlive(state.pid)) {
    response.data = { alreadyRunning: true, ...state };
    return response;
  }
  await installBundle(context);
  const tokenFile = join(context.installRoot, "http-token");
  await ensureToken(tokenFile);
  await mkdir(join(context.installRoot, "logs"), { recursive: true });
  const logPath = join(
    context.installRoot,
    "logs",
    `${context.serverName}.http.log`,
  );
  const log = openSync(logPath, "a", 0o600);
  const child = spawn(
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
      ...(request.ownerPid ? ["--owner-pid", String(request.ownerPid)] : []),
    ],
    {
      detached: true,
      stdio: ["ignore", log, log],
      env: {
        ...process.env,
        UNITY_PROJECT_PATH: context.projectPath,
        UNIGAME_UNITYCLI_ROOT: join(context.installRoot, "versions", toolkitVersion),
      },
      shell: false,
    },
  );
  closeSync(log);
  child.unref();
  response.changes.push({
    kind: "process",
    target: String(child.pid),
    summary: "Started loopback Streamable HTTP MCP server.",
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
}

async function health(
  context: SetupContext,
  response: SetupResponse,
): Promise<SetupResponse> {
  const state = (await readJson(statePath(context))) as { pid?: number; port?: number } | null;
  const serverExists = existsSync(installedServer(context));
  const agents = discoverAgents(context);
  response.data = {
    ...response.data,
    serverExists,
    serverExecutable: serverExists && (await canRead(installedServer(context))),
    http: state ? { ...state, alive: Boolean(state.pid && isAlive(state.pid)) } : null,
    registrations: await Promise.all(
      agents.map(async (agent) => ({
        id: agent.id,
        configured: agent.configPath ? await containsManaged(agent, context) : false,
      })),
    ),
    skillInstalled: existsSync(skillPath(context)),
  };
  response.ok = response.errors.length === 0;
  return response;
}

async function hasConflict(
  agent: AgentRegistration,
  context: SetupContext,
): Promise<boolean> {
  if (!agent.configPath || !existsSync(agent.configPath)) return false;
  const text = await readText(agent.configPath);
  if (!text.includes(context.serverName)) return false;
  return (
    !text.includes(managedMarker) &&
    !existsSync(registrationMarkerPath(context, agent.id))
  );
}

async function containsManaged(
  agent: AgentRegistration,
  context: SetupContext,
): Promise<boolean> {
  const text = await readText(agent.configPath!);
  return (
    text.includes(context.serverName) &&
    (text.includes(managedMarker) ||
      existsSync(registrationMarkerPath(context, agent.id)) ||
      agent.format === "dxt")
  );
}

function installedServer(context: SetupContext): string {
  return join(context.installRoot, "versions", toolkitVersion, "dist", "index.js");
}
function statePath(context: SetupContext): string {
  return join(context.installRoot, "http-state.json");
}
function skillPath(context: SetupContext): string {
  return join(context.projectRoot, ".agents", "skills", "operate-unity-cli");
}
function skillMirrors(context: SetupContext): string[] {
  return [
    join(context.projectRoot, ".cline", "skills", "operate-unity-cli"),
    join(context.projectRoot, ".claude", "skills", "operate-unity-cli"),
  ];
}
function registrationMarkerPath(
  context: SetupContext,
  agent: AgentId,
): string {
  return join(
    context.installRoot,
    "registrations",
    `${context.serverName}.${agent}.json`,
  );
}

async function writeRegistrationMarker(
  registration: AgentRegistration,
  context: SetupContext,
  value: Record<string, unknown> | undefined,
): Promise<void> {
  const path = registrationMarkerPath(context, registration.id);
  if (!value) {
    await rm(path, { force: true });
    return;
  }
  await atomicWrite(
    path,
    JSON.stringify(
      {
        managedBy: "com.unigame.unitycli.mcp",
        version: toolkitVersion,
        agent: registration.id,
        serverName: context.serverName,
        configPath: registration.configPath,
        fingerprint: fingerprint(value),
      },
      null,
      2,
    ) + "\n",
  );
}

async function ensureToken(path: string): Promise<void> {
  if (existsSync(path)) return;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, randomBytes(32).toString("base64url"), { mode: 0o600 });
}
async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, path);
}
async function readText(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}
async function readJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}
async function canRead(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
function major(): number {
  return Number(process.versions.node.split(".")[0]);
}

async function directoryHash(root: string): Promise<string> {
  const hash = createHash("sha256");
  async function visit(path: string): Promise<void> {
    const details = await stat(path);
    if (details.isDirectory()) {
      const entries = (await import("node:fs/promises")).readdir(path, {
        withFileTypes: true,
      });
      for (const entry of (await entries).sort((left, right) =>
        left.name.localeCompare(right.name),
      )) {
        if (entry.name === ".unigame-managed.json" || entry.name.endsWith(".meta"))
          continue;
        await visit(join(path, entry.name));
      }
      return;
    }
    hash.update(path.slice(root.length).replaceAll("\\", "/"));
    hash.update(await readFile(path));
  }
  await visit(root);
  return hash.digest("hex");
}

async function installedPipelineVersion(
  projectPath: string,
): Promise<string | null> {
  for (const file of [
    join(projectPath, "Packages", "packages-lock.json"),
    join(projectPath, "Packages", "manifest.json"),
  ]) {
    const value = await readJson(file);
    const dependencies = value?.dependencies as
      | Record<string, { version?: string } | string>
      | undefined;
    const pipeline = dependencies?.["com.unity.pipeline"];
    if (typeof pipeline === "string") return pipeline;
    if (pipeline?.version) return pipeline.version;
  }
  return null;
}
function baseResponse(operation: SetupRequest["operation"]): SetupResponse {
  return {
    ok: true,
    operation,
    changes: [],
    warnings: [],
    errors: [],
    backup: null,
    restartRequired: [],
    data: {},
  };
}
