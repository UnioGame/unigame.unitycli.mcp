import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  AgentId,
  AgentRegistration,
  SetupContext,
  TransportName,
} from "./types.js";

export const supportedAgents: AgentId[] = [
  "codex",
  "cursor",
  "vscode",
  "cline",
  "claude-code",
  "claude-desktop",
];

export function discoverAgents(context: SetupContext): AgentRegistration[] {
  const appData =
    process.platform === "win32"
      ? join(context.homePath, "AppData", "Roaming")
      : join(context.homePath, ".config");
  const definitions: AgentRegistration[] = [
    {
      id: "codex",
      displayName: "Codex",
      installed: existsAny(join(context.homePath, ".codex"), "codex"),
      configPath: envOr("UNIGAME_CODEX_CONFIG", join(context.homePath, ".codex", "config.toml")),
      format: "toml",
      key: "mcpServers",
      restartRequired: true,
    },
    {
      id: "cursor",
      displayName: "Cursor",
      installed: existsAny(join(context.homePath, ".cursor"), "cursor"),
      configPath: envOr("UNIGAME_CURSOR_CONFIG", join(context.homePath, ".cursor", "mcp.json")),
      format: "jsonc",
      key: "mcpServers",
      restartRequired: true,
    },
    {
      id: "vscode",
      displayName: "VS Code / Copilot",
      installed: existsAny(join(appData, "Code"), "code"),
      configPath: envOr("UNIGAME_VSCODE_CONFIG", join(appData, "Code", "User", "mcp.json")),
      format: "jsonc",
      key: "servers",
      restartRequired: true,
    },
    {
      id: "cline",
      displayName: "Cline",
      installed: existsSync(join(context.homePath, ".cline")),
      configPath: envOr(
        "UNIGAME_CLINE_CONFIG",
        join(context.homePath, ".cline", "data", "settings", "cline_mcp_settings.json"),
      ),
      format: "json",
      key: "mcpServers",
      restartRequired: true,
    },
    {
      id: "claude-code",
      displayName: "Claude Code",
      installed: existsAny(join(context.homePath, ".claude"), "claude"),
      configPath: envOr("UNIGAME_CLAUDE_CONFIG", join(context.homePath, ".claude.json")),
      format: "json",
      key: "mcpServers",
      restartRequired: true,
    },
    {
      id: "claude-desktop",
      displayName: "Claude Desktop",
      installed: existsSync(join(appData, "Claude")),
      configPath: join(context.installRoot, "exports", `${context.serverName}.dxt.json`),
      format: "dxt",
      key: "mcpServers",
      restartRequired: false,
    },
  ];
  return definitions;
}

export function registrationValue(
  context: SetupContext,
  transport: TransportName,
  serverPath: string,
  tokenFile: string,
  port = 0,
): Record<string, unknown> {
  const env = {
    UNITY_PROJECT_PATH: context.projectPath,
    UNIGAME_UNITYCLI_ROOT: dirname(dirname(serverPath)),
  };
  const value =
    transport === "http"
      ? {
          type: "http",
          url: `http://127.0.0.1:${port}/mcp`,
          headers: { Authorization: `Bearer file:${tokenFile}` },
        }
      : {
          command: process.execPath,
          args: [serverPath],
          env,
        };
  return value;
}

function envOr(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

function existsAny(directory: string, executable: string): boolean {
  if (existsSync(directory)) return true;
  const extensions = process.platform === "win32" ? [".exe", ".cmd", ""] : [""];
  return (process.env.PATH ?? "")
    .split(process.platform === "win32" ? ";" : ":")
    .some((entry) => extensions.some((ext) => existsSync(join(entry, executable + ext))));
}
