import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { executeSetup } from "../src/setup/manager.js";
import { patchServerJsonc } from "../src/setup/config.js";
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
    expect(await readFile(cursorPath, "utf8")).toContain(projectServerName(paths.projectPath));
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
});
