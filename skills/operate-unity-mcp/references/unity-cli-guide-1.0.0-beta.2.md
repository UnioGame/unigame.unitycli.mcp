# Unity CLI 1.0.0-beta.2 capability guide

This is the bundled capability map for Unity CLI `1.0.0-beta.2`, Unity Pipeline
`0.4.0-exp.1`, and the verified Unity `6000.3.14f1` Editor. It is copied into
the skill so an installed skill does not depend on package-relative files.
Treat it as a versioned baseline and prefer live help after upgrades.

## Contents

- [Discovery and health](#discovery-and-health)
- [Standalone CLI](#standalone-cli)
- [Editor Pipeline](#editor-pipeline)
- [Development Player](#development-player)
- [Official MCP](#official-mcp)
- [Automation rules](#automation-rules)

## Discovery and health

| Need | Command |
| --- | --- |
| CLI version | `unity --version` |
| Environment health | `unity doctor --format json` |
| Authentication | `unity auth status --format json` |
| Installed Editors | `unity editors list --format json` |
| Project connection | `unity status --project <project> --format json` |
| Pipeline catalog | `unity list --project-path <project> --format json` |
| Nested syntax | `unity <group> <command> --help` |

Resolve the executable from `UNITY_CLI_PATH` or `PATH`. Use absolute project
paths and `--no-banner` when machine-readable output must contain only data.

## Standalone CLI

The standalone surface covers:

- authentication, licensing, diagnostics, configuration, and changelog;
- Unity Editor discovery, installation, removal, modules, and release metadata;
- project creation, opening, templates, and project discovery;
- package, Cloud, Version Control, and organization/project operations;
- batch `run`, `test`, and `build` orchestration.

Networked operations can require authentication and interactive agreement.
Never expose serials, access tokens, refresh tokens, or proxy credentials.

Top-level batch testing:

```text
unity test <project> --mode EditMode \
  --output Logs/test-results.xml \
  --editor-version 6000.3.14f1 --non-interactive
```

Top-level build delegates implementation to project code:

```text
unity build <project> --target StandaloneWindows64 \
  --execute-method ProjectBuild.Perform \
  --output-path Builds/Game.exe \
  --editor-version 6000.3.14f1 --non-interactive
```

## Editor Pipeline

Install only with mutation authority:

```text
unity pipeline install --project-path <project>
```

The verified catalog includes these families:

| Family | Typical capabilities |
| --- | --- |
| Connection | status, catalog, schema, version, logs |
| Scenes | create, open, save, hierarchy, active scene |
| GameObjects | create, find, inspect, update, delete, parenting |
| Components | list, add, inspect, update, remove |
| Prefabs | create, instantiate, open, save, apply, unpack |
| Assets | search, inspect, create folders, import, move, delete |
| Scripts | create, read, update, attach, recompile, diagnostics |
| Settings | read and update supported Player/Editor settings |
| Tests | list, run, poll status, retrieve results |
| Builds | queue build, poll status, inspect result |
| Packages | list and perform supported package operations |
| Specialized | Timeline, navigation, input, screenshots, selection |

Dynamic parameters are named options:

```text
unity command --project-path <project> create_scene \
  --path Assets/Automation/Scene.unity --confirm true
unity command --project-path <project> save_scene --confirm true
unity command --project-path <project> list_tests --mode EditMode
unity command --project-path <project> run_tests \
  --mode EditMode --filter Project.Tests
unity command --project-path <project> test_status
```

Use `--name value`, never shell-style `name=value`. Poll asynchronous compile,
test, build, bake, import, and target-switch operations.

## Development Player

Player tools require `RuntimePipelineManager`, `enableInBuilds=true`, and a
standalone Development Build. Select the directory containing
`.unity-pipeline-runtime-port`.

```text
unity list --runtime-path <player-directory> --format json
unity command --runtime-path <player-directory> runtime_status
```

Do not enable Pipeline in production Players.

## Official MCP

`unity mcp` exposes the current Pipeline catalog and schemas over stdio. It
does not add authoring capabilities beyond those available from the connected
Pipeline instance.

```text
unity mcp --project-path <absolute-project>
unity mcp configure --list --format json --no-banner
unity mcp configure codex --project-path <absolute-project> --dry-run
```

Known adapter families in this release include Codex, Cursor, VS Code/Copilot,
Cline, Claude Code, and Claude Desktop, plus additional clients reported by the
live list command. Discovery output is authoritative.

For manual registration:

- command: the resolved Unity CLI executable;
- arguments: `mcp`, `--project-path`, absolute project path;
- transport: stdio;
- registration name: unique and stable per project.

No Node runtime is required for this official stdio path.

## Automation rules

- Read before writing and save explicitly.
- Prefer JSON output, non-interactive mode, absolute paths, and timeouts.
- Inspect exit code and bounded stdout/stderr after every process.
- Honor confirmation and dry-run boundaries.
- Do not guess between multiple ready Editors.
- Sanitize logs before sharing; process arguments may contain sensitive data.
- Re-run help, changelog, and catalogs after upgrading experimental components.
