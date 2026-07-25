import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { executeSetup } from "../src/setup/manager.js";
import {
  fingerprint,
  managedTomlBlock,
  managedTomlFingerprint,
  patchServerJsonc,
} from "../src/setup/config.js";
import { projectServerName } from "../src/setup/project.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const temporary: string[] = [];

afterEach(async () => {
  while (temporary.length) {
    const path = temporary.pop()!;
    await rm(path, { recursive: true, force: true });
  }
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "unigame-setup-"));
  temporary.push(root);
  const projectPath = join(root, "repo", "GameClient");
  const homePath = join(root, "home");
  const dataPath = join(root, "data");
  await mkdir(join(projectPath, "Assets"), { recursive: true });
  await mkdir(join(root, "repo", ".git"), { recursive: true });
  return { root, projectPath, homePath, dataPath };
}

describe("setup manager", () => {
  it("generates a stable sanitized project-pinned name", () => {
    const first = projectServerName("C:\\Projects\\My Game");
    const second = projectServerName("C:\\Projects\\My Game");
    expect(first).toBe(second);
    expect(first).toMatch(/^unigameUnityCli_[A-Za-z0-9_]+_[a-f0-9]{8}$/);
  });

  it("preserves JSONC comments and unrelated servers", () => {
    const source = `{\n  // keep this agent\n  "mcpServers": { "other": { "command": "safe" } }\n}\n`;
    const output = patchServerJsonc(
      source,
      "mcpServers",
      "managed",
      { command: "node" },
    );
    expect(output).toContain("// keep this agent");
    expect(output).toContain('"other"');
    expect(output).toContain('"managed"');
  });

  it("keeps preview read-only and applies all fake-home registrations", async () => {
    const paths = await fixture();
    const base = {
      projectPath: paths.projectPath,
      packageRoot,
      homePath: paths.homePath,
      dataPath: paths.dataPath,
      agents: ["codex", "cursor", "vscode", "cline", "claude-code", "claude-desktop"] as const,
      installServer: true,
      installSkill: true,
      transport: "stdio" as const,
    };
    const plan = await executeSetup({ operation: "plan", ...base });
    expect(plan.ok).toBe(true);
    expect(existsSync(paths.dataPath)).toBe(false);

    const apply = await executeSetup({
      operation: "apply",
      ...base,
      agents: [...base.agents],
      confirm: true,
    });
    expect(apply.ok, apply.errors.join("\n")).toBe(true);
    expect(apply.backup).toBeTruthy();
    expect(apply.data.serverExists).toBe(true);
    expect(existsSync(join(paths.root, "repo", ".agents", "skills", "operate-unity-cli", "SKILL.md"))).toBe(true);
    expect(existsSync(join(paths.dataPath, "unity-cli-mcp", "exports"))).toBe(true);
  });

  it("removes only managed entries and rolls the backup back", async () => {
    const paths = await fixture();
    const cursorPath = join(paths.homePath, ".cursor", "mcp.json");
    await mkdir(dirname(cursorPath), { recursive: true });
    await writeFile(
      cursorPath,
      `{\n // retained\n "mcpServers": { "other": { "command": "other" } }\n}\n`,
    );
    const base = {
      projectPath: paths.projectPath,
      packageRoot,
      homePath: paths.homePath,
      dataPath: paths.dataPath,
      agents: ["cursor"] as const,
      installServer: true,
      installSkill: false,
    };
    const apply = await executeSetup({
      operation: "apply",
      ...base,
      agents: [...base.agents],
      confirm: true,
    });
    expect(apply.ok).toBe(true);
    const remove = await executeSetup({
      operation: "remove",
      ...base,
      agents: [...base.agents],
      confirm: true,
    });
    expect(remove.ok).toBe(true);
    const removed = await readFile(cursorPath, "utf8");
    expect(removed).toContain('"other"');
    expect(removed).not.toContain(projectServerName(paths.projectPath));

    const rollback = await executeSetup({
      operation: "rollback",
      projectPath: paths.projectPath,
      packageRoot,
      homePath: paths.homePath,
      dataPath: paths.dataPath,
      backupId: remove.backup!,
      confirm: true,
    });
    expect(rollback.ok).toBe(true);
    expect(await readFile(cursorPath, "utf8")).toContain("unity_cli_mcp");
  });

  it("requires confirmation before mutations", async () => {
    const paths = await fixture();
    const result = await executeSetup({
      operation: "apply",
      projectPath: paths.projectPath,
      packageRoot,
      homePath: paths.homePath,
      dataPath: paths.dataPath,
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("CONFIRMATION_REQUIRED");
  });

  it("does not register an HTTP endpoint before a port is assigned", async () => {
    const paths = await fixture();
    const request = {
      projectPath: paths.projectPath,
      packageRoot,
      homePath: paths.homePath,
      dataPath: paths.dataPath,
      agents: ["cursor"] as const,
      installServer: true,
      installSkill: false,
      transport: "http" as const,
    };
    const plan = await executeSetup({
      operation: "plan",
      ...request,
      agents: [...request.agents],
    });
    expect(plan.ok).toBe(true);
    expect(plan.warnings).toContain(
      "HTTP_ENDPOINT_NOT_READY: start the shared broker first or choose a fixed port before Apply.",
    );

    const apply = await executeSetup({
      operation: "apply",
      ...request,
      agents: [...request.agents],
      confirm: true,
    });
    expect(apply.ok).toBe(false);
    expect(apply.errors.join("\n")).toContain("HTTP_ENDPOINT_NOT_READY");
    expect(existsSync(join(paths.homePath, ".cursor", "mcp.json"))).toBe(false);
    expect(existsSync(join(paths.dataPath, "unity-cli-mcp", "current.json"))).toBe(false);
    expect(existsSync(join(paths.dataPath, "unity-cli-mcp", "http-token"))).toBe(false);
  });

  it("previews repair without mutation and applies only when confirmed", async () => {
    const paths = await fixture();
    const base = {
      projectPath: paths.projectPath,
      packageRoot,
      homePath: paths.homePath,
      dataPath: paths.dataPath,
      agents: ["cursor"] as const,
      installServer: false,
      installSkill: false,
    };
    const preview = await executeSetup({
      operation: "repair",
      ...base,
      agents: [...base.agents],
    });
    expect(preview.ok).toBe(true);
    expect(preview.operation).toBe("repair");
    expect(existsSync(join(paths.homePath, ".cursor", "mcp.json"))).toBe(false);

    const applied = await executeSetup({
      operation: "repair",
      ...base,
      agents: [...base.agents],
      confirm: true,
    });
    expect(applied.ok).toBe(true);
    expect(await readFile(join(paths.homePath, ".cursor", "mcp.json"), "utf8"))
      .toContain("unity_cli_mcp");
  });

  it("plans and applies mixed enable and disable state", async () => {
    const paths = await fixture();
    const base = {
      projectPath: paths.projectPath,
      packageRoot,
      homePath: paths.homePath,
      dataPath: paths.dataPath,
      installServer: true,
      installSkill: false,
    };
    const initial = await executeSetup({
      operation: "apply",
      ...base,
      agents: ["codex", "cursor"],
      confirm: true,
    });
    expect(initial.ok, initial.errors.join("\n")).toBe(true);

    const plan = await executeSetup({
      operation: "plan",
      ...base,
      agents: ["cursor"],
      disabledAgents: ["codex"],
    });
    expect(plan.ok).toBe(true);
    expect(plan.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ agent: "cursor" }),
        expect.objectContaining({ agent: "codex", kind: "remove" }),
      ]),
    );

    const apply = await executeSetup({
      operation: "apply",
      ...base,
      agents: ["cursor"],
      disabledAgents: ["codex"],
      confirm: true,
    });
    expect(apply.ok, apply.errors.join("\n")).toBe(true);
    const codex = await readFile(join(paths.homePath, ".codex", "config.toml"), "utf8");
    const cursor = await readFile(join(paths.homePath, ".cursor", "mcp.json"), "utf8");
    expect(codex).not.toContain(projectServerName(paths.projectPath));
    expect(cursor).toContain("unity_cli_mcp");
    expect(cursor).not.toContain("UNITY_PROJECT_PATH");
  });

  it("reports configured and conflict state in probe", async () => {
    const paths = await fixture();
    const base = {
      projectPath: paths.projectPath,
      packageRoot,
      homePath: paths.homePath,
      dataPath: paths.dataPath,
      installServer: true,
      installSkill: false,
    };
    await executeSetup({
      operation: "apply",
      ...base,
      agents: ["cursor"],
      confirm: true,
    });
    const probe = await executeSetup({ operation: "probe", ...base });
    const agents = probe.data.agents as Array<{
      id: string;
      configured: boolean;
      conflict: boolean;
    }>;
    expect(agents.find((entry) => entry.id === "cursor")).toMatchObject({
      configured: true,
      conflict: false,
    });
  });

  it("keeps legacy requests enabled-only", async () => {
    const paths = await fixture();
    const plan = await executeSetup({
      operation: "plan",
      projectPath: paths.projectPath,
      packageRoot,
      homePath: paths.homePath,
      dataPath: paths.dataPath,
      agents: ["codex"],
      installServer: false,
      installSkill: false,
    });
    expect(plan.ok).toBe(true);
    expect(plan.changes.some((change) => change.agent === "codex")).toBe(true);
    expect(plan.changes.some((change) => change.kind === "remove")).toBe(false);
  });

  it("restores all managed files when a mixed apply fails", async () => {
    const paths = await fixture();
    const skillPath = join(
      paths.root,
      "repo",
      ".agents",
      "skills",
      "operate-unity-cli",
    );
    await mkdir(skillPath, { recursive: true });
    await writeFile(join(skillPath, "SKILL.md"), "user-owned");
    const result = await executeSetup({
      operation: "apply",
      projectPath: paths.projectPath,
      packageRoot,
      homePath: paths.homePath,
      dataPath: paths.dataPath,
      agents: ["cursor"],
      installServer: true,
      installSkill: true,
      confirm: true,
    });

    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.startsWith("SKILL_CONFLICT:"))).toBe(true);
    const cursorPath = join(paths.homePath, ".cursor", "mcp.json");
    expect(existsSync(cursorPath)).toBe(false);
    expect(await readFile(join(skillPath, "SKILL.md"), "utf8")).toBe("user-owned");
  });

  it("migrates only fingerprinted legacy project registrations to one global entry", async () => {
    const paths = await fixture();
    const cursorPath = join(paths.homePath, ".cursor", "mcp.json");
    const legacyName = projectServerName(paths.projectPath);
    const legacyValue = {
      command: process.execPath,
      args: ["legacy-server.js"],
      env: { UNITY_PROJECT_PATH: paths.projectPath },
    };
    await mkdir(dirname(cursorPath), { recursive: true });
    await writeFile(
      cursorPath,
      JSON.stringify({ mcpServers: { [legacyName]: legacyValue } }),
    );
    const markerPath = join(
      paths.dataPath,
      "unity-cli-mcp",
      "registrations",
      `${legacyName}.cursor.json`,
    );
    await mkdir(dirname(markerPath), { recursive: true });
    await writeFile(markerPath, JSON.stringify({
      managedBy: "com.unigame.unitycli.mcp",
      serverName: legacyName,
      fingerprint: fingerprint(legacyValue),
    }));

    const applied = await executeSetup({
      operation: "apply",
      projectPath: paths.projectPath,
      packageRoot,
      homePath: paths.homePath,
      dataPath: paths.dataPath,
      agents: ["cursor"],
      installServer: true,
      installSkill: false,
      confirm: true,
    });

    expect(applied.ok, applied.errors.join("\n")).toBe(true);
    const migrated = await readFile(cursorPath, "utf8");
    expect(migrated).toContain('"unity_cli_mcp"');
    expect(migrated).not.toContain(legacyName);
    expect(migrated).not.toContain("UNITY_PROJECT_PATH");
    expect(existsSync(markerPath)).toBe(false);
  });

  it("preserves an unknown user-owned global same-name registration", async () => {
    const paths = await fixture();
    const cursorPath = join(paths.homePath, ".cursor", "mcp.json");
    const original = JSON.stringify({
      mcpServers: { unity_cli_mcp: { command: "user-owned" } },
    }, null, 2);
    await mkdir(dirname(cursorPath), { recursive: true });
    await writeFile(cursorPath, original);

    const applied = await executeSetup({
      operation: "apply",
      projectPath: paths.projectPath,
      packageRoot,
      homePath: paths.homePath,
      dataPath: paths.dataPath,
      agents: ["cursor"],
      installServer: false,
      installSkill: false,
      confirm: true,
    });

    expect(applied.ok).toBe(false);
    expect(applied.errors).toContain("CONFLICT:cursor");
    expect(await readFile(cursorPath, "utf8")).toBe(original);
  });

  it("replaces an unmanaged same-name registration only with explicit force and confirmation", async () => {
    const paths = await fixture();
    const cursorPath = join(paths.homePath, ".cursor", "mcp.json");
    await mkdir(dirname(cursorPath), { recursive: true });
    await writeFile(cursorPath, JSON.stringify({
      mcpServers: { unity_cli_mcp: { command: "user-owned" } },
    }));
    const result = await executeSetup({
      operation: "apply",
      projectPath: paths.projectPath,
      packageRoot,
      homePath: paths.homePath,
      dataPath: paths.dataPath,
      agents: ["cursor"],
      installServer: true,
      installSkill: false,
      confirm: true,
      force: true,
    });
    expect(result.ok, result.errors.join("\n")).toBe(true);
    const replaced = await readFile(cursorPath, "utf8");
    expect(replaced).toContain("unity_cli_mcp");
    expect(replaced).not.toContain("user-owned");
  });

  it("requires confirmation before deleting only the requested broker lease", async () => {
    const paths = await fixture();
    const leaseDirectory = join(paths.dataPath, "unity-cli-mcp", "broker-leases");
    await mkdir(leaseDirectory, { recursive: true });
    const leasePath = join(leaseDirectory, "editor-one.json");
    await writeFile(leasePath, JSON.stringify({ keep: true }));
    const base = {
      operation: "serve" as const,
      projectPath: paths.projectPath,
      packageRoot,
      homePath: paths.homePath,
      dataPath: paths.dataPath,
      editorInstanceId: "editor-one",
      stop: true,
    };
    const rejected = await executeSetup(base);
    expect(rejected.ok).toBe(false);
    expect(rejected.errors).toContain("CONFIRMATION_REQUIRED");
    expect(existsSync(leasePath)).toBe(true);
    const stopped = await executeSetup({ ...base, confirm: true });
    expect(stopped.ok).toBe(true);
    expect(existsSync(leasePath)).toBe(false);
  });

  it("rejects an external HTTP lease without stable Editor owner identity", async () => {
    const paths = await fixture();
    const base = {
      operation: "serve" as const,
      projectPath: paths.projectPath,
      packageRoot,
      homePath: paths.homePath,
      dataPath: paths.dataPath,
      ownerPid: 2_147_483_647,
      confirm: true,
    };

    const missingInstance = await executeSetup(base);
    expect(missingInstance.ok).toBe(false);
    expect(missingInstance.errors).toContain(
      "editorInstanceId is required for an external HTTP lease",
    );

    const missingStart = await executeSetup({
      ...base,
      editorInstanceId: "10000000-0000-4000-8000-000000000001",
    });
    expect(missingStart.ok).toBe(false);
    expect(missingStart.errors).toContain(
      "ownerStartedAtUtc is required for an external HTTP lease",
    );
  });

  it("treats a modified managed TOML block as user-owned and preserves it", async () => {
    const paths = await fixture();
    const base = {
      projectPath: paths.projectPath,
      packageRoot,
      homePath: paths.homePath,
      dataPath: paths.dataPath,
      agents: ["codex"] as const,
      installServer: true,
      installSkill: false,
    };
    const applied = await executeSetup({
      operation: "apply", ...base, agents: [...base.agents], confirm: true,
    });
    expect(applied.ok).toBe(true);
    const path = join(paths.homePath, ".codex", "config.toml");
    const modified = (await readFile(path, "utf8"))
      .replace(/^command\s*=.*$/m, 'command = "user-modified"');
    await writeFile(path, modified);
    const probe = await executeSetup({ operation: "probe", ...base });
    const codex = (probe.data.agents as Array<{
      id: string; configured: boolean; conflict: boolean;
    }>).find((entry) => entry.id === "codex");
    expect(codex).toMatchObject({ configured: false, conflict: true });
    const removed = await executeSetup({
      operation: "remove", ...base, agents: [...base.agents], confirm: true,
    });
    expect(removed.ok).toBe(true);
    expect(await readFile(path, "utf8")).toContain("user-modified");
  });

  it("migrates a valid fingerprinted legacy TOML block", async () => {
    const paths = await fixture();
    const legacyName = projectServerName(paths.projectPath);
    const value = {
      command: process.execPath,
      args: ["legacy-server.js"],
      env: { UNITY_PROJECT_PATH: paths.projectPath },
    };
    const configPath = join(paths.homePath, ".codex", "config.toml");
    const block = managedTomlBlock(legacyName, value);
    expect(managedTomlFingerprint(block, legacyName)).toBe(fingerprint(value));
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, block);
    const markerPath = join(
      paths.dataPath, "unity-cli-mcp", "registrations", `${legacyName}.codex.json`,
    );
    await mkdir(dirname(markerPath), { recursive: true });
    await writeFile(markerPath, JSON.stringify({
      managedBy: "com.unigame.unitycli.mcp",
      serverName: legacyName,
      fingerprint: fingerprint(value),
    }));
    const result = await executeSetup({
      operation: "apply",
      projectPath: paths.projectPath,
      packageRoot,
      homePath: paths.homePath,
      dataPath: paths.dataPath,
      agents: ["codex"],
      installServer: true,
      installSkill: false,
      confirm: true,
    });
    expect(result.ok, result.errors.join("\n")).toBe(true);
    const migrated = await readFile(configPath, "utf8");
    expect(migrated).toContain("unity_cli_mcp");
    expect(migrated).not.toContain(legacyName);
  });
});
