#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const commandPaths = `
analytics
analytics opt-in
analytics opt-out
analytics status
auth
auth login
auth logout
auth status
bug
build
cache
cache clean
cache info
changelog
cloud
cloud org
cloud org clear-default
cloud org current
cloud org list
cloud org set-default
cloud project
cloud project list
cloud status
command
completion
config
config proxy
config update-check
diagnose
diagnose proxy
doctor
editor
editor add
editor module
editor module add
editor module list
editor module refresh
editors
editors add
editors default
editors info
editors install-path
editors list
editors module
editors module add
editors module list
editors module refresh
editors path
editors upgrade
env
hub
hub install
install
install-modules
install-path
language
license
license activate
license list
license return
license server
license server list
license server status
license status
list
logs
mcp
mcp configure
modules
modules list
open
pipeline
pipeline install
pipeline list
pipeline list-versions
pipeline upgrade
projects
projects add
projects clone
projects create
projects export
projects import
projects info
projects link
projects link cloud
projects link vcs
projects list
projects new
projects open
projects pin
projects remove
projects require
projects unlink
projects unlink cloud
projects unlink vcs
projects unpin
projects upgrade
releases
run
self-uninstall
shell
status
templates
templates create
templates delete
templates edit
templates info
templates list
templates location
test
uninstall
upgrade
`
  .trim()
  .split("\n");

const dangerousCli = new Set([
  "auth logout",
  "build",
  "cache clean",
  "cloud org clear-default",
  "cloud org set-default",
  "config proxy",
  "config update-check",
  "editor module add",
  "editor module refresh",
  "editors add",
  "editors default",
  "editors module add",
  "editors module refresh",
  "editors upgrade",
  "hub install",
  "install",
  "install-modules",
  "license activate",
  "license return",
  "license server",
  "mcp configure",
  "pipeline install",
  "pipeline upgrade",
  "projects clone",
  "projects create",
  "projects export",
  "projects import",
  "projects link",
  "projects link cloud",
  "projects link vcs",
  "projects new",
  "projects open",
  "projects remove",
  "projects unlink",
  "projects unlink cloud",
  "projects unlink vcs",
  "projects upgrade",
  "run",
  "self-uninstall",
  "shell",
  "templates create",
  "templates delete",
  "templates edit",
  "uninstall",
  "upgrade",
]);

const dangerousPipeline = /^(apply_|bake_|build$|cancel_|clear_|create_|delete_|editor_(play|pause|stop)|eval|import_|instantiate_|menu$|move_|package_|recompile$|reload_|remove_|rename_|revert_|run_tests$|save_|set_|switch_|unpack_|write_|quit$|cleanup_)/;

function optionName(value) {
  return value.replace(/^--/, "").replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function toolName(source, name) {
  return `unity_${source}_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}`;
}

function inferType(placeholder, description) {
  const value = `${placeholder ?? ""} ${description}`.toLowerCase();
  if (/number|seconds|timeout|port|count|limit/.test(value)) return "int";
  return "string";
}

function parseHelp(path, help) {
  const lines = help.split(/\r?\n/);
  const usage = lines.find((line) => line.startsWith("Usage:")) ?? "";
  const description = lines
    .slice(lines.findIndex((line) => line.startsWith("Usage:")) + 1)
    .map((line) => line.trim())
    .find((line) => line && !/^(Arguments|Options|Commands|Subcommands|Global Options):$/.test(line));
  const parameters = [];
  let section = "";

  for (const line of lines) {
    const heading = line.match(/^(Arguments|Options|Global Options):$/);
    if (heading) {
      section = heading[1];
      continue;
    }
    if (/^(Commands|Subcommands|Examples|Supported clients):$/.test(line)) {
      section = "";
      continue;
    }
    if (section === "Arguments") {
      const match = line.match(/^\s{2}([A-Za-z][A-Za-z0-9_-]*)(?:\s{2,})(.+)$/);
      if (!match) continue;
      const name = match[1];
      const multiple = usage.includes(`<${name}...>`) || usage.includes(`[${name}...]`);
      const required = usage.includes(`<${name}`) && !usage.includes(`[${name}`);
      parameters.push({
        name,
        type: multiple ? "string[]" : "string",
        description: match[2].trim(),
        required,
        positional: true,
        multiple,
      });
    }
    if (section === "Options" || section === "Global Options") {
      const match = line.match(
        /^\s{2}(?:(?:-[A-Za-z0-9],\s*)?)(--[A-Za-z0-9][A-Za-z0-9-]*)(?:\s+<([^>]+)>)?\s{2,}(.+)$/,
      );
      if (!match) continue;
      const [, cliName, placeholder, details] = match;
      if (["--help", "--version", "--format", "--non-interactive"].includes(cliName)) continue;
      const name = optionName(cliName);
      if (parameters.some((parameter) => parameter.name === name)) continue;
      parameters.push({
        name,
        cliName,
        type: placeholder ? inferType(placeholder, details) : "bool",
        description: details.trim(),
        required: false,
        positional: false,
        multiple: /multiple|one or more|accepts.*values/i.test(details),
      });
    }
  }

  return {
    name: path,
    toolName: toolName("cli", path),
    description: description ?? `Run unity ${path}.`,
    source: "cli",
    command: path.split(" "),
    dangerous: dangerousCli.has(path),
    parameters,
  };
}

function run(executable, args, timeoutMs = 12_000) {
  return new Promise((resolve) => {
    const child = spawn(executable, args, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ exitCode: null, stdout: "", stderr: error.message, timedOut });
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({
        exitCode,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        timedOut,
      });
    });
  });
}

async function parallelMap(values, concurrency, handler) {
  const result = new Array(values.length);
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor++;
      result[index] = await handler(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return result;
}

function transformPipeline(source, name, description, parameters) {
  return {
    name,
    toolName: toolName(source, name),
    description,
    source,
    command: [name],
    dangerous: dangerousPipeline.test(name),
    parameters: parameters.map((parameter) => ({
      name: parameter.name,
      type: parameter.type,
      description: parameter.description ?? parameter.name,
      required: Boolean(parameter.required),
      default: parameter.default,
      positional: false,
      multiple: String(parameter.type).endsWith("[]"),
    })),
  };
}

const runtimeTools = [
  ["eval", "Evaluate C# code dynamically using Roslyn compiler", [["code", "string", true], ["timeout", "int", false]]],
  ["eval_file", "Evaluate C# code read from a .cs file on disk", [["file", "string", true], ["timeout", "int", false]]],
  ["console", "Get captured Unity console output", [["tail", "int", false], ["level", "string", false], ["since", "long", false]]],
  ["reload_file_override", "Compile and apply hot reload file changes immediately", [["filename", "string", true], ["timeout", "int", false], ["assemblyDir", "string", false]]],
  ["reload_file", "Compile and apply in-place [HotReload] edits", [["filename", "string", true], ["timeout", "int", false], ["assemblyDir", "string", false], ["pdb", "bool", false]]],
  ["cleanup_hotreload", "Remove old hot reload DLL versions and clear registry", [["assemblyDir", "string", true], ["force_domain_reload", "bool", false]]],
  ["hotreload_status", "Show current hot reload registry status and statistics", []],
  ["quit", "Gracefully quit the Unity application", [["exitCode", "int", false]]],
  ["set_target_framerate", "Set the target frame rate", [["frameRate", "int", true]]],
  ["set_timescale", "Set the time scale", [["scale", "float", true]]],
  ["simulate_key", "Simulate an Input System keyboard event", [["key", "string", true], ["action", "string", false]]],
  ["simulate_pointer", "Simulate an Input System pointer event", [["x", "float", true], ["y", "float", true], ["action", "string", false], ["button", "string", false]]],
  ["log", "Write a message to the Unity console", [["message", "string", true], ["level", "string", false]]],
  ["runtime_status", "Get comprehensive runtime application status", []],
];

function parseArgs() {
  const result = {
    cli: process.env.UNITY_CLI_PATH || (process.platform === "win32" ? join(process.env.LOCALAPPDATA ?? "", "Unity", "bin", "unity.exe") : "unity"),
    editorProject: null,
    runtimePath: null,
  };
  for (let index = 2; index < process.argv.length; index += 1) {
    if (process.argv[index] === "--cli") result.cli = process.argv[++index];
    else if (process.argv[index] === "--editor-project") result.editorProject = process.argv[++index];
    else if (process.argv[index] === "--runtime-path") result.runtimePath = process.argv[++index];
  }
  return result;
}

const options = parseArgs();
const serverRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const catalogDirectory = join(serverRoot, "catalogs");
await mkdir(catalogDirectory, { recursive: true });

const cliTools = await parallelMap(commandPaths, 8, async (path) => {
  const response = await run(options.cli, [...path.split(" "), "--help"]);
  if (response.timedOut || response.exitCode !== 0) {
    return {
      name: path,
      toolName: toolName("cli", path),
      description: `Run unity ${path}. Help was unavailable during snapshot generation.`,
      source: "cli",
      command: path.split(" "),
      dangerous: dangerousCli.has(path),
      parameters: [],
    };
  }
  return parseHelp(path, response.stdout || response.stderr);
});

const cliCatalog = {
  schemaVersion: 1,
  source: "cli",
  productVersion: "1.0.0-beta.2",
  generatedAt: new Date().toISOString(),
  tools: cliTools,
};
await writeFile(
  join(catalogDirectory, "unity-cli-1.0.0-beta.2.json"),
  `${JSON.stringify(cliCatalog, null, 2)}\n`,
);

const runtimeCatalog = {
  schemaVersion: 1,
  source: "player",
  productVersion: "0.4.0-exp.1",
  editorVersion: "6000.3.14f1",
  generatedAt: new Date().toISOString(),
  tools: runtimeTools.map(([name, description, parameters]) =>
    transformPipeline(
      "player",
      name,
      description,
      parameters.map(([parameterName, type, required]) => ({
        name: parameterName,
        type,
        required,
        description: parameterName,
      })),
    ),
  ),
};
await writeFile(
  join(catalogDirectory, "pipeline-player-0.4.0-exp.1-6000.3.14f1.json"),
  `${JSON.stringify(runtimeCatalog, null, 2)}\n`,
);

if (options.editorProject) {
  const response = await run(
    options.cli,
    ["list", "--project-path", options.editorProject, "--format", "json"],
    30_000,
  );
  if (response.exitCode !== 0) {
    throw new Error(`Unable to read Editor catalog: ${response.stderr || response.stdout}`);
  }
  const parsed = JSON.parse(response.stdout);
  const tools = parsed.data?.tools ?? parsed.tools;
  const editorCatalog = {
    schemaVersion: 1,
    source: "editor",
    productVersion: "0.4.0-exp.1",
    editorVersion: "6000.3.14f1",
    generatedAt: new Date().toISOString(),
    tools: tools.map((tool) =>
      transformPipeline("editor", tool.name, tool.description, tool.parameters ?? []),
    ),
  };
  await writeFile(
    join(catalogDirectory, "pipeline-editor-0.4.0-exp.1-6000.3.14f1.json"),
    `${JSON.stringify(editorCatalog, null, 2)}\n`,
  );
}

console.log(
  JSON.stringify(
    {
      cli: cliCatalog.tools.length,
      editor: options.editorProject ? "generated" : "skipped",
      player: runtimeCatalog.tools.length,
      output: catalogDirectory,
    },
    null,
    2,
  ),
);
