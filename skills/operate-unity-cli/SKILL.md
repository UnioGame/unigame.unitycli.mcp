---
name: operate-unity-cli
description: Operate Unity installations, projects, batch jobs, running Editors, and Development Players through Unity CLI, Unity Pipeline, or the bundled MCP server. Use when an agent needs to install or diagnose Unity CLI, manage Editors and modules, create or open projects, configure Pipeline or MCP, edit scenes/GameObjects/prefabs/assets, compile scripts, run EditMode or PlayMode tests, build Players, or control an instrumented Development Player.
---

# Operate Unity CLI

## Overview

Use the narrowest Unity CLI mode that can complete the task. Discover the
installed version and live command schemas before mutating a project because
both Unity CLI and Pipeline are experimental.

## Start every task

1. Resolve the executable with `node scripts/probe-environment.mjs`.
2. Run `unity --version`, `unity --help`, and the relevant nested `--help`.
3. Identify the target project and its `ProjectVersion.txt`.
4. Choose standalone CLI, batch Editor, Pipeline Editor, or Pipeline Player.
5. Prefer `--format json`, `--non-interactive`, explicit timeouts, and absolute
   project paths in automation.
6. Inspect the result and exit code before continuing to the next mutation.

Use standalone CLI for installs, projects, auth, licensing, configuration,
Cloud/VCS, and discovery. Use batch Editor for `run`, top-level `test`, and
top-level `build`. Use Pipeline Editor for authoring, compilation, tests, and
its built-in build. Use Pipeline Player only for an opted-in standalone
Development Build.

## Bootstrap Unity CLI

Follow Unity's current installation instructions instead of embedding an
installer URL permanently. Verify with:

```sh
unity --version
unity doctor --format json
unity auth status --format json
unity editors list --format json
```

If `unity` is absent from `PATH`, use `UNITY_CLI_PATH` or the absolute path
reported by `scripts/probe-environment.mjs`. Do not change PATH without the
user's authorization.

## Prepare a project for Pipeline

1. Require Unity 6 or newer.
2. Open the intended project, or pass its absolute path explicitly.
3. Run `unity pipeline install --project-path <project>` only when the package
   is missing and project mutation is authorized.
4. Wait for compilation, then verify `unity status` reports `ready`.
5. Read the actual catalog with `unity list --project-path <project>
   --format json`.
6. Invoke built-ins with named options:

```sh
unity command --project-path <project> create_scene \
  --path Assets/Automation/Scene.unity --confirm true
unity command --project-path <project> save_scene --confirm true
```

Never pass `name=value` in place of `--name value`.

## Use the bundled MCP server

Prefer `UniGame/Unity CLI MCP`: verify the environment, select agents, keep
stdio and the project-local skill enabled, then choose **Review Configuration**.
Inspect the inline plan and use **Apply Configuration** only after
authorization. The guided screen installs the self-contained server, creates
private project-pinned registrations, and installs this skill locally.

Use **Advanced** only for optional loopback HTTP, managed removal, rollback, or
sanitized diagnostics. A normal reviewed Apply repairs missing managed state;
force appears only when the plan detects a same-name conflict.

For standalone use, launch `Server~/dist/index.js` with Node. Configure `UNITY_PROJECT_PATH` for
an Editor target or provide `projectPath` on each `unity_editor_*` call. The
server exposes `unity_cli_*`, `unity_editor_*`, `unity_player_*`, and toolkit
discovery tools.

Treat `CONFIRMATION_REQUIRED` as a safety boundary. Ask for authorization and
retry with `confirm=true`; do not silently retry destructive commands.

## Author safely

- Read scene hierarchy or assets before changing them.
- Set a narrow authoring root before generating assets.
- Save explicitly after scene changes.
- Poll recompile, build, test, target-switch, and bake status commands.
- Prefer `dry_run=true` where available.
- Preserve user scenes, settings, licenses, Cloud/VCS links, and Editors unless
  they are explicitly in scope.
- Remember that assets, UPM, settings, target switches, and builds are often
  not Undo-able.

## Build and test

- Prefer Pipeline `unity_editor_build` when an Editor is connected; poll
  `unity_editor_build_status`.
- Use top-level `unity build` only with a project-owned static
  `--execute-method`. The CLI does not supply the build implementation.
- Use top-level `unity test` for isolated batch tests and NUnit XML.
- Use Pipeline `list_tests`/`run_tests`/`test_status` for a running Editor.

## Control a Player

Require `RuntimePipelineManager`, `enableInBuilds=true`, and a standalone
Development Build. Target the directory containing
`.unity-pipeline-runtime-port`. Never enable Pipeline in a production Player.

## Protect credentials and logs

Do not place tokens, serials, account identifiers, proxy credentials, or
descriptor bearer tokens in prompts or tool arguments. Use environment
variable names or protected files. Sanitize Editor logs before sharing them;
batch logs can echo process arguments.

## Load references only when needed

- Read [recipes.md](references/recipes.md) for verified workflows.
- Read [mcp-tools.md](references/mcp-tools.md) for the MCP contract.
- Read [setup-and-agents.md](references/setup-and-agents.md) when installing,
  recovering, removing, or troubleshooting an agent registration or HTTP
  lifecycle.
- Read
  [unity-cli-capabilities.md](../../Documentation~/unity-cli-capabilities.md)
  for the complete versioned capability map and catalogs.
- Run [probe-environment.mjs](scripts/probe-environment.mjs) on an unfamiliar
  machine.
- Run [audit-catalogs.mjs](scripts/audit-catalogs.mjs) after upgrading Unity
  CLI, Editor, or Pipeline.
