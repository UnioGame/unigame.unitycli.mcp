import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { isSecretParameter } from "./secrets.js";
const catalogDirectory = join(dirname(fileURLToPath(import.meta.url)), "..", "catalogs");
const catalogFiles = [
    "unity-cli-1.0.0-beta.2.json",
    "pipeline-editor-0.4.0-exp.1-6000.3.14f1.json",
    "pipeline-player-0.4.0-exp.1-6000.3.14f1.json",
];
export async function loadCatalogs() {
    return Promise.all(catalogFiles.map(async (file) => JSON.parse(await readFile(join(catalogDirectory, file), "utf8"))));
}
export function normalizeToolName(value) {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
}
function parameterSchema(parameter) {
    const description = parameter.description || parameter.name;
    if (isSecretParameter(parameter.name)) {
        return {
            type: "string",
            pattern: "^(env|file):",
            description: `${description} Pass an env:VARIABLE or file:/protected/path reference; direct secret values are rejected.`,
        };
    }
    const type = parameter.type.toLowerCase();
    if (type.includes("[][]")) {
        const scalarType = type.includes("int") ? "integer" :
            type.includes("single") || type.includes("float") || type.includes("double") ? "number" :
                "string";
        return {
            type: "array",
            items: {
                type: "array",
                items: { type: scalarType },
            },
            description,
        };
    }
    if (parameter.multiple || parameter.type.endsWith("[]")) {
        const scalarType = type.includes("int") ? "integer" :
            type.includes("single") || type.includes("float") || type.includes("double") ? "number" :
                type.includes("bool") ? "boolean" :
                    "string";
        return {
            type: "array",
            items: { type: scalarType },
            description,
        };
    }
    if (type.includes("bool"))
        return { type: "boolean", description };
    if (type.includes("int") || type.includes("number")) {
        return { type: "integer", description };
    }
    if (type.includes("float") || type.includes("double")) {
        return { type: "number", description };
    }
    if (type.includes("object") || type.includes("json")) {
        return {
            description,
            oneOf: [
                { type: "object", additionalProperties: true },
                { type: "array", items: {} },
                { type: "string" },
            ],
        };
    }
    return { type: "string", description };
}
export function inputSchema(tool) {
    const properties = {};
    const required = [];
    for (const parameter of tool.parameters) {
        properties[parameter.name] = parameterSchema(parameter);
        if (parameter.required)
            required.push(parameter.name);
    }
    if (tool.source === "editor" && !properties.projectPath) {
        properties.projectPath = {
            type: "string",
            description: "Absolute Unity project path. Defaults to UNITY_PROJECT_PATH.",
        };
    }
    if (tool.source === "player") {
        properties.runtimePath = {
            type: "string",
            description: "Directory containing .unity-pipeline-runtime-port.",
        };
        properties.runtime = {
            type: "string",
            description: "Player process/runtime selector used by Unity CLI.",
        };
    }
    properties.timeoutMs = {
        type: "integer",
        minimum: 100,
        maximum: 3_600_000,
        description: "Toolkit process timeout in milliseconds.",
        default: 30_000,
    };
    if (!properties.confirm) {
        properties.confirm = {
            type: "boolean",
            description: "Acknowledge a high-risk operation.",
            default: false,
        };
    }
    properties.extraArgs = {
        type: "array",
        items: { type: "string" },
        description: "Additional upstream CLI arguments for additive compatibility.",
    };
    properties.includeLogs = {
        type: "boolean",
        description: "Include bounded and sanitized stdout/stderr.",
        default: false,
    };
    return {
        type: "object",
        properties,
        additionalProperties: false,
        ...(required.length ? { required } : {}),
    };
}
async function executableExists(path) {
    try {
        await access(path, constants.X_OK);
        return true;
    }
    catch {
        return false;
    }
}
export async function resolveUnityCli() {
    const executable = process.platform === "win32" ? "unity.exe" : "unity";
    const candidates = [
        process.env.UNITY_CLI_PATH,
        ...(process.env.PATH ?? "")
            .split(delimiter)
            .filter(Boolean)
            .map((path) => join(path, executable)),
    ];
    if (process.platform === "win32") {
        candidates.push(join(process.env.LOCALAPPDATA ?? "", "Unity", "bin", "unity.exe"));
    }
    else {
        candidates.push(join(process.env.HOME ?? "", ".local", "bin", "unity"), "/usr/local/bin/unity", "/opt/unity/bin/unity");
    }
    for (const candidate of candidates.filter((value) => Boolean(value))) {
        if (await executableExists(candidate))
            return candidate;
        if (process.platform === "win32" && !extname(candidate)) {
            const withExtension = `${candidate}.exe`;
            if (await executableExists(withExtension))
                return withExtension;
        }
    }
    return null;
}
//# sourceMappingURL=catalog.js.map