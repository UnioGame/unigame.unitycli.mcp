#!/usr/bin/env node

import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, join } from "node:path";
import { spawn } from "node:child_process";
import process from "node:process";

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length
    ? process.argv[index + 1]
    : fallback;
}

async function exists(path) {
  if (!path) return false;
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function candidates() {
  const executable = process.platform === "win32" ? "unity.exe" : "unity";
  const pathCandidates = (process.env.PATH ?? "")
    .split(delimiter)
    .filter(Boolean)
    .map((entry) => join(entry, executable));

  if (process.platform === "win32") {
    pathCandidates.push(
      join(process.env.LOCALAPPDATA ?? "", "Unity", "bin", "unity.exe"),
    );
  } else {
    pathCandidates.push(
      join(process.env.HOME ?? "", ".local", "bin", "unity"),
      "/usr/local/bin/unity",
      "/opt/unity/bin/unity",
    );
  }

  return [process.env.UNITY_CLI_PATH, ...pathCandidates].filter(Boolean);
}

async function resolveCli() {
  const explicitArgument = option("--cli");
  if (await exists(explicitArgument)) return explicitArgument;
  for (const candidate of candidates()) {
    if (await exists(candidate)) return candidate;
  }
  return null;
}

function run(executable, args, timeoutMs = 10_000) {
  return new Promise((resolve) => {
    const child = spawn(executable, args, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ exitCode: null, stdout: "", stderr: error.message });
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({
        exitCode,
        stdout: Buffer.concat(stdout).toString("utf8").trim(),
        stderr: Buffer.concat(stderr).toString("utf8").trim(),
      });
    });
  });
}

const cliPath = await resolveCli();
const result = {
  platform: process.platform,
  architecture: process.arch,
  node: process.version,
  cliPath,
  cliVersion: null,
  projectPath: option("--project", process.env.UNITY_PROJECT_PATH ?? null),
  projectVersion: null,
};

if (cliPath) {
  const version = await run(cliPath, ["--version"]);
  result.cliVersion = version.exitCode === 0 ? version.stdout : null;
}

if (result.projectPath) {
  try {
    const versionText = await readFile(
      join(result.projectPath, "ProjectSettings", "ProjectVersion.txt"),
      "utf8",
    );
    result.projectVersion =
      versionText.match(/^m_EditorVersion:\s*(.+)$/m)?.[1] ?? null;
  } catch {
    result.projectVersion = null;
  }
}

console.log(JSON.stringify(result, null, 2));
process.exitCode = cliPath ? 0 : 2;
