import { afterEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseOfficialClientList } from "../src/setup/agents.js";
import {
  managedTomlBlock,
  patchServerJsonc,
} from "../src/setup/config.js";
import { executeSetup } from "../src/setup/manager.js";
import { projectServerName } from "../src/setup/project.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const temporary: string[] = [];
const previousCli = process.env.UNITY_CLI_PATH;

afterEach(async () => {
  if (previousCli === undefined) delete process.env.UNITY_CLI_PATH;
  else process.env.UNITY_CLI_PATH = previousCli;
  while (temporary.length)
    await rm(temporary.pop()!, { recursive: true, force: true });
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "unigame-setup-"));
  temporary.push(root);
  const project_path = join(root, "repo", "GameClient");
  const home_path = join(root, "home");
  const data_path = join(root, "data");
  const cli = join(root, process.platform === "win32" ? "unity.exe" : "unity");
  await mkdir(join(project_path, "Assets"), { recursive: true });
  await mkdir(join(root, "repo", ".git"), { recursive: true });
  await writeFile(cli, "");
  if (process.platform !== "win32")
    await (await import("node:fs/promises")).chmod(cli, 0o755);
  process.env.UNITY_CLI_PATH = cli;
  return { root, project_path, home_path, data_path, cli };
}

function base(paths: Awaited<ReturnType<typeof fixture>>) {
  return {
    project_path: paths.project_path,
    package_root: packageRoot,
    home_path: paths.home_path,
    data_path: paths.data_path,
  };
}

describe("official MCP setup", () => {
  it("generates stable snake_case project-pinned names", () => {
    const first = projectServerName("C:\\Projects\\My Game");
    expect(first).toBe(projectServerName("C:\\Projects\\My Game"));
    expect(first).toMatch(
      /^unigame_unity_cli_[a-z0-9_]+_[a-f0-9]{8}$/,
    );
  });

  it("keeps different projects isolated", () => {
    expect(projectServerName("C:\\Projects\\One")).not.toBe(
      projectServerName("C:\\Projects\\Two"),
    );
  });

  it("parses installed/detected clients from official discovery JSON", () => {
    const clients = parseOfficialClientList({
      clients: [
        { id: "cursor", installed: true },
        { name: "Claude Code", detected: true },
        { id: "codex", installed: false },
      ],
    });
    expect(clients.get("cursor")).toBe(true);
    expect(clients.get("claude-code")).toBe(true);
    expect(clients.get("codex")).toBe(false);
  });

  it("parses the Unity CLI 1.0.0-beta.2 client catalog shape", () => {
    const clients = parseOfficialClientList({
      success: true,
      command: "mcp-clients",
      data: [
        {
          key: "codex",
          displayName: "OpenAI Codex CLI",
          configPath: "C:\\Users\\Test\\.codex\\config.toml",
          status: "not-configured",
        },
        {
          key: "claude",
          displayName: "Claude Desktop",
          configPath: "C:\\Users\\Test\\Claude\\config.json",
          status: "file-not-found",
        },
      ],
    });
    expect(clients.get("codex")).toBe(true);
    expect(clients.get("claude-desktop")).toBe(false);
  });

  it("preserves JSONC comments and unrelated registrations", () => {
    const source =
      `{\n  // keep this comment\n  "mcpServers": {\n` +
      `    "other": { "command": "safe" }\n  }\n}\n`;
    const output = patchServerJsonc(
      source,
      "mcpServers",
      "managed",
      { command: "unity", args: ["mcp"] },
    );
    expect(output).toContain("// keep this comment");
    expect(output).toContain('"other"');
    expect(output).toContain('"managed"');
  });

  it("preserves unrelated TOML while adding a managed block", () => {
    const original = "[features]\nweb_search = true\n";
    const block = managedTomlBlock("managed", {
      command: "unity",
      args: ["mcp", "--project-path", "C:/Game"],
      env: {},
    });
    expect(original + "\n" + block).toContain("web_search = true");
    expect(block).toContain("[mcp_servers.\"managed\"]");
  });

  it("plans and applies one agent with the official Node-free command", async () => {
    const paths = await fixture();
    const request = {
      ...base(paths),
      target_kind: "agent" as const,
      target_id: "cursor",
      transport: "stdio" as const,
    };
    const plan = await executeSetup({ operation: "plan", ...request });
    expect(plan.ok).toBe(true);
    expect(plan.changes).toEqual([
      expect.objectContaining({ agent_id: "cursor" }),
    ]);
    expect(existsSync(join(paths.home_path, ".cursor", "mcp.json"))).toBe(false);

    const apply = await executeSetup({
      operation: "apply",
      ...request,
      confirm: true,
    });
    expect(apply.ok, apply.errors.join("\n")).toBe(true);
    const config = await readFile(
      join(paths.home_path, ".cursor", "mcp.json"),
      "utf8",
    );
    expect(config).toContain(`"${projectServerName(paths.project_path)}"`);
    expect(config).toContain('"mcp"');
    expect(config).toContain('"--project-path"');
    expect(config).toContain(paths.project_path.replaceAll("\\", "\\\\"));
    expect(config).not.toContain("node");
  });

  it("writes Cline through its VS Code settings key", async () => {
    const paths = await fixture();
    const apply = await executeSetup({
      operation: "apply",
      ...base(paths),
      target_kind: "agent",
      target_id: "cline",
      confirm: true,
    });
    expect(apply.ok, apply.errors.join("\n")).toBe(true);
    const appData = process.platform === "win32"
      ? join(paths.home_path, "AppData", "Roaming")
      : join(paths.home_path, ".config");
    const settings = await readFile(
      join(appData, "Code", "User", "settings.json"),
      "utf8",
    );
    expect(settings).toContain('"cline.mcpServers"');
    expect(settings).toContain(`"${projectServerName(paths.project_path)}"`);
  });

  it("removes only a fingerprinted managed agent entry", async () => {
    const paths = await fixture();
    const cursor = join(paths.home_path, ".cursor", "mcp.json");
    await mkdir(dirname(cursor), { recursive: true });
    await writeFile(
      cursor,
      JSON.stringify({ mcpServers: { other: { command: "keep" } } }),
    );
    const request = {
      ...base(paths),
      target_kind: "agent" as const,
      target_id: "cursor",
    };
    await executeSetup({ operation: "apply", ...request, confirm: true });
    const removed = await executeSetup({
      operation: "remove",
      ...request,
      confirm: true,
    });
    expect(removed.ok).toBe(true);
    const text = await readFile(cursor, "utf8");
    expect(text).toContain('"other"');
    expect(text).not.toContain(projectServerName(paths.project_path));
  });

  it("reports conflict and preserves an unmanaged same-name entry", async () => {
    const paths = await fixture();
    const cursor = join(paths.home_path, ".cursor", "mcp.json");
    const name = projectServerName(paths.project_path);
    await mkdir(dirname(cursor), { recursive: true });
    await writeFile(
      cursor,
      JSON.stringify({ mcpServers: { [name]: { command: "user" } } }),
    );
    const result = await executeSetup({
      operation: "apply",
      ...base(paths),
      target_kind: "agent",
      target_id: "cursor",
      confirm: true,
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("CONFLICT:cursor");
    expect(await readFile(cursor, "utf8")).toContain('"user"');
  });

  it("manages both skills independently and repairs modified copies", async () => {
    const paths = await fixture();
    const request = {
      ...base(paths),
      target_kind: "skill" as const,
      target_id: "operate-unity-mcp",
    };
    const applied = await executeSetup({
      operation: "apply",
      ...request,
      confirm: true,
    });
    expect(applied.ok, applied.errors.join("\n")).toBe(true);
    const skill = join(
      paths.root,
      "repo",
      ".agents",
      "skills",
      "operate-unity-mcp",
    );
    expect(existsSync(join(skill, "SKILL.md"))).toBe(true);
    expect(existsSync(join(skill, "references", "unity-cli-guide-1.0.0-beta.2.md")))
      .toBe(true);
    expect(existsSync(join(skill, "references", "unity-cli-capabilities.md")))
      .toBe(true);
    const installedProbe = await executeSetup({
      operation: "probe",
      ...base(paths),
    });
    expect(
      installedProbe.data.skills.find(
        (entry) => entry.skill_id === "operate-unity-mcp",
      )?.state,
    ).toBe("installed");
    await writeFile(join(skill, "SKILL.md"), "modified");
    const probe = await executeSetup({ operation: "probe", ...base(paths) });
    expect(
      probe.data.skills.find(
        (entry) => entry.skill_id === "operate-unity-mcp",
      )?.state,
    ).toBe("modified");
    const repaired = await executeSetup({
      operation: "repair",
      ...request,
      confirm: true,
    });
    expect(repaired.ok, repaired.errors.join("\n")).toBe(true);
    expect(await readFile(join(skill, "SKILL.md"), "utf8")).toContain(
      "Operate Unity MCP",
    );
    const removed = await executeSetup({
      operation: "remove",
      ...request,
      confirm: true,
    });
    expect(removed.ok).toBe(true);
    expect(existsSync(skill)).toBe(false);
  });

  it("detects but never automatically deletes legacy unity_cli_mcp", async () => {
    const paths = await fixture();
    const cursor = join(paths.home_path, ".cursor", "mcp.json");
    await mkdir(dirname(cursor), { recursive: true });
    await writeFile(
      cursor,
      JSON.stringify({
        mcpServers: { unity_cli_mcp: { command: "legacy-user-owned" } },
      }),
    );
    const probe = await executeSetup({ operation: "probe", ...base(paths) });
    expect(probe.data.official_mcp.legacy_global_detected).toBe(true);
    await executeSetup({
      operation: "apply",
      ...base(paths),
      target_kind: "agent",
      target_id: "cursor",
      confirm: true,
    });
    expect(await readFile(cursor, "utf8")).toContain("unity_cli_mcp");
  });

  it("returns only canonical snake_case high-level fields", async () => {
    const paths = await fixture();
    const response = await executeSetup({ operation: "probe", ...base(paths) });
    expect(Object.keys(response.data).sort()).toEqual([
      "advanced_broker",
      "agents",
      "current_editor",
      "official_mcp",
      "pipeline",
      "skills",
      "unity_cli",
    ]);
    expect(response).toHaveProperty("restart_required");
    expect(response).not.toHaveProperty("restartRequired");
    expect(response.data.agents[0]).toEqual(
      expect.objectContaining({
        agent_id: expect.any(String),
        display_name: expect.any(String),
        detected: expect.any(Boolean),
        registration_state: expect.stringMatching(
          /^(not_installed|not_configured|configured|restart_required|conflict)$/,
        ),
        managed: expect.any(Boolean),
        restart_required: expect.any(Boolean),
      }),
    );
  });
});
