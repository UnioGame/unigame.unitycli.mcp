import { createHash, randomBytes, randomUUID } from "node:crypto";
import { access, copyFile, cp, mkdir, readFile, rename, rm, stat, writeFile, } from "node:fs/promises";
import { closeSync, constants, existsSync, openSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { resolveUnityCli } from "../catalog.js";
import { runProcess } from "../process.js";
import { redact } from "../redaction.js";
import { discoverAgents, registrationValue, supportedAgents } from "./agents.js";
import { managedTomlBlock, managedTomlFingerprint, fingerprint, parseJsonc, patchManagedToml, patchServerJsonc, } from "./config.js";
import { createContext, toolkitVersion } from "./project.js";
import { discoverEditors } from "../editor-registry.js";
import { acquireBrokerStartLock, liveBrokerLeases, releaseBrokerStartLock, } from "./broker.js";
export async function executeSetup(request) {
    const response = baseResponse(request.operation);
    try {
        if (request.operation === "handshake") {
            response.data = { protocolVersion: 1, toolkitVersion, node: process.version };
            return response;
        }
        const context = createContext(request);
        if (request.operation === "probe")
            return await probe(context, response);
        if (request.operation === "health")
            return await health(context, response);
        if (request.operation === "rollback")
            return await rollback(context, request, response);
        if (request.operation === "serve")
            return await serve(context, request, response);
        const plan = await buildPlan(context, request);
        response.changes = plan.changes;
        response.warnings.push(...plan.warnings);
        response.data = plan.data;
        if (request.operation === "plan" ||
            (request.operation === "repair" && !request.confirm))
            return response;
        if (!request.confirm) {
            response.ok = false;
            response.errors.push("CONFIRMATION_REQUIRED");
            return response;
        }
        const backup = await createBackup(context, plan.paths);
        response.backup = backup.id;
        try {
            if (request.operation === "remove") {
                await removeManaged(context, request, plan.registrations);
            }
            else {
                await applyManaged(context, request, plan.enabledRegistrations, plan.disabledRegistrations);
            }
        }
        catch (error) {
            await restoreBackup(context, backup.id);
            throw error;
        }
        response.restartRequired = plan.registrations
            .filter((entry) => entry.restartRequired)
            .map((entry) => entry.displayName);
        return await health(context, response);
    }
    catch (error) {
        response.ok = false;
        response.errors.push(error instanceof Error ? error.message : String(error));
        return response;
    }
}
async function probe(context, response) {
    const registrations = await Promise.all(discoverAgents(context).map(async (registration) => ({
        ...registration,
        configured: await containsManaged(registration, context),
        conflict: await hasConflict(registration, context),
    })));
    const cliPath = await resolveUnityCli();
    const cliVersion = cliPath
        ? await runProcess(cliPath, ["--version"], { timeoutMs: 5_000 })
        : null;
    const editorStatus = cliPath
        ? await runProcess(cliPath, ["status", "--format", "json"], {
            timeoutMs: 10_000,
        })
        : null;
    const pipelineVersion = await installedPipelineVersion(context.projectPath);
    const registry = await discoverEditors({ dataPath: context.dataPath });
    const leaseCounts = await brokerLeaseCounts(context);
    response.data = {
        toolkitVersion,
        node: { path: process.execPath, version: process.version, supported: major() >= 20 },
        unityCli: {
            path: cliPath,
            version: cliVersion?.exitCode === 0 ? redact(cliVersion.stdout.trim(), 1_000) : null,
            expected: "1.0.0-beta.2",
        },
        pipeline: {
            installed: Boolean(pipelineVersion),
            version: pipelineVersion,
            expected: "0.4.0-exp.1",
        },
        editor: {
            connected: editorStatus?.exitCode === 0,
            status: editorStatus?.exitCode === 0
                ? redact(editorStatus.stdout.trim(), 4_000)
                : null,
        },
        projectPath: context.projectPath,
        projectRoot: context.projectRoot,
        serverName: context.serverName,
        installRoot: context.installRoot,
        serverInstalled: existsSync(installedServer(context)),
        agents: registrations,
        skillInstalled: existsSync(skillPath(context)),
        http: await readJson(statePath(context)),
        registry,
        ...leaseCounts,
    };
    response.warnings = major() < 20 ? ["Node 20 or newer is required."] : [];
    return response;
}
async function buildPlan(context, request) {
    const selected = request.agents ?? supportedAgents;
    const disabled = (request.disabledAgents ?? []).filter((id) => !selected.includes(id));
    const discovered = discoverAgents(context);
    const enabledRegistrations = discovered.filter((entry) => selected.includes(entry.id));
    const disabledRegistrations = [];
    for (const registration of discovered) {
        if (disabled.includes(registration.id) && await containsManaged(registration, context))
            disabledRegistrations.push(registration);
    }
    const registrations = request.operation === "remove"
        ? enabledRegistrations
        : [...enabledRegistrations, ...disabledRegistrations];
    const changes = [];
    const warnings = [];
    const paths = [];
    const httpState = request.transport === "http"
        ? (await readJson(statePath(context)))
        : null;
    const httpPort = request.port && request.port > 0
        ? request.port
        : httpState?.port ?? 0;
    if (request.operation !== "remove" &&
        request.transport === "http" &&
        enabledRegistrations.some((entry) => Boolean(entry.configPath)) &&
        httpPort <= 0) {
        warnings.push("HTTP_ENDPOINT_NOT_READY: start the shared broker first or choose a fixed port before Apply.");
    }
    if (request.installServer !== false) {
        changes.push({
            kind: existsSync(installedServer(context)) ? "update" : "create",
            target: installedServer(context),
            summary: "Install the self-contained MCP server bundle.",
        });
        paths.push(join(context.installRoot, "current.json"));
    }
    for (const registration of enabledRegistrations) {
        if (!registration.configPath)
            continue;
        const conflict = await hasConflict(registration, context);
        changes.push({
            kind: request.operation === "remove" ? "remove" : existsSync(registration.configPath) ? "update" : "create",
            target: registration.configPath,
            summary: registration.format === "dxt"
                ? "Export a global dynamic-registry Claude Desktop extension manifest."
                : `Manage private ${registration.displayName} registration ${context.serverName}.`,
            agent: registration.id,
            conflict,
        });
        if (conflict && !request.force)
            warnings.push(`${registration.displayName} has an unmanaged registration with the same name.`);
        paths.push(registration.configPath);
        paths.push(registrationMarkerPath(context, registration.id));
        paths.push(...await legacyRegistrationMarkerPaths(context, registration.id));
    }
    if (request.operation !== "remove") {
        for (const registration of disabledRegistrations) {
            if (!registration.configPath)
                continue;
            changes.push({
                kind: "remove",
                target: registration.configPath,
                summary: `Disable MCP for ${registration.displayName}.`,
                agent: registration.id,
            });
            paths.push(registration.configPath);
            paths.push(registrationMarkerPath(context, registration.id));
        }
    }
    if (request.installSkill) {
        changes.push({
            kind: request.operation === "remove" ? "remove" : existsSync(skillPath(context)) ? "update" : "create",
            target: skillPath(context),
            summary: "Manage the project-local operate-unity-cli skill and agent mirrors.",
        });
        paths.push(skillPath(context), ...skillMirrors(context));
    }
    return {
        changes,
        warnings,
        paths,
        registrations,
        enabledRegistrations,
        disabledRegistrations,
        data: {
            serverName: context.serverName,
            projectRoot: context.projectRoot,
            enabledAgents: enabledRegistrations.map((entry) => entry.id),
            disabledAgents: disabledRegistrations.map((entry) => entry.id),
            ...(request.transport === "http" ? { httpPort } : {}),
        },
    };
}
async function applyManaged(context, request, enabledRegistrations, disabledRegistrations) {
    for (const registration of enabledRegistrations) {
        if (registration.configPath &&
            (await hasConflict(registration, context)) &&
            !request.force)
            throw new Error(`CONFLICT:${registration.id}`);
    }
    const state = (await readJson(statePath(context)));
    const httpPort = request.port && request.port > 0
        ? request.port
        : state?.port ?? 0;
    if (request.transport === "http" &&
        enabledRegistrations.some((entry) => Boolean(entry.configPath)) &&
        httpPort <= 0) {
        throw new Error("HTTP_ENDPOINT_NOT_READY: start the shared broker first or choose a fixed port before Apply.");
    }
    if (request.installServer !== false)
        await installBundle(context);
    const serverPath = installedServer(context);
    const tokenFile = join(context.installRoot, "http-token");
    await ensureToken(tokenFile);
    for (const registration of enabledRegistrations) {
        if (!registration.configPath)
            continue;
        await removeLegacyManagedRegistration(registration, context);
        const value = registrationValue(context, request.transport ?? "stdio", serverPath, tokenFile, httpPort);
        await writeRegistration(registration, context, value);
    }
    for (const registration of disabledRegistrations) {
        if (registration.configPath && await containsManaged(registration, context))
            await writeRegistration(registration, context, undefined);
    }
    if (request.installSkill)
        await installSkill(context, Boolean(request.force));
}
async function removeManaged(context, request, registrations) {
    for (const registration of registrations)
        if (registration.configPath && await containsManaged(registration, context))
            await writeRegistration(registration, context, undefined);
    if (request.installSkill) {
        for (const path of [skillPath(context), ...skillMirrors(context)])
            await rm(path, { recursive: true, force: true });
    }
}
async function writeRegistration(registration, context, value) {
    const path = registration.configPath;
    await mkdir(dirname(path), { recursive: true });
    const text = await readText(path);
    if (registration.format === "toml") {
        const stdio = value;
        const block = value
            ? managedTomlBlock(context.serverName, {
                command: stdio.command ?? "",
                args: stdio.args ?? [],
                env: stdio.env ?? {},
                url: stdio.url,
                headers: stdio.headers,
            })
            : "";
        await atomicWrite(path, patchManagedToml(text, context.serverName, block));
        await writeRegistrationMarker(registration, context, value);
        return;
    }
    if (registration.format === "dxt") {
        if (!value)
            await rm(path, { force: true });
        else
            await atomicWrite(path, JSON.stringify({
                dxt_version: "0.1",
                name: context.serverName,
                display_name: `UniGame Unity CLI — ${context.serverName}`,
                version: toolkitVersion,
                description: "Global Unity CLI MCP broker with dynamic Editor discovery.",
                server: value,
            }, null, 2) + "\n");
        await writeRegistrationMarker(registration, context, value);
        return;
    }
    const key = registration.key;
    await atomicWrite(path, patchServerJsonc(text, key, context.serverName, value));
    await writeRegistrationMarker(registration, context, value);
}
async function installBundle(context) {
    const versions = join(context.installRoot, "versions");
    const target = join(versions, toolkitVersion);
    const temporary = `${target}.tmp-${process.pid}`;
    await rm(temporary, { recursive: true, force: true });
    await mkdir(temporary, { recursive: true });
    const source = existsSync(join(context.packageRoot, "Server~", "dist", "index.js"))
        ? join(context.packageRoot, "Server~", "dist", "index.js")
        : join(context.packageRoot, "Server~", "build", "index.js");
    await mkdir(join(temporary, "dist"), { recursive: true });
    await copyFile(source, join(temporary, "dist", "index.js"));
    await cp(join(context.packageRoot, "Server~", "catalogs"), join(temporary, "catalogs"), { recursive: true });
    await cp(join(context.packageRoot, "Server~", "schemas"), join(temporary, "schemas"), { recursive: true });
    await cp(join(context.packageRoot, "Documentation~"), join(temporary, "Documentation~"), { recursive: true });
    await mkdir(versions, { recursive: true });
    await mkdir(join(context.installRoot, "logs"), { recursive: true });
    await mkdir(join(context.installRoot, "backups"), { recursive: true });
    await mkdir(join(context.installRoot, "registrations"), { recursive: true });
    if (existsSync(target)) {
        const rollbackTarget = join(context.installRoot, "rollback", `${toolkitVersion}-${Date.now()}`);
        await mkdir(dirname(rollbackTarget), { recursive: true });
        await rename(target, rollbackTarget);
    }
    await rename(temporary, target);
    const bundleHash = createHash("sha256")
        .update(await readFile(join(target, "dist", "index.js")))
        .digest("hex");
    await atomicWrite(join(context.installRoot, "current.json"), JSON.stringify({
        version: toolkitVersion,
        serverPath: join(target, "dist", "index.js"),
        bundleHash,
        installedAt: new Date().toISOString(),
    }, null, 2) + "\n");
}
async function installSkill(context, force) {
    const source = join(context.packageRoot, "skills", "operate-unity-cli");
    const targets = [skillPath(context), ...skillMirrors(context)];
    const sourceHash = await directoryHash(source);
    for (const target of targets) {
        if (existsSync(target)) {
            const manifest = (await readJson(join(target, ".unigame-managed.json")));
            const currentHash = await directoryHash(target);
            if (!force &&
                (!manifest || (manifest.sourceHash && manifest.sourceHash !== currentHash)))
                throw new Error(`SKILL_CONFLICT:${target}`);
        }
        await rm(target, { recursive: true, force: true });
        await mkdir(dirname(target), { recursive: true });
        await cp(source, target, { recursive: true, filter: (entry) => !entry.endsWith(".meta") });
        await writeFile(join(target, ".unigame-managed.json"), JSON.stringify({
            package: "com.unigame.unitycli.mcp",
            version: toolkitVersion,
            sourceHash,
        }, null, 2));
    }
}
async function createBackup(context, paths) {
    const id = `${Date.now()}-${process.pid}`;
    const root = join(context.installRoot, "backups", id);
    const manifest = { id, files: [] };
    await mkdir(root, { recursive: true });
    for (let index = 0; index < paths.length; index++) {
        const source = paths[index];
        const backup = join(root, String(index));
        const existed = existsSync(source);
        if (existed)
            await cp(source, backup, { recursive: true });
        manifest.files.push({ source, backup, existed });
    }
    await writeFile(join(root, "manifest.json"), JSON.stringify(manifest, null, 2));
    return manifest;
}
async function rollback(context, request, response) {
    if (!request.confirm)
        throw new Error("CONFIRMATION_REQUIRED");
    if (!request.backupId)
        throw new Error("backupId is required");
    const manifest = await restoreBackup(context, request.backupId);
    response.backup = request.backupId;
    response.changes = manifest.files.map((file) => ({
        kind: "update",
        target: file.source,
        summary: "Restored from backup.",
    }));
    return response;
}
async function restoreBackup(context, backupId) {
    const root = join(context.installRoot, "backups", backupId);
    const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
    for (const file of manifest.files) {
        await rm(file.source, { recursive: true, force: true });
        if (file.existed) {
            await mkdir(dirname(file.source), { recursive: true });
            await cp(file.backup, file.source, { recursive: true });
        }
    }
    return manifest;
}
async function serve(context, request, response) {
    const state = (await readJson(statePath(context)));
    const leaseDirectory = join(context.installRoot, "broker-leases");
    const ownerPid = request.ownerPid ?? process.pid;
    const ownerStartedAtUtc = request.ownerStartedAtUtc ??
        (ownerPid === process.pid ? processStartedAtUtc() : null);
    const leaseId = (request.editorInstanceId ??
        (ownerPid === process.pid ? randomUUID() : ""))
        .replace(/[^a-zA-Z0-9._-]/g, "_");
    if (!leaseId)
        throw new Error("editorInstanceId is required for an external HTTP lease");
    if (!ownerStartedAtUtc)
        throw new Error("ownerStartedAtUtc is required for an external HTTP lease");
    const leasePath = join(leaseDirectory, `${leaseId}.json`);
    if (request.stop) {
        if (!request.confirm)
            throw new Error("CONFIRMATION_REQUIRED");
        await rm(leasePath, { force: true });
        response.data = {
            stopped: true,
            brokerStillRunning: Boolean(state?.pid && isAlive(state.pid)),
        };
        return response;
    }
    if (!request.confirm)
        throw new Error("CONFIRMATION_REQUIRED");
    await mkdir(leaseDirectory, { recursive: true });
    const leaseNow = new Date();
    await atomicWrite(leasePath, JSON.stringify({
        schema_version: 1,
        editor_instance_id: leaseId,
        owner_pid: ownerPid,
        owner_started_at_utc: ownerStartedAtUtc,
        heartbeat_at_utc: leaseNow.toISOString(),
        lease_expires_at_utc: new Date(leaseNow.getTime() + 10_000).toISOString(),
    }, null, 2) + "\n");
    if (state?.pid && isAlive(state.pid)) {
        response.data = { alreadyRunning: true, ...state };
        return response;
    }
    const lockPath = join(context.installRoot, "broker-start.lock");
    const lock = await acquireBrokerStartLock(lockPath, {
        ownerPid: process.pid,
        ownerStartedAtUtc: processStartedAtUtc(),
    });
    if (!lock) {
        for (let attempt = 0; attempt < 50; attempt++) {
            const current = await readJson(statePath(context));
            if (current?.pid && isAlive(current.pid)) {
                response.data = { alreadyRunning: true, ...current };
                return response;
            }
            await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
        }
        throw new Error("BROKER_START_IN_PROGRESS");
    }
    try {
        await installBundle(context);
        const tokenFile = join(context.installRoot, "http-token");
        await ensureToken(tokenFile);
        await mkdir(join(context.installRoot, "logs"), { recursive: true });
        const logPath = join(context.installRoot, "logs", `${context.serverName}.http.log`);
        const log = openSync(logPath, "a", 0o600);
        const child = spawn(process.execPath, [
            installedServer(context),
            "--transport",
            "http",
            "--port",
            String(request.port ?? 0),
            "--token-file",
            tokenFile,
            "--state-file",
            statePath(context),
            "--lease-dir",
            leaseDirectory,
            "--keep-alive",
            String(Boolean(request.keepAlive)),
        ], {
            detached: true,
            stdio: ["ignore", log, log],
            env: {
                ...process.env,
                UNIGAME_UNITYCLI_ROOT: join(context.installRoot, "versions", toolkitVersion),
                UNIGAME_UNITYCLI_DATA_PATH: context.dataPath,
            },
            shell: false,
        });
        closeSync(log);
        child.unref();
        response.changes.push({
            kind: "process",
            target: String(child.pid),
            summary: "Started loopback Streamable HTTP MCP server.",
        });
        response.data = { pid: child.pid, pendingHealth: true };
        for (let attempt = 0; attempt < 30; attempt++) {
            const current = await readJson(statePath(context));
            if (current) {
                response.data = { ...current, pendingHealth: false };
                break;
            }
            await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
        }
        return response;
    }
    finally {
        await releaseBrokerStartLock(lockPath, lock);
    }
}
async function health(context, response) {
    const state = (await readJson(statePath(context)));
    const serverExists = existsSync(installedServer(context));
    const agents = discoverAgents(context);
    const registry = await discoverEditors({ dataPath: context.dataPath });
    const leaseCounts = await brokerLeaseCounts(context);
    response.data = {
        ...response.data,
        serverExists,
        serverExecutable: serverExists && (await canRead(installedServer(context))),
        http: state ? { ...state, alive: Boolean(state.pid && isAlive(state.pid)) } : null,
        registrations: await Promise.all(agents.map(async (agent) => ({
            id: agent.id,
            configured: agent.configPath ? await containsManaged(agent, context) : false,
        }))),
        skillInstalled: existsSync(skillPath(context)),
        registry,
        ...leaseCounts,
    };
    response.ok = response.errors.length === 0;
    return response;
}
async function hasConflict(agent, context) {
    if (!agent.configPath || !existsSync(agent.configPath))
        return false;
    const text = await readText(agent.configPath);
    if (!text.includes(context.serverName))
        return false;
    return !(await containsManaged(agent, context));
}
async function containsManaged(agent, context) {
    const text = await readText(agent.configPath);
    if (!text.includes(context.serverName))
        return false;
    const marker = await readJson(registrationMarkerPath(context, agent.id));
    if (marker?.managedBy !== "com.unigame.unitycli.mcp" ||
        marker.serverName !== context.serverName ||
        typeof marker.fingerprint !== "string")
        return false;
    if (agent.format === "toml") {
        return managedTomlFingerprint(text, context.serverName) === marker.fingerprint;
    }
    try {
        const parsed = parseJsonc(text);
        const value = agent.format === "dxt"
            ? parsed.server
            : parsed[agent.key]?.[context.serverName];
        return value !== undefined && fingerprint(value) === marker.fingerprint;
    }
    catch {
        return false;
    }
}
function installedServer(context) {
    return join(context.installRoot, "versions", toolkitVersion, "dist", "index.js");
}
function statePath(context) {
    return join(context.installRoot, "http-state.json");
}
function skillPath(context) {
    return join(context.projectRoot, ".agents", "skills", "operate-unity-cli");
}
function skillMirrors(context) {
    return [
        join(context.projectRoot, ".cline", "skills", "operate-unity-cli"),
        join(context.projectRoot, ".claude", "skills", "operate-unity-cli"),
    ];
}
function registrationMarkerPath(context, agent) {
    return join(context.installRoot, "registrations", `${context.serverName}.${agent}.json`);
}
async function brokerLeaseCounts(context) {
    const directory = join(context.installRoot, "broker-leases");
    let entries;
    try {
        entries = await (await import("node:fs/promises")).readdir(directory, {
            withFileTypes: true,
        });
    }
    catch {
        return { live_lease_count: 0, lease_count: 0 };
    }
    const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json"));
    const live = await liveBrokerLeases(directory, { cleanupStale: false });
    return { live_lease_count: live.length, lease_count: files.length };
}
function legacyRegistrationMarkerPath(context, agent) {
    return join(context.installRoot, "registrations", `${context.legacyServerName}.${agent}.json`);
}
async function legacyRegistrationMarkerPaths(context, agent) {
    const directory = join(context.installRoot, "registrations");
    try {
        return (await (await import("node:fs/promises")).readdir(directory))
            .filter((file) => file.startsWith("unigameUnityCli_") &&
            file.endsWith(`.${agent}.json`))
            .map((file) => join(directory, file));
    }
    catch {
        return [legacyRegistrationMarkerPath(context, agent)];
    }
}
async function removeLegacyManagedRegistration(registration, context) {
    if (!registration.configPath)
        return false;
    const markerDirectory = join(context.installRoot, "registrations");
    let markerFiles;
    try {
        markerFiles = await (await import("node:fs/promises")).readdir(markerDirectory);
    }
    catch {
        return false;
    }
    let removed = false;
    for (const markerFile of markerFiles) {
        if (!markerFile.startsWith("unigameUnityCli_") ||
            !markerFile.endsWith(`.${registration.id}.json`))
            continue;
        const markerPath = join(markerDirectory, markerFile);
        const marker = await readJson(markerPath);
        const legacyName = marker?.serverName;
        if (marker?.managedBy !== "com.unigame.unitycli.mcp" ||
            !legacyName?.startsWith("unigameUnityCli_") ||
            typeof marker.fingerprint !== "string")
            continue;
        const text = await readText(registration.configPath);
        if (registration.format === "toml") {
            if (managedTomlFingerprint(text, legacyName) !== marker.fingerprint)
                continue;
            await atomicWrite(registration.configPath, patchManagedToml(text, legacyName, ""));
        }
        else if (registration.format === "json" || registration.format === "jsonc") {
            let value;
            try {
                const parsed = parseJsonc(text);
                value = parsed[registration.key]?.[legacyName];
            }
            catch {
                continue;
            }
            if (value === undefined || fingerprint(value) !== marker.fingerprint)
                continue;
            await atomicWrite(registration.configPath, patchServerJsonc(text, registration.key, legacyName, undefined));
        }
        else {
            continue;
        }
        await rm(markerPath, { force: true });
        removed = true;
    }
    return removed;
}
async function writeRegistrationMarker(registration, context, value) {
    const path = registrationMarkerPath(context, registration.id);
    if (!value) {
        await rm(path, { force: true });
        return;
    }
    await atomicWrite(path, JSON.stringify({
        managedBy: "com.unigame.unitycli.mcp",
        version: toolkitVersion,
        agent: registration.id,
        serverName: context.serverName,
        configPath: registration.configPath,
        fingerprint: fingerprint(value),
    }, null, 2) + "\n");
}
async function ensureToken(path) {
    if (existsSync(path))
        return;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, randomBytes(32).toString("base64url"), { mode: 0o600 });
}
async function atomicWrite(path, content) {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.tmp-${process.pid}`;
    await writeFile(temporary, content, "utf8");
    await rename(temporary, path);
}
async function readText(path) {
    try {
        return await readFile(path, "utf8");
    }
    catch {
        return "";
    }
}
async function readJson(path) {
    try {
        return JSON.parse(await readFile(path, "utf8"));
    }
    catch {
        return null;
    }
}
async function canRead(path) {
    try {
        await access(path, constants.R_OK);
        return true;
    }
    catch {
        return false;
    }
}
function isAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}
function processStartedAtUtc() {
    return new Date(Date.now() - process.uptime() * 1_000).toISOString();
}
function major() {
    return Number(process.versions.node.split(".")[0]);
}
async function directoryHash(root) {
    const hash = createHash("sha256");
    async function visit(path) {
        const details = await stat(path);
        if (details.isDirectory()) {
            const entries = (await import("node:fs/promises")).readdir(path, {
                withFileTypes: true,
            });
            for (const entry of (await entries).sort((left, right) => left.name.localeCompare(right.name))) {
                if (entry.name === ".unigame-managed.json" || entry.name.endsWith(".meta"))
                    continue;
                await visit(join(path, entry.name));
            }
            return;
        }
        hash.update(path.slice(root.length).replaceAll("\\", "/"));
        hash.update(await readFile(path));
    }
    await visit(root);
    return hash.digest("hex");
}
async function installedPipelineVersion(projectPath) {
    for (const file of [
        join(projectPath, "Packages", "packages-lock.json"),
        join(projectPath, "Packages", "manifest.json"),
    ]) {
        const value = await readJson(file);
        const dependencies = value?.dependencies;
        const pipeline = dependencies?.["com.unity.pipeline"];
        if (typeof pipeline === "string")
            return pipeline;
        if (pipeline?.version)
            return pipeline.version;
    }
    return null;
}
function baseResponse(operation) {
    return {
        ok: true,
        operation,
        changes: [],
        warnings: [],
        errors: [],
        backup: null,
        restartRequired: [],
        data: {},
    };
}
//# sourceMappingURL=manager.js.map