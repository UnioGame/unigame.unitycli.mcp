import type { CatalogParameter, CatalogTool } from "./types.js";

const metaNames = new Set([
  "projectPath",
  "project_path",
  "project_id",
  "editor_instance_id",
  "runtimePath",
  "runtime",
  "timeoutMs",
  "confirm",
  "extraArgs",
  "includeLogs",
]);

function serialize(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function appendParameter(
  result: string[],
  source: CatalogTool["source"],
  parameter: CatalogParameter,
  value: unknown,
): void {
  if (value === undefined || value === null || metaNames.has(parameter.name)) return;
  if (parameter.positional) {
    if (Array.isArray(value)) result.push(...value.map(serialize));
    else result.push(serialize(value));
    return;
  }

  const option = parameter.cliName ?? `--${parameter.name}`;
  if (typeof value === "boolean") {
    if (value) result.push(option);
    return;
  }
  if (
    Array.isArray(value) &&
    parameter.multiple &&
    source === "cli" &&
    !parameter.type.includes("[][]")
  ) {
    for (const entry of value) result.push(option, serialize(entry));
    return;
  }
  result.push(option, serialize(value));
}

export function buildArguments(
  tool: CatalogTool,
  input: Record<string, unknown>,
): { args: string[]; target: string | null } {
  const args: string[] = [];
  let target: string | null = null;

  if (tool.source === "cli") {
    args.push(...tool.command);
  } else if (tool.source === "editor") {
    target =
      (input.project_path as string | undefined) ??
      (input.projectPath as string | undefined) ??
      process.env.UNITY_PROJECT_PATH ??
      null;
    args.push("command");
    if (target) args.push("--project-path", target);
    args.push("--format", "json", tool.name);
  } else if (tool.source === "player") {
    target =
      (input.runtimePath as string | undefined) ??
      (input.runtime as string | undefined) ??
      process.env.UNITY_RUNTIME_PATH ??
      null;
    args.push("command");
    if (input.runtimePath ?? process.env.UNITY_RUNTIME_PATH) {
      args.push("--runtime-path", String(input.runtimePath ?? process.env.UNITY_RUNTIME_PATH));
    } else if (input.runtime) {
      args.push("--runtime", String(input.runtime));
    }
    args.push("--format", "json", tool.name);
  }

  for (const parameter of tool.parameters) {
    appendParameter(args, tool.source, parameter, input[parameter.name]);
  }

  if (tool.source === "cli") {
    args.push("--format", "json", "--non-interactive");
  }
  if (Array.isArray(input.extraArgs)) {
    args.push(...input.extraArgs.map(String));
  }
  return { args, target };
}
