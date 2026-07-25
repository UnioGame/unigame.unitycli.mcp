import { spawn } from "node:child_process";
import type { ProcessResult } from "./types.js";

export interface RunProcessOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  signal?: AbortSignal;
  maxOutputBytes?: number;
}

export function runProcess(
  executable: string,
  args: string[],
  options: RunProcessOptions = {},
): Promise<ProcessResult> {
  const started = Date.now();
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxOutputBytes = options.maxOutputBytes ?? 1_000_000;

  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let settled = false;

    const append = (target: Buffer[], chunk: Buffer, isStdout: boolean) => {
      const current = isStdout ? stdoutBytes : stderrBytes;
      if (current >= maxOutputBytes) return;
      const remaining = maxOutputBytes - current;
      const kept = chunk.subarray(0, remaining);
      target.push(kept);
      if (isStdout) stdoutBytes += kept.length;
      else stderrBytes += kept.length;
    };

    child.stdout.on("data", (chunk: Buffer) => append(stdout, chunk, true));
    child.stderr.on("data", (chunk: Buffer) => append(stderr, chunk, false));

    const terminate = () => {
      if (!child.killed) child.kill();
    };
    const abort = () => terminate();
    options.signal?.addEventListener("abort", abort, { once: true });

    const timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, timeoutMs);

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      reject(error);
    });

    child.on("close", (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      resolve({
        exitCode,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        timedOut,
        durationMs: Date.now() - started,
      });
    });
  });
}
