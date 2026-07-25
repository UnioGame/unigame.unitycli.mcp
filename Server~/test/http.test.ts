import { afterEach, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const children: ChildProcess[] = [];
const directories: string[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) child.kill();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

describe("Streamable HTTP lifecycle", () => {
  it("binds loopback, protects health, and emits an ownership record", async () => {
    const directory = await mkdtemp(join(tmpdir(), "unigame-http-"));
    directories.push(directory);
    const tokenFile = join(directory, "token");
    const stateFile = join(directory, "state.json");
    await writeFile(tokenFile, "test-capability");
    const child = spawn(
      process.execPath,
      [
        resolve("dist/index.js"),
        "--transport",
        "http",
        "--port",
        "0",
        "--token-file",
        tokenFile,
        "--state-file",
        stateFile,
      ],
      { stdio: "ignore", shell: false },
    );
    children.push(child);
    const state = await waitForState(stateFile);
    const unauthorized = await fetch(`http://127.0.0.1:${state.port}/health`);
    expect(unauthorized.status).toBe(401);
    const health = await fetch(`http://127.0.0.1:${state.port}/health`, {
      headers: { Authorization: `Bearer file:${tokenFile}` },
    });
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true, transport: "http" });
  }, 15_000);
});

async function waitForState(path: string): Promise<{ port: number }> {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      return JSON.parse(await readFile(path, "utf8")) as { port: number };
    } catch {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    }
  }
  throw new Error("HTTP state file was not created");
}
