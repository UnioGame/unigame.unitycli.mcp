import { readFile } from "node:fs/promises";
import { ToolkitError } from "./errors.js";
import type { CatalogTool } from "./types.js";

const secretName =
  /(?:clientsecret|gittoken|password|serial|keystorebase64)$/i;

export function isSecretParameter(name: string): boolean {
  return secretName.test(name) && !/stdin$/i.test(name);
}

async function resolveReference(value: unknown, name: string): Promise<string> {
  if (typeof value !== "string") {
    throw new ToolkitError(
      "UPSTREAM_FAILED",
      `${name} accepts only env:VARIABLE or file:/protected/path references.`,
    );
  }
  if (value.startsWith("env:")) {
    const variable = value.slice(4);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(variable)) {
      throw new ToolkitError("UPSTREAM_FAILED", `Invalid environment variable name for ${name}.`);
    }
    const resolved = process.env[variable];
    if (resolved === undefined) {
      throw new ToolkitError("UPSTREAM_FAILED", `Environment variable ${variable} is not set.`);
    }
    return resolved;
  }
  if (value.startsWith("file:")) {
    const path = value.slice(5);
    if (!path) {
      throw new ToolkitError("UPSTREAM_FAILED", `Protected file path is missing for ${name}.`);
    }
    return (await readFile(path, "utf8")).trimEnd();
  }
  throw new ToolkitError(
    "UPSTREAM_FAILED",
    `${name} rejects direct secret values; use env:VARIABLE or file:/protected/path.`,
  );
}

export async function resolveSecretInputs(
  tool: CatalogTool,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result = { ...input };
  for (const parameter of tool.parameters) {
    if (!isSecretParameter(parameter.name) || result[parameter.name] == null) continue;
    result[parameter.name] = await resolveReference(
      result[parameter.name],
      parameter.name,
    );
  }
  return result;
}
