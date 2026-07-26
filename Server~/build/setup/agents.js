import { existsSync } from "node:fs";
import { join } from "node:path";
export const supportedAgents = [
    "codex",
    "cursor",
    "vscode",
    "cline",
    "claude-code",
    "claude-desktop",
];
const aliases = {
    codex: "codex",
    cursor: "cursor",
    vscode: "vscode",
    "vs-code": "vscode",
    "visual-studio-code": "vscode",
    copilot: "vscode",
    cline: "cline",
    claude: "claude-desktop",
    "claude-code": "claude-code",
    "claude-desktop": "claude-desktop",
};
/** Parses the intentionally loose JSON returned by experimental Unity CLI builds. */
export function parseOfficialClientList(value) {
    const result = new Map();
    const root = value;
    const items = Array.isArray(root)
        ? root
        : root && typeof root === "object"
            ? (root.data ??
                root.clients ??
                root.agents ??
                root.items ??
                root.configurators)
            : [];
    if (!Array.isArray(items))
        return result;
    for (const item of items) {
        const object = typeof item === "string" ? { id: item } : item;
        const raw = String(object.key ??
            object.id ??
            object.name ??
            object.client ??
            object.agent ??
            "")
            .trim()
            .toLowerCase()
            .replaceAll("_", "-")
            .replace(/\s+/g, "-");
        const id = aliases[raw];
        if (!id)
            continue;
        const status = String(object.status ?? "").toLowerCase();
        const detected = Boolean(object.installed ||
            object.detected ||
            object.available ||
            object.found) ||
            (Boolean(object.configPath ?? object.config_path) &&
                status !== "file-not-found" &&
                status !== "no-file");
        result.set(id, detected);
    }
    return result;
}
export function discoverAgents(context, official = new Map()) {
    const appData = process.platform === "win32"
        ? join(context.home_path, "AppData", "Roaming")
        : join(context.home_path, ".config");
    const definitions = [
        adapter("codex", "Codex", join(context.home_path, ".codex", "config.toml"), "toml", "mcpServers", true, existsSync(join(context.home_path, ".codex"))),
        adapter("cursor", "Cursor", join(context.home_path, ".cursor", "mcp.json"), "jsonc", "mcpServers", true, existsSync(join(context.home_path, ".cursor"))),
        adapter("vscode", "VS Code / Copilot", join(appData, "Code", "User", "mcp.json"), "jsonc", "servers", true, existsSync(join(appData, "Code"))),
        adapter("cline", "Cline", join(appData, "Code", "User", "settings.json"), "jsonc", "cline.mcpServers", true, existsSync(join(appData, "Code"))),
        adapter("claude-code", "Claude Code", join(context.home_path, ".claude.json"), "json", "mcpServers", true, existsSync(join(context.home_path, ".claude"))),
        adapter("claude-desktop", "Claude Desktop", join(appData, "Claude", "claude_desktop_config.json"), "json", "mcpServers", true, existsSync(join(appData, "Claude"))),
    ];
    return definitions
        .map((entry) => ({
        ...entry,
        detected: official.get(entry.agent_id) === true || entry.detected,
        official_id: entry.agent_id,
    }))
        .sort((left, right) => Number(right.detected) - Number(left.detected) ||
        left.display_name.localeCompare(right.display_name));
}
export function registrationValue(context, unityCli, transport, broker) {
    if (transport === "http") {
        return {
            type: "http",
            url: `http://127.0.0.1:${broker.port}/mcp`,
            headers: { Authorization: `Bearer file:${broker.token_file}` },
        };
    }
    return {
        command: unityCli,
        args: ["mcp", "--project-path", context.project_path],
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
        restart_required,
    };
}
//# sourceMappingURL=agents.js.map