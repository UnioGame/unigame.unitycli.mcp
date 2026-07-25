import { describe, expect, it } from "vitest";
import process from "node:process";
import { runProcess } from "../src/process.js";

describe("runProcess", () => {
  it("captures stdout and exit code", async () => {
    const result = await runProcess(process.execPath, [
      "-e",
      'process.stdout.write("ok")',
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("ok");
    expect(result.timedOut).toBe(false);
  });

  it("terminates after a timeout", async () => {
    const result = await runProcess(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      { timeoutMs: 100 },
    );
    expect(result.timedOut).toBe(true);
  });

  it("terminates when an MCP cancellation signal aborts", async () => {
    const controller = new AbortController();
    const pending = runProcess(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      { timeoutMs: 10_000, signal: controller.signal },
    );
    setTimeout(() => controller.abort(), 100);
    const result = await pending;
    expect(result.timedOut).toBe(false);
    expect(result.signal ?? result.exitCode).not.toBe(0);
  });
});
