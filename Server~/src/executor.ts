import { buildArguments } from "./arguments.js";
import { resolveUnityCli } from "./catalog.js";
import { disconnectedTargetCode } from "./compatibility.js";
import { ToolkitError } from "./errors.js";
import { parseMixedOutput } from "./output.js";
import { runProcess } from "./process.js";
import { redact } from "./redaction.js";
import { requireConfirmation } from "./safety.js";
import { resolveSecretInputs } from "./secrets.js";
import type { CatalogTool, ToolkitResult } from "./types.js";

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

function connectionFailure(tool: CatalogTool, text: string): ToolkitError | null {
  const code = disconnectedTargetCode(tool.source, text);
  if (code === "EDITOR_NOT_CONNECTED") {
    return new ToolkitError(
      "EDITOR_NOT_CONNECTED",
      "No ready Pipeline Editor matched the requested project. Open the project, install Pipeline, and wait for unity status to report ready.",
    );
  }
  if (code === "PLAYER_NOT_CONNECTED") {
    return new ToolkitError(
      "PLAYER_NOT_CONNECTED",
      "No Pipeline Development Player matched the runtime selector.",
    );
  }
  return null;
}

export async function executeCatalogTool(
  tool: CatalogTool,
  input: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<ToolkitResult> {
  requireConfirmation(tool, input);
  const resolvedInput = await resolveSecretInputs(tool, input);
  const cli = await resolveUnityCli();
  if (!cli) {
    throw new ToolkitError(
      "CLI_NOT_FOUND",
      "Unity CLI was not found. Set UNITY_CLI_PATH or install the official CLI.",
    );
  }

  const { args, target } = buildArguments(tool, resolvedInput);
  let processResult;
  try {
    processResult = await runProcess(cli, args, {
      timeoutMs: Number(input.timeoutMs ?? 30_000),
      signal,
      cwd: target ?? undefined,
    });
  } catch (error) {
    throw new ToolkitError(
      "UPSTREAM_FAILED",
      error instanceof Error ? error.message : String(error),
    );
  }

  if (processResult.timedOut) {
    throw new ToolkitError(
      "TIMEOUT",
      `${tool.toolName} exceeded its ${input.timeoutMs ?? 30_000} ms timeout.`,
    );
  }

  const parsed = parseMixedOutput(processResult.stdout);
  const upstream = parsed.data as
    | { success?: boolean; data?: unknown; warnings?: unknown; errors?: unknown }
    | null;
  const ok =
    processResult.exitCode === 0 &&
    (!upstream || typeof upstream !== "object" || upstream.success !== false);

  if (!ok) {
    const combined = `${processResult.stderr}\n${processResult.stdout}`;
    const connection = connectionFailure(tool, combined);
    if (connection) throw connection;
  }

  const result: ToolkitResult = {
    ok,
    source: tool.source,
    command: tool.name,
    target,
    exitCode: processResult.exitCode,
    data: upstream && "data" in upstream ? upstream.data : parsed.data,
    warnings: arrayValue(upstream?.warnings),
    errors: arrayValue(upstream?.errors),
    durationMs: processResult.durationMs,
  };

  if (!ok && result.errors.length === 0) {
    result.errors.push({
      code: parsed.validJson ? "UPSTREAM_FAILED" : "INVALID_OUTPUT",
      message: redact(processResult.stderr || parsed.text || "Unity CLI failed."),
    });
  }

  if (input.includeLogs === true) {
    result.logs = {
      ...(processResult.stdout ? { stdout: redact(processResult.stdout) } : {}),
      ...(processResult.stderr ? { stderr: redact(processResult.stderr) } : {}),
    };
  }
  return result;
}
