export type SetupOperation = "probe" | "plan" | "apply" | "repair" | "remove" | "rollback" | "handshake" | "serve" | "health";
export type AgentId = "codex" | "cursor" | "vscode" | "cline" | "claude-code" | "claude-desktop";
export type TransportName = "stdio" | "http";
export interface SetupRequest {
    operation: SetupOperation;
    projectPath?: string;
    packageRoot?: string;
    homePath?: string;
    dataPath?: string;
    agents?: AgentId[];
    disabledAgents?: AgentId[];
    transport?: TransportName;
    confirm?: boolean;
    force?: boolean;
    installServer?: boolean;
    installSkill?: boolean;
    port?: number;
    ownerPid?: number;
    editorInstanceId?: string;
    ownerStartedAtUtc?: string;
    keepAlive?: boolean;
    backupId?: string;
    stop?: boolean;
}
export interface PlannedChange {
    kind: "create" | "update" | "remove" | "process" | "none";
    target: string;
    summary: string;
    agent?: AgentId;
    conflict?: boolean;
}
export interface SetupResponse {
    ok: boolean;
    operation: SetupOperation;
    changes: PlannedChange[];
    warnings: string[];
    errors: string[];
    backup: string | null;
    restartRequired: string[];
    data: Record<string, unknown>;
}
export interface SetupContext {
    projectPath: string;
    projectRoot: string;
    packageRoot: string;
    homePath: string;
    dataPath: string;
    installRoot: string;
    serverName: string;
    legacyServerName: string;
}
export interface AgentRegistration {
    id: AgentId;
    displayName: string;
    installed: boolean;
    configPath: string | null;
    format: "json" | "jsonc" | "toml" | "dxt";
    key: "mcpServers" | "servers";
    restartRequired: boolean;
    configured?: boolean;
    conflict?: boolean;
}
//# sourceMappingURL=types.d.ts.map