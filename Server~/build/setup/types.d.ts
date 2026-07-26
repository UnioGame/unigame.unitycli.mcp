export type SetupOperation = "probe" | "plan" | "apply" | "repair" | "remove" | "rollback" | "handshake" | "serve" | "health";
export type AgentId = "codex" | "cursor" | "vscode" | "cline" | "claude-code" | "claude-desktop";
export type SkillId = "operate-unity-cli" | "operate-unity-mcp";
export type TransportName = "stdio" | "http";
export type TargetKind = "agent" | "skill" | "broker" | "all";
export type RegistrationState = "not_installed" | "not_configured" | "configured" | "restart_required" | "conflict";
export type SkillState = "not_installed" | "installed" | "update_available" | "modified";
/** Canonical setup contract. Field names are intentionally snake_case. */
export interface SetupRequest {
    operation: SetupOperation;
    project_path?: string;
    package_root?: string;
    home_path?: string;
    data_path?: string;
    agent_ids?: AgentId[];
    disabled_agent_ids?: AgentId[];
    skill_ids?: SkillId[];
    disabled_skill_ids?: SkillId[];
    target_kind?: TargetKind;
    target_id?: string;
    transport?: TransportName;
    confirm?: boolean;
    force?: boolean;
    install_server?: boolean;
    port?: number;
    owner_pid?: number;
    editor_instance_id?: string;
    owner_started_at_utc?: string;
    keep_alive?: boolean;
    backup_id?: string;
    stop?: boolean;
}
export interface PlannedChange {
    kind: "create" | "update" | "remove" | "process" | "none";
    target: string;
    summary: string;
    agent_id?: AgentId;
    skill_id?: SkillId;
    conflict?: boolean;
}
export interface SetupResponse {
    ok: boolean;
    operation: SetupOperation;
    changes: PlannedChange[];
    warnings: string[];
    errors: string[];
    backup: string | null;
    restart_required: string[];
    data: {
        unity_cli: Record<string, unknown>;
        pipeline: Record<string, unknown>;
        current_editor: Record<string, unknown> | null;
        official_mcp: Record<string, unknown>;
        agents: AgentStatus[];
        skills: SkillStatus[];
        advanced_broker: Record<string, unknown>;
    };
}
export interface SetupContext {
    project_path: string;
    project_root: string;
    package_root: string;
    home_path: string;
    data_path: string;
    install_root: string;
    registration_name: string;
}
export interface AgentRegistration {
    agent_id: AgentId;
    display_name: string;
    detected: boolean;
    config_path: string;
    format: "json" | "jsonc" | "toml";
    key: "mcpServers" | "servers" | "cline.mcpServers";
    restart_required: boolean;
    official_id?: string;
}
export interface AgentStatus {
    agent_id: AgentId;
    display_name: string;
    detected: boolean;
    registration_state: RegistrationState;
    managed: boolean;
    restart_required: boolean;
}
export interface SkillStatus {
    skill_id: SkillId;
    display_name: string;
    state: SkillState;
    managed: boolean;
    install_path: string;
}
//# sourceMappingURL=types.d.ts.map