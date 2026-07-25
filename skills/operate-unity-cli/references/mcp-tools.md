# MCP tool contract

## Contents

- [Namespaces](#namespaces)
- [Shared input](#shared-input)
- [Result envelope](#result-envelope)
- [Confirmation](#confirmation)
- [Catalog compatibility](#catalog-compatibility)

## Namespaces

| Prefix | Target |
| --- | --- |
| `unity_cli_` | Standalone Unity CLI and batch Editor launchers |
| `unity_editor_` | Unity Pipeline commands against a running Editor |
| `unity_player_` | Unity Pipeline commands against a Development Player |
| `unity_` | Toolkit discovery and connection services |

Command paths are normalized with hyphens and spaces changed to underscores.
For example, `projects link vcs` becomes `unity_cli_projects_link_vcs`.

## Shared input

- `editor_instance_id`: exact Editor session UUID; highest-priority selector.
- `project_id`: stable project hash; valid only when one ready instance matches.
- `project_path`: normalized absolute Editor project path.
- `projectPath`: deprecated alias for `project_path`.
- `runtimePath`: directory containing `.unity-pipeline-runtime-port`.
- `timeoutMs`: process/command timeout.
- `confirm`: explicit acknowledgement for high-risk operations.
- `extraArgs`: compatibility escape hatch for flags added after the snapshot.
- `includeLogs`: include bounded, sanitized upstream text.

Known parameters are translated to canonical long CLI flags. Processes are
spawned without a shell.

Secret parameters accept only `env:VARIABLE` or `file:/protected/path`
references. The server resolves them immediately before spawning Unity CLI
and redacts returned output.

## Result envelope

```json
{
  "ok": true,
  "source": "editor",
  "command": "create_scene",
  "target": "/absolute/project",
  "exitCode": 0,
  "data": {},
  "warnings": [],
  "errors": [],
  "durationMs": 123
}
```

Failures preserve the same shape and add one stable toolkit error code:
`CLI_NOT_FOUND`, `VERSION_MISMATCH`, `EDITOR_NOT_CONNECTED`,
`PLAYER_NOT_CONNECTED`, `CONFIRMATION_REQUIRED`, `TIMEOUT`,
`UPSTREAM_FAILED`, `INVALID_OUTPUT`, `TARGET_REQUIRED`, `TARGET_NOT_FOUND`,
`TARGET_AMBIGUOUS`, `TARGET_STALE`, or `TARGET_NOT_READY`.

## Confirmation

Machine changes, remote mutations, deletions, builds, target switches,
arbitrary C#, hot reload, menu execution, and Player quit require
`confirm=true`. This confirmation supplements rather than bypasses Unity's own
`confirm`, `force`, or `yes` flags.

## Catalog compatibility

The distributable catalogs are snapshots for Unity CLI `1.0.0-beta.2`,
Pipeline `0.4.0-exp.1`, Editor `6000.3.14f1`. The server warns rather than
refuses when the installed CLI differs. Use `extraArgs` for additive flags and
regenerate snapshots before publishing a package update.
