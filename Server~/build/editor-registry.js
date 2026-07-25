import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { isAbsolute, join, normalize, resolve } from "node:path";
import { homedir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ToolkitError } from "./errors.js";
export const editorMetadataSchemaVersion = 1;
export const editorLeaseExpiryMs = 10_000;
const metadataKeys = new Set([
    "schema_version", "metadata_revision", "project_id", "project_name",
    "project_path", "editor_instance_id", "editor_pid", "editor_started_at_utc",
    "editor_version", "package_version", "pipeline_version", "connection_state",
    "heartbeat_at_utc", "lease_expires_at_utc", "pipeline_descriptor_path",
    "capability_catalog_hash", "tool_count", "is_playing", "is_compiling",
    "compile_errors_count",
]);
const stringKeys = [
    "project_id", "project_name", "project_path", "editor_instance_id",
    "editor_started_at_utc", "editor_version", "package_version",
    "pipeline_version", "connection_state", "heartbeat_at_utc",
    "lease_expires_at_utc", "pipeline_descriptor_path", "capability_catalog_hash",
];
export function defaultDataPath() {
    if (process.env.UNIGAME_UNITYCLI_DATA_PATH)
        return resolve(process.env.UNIGAME_UNITYCLI_DATA_PATH);
    if (process.platform === "win32")
        return join(process.env.LOCALAPPDATA ?? homedir(), "UniGame");
    return join(homedir(), ".local", "share", "unigame");
}
export function normalizeProjectPath(path) {
    let value = normalize(resolve(path)).replaceAll("\\", "/");
    if (process.platform === "win32")
        value = value.toLowerCase();
    return value.replace(/\/+$/, "");
}
export function projectId(path) {
    return createHash("sha256").update(normalizeProjectPath(path)).digest("hex");
}
export function validateEditorMetadata(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("metadata must be an object");
    const object = value;
    for (const key of Object.keys(object))
        if (!metadataKeys.has(key))
            throw new Error(`additional property is not allowed: ${key}`);
    for (const key of metadataKeys)
        if (!(key in object))
            throw new Error(`required property is missing: ${key}`);
    if (object.schema_version !== editorMetadataSchemaVersion)
        throw new Error(`unsupported schema_version: ${String(object.schema_version)}`);
    for (const key of stringKeys)
        if (typeof object[key] !== "string" || !object[key])
            throw new Error(`${key} must be a non-empty string`);
    for (const key of ["metadata_revision", "editor_pid", "tool_count", "compile_errors_count"])
        if (!Number.isInteger(object[key]) || Number(object[key]) < 0)
            throw new Error(`${key} must be a non-negative integer`);
    if (Number(object.editor_pid) < 1)
        throw new Error("editor_pid must be a positive integer");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(String(object.editor_instance_id)))
        throw new Error("editor_instance_id must be a UUID");
    for (const key of ["is_playing", "is_compiling"])
        if (typeof object[key] !== "boolean")
            throw new Error(`${key} must be a boolean`);
    for (const key of ["editor_started_at_utc", "heartbeat_at_utc", "lease_expires_at_utc"])
        if (!Number.isFinite(Date.parse(String(object[key]))))
            throw new Error(`${key} must be an ISO timestamp`);
    if (!isAbsolute(String(object.project_path)) ||
        projectId(String(object.project_path)) !== object.project_id)
        throw new Error("project_id does not match normalized project_path");
    if (!isAbsolute(String(object.pipeline_descriptor_path)))
        throw new Error("pipeline_descriptor_path must be absolute");
    return object;
}
const execFileAsync = promisify(execFile);
export async function processMatchesStart(pid, startedAtUtc) {
    try {
        process.kill(pid, 0);
        let output;
        if (process.platform === "win32") {
            const result = await execFileAsync("powershell.exe", [
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().ToString('O')`,
            ], { windowsHide: true, timeout: 2_000 });
            output = result.stdout.trim();
        }
        else {
            const result = await execFileAsync("ps", ["-o", "lstart=", "-p", String(pid)], { timeout: 2_000 });
            output = result.stdout.trim();
        }
        const actual = Date.parse(output);
        const claimed = Date.parse(startedAtUtc);
        return Number.isFinite(actual) &&
            Number.isFinite(claimed) &&
            Math.abs(actual - claimed) <= 2_000;
    }
    catch {
        return false;
    }
}
async function defaultProcessMatches(metadata) {
    return processMatchesStart(metadata.editor_pid, metadata.editor_started_at_utc);
}
async function descriptorIsReadable(metadata) {
    try {
        const details = await stat(metadata.pipeline_descriptor_path);
        return details.isFile() && details.size > 0;
    }
    catch {
        return false;
    }
}
export async function discoverEditors(options = {}) {
    const root = join(options.dataPath ?? defaultDataPath(), "unity-cli-mcp", "registry", "editors");
    const snapshot = {
        active_editors: [], stale_editors: [], corrupt_entries: [],
    };
    let projectDirectories;
    try {
        projectDirectories = await readdir(root, { withFileTypes: true });
    }
    catch {
        return snapshot;
    }
    const now = (options.now ?? new Date()).getTime();
    const processMatches = options.processMatches ?? defaultProcessMatches;
    for (const projectDirectory of projectDirectories) {
        if (!projectDirectory.isDirectory())
            continue;
        const projectRoot = join(root, projectDirectory.name);
        let files;
        try {
            files = await readdir(projectRoot, { withFileTypes: true });
        }
        catch (error) {
            snapshot.corrupt_entries.push({ path: projectRoot, error: String(error) });
            continue;
        }
        for (const file of files) {
            if (!file.isFile() || !file.name.endsWith(".json"))
                continue;
            const path = join(projectRoot, file.name);
            let metadata;
            try {
                metadata = validateEditorMetadata(JSON.parse(await readFile(path, "utf8")));
                if (projectDirectory.name !== metadata.project_id ||
                    file.name !== `${metadata.editor_instance_id}.json`)
                    throw new Error("registry path does not match metadata identity");
            }
            catch (error) {
                snapshot.corrupt_entries.push({
                    path, error: error instanceof Error ? error.message : String(error),
                });
                continue;
            }
            let staleReason = "";
            if (Date.parse(metadata.lease_expires_at_utc) <= now ||
                now - Date.parse(metadata.heartbeat_at_utc) > editorLeaseExpiryMs)
                staleReason = "lease_expired";
            else if (!(await processMatches(metadata)))
                staleReason = "editor_process_mismatch";
            else if (metadata.connection_state === "ready" &&
                !(await descriptorIsReadable(metadata)))
                staleReason = "pipeline_descriptor_unavailable";
            if (staleReason)
                snapshot.stale_editors.push({ ...metadata, stale_reason: staleReason });
            else
                snapshot.active_editors.push(metadata);
        }
    }
    snapshot.active_editors.sort((a, b) => a.project_id.localeCompare(b.project_id) ||
        a.editor_instance_id.localeCompare(b.editor_instance_id));
    return snapshot;
}
function matchesPath(editor, path) {
    return normalizeProjectPath(editor.project_path) === normalizeProjectPath(path);
}
export async function resolveEditor(selectors, options = {}) {
    const snapshot = await discoverEditors(options);
    const fallbackPath = process.env.UNITY_PROJECT_PATH;
    let candidates = snapshot.active_editors;
    let stale = snapshot.stale_editors;
    const selector = selectors.editor_instance_id ? ["editor_instance_id", selectors.editor_instance_id] :
        selectors.project_id ? ["project_id", selectors.project_id] :
            selectors.project_path ? ["project_path", selectors.project_path] :
                selectors.projectPath ? ["project_path", selectors.projectPath] :
                    fallbackPath ? ["project_path", fallbackPath] :
                        null;
    if (selector) {
        const [key, value] = selector;
        const predicate = key === "project_path"
            ? (editor) => matchesPath(editor, value)
            : (editor) => editor[key] === value;
        candidates = candidates.filter(predicate);
        stale = stale.filter(predicate);
    }
    const matching = candidates;
    candidates = matching.filter((editor) => editor.connection_state === "ready");
    if (candidates.length === 1)
        return candidates[0];
    if (candidates.length > 1)
        throw new ToolkitError("TARGET_AMBIGUOUS", "Multiple ready Unity Editors match the selector.", candidates);
    if (matching.length)
        throw new ToolkitError("TARGET_NOT_READY", "The selected Unity Editor is not ready.", matching);
    if (stale.length)
        throw new ToolkitError("TARGET_STALE", "The selected Unity Editor lease is stale.", stale);
    if (selector)
        throw new ToolkitError("TARGET_NOT_FOUND", "No Unity Editor matches the selector.");
    throw new ToolkitError("TARGET_REQUIRED", "Select an Editor with editor_instance_id, project_id, or project_path.");
}
//# sourceMappingURL=editor-registry.js.map