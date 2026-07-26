#!/usr/bin/env node
import { executeSetup } from "./setup/manager.js";
const input = await readStdin();
try {
    const request = normalizeLegacyRequest(JSON.parse(input));
    const response = await executeSetup(request);
    process.stdout.write(`${JSON.stringify(response)}\n`);
    process.exitCode = response.ok ? 0 : 1;
}
catch (error) {
    process.stdout.write(`${JSON.stringify({
        ok: false,
        operation: "handshake",
        changes: [],
        warnings: [],
        errors: [error instanceof Error ? error.message : String(error)],
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
    })}\n`);
    process.exitCode = 1;
}
/** Deprecated compatibility exists only at the process boundary. */
export function normalizeLegacyRequest(input) {
    const aliases = {
        projectPath: "project_path",
        packageRoot: "package_root",
        homePath: "home_path",
        dataPath: "data_path",
        agents: "agent_ids",
        disabledAgents: "disabled_agent_ids",
        skills: "skill_ids",
        disabledSkills: "disabled_skill_ids",
        targetKind: "target_kind",
        targetId: "target_id",
        installServer: "install_server",
        installSkill: "install_skill",
        ownerPid: "owner_pid",
        editorInstanceId: "editor_instance_id",
        ownerStartedAtUtc: "owner_started_at_utc",
        keepAlive: "keep_alive",
        backupId: "backup_id",
    };
    const normalized = { ...input };
    for (const [legacy, canonical] of Object.entries(aliases)) {
        if (normalized[canonical] === undefined && normalized[legacy] !== undefined)
            normalized[canonical] = normalized[legacy];
        delete normalized[legacy];
    }
    if (input.installSkill === true && normalized.skill_ids === undefined)
        normalized.skill_ids = ["operate-unity-cli"];
    return normalized;
}
async function readStdin() {
    const chunks = [];
    for await (const chunk of process.stdin)
        chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString("utf8");
}
//# sourceMappingURL=setup.js.map