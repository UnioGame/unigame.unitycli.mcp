import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
export const supportedAgents = [
    "codex",
    "cursor",
    "vscode",
    "cline",
    "claude-code",
    "claude-desktop",
];
export function discoverAgents(context) {
    const appData = process.platform === "win32"
        ? join(context.homePath, "AppData", "Roaming")
        : join(context.homePath, ".config");
    const definitions = [
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
            configPath: envOr("UNIGAME_CLINE_CONFIG", join(context.homePath, ".cline", "data", "settings", "cline_mcp_settings.json")),
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
export function registrationValue(context, transport, serverPath, tokenFile, port = 0) {
    const env = {
        UNIGAME_UNITYCLI_ROOT: dirname(dirname(serverPath)),
        UNIGAME_UNITYCLI_DATA_PATH: context.dataPath,
    };
    const value = transport === "http"
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
function envOr(name, fallback) {
    return process.env[name] || fallback;
}
function existsAny(directory, executable) {
    if (existsSync(directory))
        return true;
    const extensions = process.platform === "win32" ? [".exe", ".cmd", ""] : [""];
    return (process.env.PATH ?? "")
        .split(process.platform === "win32" ? ";" : ":")
        .some((entry) => extensions.some((ext) => existsSync(join(entry, executable + ext))));
}
//# sourceMappingURL=agents.js.map