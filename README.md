<div align="center">

# Unity CLI MCP Toolkit

**Install Unity, automate projects, author scenes, run tests, build Players, and
control Development Players from any MCP-capable agent.**

[![UPM](https://img.shields.io/badge/UPM-0.1.0-4c8bf5?style=flat-square)](package.json)
[![Unity](https://img.shields.io/badge/Unity-6000.0%2B-black?style=flat-square&logo=unity)](https://unity.com/)
[![Unity CLI](https://img.shields.io/badge/Unity_CLI-1.0.0--beta.2-ff6d00?style=flat-square)](https://docs.unity.com/en-us/unity-cli/unity-cli)
[![Pipeline](https://img.shields.io/badge/Pipeline-0.4.0--exp.1-6c5ce7?style=flat-square)](https://docs.unity.com/en-us/unity-production-pipeline/local-tools-cli/unity-pipeline-package)
[![Node](https://img.shields.io/badge/Node-%E2%89%A520-339933?style=flat-square&logo=node.js&logoColor=white)](Server~/package.json)
[![License](https://img.shields.io/badge/License-MIT-2ea44f?style=flat-square)](LICENSE)

**269 MCP tools · Unity CLI · quick setup**

</div>

> [!IMPORTANT]
> Unity CLI and Unity Pipeline are experimental. This release pins and verifies
> Unity CLI `1.0.0-beta.2`, Pipeline `0.4.0-exp.1`, and Editor `6000.3.14f1`.
> The server warns on version drift instead of hiding tools.

## Capabilities at a glance

| Mode | What an agent can do | Tools |
| --- | --- | ---: |
| Standalone CLI | Install Editors/modules, manage projects, auth, licenses, Cloud/VCS, configuration, diagnostics, batch run/build/test | 112 |
| Running Editor | Create scenes, GameObjects, components, prefabs and assets; compile, test, bake, configure, capture and build | 140 |
| Development Player | Inspect runtime state, change time/frame rate, simulate input, read logs, hot reload and quit | 14 |
| Toolkit | Inspect catalogs/connections and search capabilities | 3 |

The bundled [Agent Skill](skills/operate-unity-cli/SKILL.md) teaches an agent
which mode to select and how to cross the boundaries safely. The full
[capability map](Documentation~/unity-cli-capabilities.md) distinguishes
built-in commands from batch Editor code, Pipeline tools, and arbitrary C#.

## Quick connect

### 1. Install in Unity

Add the Git package in Package Manager, or add it to
`Packages/manifest.json`:

```json
{
  "dependencies": {
    "com.unigame.unitycli.mcp": "https://github.com/UnioGame/unigame.unitycli.mcp.git"
  }
}
```

Open the guided setup window:

```text
UniGame → Unity CLI MCP
```

The guided screen checks the environment and switches MCP **On** for found
agents on first use. Each agent row shows detection and integration state:
**Found** or **Missing**, plus **On**, **Off**, **Pending On**,
**Pending Off**, or **Conflict**. Keep stdio and the Agent Skill enabled,
click **Preview changes**, inspect the exact managed changes, then click
**Apply preview**. The toolkit
installs the self-contained server in stable user-local storage and creates one
global private registration named `unity_cli_mcp`. Every open Editor publishes
a short-lived user-local lease, so several Unity projects work concurrently.

> [!TIP]
> The default setup is agent-managed stdio plus the project-local Agent Skill.
> It requires no npm install and writes no machine paths to the repository.

### 2. Run standalone

```sh
git clone https://github.com/UnioGame/unigame.unitycli.mcp.git
node unigame.unitycli.mcp/Server~/dist/index.js
```

The committed self-contained bundle means consumers need only Node.js—npm and TypeScript are
development dependencies. The server uses stdio. Set `UNITY_CLI_PATH` only
when `unity` is not on `PATH`. `UNITY_PROJECT_PATH` is a deprecated one-release
fallback; prefer an Editor selector on each call.

### 3. Connect an agent

The Control Center has first-line adapters for Codex, Cursor, VS Code / GitHub
Copilot, Cline, and Claude Code. Claude Desktop keeps DXT/export support.
Registrations use:

```text
unity_cli_mcp
```

They are stored in private user configuration. Existing registrations and
comments are preserved and every mutation has a backup. A normal reviewed
Apply restores missing managed state; Remove and Rollback stay out of the
primary flow under **Advanced**.

For a client that is not yet supported, use the generic fallback:

Generic JSON configuration:

```json
{
  "mcpServers": {
    "unity_cli_mcp": {
      "command": "node",
      "args": ["<PACKAGE_ROOT>/Server~/dist/index.js"]
    }
  }
}
```

Codex `config.toml`:

```toml
[mcp_servers.unity_cli_mcp]
command = "node"
args = ["<PACKAGE_ROOT>/Server~/dist/index.js"]
```

VS Code `.vscode/mcp.json`:

```json
{
  "servers": {
    "unity_cli_mcp": {
      "type": "stdio",
      "command": "node",
      "args": ["<PACKAGE_ROOT>/Server~/dist/index.js"]
    }
  }
}
```

Claude Desktop, Cursor, Cline and other JSON-based clients use the generic
`mcpServers` object.

### 4. Install the Agent Skill

Keep **Install the project-local operate-unity-cli Agent Skill** enabled before
Apply. The
canonical copy is installed at:

```text
.agents/skills/operate-unity-cli
```

Managed mirrors are created for Cline and Claude Code. Invoke
`$operate-unity-cli` from a supporting agent.

### 5. First verified check

With the intended project open in Unity:

```sh
unity status --format json
unity list --project-path "<UNITY_PROJECT>" --format json
```

From MCP call:

```text
unity_catalog_status {}
unity_connection_status { "project_path": "<UNITY_PROJECT>" }
unity_editor_editor_status { "project_id": "<PROJECT_ID>" }
```

A ready response confirms the CLI executable, the versioned catalogs, the
Pipeline descriptor and the Editor connection.

## Architecture

```mermaid
flowchart LR
    Agent["MCP-capable agent"] -->|one global stdio registration| Server["Shared UniGame MCP broker<br/>Node.js"]
    Skill["operate-unity-cli skill"] -. workflow guidance .-> Agent
    Registry["User-local Editor leases<br/>heartbeat 2s · expiry 10s"] --> Server
    Editor -->|atomic metadata only| Registry
    Server -->|spawn, no shell| CLI["Unity CLI"]
    CLI --> Standalone["Standalone services<br/>Editors · projects · auth · CI"]
    CLI -->|batch process| Batch["Unity Editor batch mode<br/>run · test · build"]
    CLI -->|localhost + descriptor token| Editor["Running Unity Editor<br/>Pipeline package"]
    CLI -->|localhost + descriptor token| Player["Development Player<br/>RuntimePipelineManager"]
    Setup["Guided Unity setup<br/>Probe · Preview · Apply"] --> Agent
    Setup --> Install["Stable user-local bundle"]
    Install --> Server
```

There is one MCP implementation. Installing the repository as a UPM package
adds the Control Center; cloning it separately runs the same committed
self-contained JavaScript bundle.

## Supported agents

| Client | stdio | HTTP | Skill | Configuration |
| --- | :---: | :---: | :---: | --- |
| Codex | ✓ | ✓ | Project-local | Developer-local TOML |
| Cursor | ✓ | ✓ | Project-local | Private MCP JSON |
| VS Code / Copilot | ✓ | ✓ | Project-local | User/profile `mcp.json` |
| Cline | ✓ | ✓ | Managed mirror | Private MCP settings |
| Claude Code | ✓ | ✓ | Managed mirror | Private local registration |
| Claude Desktop | Export | Export | DXT | DXT/export manifest |

## Tool model

Every versioned command is an individual MCP tool:

- `unity_cli_projects_create`
- `unity_cli_test`
- `unity_editor_create_scene`
- `unity_editor_create_prefab`
- `unity_editor_recompile`
- `unity_editor_build`
- `unity_player_runtime_status`

Names use `unity_<source>_<command_path>`. Editor selection never guesses the
newest instance: ambiguity returns `TARGET_AMBIGUOUS`; missing, stale, and
not-ready targets return the corresponding stable `TARGET_*` error. Player
routing remains unchanged.

Shared inputs:

| Input | Purpose |
| --- | --- |
| `editor_instance_id` | Select one exact Editor session (highest priority) |
| `project_id` | Select the sole ready Editor for a stable project ID |
| `project_path` | Select by normalized absolute project path |
| `projectPath` | Deprecated alias for `project_path` |
| `runtimePath` | Select a Development Player descriptor directory |
| `timeoutMs` | Bound the upstream process |
| `confirm` | Acknowledge a high-risk operation |
| `extraArgs` | Forward additive flags from a newer CLI |
| `includeLogs` | Return bounded, redacted logs |

All calls return a stable envelope with `ok`, `source`, `command`, `target`,
`exitCode`, `data`, `warnings`, `errors`, and `durationMs`.

## Unity Control Center

`UniGame → Unity CLI MCP` is a UI Toolkit Control Center:

1. **Environment** checks Unity CLI, Node, Pipeline, and the bundled server.
2. **This Editor** shows the current instance ID, project ID, connection state,
   heartbeat, descriptor, and the exact snake_case metadata published locally.
3. **Active Editors** lists every live, stale, not-ready, duplicate, or corrupt
   Editor registration so concurrent projects remain explicit.
4. **Global Agent Registration** gives every client an MCP toggle, transport
   selection, conflict state, and one shared `unity_cli_mcp` entry.
5. **Shared HTTP Broker** displays endpoint, owner leases, health, and guarded
   start/stop controls.
6. **Skill** manages the project-local Agent Skill and mirrors.
7. **Managed configuration** runs a read-only **Preview changes** operation.
   Exact create/update/remove targets, warnings, conflicts, and restart
   requirements appear inline before **Apply preview** is enabled.

Apply preview creates an atomic backup and also restores missing managed state.
Unknown same-name registrations remain user-owned unless the reviewed Apply
explicitly uses `force`.
Success lists clients that need a restart; failures automatically expose
sanitized diagnostics.

The collapsed **Advanced** section contains only optional loopback HTTP
Start/Stop, Remove managed configuration, Rollback when a backup exists, and
Copy Diagnostics. Opening the window, refreshing status, or previewing a plan
never mutates files or starts processes.

Pipeline `0.4.0-exp.1` and the native Unity CLI each show a compact
**Install** action only when missing. Both require confirmation. Pipeline uses
Unity Package Manager; the CLI uses Unity's official installer for the current
platform with the beta channel. A failed CLI install exposes **Copy Command**
and **Docs** while keeping sanitized output under **Advanced**. Node remains
documentation-only. The toolkit never changes `PATH`, returns a license, or
edits Cloud/VCS state.

## stdio and HTTP lifecycle

stdio is the default: the agent owns one global broker process.
Optional HTTP binds only to `127.0.0.1`, validates Host and Origin, and accepts
a capability stored in a protected local file. Each Editor owns an independent
lease; closing one cannot stop sessions owned by another Editor.

Advanced prevents duplicate startup and reports sanitized failures. HTTP stops
ten seconds after the last live lease unless keep-alive is enabled.

For an automatically assigned HTTP port, start the broker first, refresh until
the actual endpoint is visible, then preview and apply agent registrations. A
fixed free port may be previewed and applied before broker startup. Apply fails
with `HTTP_ENDPOINT_NOT_READY` instead of writing a registration with port `0`.

## Common workflows

### Create and save a scene

```text
unity_editor_create_scene {
  "project_path": "<UNITY_PROJECT>",
  "path": "Assets/Automation/Probe.unity",
  "confirm": true
}

unity_editor_create_gameobject {
  "project_path": "<UNITY_PROJECT>",
  "name": "ProbeCube",
  "primitive": "cube",
  "confirm": true
}

unity_editor_save_scene {
  "project_path": "<UNITY_PROJECT>",
  "confirm": true
}
```

### Compile and test

```text
unity_editor_recompile {
  "project_path": "<UNITY_PROJECT>",
  "confirm": true
}
unity_editor_recompile_status { "project_path": "<UNITY_PROJECT>" }
unity_editor_run_tests {
  "project_path": "<UNITY_PROJECT>",
  "mode": "EditMode",
  "filter": "Company.Tests"
}
```

For an isolated NUnit XML run, use `unity_cli_test`.

### Build a Player

`unity_editor_build` is a complete asynchronous Pipeline build operation; poll
`unity_editor_build_status`. In contrast, top-level `unity_cli_build` starts a
batch Editor and requires a project-owned `--execute-method`.

### Control a Development Player

Add `Unity.Pipeline.RuntimePipelineManager`, enable `enableInBuilds`, and make
a standalone Development Build. Point `runtimePath` to the folder containing
`.unity-pipeline-runtime-port`. Never enable Pipeline in a production build.

## Safety

> [!WARNING]
> Install/uninstall, licensing, Cloud/VCS links, deletions, builds, target
> switches, arbitrary C#, menu execution, hot reload and Player quit require
> `confirm: true`.

- Processes are spawned with argument arrays and `shell: false`.
- Output is bounded and tokens, passwords, serials and credential-bearing URLs
  are redacted.
- Secret-bearing operations should reference environment variables or
  protected files as `env:VARIABLE` or `file:/protected/path`; direct secret
  values are rejected.
- Pipeline's authoring root and native `dry_run`/`confirm` checks remain active.
- Batch Editor logs can echo process arguments. Review logs before publishing
  CI artifacts.
- Agent config changes are global and private; repository MCP config is
  never changed by default.
- Setup writes are previewed, backed up, atomic, fingerprinted, and reversible.

## Development

```sh
cd Server~
npm ci
npm test
npm run build
npm run catalog:generate -- --cli "<UNITY_CLI_PATH>"
npm run pack:check
```

After opening a Pipeline-enabled Editor, append:

```sh
npm run catalog:generate -- \
  --cli "<UNITY_CLI_PATH>" \
  --editor-project "<UNITY_PROJECT>"
```

Validate the skill:

```sh
python <skill-creator>/scripts/quick_validate.py \
  skills/operate-unity-cli
```

The setup tests use isolated fake-home directories for all agent adapters and
never touch real client configuration. The E2E script connects through a real MCP SDK client, creates a 55-cube
pyramid in a disposable project, verifies every name and position, saves the
scene, and checks compilation:

```sh
npm run test:e2e -- \
  --project "<DISPOSABLE_UNITY_PROJECT>" \
  --cli "<UNITY_CLI_PATH>"
```

## Versioning and limitations

- The committed catalogs target CLI `1.0.0-beta.2`, Pipeline
  `0.4.0-exp.1`, and Editor `6000.3.14f1`.
- Pipeline requires Unity 6+.
- The Editor Pipeline endpoint requires a normally opened Editor; launching
  the Editor itself with `-batchmode` does not publish the endpoint in
  Pipeline `0.4.0-exp.1`.
- Player tools require a standalone Development Build and explicit
  `RuntimePipelineManager`.
- Timeline, AI Navigation, Input System and Test tools require their
  corresponding Unity packages.
- `unity projects new` can fail when Unity's downloaded template archive is
  unavailable; this is an upstream beta failure and is returned unchanged.
- Online documentation can lag the executable. Installed recursive `--help`
  and live `unity list --format json` remain authoritative.
- Client config formats can evolve. Adapters preserve unmanaged same-name
  registrations by default; replacement requires a reviewed Apply with explicit
  `force`, and a rollback backup is created first.
- Node 20+ is required; the Control Center diagnoses it but does not install it.

## Documentation

- [Complete capability map](Documentation~/unity-cli-capabilities.md)
- [Agent workflow](skills/operate-unity-cli/SKILL.md)
- [Recipes](skills/operate-unity-cli/references/recipes.md)
- [MCP contract](skills/operate-unity-cli/references/mcp-tools.md)
- [Setup and agent registration](skills/operate-unity-cli/references/setup-and-agents.md)
- [Official Unity CLI documentation](https://docs.unity.com/en-us/unity-cli/unity-cli)
- [Official Pipeline package documentation](https://docs.unity.com/en-us/unity-production-pipeline/local-tools-cli/unity-pipeline-package)

---

<div align="center">

Built for agents that need to operate Unity deliberately, observably, and
without pretending every C# possibility is a built-in CLI command.

</div>
