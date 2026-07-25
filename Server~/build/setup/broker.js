import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { processMatchesStart } from "../editor-registry.js";
export function validateBrokerLease(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("lease must be an object");
    const object = value;
    const keys = new Set([
        "schema_version", "editor_instance_id", "owner_pid",
        "owner_started_at_utc", "heartbeat_at_utc", "lease_expires_at_utc",
    ]);
    for (const key of Object.keys(object))
        if (!keys.has(key))
            throw new Error(`additional property: ${key}`);
    for (const key of keys)
        if (!(key in object))
            throw new Error(`missing property: ${key}`);
    if (object.schema_version !== 1)
        throw new Error("unsupported schema_version");
    if (typeof object.editor_instance_id !== "string" || !object.editor_instance_id)
        throw new Error("editor_instance_id must be a string");
    if (!Number.isInteger(object.owner_pid) || Number(object.owner_pid) < 1)
        throw new Error("owner_pid must be positive");
    for (const key of ["owner_started_at_utc", "heartbeat_at_utc", "lease_expires_at_utc"])
        if (typeof object[key] !== "string" || !Number.isFinite(Date.parse(object[key])))
            throw new Error(`${key} must be an ISO timestamp`);
    return object;
}
export async function liveBrokerLeases(directory, options = {}) {
    let files;
    try {
        files = await readdir(directory);
    }
    catch {
        return [];
    }
    const now = (options.now ?? new Date()).getTime();
    const processMatches = options.processMatches ??
        ((lease) => processMatchesStart(lease.owner_pid, lease.owner_started_at_utc));
    const live = [];
    for (const file of files.filter((entry) => entry.endsWith(".json"))) {
        const path = join(directory, file);
        try {
            const lease = validateBrokerLease(JSON.parse(await readFile(path, "utf8")));
            if (file !== `${lease.editor_instance_id}.json` ||
                Date.parse(lease.lease_expires_at_utc) <= now ||
                now - Date.parse(lease.heartbeat_at_utc) > 10_000 ||
                !(await processMatches(lease)))
                throw new Error("stale lease");
            live.push(lease);
        }
        catch {
            if (options.cleanupStale !== false)
                await rm(path, { force: true });
        }
    }
    return live.sort((a, b) => a.editor_instance_id.localeCompare(b.editor_instance_id));
}
async function atomicWrite(path, content) {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
    await writeFile(temporary, content, "utf8");
    await rename(temporary, path);
}
export async function acquireBrokerStartLock(path, options = {}) {
    const now = options.now ?? new Date();
    const lock = {
        token: randomUUID(),
        owner_pid: options.ownerPid ?? process.pid,
        owner_started_at_utc: options.ownerStartedAtUtc ?? now.toISOString(),
        acquired_at_utc: now.toISOString(),
    };
    try {
        await mkdir(path);
        await atomicWrite(join(path, "owner.json"), JSON.stringify(lock));
        return lock;
    }
    catch (error) {
        if (error.code !== "EEXIST")
            throw error;
    }
    let existing = null;
    let age = Number.POSITIVE_INFINITY;
    try {
        existing = JSON.parse(await readFile(join(path, "owner.json"), "utf8"));
        age = now.getTime() - Date.parse(existing.acquired_at_utc);
    }
    catch {
        try {
            age = now.getTime() - (await stat(path)).mtimeMs;
        }
        catch {
            age = Number.POSITIVE_INFINITY;
        }
    }
    const processMatches = options.processMatches ??
        ((entry) => processMatchesStart(entry.owner_pid, entry.owner_started_at_utc));
    const live = existing ? await processMatches(existing) : false;
    if (live || age <= (options.staleAfterMs ?? 10_000))
        return null;
    await rm(path, { recursive: true, force: true });
    return acquireBrokerStartLock(path, options);
}
export async function releaseBrokerStartLock(path, lock) {
    try {
        const existing = JSON.parse(await readFile(join(path, "owner.json"), "utf8"));
        if (existing.token !== lock.token)
            return false;
        await rm(path, { recursive: true, force: true });
        return true;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=broker.js.map