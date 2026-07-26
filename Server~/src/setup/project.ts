import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { SetupContext, SetupRequest } from "./types.js";

export const toolkitVersion = "0.1.0";

export function findProjectRoot(projectPath: string): string {
  const unityProject = resolve(projectPath);
  let current = unityProject;
  while (true) {
    if (
      existsSync(join(current, ".git")) ||
      existsSync(join(current, ".agents"))
    )
      return current;
    const parent = dirname(current);
    if (parent === current) return unityProject;
    current = parent;
  }
}

export function projectServerName(projectPath: string): string {
  const absolute = resolve(projectPath);
  const normalized = absolute.replaceAll("\\", "/").toLowerCase();
  const slug =
    absolute
      .split(/[\\/]/)
      .filter(Boolean)
      .at(-1)
      ?.toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "unity_project";
  const hash = createHash("sha256").update(normalized).digest("hex").slice(0, 8);
  return `unigame_unity_cli_${slug}_${hash}`;
}

export function createContext(request: SetupRequest): SetupContext {
  if (!request.project_path) throw new Error("project_path is required");
  if (!request.package_root) throw new Error("package_root is required");
  const project_path = resolve(request.project_path);
  const home_path = resolve(request.home_path ?? homedir());
  const data_path = resolve(
    request.data_path ??
      (process.platform === "win32"
        ? join(process.env.LOCALAPPDATA ?? home_path, "UniGame")
        : join(home_path, ".local", "share", "unigame")),
  );
  return {
    project_path,
    project_root: findProjectRoot(project_path),
    package_root: resolve(request.package_root),
    home_path,
    data_path,
    install_root: join(data_path, "unity-cli-mcp"),
    registration_name: projectServerName(project_path),
  };
}
