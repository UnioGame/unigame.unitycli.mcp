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

**269 MCP tools · project-pinned agent setup · stdio + HTTP · zero production runtime code**

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

The package brings `com.unity.pipeline@0.4.0-exp.1`. Open:

```text
Tools → UniGame → Unity CLI Control Center
```

Select the agents you use, click **Preview**, inspect the exact files and
processes, then click **Apply**. The Control Center installs the self-contained
server in stable user-local storage and creates a private registration pinned
to this project.

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
when `unity` is not on `PATH`; optionally set `UNITY_PROJECT_PATH` to pin a
running Editor.

### 3. Connect an agent

The Control Center has first-line adapters for Codex, Cursor, VS Code / GitHub
Copilot, Cline, and Claude Code. Claude Desktop receives a project-pinned
DXT/export manifest. Registrations use:

```text
unigameUnityCli_<project>_<path-hash>
```

They are stored in private user configuration. Existing registrations and
comments are preserved, every mutation has a backup, and **Repair**,
**Remove**, and **Rollback** are available from the same window.

For a client that is not yet supported, use the generic fallback:

Generic JSON configuration:

```json
{
  "mcpServers": {
    "unigame-unity-cli": {
      "command": "node",
      "args": ["<PACKAGE_ROOT>/Server~/dist/index.js"],
      "env": {
        "UNITY_PROJECT_PATH": "<UNITY_PROJECT>"
      }
    }
  }
}
```

Codex `config.toml`:

```toml
[mcp_servers.unigame-unity-cli]
command = "node"
args = ["<PACKAGE_ROOT>/Server~/dist/index.js"]
env = { UNITY_PROJECT_PATH = "<UNITY_PROJECT>" }
```

VS Code `.vscode/mcp.json`:

```json
{
  "servers": {
    "unigame-unity-cli": {
      "type": "stdio",
      "command": "node",
      "args": ["<PACKAGE_ROOT>/Server~/dist/index.js"],
      "env": { "UNITY_PROJECT_PATH": "<UNITY_PROJECT>" }
    }
  }
}
```

Claude Desktop, Cursor, Cline and other JSON-based clients use the generic
`mcpServers` object.

### 4. Install the Agent Skill

Enable **Manage project-local operate-unity-cli skill** before Apply. The
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
unity_connection_status { "projectPath": "<UNITY_PROJECT>" }
unity_editor_editor_status { "projectPath": "<UNITY_PROJECT>" }
```

A ready response confirms the CLI executable, the versioned catalogs, the
Pipeline descriptor and the Editor connection.

## Architecture

```mermaid
flowchart LR
    Agent["MCP-capable agent"] -->|stdio| Server["UniGame MCP server<br/>Node.js"]
    Skill["operate-unity-cli skill"] -. workflow guidance .-> Agent
    Server -->|spawn, no shell| CLI["Unity CLI"]
    CLI --> Standalone["Standalone services<br/>Editors · projects · auth · CI"]
    CLI -->|batch process| Batch["Unity Editor batch mode<br/>run · test · build"]
    CLI -->|localhost + descriptor token| Editor["Running Unity Editor<br/>Pipeline package"]
    CLI -->|localhost + descriptor token| Player["Development Player<br/>RuntimePipelineManager"]
    Setup["Unity Control Center<br/>Preview · Apply · Repair · Rollback"] --> Agent
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

Names use `unity_<source>_<command_path>`. Editor and Player tools remain
discoverable when their target is offline and return actionable
`EDITOR_NOT_CONNECTED` or `PLAYER_NOT_CONNECTED` errors.

Shared inputs:

| Input | Purpose |
| --- | --- |
| `projectPath` | Select a Unity project/Editor |
| `runtimePath` | Select a Development Player descriptor directory |
| `timeoutMs` | Bound the upstream process |
| `confirm` | Acknowledge a high-risk operation |
| `extraArgs` | Forward additive flags from a newer CLI |
| `includeLogs` | Return bounded, redacted logs |

All calls return a stable envelope with `ok`, `source`, `command`, `target`,
`exitCode`, `data`, `warnings`, `errors`, and `durationMs`.

## Unity Control Center

`Tools → UniGame → Unity CLI Control Center` provides:

- **Overview** — CLI, Node, Pipeline, server, Editor, and Player readiness;
- **Agents** — first-line private project-pinned registrations;
- **Server** — stdio or optional loopback Streamable HTTP;
- **Skill** — project-local skill and managed mirrors;
- **Diagnostics** — requests, sanitized responses, conflicts, and version drift.

Every change follows **Probe → Preview → Confirm → Apply → Health**. Apply
creates an atomic backup. Repair, Remove, and Rollback touch only data carrying
the package's managed fingerprint. Opening the window never mutates the
machine.

Pipeline `0.4.0-exp.1` can be installed from Overview after a separate
confirmation. The toolkit never installs Node or Unity CLI, changes `PATH`,
returns a license, or edits Cloud/VCS state.

## stdio and HTTP lifecycle

stdio is the default: the agent owns one process pinned to this Unity project.
Optional HTTP binds only to `127.0.0.1`, validates Host and Origin, and accepts
a capability stored in a protected local file. Its state records the PID,
owner Editor PID, port, and endpoint.

The Control Center prevents duplicate startup, reports stale ownership, and
stops its HTTP process when the owning Editor exits. Use HTTP only for clients
that need a shared endpoint.

## Common workflows

### Create and save a scene

```text
unity_editor_create_scene {
  "projectPath": "<UNITY_PROJECT>",
  "path": "Assets/Automation/Probe.unity",
  "confirm": true
}

unity_editor_create_gameobject {
  "projectPath": "<UNITY_PROJECT>",
  "name": "ProbeCube",
  "primitive": "cube",
  "confirm": true
}

unity_editor_save_scene {
  "projectPath": "<UNITY_PROJECT>",
  "confirm": true
}
```

### Compile and test

```text
unity_editor_recompile {
  "projectPath": "<UNITY_PROJECT>",
  "confirm": true
}
unity_editor_recompile_status { "projectPath": "<UNITY_PROJECT>" }
unity_editor_run_tests {
  "projectPath": "<UNITY_PROJECT>",
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
- Agent config changes are project-pinned and private; repository MCP config is
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
- Client config formats can evolve. Adapters refuse unmanaged same-name
  registrations and keep a rollback backup instead of overwriting them.
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
