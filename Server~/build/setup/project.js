import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
export const toolkitVersion = "0.1.0";
export function findProjectRoot(projectPath) {
    const unityProject = resolve(projectPath);
    let current = unityProject;
    while (true) {
        if (existsSync(join(current, ".git")))
            return current;
        const parent = dirname(current);
        if (parent === current)
            return unityProject;
        current = parent;
    }
}
export function projectServerName(projectPath) {
    const normalized = resolve(projectPath).replaceAll("\\", "/").toLowerCase();
    const slug = resolve(projectPath)
        .split(/[\\/]/)
        .filter(Boolean)
        .at(-1)
        ?.replace(/[^a-zA-Z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 32) || "UnityProject";
    const hash = createHash("sha256").update(normalized).digest("hex").slice(0, 8);
    return `unigameUnityCli_${slug}_${hash}`;
}
export function createContext(request) {
    if (!request.projectPath)
        throw new Error("projectPath is required");
    if (!request.packageRoot)
        throw new Error("packageRoot is required");
    const projectPath = resolve(request.projectPath);
    const homePath = resolve(request.homePath ?? homedir());
    const dataPath = resolve(request.dataPath ??
        (process.platform === "win32"
            ? join(process.env.LOCALAPPDATA ?? homePath, "UniGame")
            : join(homePath, ".local", "share", "unigame")));
    return {
        projectPath,
        projectRoot: findProjectRoot(projectPath),
        packageRoot: resolve(request.packageRoot),
        homePath,
        dataPath,
        installRoot: join(dataPath, "unity-cli-mcp"),
        serverName: projectServerName(projectPath),
    };
}
//# sourceMappingURL=project.js.map