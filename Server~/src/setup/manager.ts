import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  access,
  copyFile,
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { closeSync, constants, existsSync, openSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { resolveUnityCli } from "../catalog.js";
import { discoverEditors } from "../editor-registry.js";
import { runProcess } from "../process.js";
import { redact } from "../redaction.js";
import {
  discoverAgents,
  parseOfficialClientList,
  registrationValue,
  supportedAgents,
} from "./agents.js";
import {
  fingerprint,
  managedTomlBlock,
  managedTomlFingerprint,
  parseJsonc,
  patchManagedToml,
  patchServerJsonc,
} from "./config.js";
import {
  acquireBrokerStartLock,
  liveBrokerLeases,
  releaseBrokerStartLock,
} from "./broker.js";
import { createContext, toolkitVersion } from "./project.js";
import type {
  AgentId,
  AgentRegistration,
  AgentStatus,
  PlannedChange,
  SetupContext,
  SetupRequest,
  SetupResponse,
  SkillId,
  SkillStatus,
} from "./types.js";

interface BackupManifest {
  id: string;
  files: Array<{ source: string; backup: string; existed: boolean }>;
}

interface SetupSnapshot {
  cli_path: string | null;
  agents: AgentRegistration[];
  agent_statuses: AgentStatus[];
  skill_statuses: SkillStatus[];
  response_data: SetupResponse["data"];
}

interface SetupPlan {
  changes: PlannedChange[];
  warnings: string[];
  paths: string[];
  enable_agents: AgentRegistration[];
  disable_agents: AgentRegistration[];
  enable_skills: SkillId[];
  disable_skills: SkillId[];
}

export async function executeSetup(request: SetupRequest): Promise<SetupResponse> {
  const response = baseResponse(request.operation);
  try {
    if (request.operation === "handshake") {
      response.data.official_mcp = {
        protocol_version: 2,
        toolkit_version: toolkitVersion,
        canonical_contract: "snake_case",
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
    if (
      request.operation === "plan" ||
      (request.operation === "repair" && !request.confirm)
    )
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
    response.restart_required = plan.enable_agents
      .filter((entry) => entry.restart_required)
      .map((entry) => entry.display_name);
    return response;
  } catch (error) {
    response.ok = false;
    response.errors.push(error instanceof Error ? error.message : String(error));
    return response;
  }
}

async function inspect(context: SetupContext): Promise<SetupSnapshot> {
  const cli_path = await resolveUnityCli();
  const [version, status, officialClients, registry, broker] = await Promise.all([
    cli_path
      ? safeRun(cli_path, ["--version", "--no-banner"], 5_000)
      : Promise.resolve(null),
    cli_path
      ? safeRun(
          cli_path,
          ["status", "--project", context.project_path, "--format", "json", "--no-banner"],
          10_000,
        )
      : Promise.resolve(null),
    discoverOfficialClients(cli_path),
    discoverEditors({ dataPath: context.data_path }),
    brokerStatus(context),
  ]);
  const agents = discoverAgents(context, officialClients);
  const agent_statuses = await Promise.all(
    agents.map((agent) => inspectAgent(context, agent)),
  );
  const skill_statuses = await Promise.all(
    skillIds.map((id) => inspectSkill(context, id)),
  );
  const pipeline_version = await installedPipelineVersion(context.project_path);
  const current_editor =
    registry.active_editors.find(
      (editor) => resolve(editor.project_path) === context.project_path,
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
        version:
          version?.exitCode === 0 ? redact(version.stdout.trim(), 1_000) : null,
        ready: Boolean(cli_path && version?.exitCode === 0),
        error: cli_path ? null : "CLI_NOT_FOUND",
      },
      pipeline: {
        installed: Boolean(pipeline_version),
        version: pipeline_version,
        ready: Boolean(pipeline_version),
        error: pipeline_version ? null : "PIPELINE_NOT_INSTALLED",
        status:
          status?.exitCode === 0 ? parseLooseJson(status.stdout) : null,
      },
      current_editor: current_editor
        ? {
            ...current_editor,
            state: current_editor.connection_state,
            ready: editor_ready,
            error: editor_ready ? null : "EDITOR_NOT_READY",
          } as Record<string, unknown>
        : null,
      official_mcp: {
        available: Boolean(cli_path),
        state:
          cli_path && pipeline_version && editor_ready
            ? "ready"
            : "not_ready",
        tool_count: current_editor?.tool_count ?? 0,
        error: !cli_path
          ? "CLI_NOT_FOUND"
          : !pipeline_version
            ? "PIPELINE_NOT_INSTALLED"
            : !editor_ready
              ? "EDITOR_NOT_READY"
              : null,
        registration_name: context.registration_name,
        command: cli_path,
        args: ["mcp", "--project-path", context.project_path],
        discovery_source:
          officialClients.size > 0 ? "unity_cli" : "safe_adapters",
        legacy_global_detected: (
          await Promise.all(agents.map((agent) => hasLegacyGlobal(agent)))
        ).some(Boolean),
      },
      agents: agent_statuses,
      skills: skill_statuses,
      advanced_broker: broker,
    },
  };
}

async function buildPlan(
  context: SetupContext,
  request: SetupRequest,
  snapshot: SetupSnapshot,
): Promise<SetupPlan> {
  const enabledAgentIds = selectedAgentIds(request, snapshot.agents);
  const disabledAgentIds = selectedDisabledAgentIds(request);
  const enabledSkillIds = selectedSkillIds(request);
  const disabledSkillIds = selectedDisabledSkillIds(request);
  const enable_agents = snapshot.agents.filter((entry) =>
    enabledAgentIds.includes(entry.agent_id),
  );
  const disable_agents = snapshot.agents.filter((entry) =>
    disabledAgentIds.includes(entry.agent_id),
  );
  const changes: PlannedChange[] = [];
  const warnings: string[] = [];
  const paths = new Set<string>();

  if (request.operation !== "remove") {
    if (enable_agents.length && !snapshot.cli_path && request.transport !== "http")
      warnings.push("CLI_NOT_FOUND: official stdio registration cannot be applied.");
    for (const agent of enable_agents) {
      const state = snapshot.agent_statuses.find(
        (entry) => entry.agent_id === agent.agent_id,
      )!;
      changes.push({
        kind: state.registration_state === "not_configured" ? "create" : "update",
        target: agent.config_path,
        summary: `Configure official Unity MCP for ${agent.display_name}.`,
        agent_id: agent.agent_id,
        conflict: state.registration_state === "conflict",
      });
      if (state.registration_state === "conflict" && !request.force)
        warnings.push(`CONFLICT:${agent.agent_id}`);
      paths.add(agent.config_path);
      paths.add(markerPath(context, agent.agent_id));
    }
  }
  const removals =
    request.operation === "remove" ? enable_agents : disable_agents;
  for (const agent of removals) {
    changes.push({
      kind: "remove",
      target: agent.config_path,
      summary: `Remove the managed Unity MCP registration for ${agent.display_name}.`,
      agent_id: agent.agent_id,
    });
    paths.add(agent.config_path);
    paths.add(markerPath(context, agent.agent_id));
  }

  const skillRemovals =
    request.operation === "remove" ? enabledSkillIds : disabledSkillIds;
  if (request.operation !== "remove") {
    for (const id of enabledSkillIds) {
      const status = snapshot.skill_statuses.find((entry) => entry.skill_id === id)!;
      changes.push({
        kind: status.state === "not_installed" ? "create" : "update",
        target: status.install_path,
        summary: `${request.operation === "repair" ? "Repair" : "Install or update"} ${id}.`,
        skill_id: id,
        conflict: status.state === "modified",
      });
      if (status.state === "modified" && request.operation !== "repair" && !request.force)
        warnings.push(`SKILL_CONFLICT:${id}`);
      for (const target of skillTargets(context, id)) paths.add(target);
    }
  }
  for (const id of skillRemovals) {
    const status = snapshot.skill_statuses.find((entry) => entry.skill_id === id)!;
    changes.push({
      kind: "remove",
      target: status.install_path,
      summary: `Remove managed skill ${id}.`,
      skill_id: id,
    });
    for (const target of skillTargets(context, id)) paths.add(target);
  }
  if (request.install_server) {
    changes.push({
      kind: "update",
      target: installedServer(context),
      summary: "Install the optional advanced broker bundle.",
    });
    paths.add(join(context.install_root, "current.json"));
  }
  return {
    changes,
    warnings,
    paths: [...paths],
    enable_agents,
    disable_agents: removals,
    enable_skills: request.operation === "remove" ? [] : enabledSkillIds,
    disable_skills: skillRemovals,
  };
}

async function applyPlan(
  context: SetupContext,
  request: SetupRequest,
  snapshot: SetupSnapshot,
  plan: SetupPlan,
): Promise<void> {
  if (request.install_server) await installBundle(context);
  const state = (await readJson(statePath(context))) as { port?: number } | null;
  const port = request.port && request.port > 0 ? request.port : state?.port ?? 0;
  if (request.transport === "http" && plan.enable_agents.length && port <= 0)
    throw new Error("HTTP_ENDPOINT_NOT_READY");
  if (request.transport !== "http" && plan.enable_agents.length && !snapshot.cli_path)
    throw new Error("CLI_NOT_FOUND");

  for (const agent of plan.enable_agents) {
    const status = snapshot.agent_statuses.find(
      (entry) => entry.agent_id === agent.agent_id,
    )!;
    if (status.registration_state === "conflict" && !request.force)
      throw new Error(`CONFLICT:${agent.agent_id}`);
    const value = registrationValue(
      context,
      snapshot.cli_path ?? "",
      request.transport ?? "stdio",
      {
        token_file: join(context.install_root, "http-token"),
        port,
      },
    );
    await writeRegistration(context, agent, value);
  }
  for (const agent of plan.disable_agents)
    if (await isManaged(context, agent))
      await writeRegistration(context, agent, undefined);

  for (const id of plan.enable_skills) {
    const status = snapshot.skill_statuses.find((entry) => entry.skill_id === id)!;
    if (status.state === "modified" && request.operation !== "repair" && !request.force)
      throw new Error(`SKILL_CONFLICT:${id}`);
    await installSkill(context, id);
  }
  for (const id of plan.disable_skills)
    await removeSkill(context, id);
}

async function discoverOfficialClients(
  cliPath: string | null,
): Promise<Map<AgentId, boolean>> {
  if (!cliPath) return new Map();
  const result = await safeRun(
    cliPath,
    ["mcp", "configure", "--list", "--format", "json", "--no-banner"],
    10_000,
  );
  if (!result || result.exitCode !== 0) return new Map();
  return parseOfficialClientList(parseLooseJson(result.stdout));
}

function parseLooseJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const object = trimmed.indexOf("{");
    const array = trimmed.indexOf("[");
    const start =
      object < 0 ? array : array < 0 ? object : Math.min(object, array);
    if (start < 0) return null;
    try {
      return JSON.parse(trimmed.slice(start));
    } catch {
      return null;
    }
  }
}

async function inspectAgent(
  context: SetupContext,
  agent: AgentRegistration,
): Promise<AgentStatus> {
  const managed = await isManaged(context, agent);
  const ownEntry = await readEntry(agent, context.registration_name);
  const conflict = ownEntry !== undefined && !managed;
  return {
    agent_id: agent.agent_id,
    display_name: agent.display_name,
    detected: agent.detected,
    registration_state: !agent.detected && ownEntry === undefined
      ? "not_installed"
      : conflict
        ? "conflict"
        : managed
          ? "configured"
          : "not_configured",
    managed,
    restart_required: false,
  };
}

async function hasLegacyGlobal(agent: AgentRegistration): Promise<boolean> {
  if (!existsSync(agent.config_path)) return false;
  return (await readText(agent.config_path)).includes("unity_cli_mcp");
}

async function readEntry(
  agent: AgentRegistration,
  name: string,
): Promise<unknown | undefined> {
  if (!existsSync(agent.config_path)) return undefined;
  const text = await readText(agent.config_path);
  if (agent.format === "toml")
    return managedTomlFingerprint(text, name) ?? undefined;
  try {
    return (parseJsonc(text)[agent.key] as Record<string, unknown> | undefined)?.[name];
  } catch {
    return undefined;
  }
}

async function isManaged(
  context: SetupContext,
  agent: AgentRegistration,
): Promise<boolean> {
  const marker = (await readJson(markerPath(context, agent.agent_id))) as {
    managed_by?: string;
    registration_name?: string;
    fingerprint?: string;
  } | null;
  if (
    marker?.managed_by !== "com.unigame.unitycli.mcp" ||
    marker.registration_name !== context.registration_name ||
    !marker.fingerprint
  )
    return false;
  if (agent.format === "toml")
    return (
      managedTomlFingerprint(
        await readText(agent.config_path),
        context.registration_name,
      ) === marker.fingerprint
    );
  const entry = await readEntry(agent, context.registration_name);
  return entry !== undefined && fingerprint(entry) === marker.fingerprint;
}

async function writeRegistration(
  context: SetupContext,
  agent: AgentRegistration,
  value: Record<string, unknown> | undefined,
): Promise<void> {
  const text = await readText(agent.config_path);
  if (agent.format === "toml") {
    const item = value as {
      command?: string;
      args?: string[];
      url?: string;
      headers?: Record<string, string>;
    };
    const block = value
      ? managedTomlBlock(context.registration_name, {
          command: item.command ?? "",
          args: item.args ?? [],
          env: {},
          url: item.url,
          headers: item.headers,
        })
      : "";
    await atomicWrite(
      agent.config_path,
      patchManagedToml(text, context.registration_name, block),
    );
  } else {
    await atomicWrite(
      agent.config_path,
      patchServerJsonc(text, agent.key, context.registration_name, value),
    );
  }
  if (!value) {
    await rm(markerPath(context, agent.agent_id), { force: true });
    return;
  }
  await atomicWrite(
    markerPath(context, agent.agent_id),
    JSON.stringify(
      {
        managed_by: "com.unigame.unitycli.mcp",
        version: toolkitVersion,
        agent_id: agent.agent_id,
        registration_name: context.registration_name,
        config_path: agent.config_path,
        fingerprint: registrationFingerprint(agent, value),
      },
      null,
      2,
    ) + "\n",
  );
}

function registrationFingerprint(
  agent: AgentRegistration,
  value: Record<string, unknown>,
): string {
  if (agent.format !== "toml" || "url" in value) return fingerprint(value);
  return fingerprint({ ...value, env: value.env ?? {} });
}

const skillIds: SkillId[] = ["operate-unity-cli", "operate-unity-mcp"];

async function inspectSkill(
  context: SetupContext,
  id: SkillId,
): Promise<SkillStatus> {
  const targets = skillTargets(context, id);
  const install_path = targets[0];
  if (!targets.some((target) => existsSync(target)))
    return {
      skill_id: id,
      display_name: displaySkill(id),
      state: "not_installed",
      managed: false,
      install_path,
    };
  const sourceHash = await skillSourceHash(context, id);
  let managed = true;
  let modified = false;
  let updateAvailable = false;
  for (const target of targets) {
    if (!existsSync(target)) {
      managed = false;
      updateAvailable = true;
      continue;
    }
    const manifest = (await readJson(join(target, ".unigame-managed.json"))) as {
      managed_by?: string;
      source_hash?: string;
    } | null;
    const targetManaged =
      manifest?.managed_by === "com.unigame.unitycli.mcp" &&
      Boolean(manifest.source_hash);
    managed = managed && targetManaged;
    if (!targetManaged || await directoryHash(target) !== manifest?.source_hash) {
      modified = true;
      continue;
    }
    if (sourceHash !== manifest?.source_hash)
      updateAvailable = true;
  }
  const state = modified
    ? "modified"
    : updateAvailable
      ? "update_available"
      : "installed";
  return {
    skill_id: id,
    display_name: displaySkill(id),
    state,
    managed,
    install_path,
  };
}

function skillSource(context: SetupContext, id: SkillId): string {
  return join(context.package_root, "skills", id);
}

function skillTargets(context: SetupContext, id: SkillId): string[] {
  const root = context.project_root;
  return [
    join(root, ".agents", "skills", id),
    join(root, ".claude", "skills", id),
    join(root, ".cline", "skills", id),
  ];
}

async function installSkill(context: SetupContext, id: SkillId): Promise<void> {
  const source = skillSource(context, id);
  const source_hash = await skillSourceHash(context, id);
  for (const target of skillTargets(context, id)) {
    const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
    await rm(temporary, { recursive: true, force: true });
    await mkdir(dirname(temporary), { recursive: true });
    await cp(source, temporary, {
      recursive: true,
      filter: (entry) => !entry.endsWith(".meta"),
    });
    if (id === "operate-unity-mcp") {
      const capabilityMap = join(
        context.package_root,
        "Documentation~",
        "unity-cli-capabilities.md",
      );
      await mkdir(join(temporary, "references"), { recursive: true });
      await copyFile(
        capabilityMap,
        join(temporary, "references", "unity-cli-capabilities.md"),
      );
    }
    await writeFile(
      join(temporary, ".unigame-managed.json"),
      JSON.stringify(
        {
          managed_by: "com.unigame.unitycli.mcp",
          skill_id: id,
          version: toolkitVersion,
          source_hash,
        },
        null,
        2,
      ) + "\n",
    );
    await rm(target, { recursive: true, force: true });
    await mkdir(dirname(target), { recursive: true });
    await rename(temporary, target);
  }
}

async function skillSourceHash(
  context: SetupContext,
  id: SkillId,
): Promise<string> {
  const extras = id === "operate-unity-mcp"
    ? [{
        logical_path: "references/unity-cli-capabilities.md",
        source_path: join(
          context.package_root,
          "Documentation~",
          "unity-cli-capabilities.md",
        ),
      }]
    : [];
  return await directoryHash(skillSource(context, id), extras);
}

async function removeSkill(context: SetupContext, id: SkillId): Promise<void> {
  for (const target of skillTargets(context, id)) {
    const manifest = await readJson(join(target, ".unigame-managed.json"));
    if (manifest?.managed_by === "com.unigame.unitycli.mcp")
      await rm(target, { recursive: true, force: true });
  }
}

function selectedAgentIds(
  request: SetupRequest,
  agents: AgentRegistration[],
): AgentId[] {
  if (request.target_kind === "skill" || request.target_kind === "broker")
    return [];
  if (request.target_kind === "agent" && request.target_id)
    return supportedAgents.includes(request.target_id as AgentId)
      ? [request.target_id as AgentId]
      : [];
  if (request.agent_ids) return request.agent_ids;
  return request.target_kind === "all"
    ? agents.filter((entry) => entry.detected).map((entry) => entry.agent_id)
    : [];
}

function selectedDisabledAgentIds(request: SetupRequest): AgentId[] {
  return request.target_kind === "agent" || request.target_kind === "all"
    ? request.disabled_agent_ids ?? []
    : [];
}

function selectedSkillIds(request: SetupRequest): SkillId[] {
  if (request.target_kind === "agent" || request.target_kind === "broker")
    return [];
  if (request.target_kind === "skill" && request.target_id)
    return skillIds.includes(request.target_id as SkillId)
      ? [request.target_id as SkillId]
      : [];
  return request.skill_ids ?? (request.target_kind === "all" ? skillIds : []);
}

function selectedDisabledSkillIds(request: SetupRequest): SkillId[] {
  return request.target_kind === "skill" || request.target_kind === "all"
    ? request.disabled_skill_ids ?? []
    : [];
}

function displaySkill(id: SkillId): string {
  return id === "operate-unity-mcp" ? "Operate Unity MCP" : "Operate Unity CLI";
}

async function createBackup(
  context: SetupContext,
  paths: string[],
): Promise<BackupManifest> {
  const id = `${Date.now()}-${process.pid}-${randomUUID().slice(0, 8)}`;
  const root = join(context.install_root, "backups", id);
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
  if (!request.backup_id) throw new Error("backup_id is required");
  const manifest = await restoreBackup(context, request.backup_id);
  response.backup = request.backup_id;
  response.changes = manifest.files.map((file) => ({
    kind: "update",
    target: file.source,
    summary: "Restored from backup.",
  }));
  response.data = (await inspect(context)).response_data;
  return response;
}

async function restoreBackup(
  context: SetupContext,
  backupId: string,
): Promise<BackupManifest> {
  const root = join(context.install_root, "backups", backupId);
  const manifest = JSON.parse(
    await readFile(join(root, "manifest.json"), "utf8"),
  ) as BackupManifest;
  for (const file of manifest.files) {
    await rm(file.source, { recursive: true, force: true });
    if (file.existed) {
      await mkdir(dirname(file.source), { recursive: true });
      await cp(file.backup, file.source, { recursive: true });
    }
  }
  return manifest;
}

async function installBundle(context: SetupContext): Promise<void> {
  const target = join(context.install_root, "versions", toolkitVersion);
  const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
  await rm(temporary, { recursive: true, force: true });
  await mkdir(join(temporary, "dist"), { recursive: true });
  const dist = join(context.package_root, "Server~", "dist", "index.js");
  const source = existsSync(dist)
    ? dist
    : join(context.package_root, "Server~", "build", "index.js");
  await copyFile(source, join(temporary, "dist", "index.js"));
  await cp(
    join(context.package_root, "Server~", "catalogs"),
    join(temporary, "catalogs"),
    { recursive: true },
  );
  await cp(
    join(context.package_root, "Server~", "schemas"),
    join(temporary, "schemas"),
    { recursive: true },
  );
  await mkdir(dirname(target), { recursive: true });
  await rm(target, { recursive: true, force: true });
  await rename(temporary, target);
  await atomicWrite(
    join(context.install_root, "current.json"),
    JSON.stringify(
      {
        version: toolkitVersion,
        server_path: installedServer(context),
        installed_at_utc: new Date().toISOString(),
      },
      null,
      2,
    ) + "\n",
  );
}

async function serve(
  context: SetupContext,
  request: SetupRequest,
  response: SetupResponse,
): Promise<SetupResponse> {
  const state = (await readJson(statePath(context))) as {
    pid?: number;
    port?: number;
  } | null;
  const leaseDirectory = join(context.install_root, "broker-leases");
  const ownerPid = request.owner_pid ?? process.pid;
  const ownerStartedAtUtc =
    request.owner_started_at_utc ??
    (ownerPid === process.pid ? processStartedAtUtc() : null);
  const leaseId = (
    request.editor_instance_id ??
    (ownerPid === process.pid ? randomUUID() : "")
  ).replace(/[^a-zA-Z0-9._-]/g, "_");
  if (!leaseId)
    throw new Error("editor_instance_id is required for an external HTTP lease");
  if (!ownerStartedAtUtc)
    throw new Error("owner_started_at_utc is required for an external HTTP lease");
  const leasePath = join(leaseDirectory, `${leaseId}.json`);
  if (request.stop) {
    if (!request.confirm) throw new Error("CONFIRMATION_REQUIRED");
    await rm(leasePath, { force: true });
    response.data.advanced_broker = await brokerStatus(context);
    return response;
  }
  if (!request.confirm) throw new Error("CONFIRMATION_REQUIRED");
  await mkdir(leaseDirectory, { recursive: true });
  const now = new Date();
  await atomicWrite(
    leasePath,
    JSON.stringify(
      {
        schema_version: 1,
        editor_instance_id: leaseId,
        owner_pid: ownerPid,
        owner_started_at_utc: ownerStartedAtUtc,
        heartbeat_at_utc: now.toISOString(),
        lease_expires_at_utc: new Date(now.getTime() + 10_000).toISOString(),
      },
      null,
      2,
    ) + "\n",
  );
  if (state?.pid && isAlive(state.pid)) {
    response.data.advanced_broker = await brokerStatus(context);
    return response;
  }
  const lockPath = join(context.install_root, "broker-start.lock");
  const lock = await acquireBrokerStartLock(lockPath, {
    ownerPid: process.pid,
    ownerStartedAtUtc: processStartedAtUtc(),
  });
  if (!lock) throw new Error("BROKER_START_IN_PROGRESS");
  try {
    await installBundle(context);
    const tokenFile = join(context.install_root, "http-token");
    await ensureToken(tokenFile);
    const logPath = join(context.install_root, "logs", "advanced-broker.log");
    await mkdir(dirname(logPath), { recursive: true });
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
        "--lease-dir",
        leaseDirectory,
        "--keep-alive",
        String(Boolean(request.keep_alive)),
      ],
      {
        detached: true,
        stdio: ["ignore", log, log],
        env: {
          ...process.env,
          UNIGAME_UNITYCLI_ROOT: join(
            context.install_root,
            "versions",
            toolkitVersion,
          ),
          UNIGAME_UNITYCLI_DATA_PATH: context.data_path,
        },
        shell: false,
      },
    );
    closeSync(log);
    child.unref();
    response.changes.push({
      kind: "process",
      target: String(child.pid),
      summary: "Started the opt-in loopback MCP broker.",
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

async function brokerStatus(context: SetupContext): Promise<Record<string, unknown>> {
  const state = (await readJson(statePath(context))) as {
    pid?: number;
    port?: number;
  } | null;
  const leases = await liveBrokerLeases(
    join(context.install_root, "broker-leases"),
    { cleanupStale: false },
  );
  return {
    opt_in: true,
    installed: existsSync(installedServer(context)),
    state: state
      ? { ...state, alive: Boolean(state.pid && isAlive(state.pid)) }
      : null,
    live_lease_count: leases.length,
  };
}

function installedServer(context: SetupContext): string {
  return join(
    context.install_root,
    "versions",
    toolkitVersion,
    "dist",
    "index.js",
  );
}

function statePath(context: SetupContext): string {
  return join(context.install_root, "http-state.json");
}

function markerPath(context: SetupContext, id: AgentId): string {
  return join(
    context.install_root,
    "registrations",
    `${context.registration_name}.${id}.json`,
  );
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

async function directoryHash(
  root: string,
  extras: Array<{ logical_path: string; source_path: string }> = [],
): Promise<string> {
  const hash = createHash("sha256");
  const files: Array<{ logical_path: string; content: Buffer }> = [];
  async function visit(path: string): Promise<void> {
    const details = await stat(path);
    if (details.isDirectory()) {
      const entries = (await readdir(path, { withFileTypes: true })).sort(
        (left, right) => left.name.localeCompare(right.name),
      );
      for (const entry of entries) {
        if (
          entry.name === ".unigame-managed.json" ||
          entry.name.endsWith(".meta")
        )
          continue;
        await visit(join(path, entry.name));
      }
      return;
    }
    files.push({
      logical_path: path.slice(root.length).replaceAll("\\", "/").replace(/^\/+/, ""),
      content: await readFile(path),
    });
  }
  await visit(root);
  for (const extra of extras) {
    files.push({
      logical_path: extra.logical_path.replaceAll("\\", "/"),
      content: await readFile(extra.source_path),
    });
  }
  files.sort((left, right) => left.logical_path.localeCompare(right.logical_path));
  for (const file of files) {
    hash.update(file.logical_path);
    hash.update(file.content);
  }
  return hash.digest("hex");
}

async function safeRun(executable: string, args: string[], timeoutMs: number) {
  try {
    return await runProcess(executable, args, { timeoutMs });
  } catch {
    return null;
  }
}

async function ensureToken(path: string): Promise<void> {
  if (existsSync(path)) return;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, randomBytes(32).toString("base64url"), { mode: 0o600 });
}

async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
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

function processStartedAtUtc(): string {
  return new Date(Date.now() - process.uptime() * 1_000).toISOString();
}

function baseResponse(operation: SetupRequest["operation"]): SetupResponse {
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
      advanced_broker: {},
    },
  };
}
