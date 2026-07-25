# Dynamic Editor Registry

## Contract

Each Unity Editor session publishes:

`<unigame-data>/unity-cli-mcp/registry/editors/<project_id>/<editor_instance_id>.json`

Metadata uses the versioned
[`editor-metadata.v1.schema.json`](../Server~/schemas/editor-metadata.v1.schema.json).
The publisher writes atomically every two seconds and expires its lease after
ten seconds. It stores descriptor paths and capability hashes, never descriptor
contents, bearer tokens, serials, or other credentials.

`project_id` is SHA-256 over the normalized absolute project path.
`editor_instance_id` is a UUID retained across domain reloads and replaced for
the next Editor process session. On quit, a publisher deletes only a lease that
still contains its own instance ID.

## Routing

The broker validates the closed schema, registry path identity, heartbeat,
lease expiry, Editor PID, and descriptor availability. Corrupt entries are
reported without aborting discovery.

Editor selectors resolve in this order:

1. `editor_instance_id`
2. `project_id` when exactly one ready instance matches
3. `project_path`
4. deprecated `projectPath`
5. deprecated `UNITY_PROJECT_PATH`
6. the sole ready Editor

The broker never chooses the newest ambiguous instance. Stable failures are
`TARGET_REQUIRED`, `TARGET_NOT_FOUND`, `TARGET_AMBIGUOUS`, `TARGET_STALE`, and
`TARGET_NOT_READY`.

## Shared HTTP broker

Stdio remains agent-owned. Optional HTTP uses one loopback broker and one lease
per Editor under `broker-leases/<editor_instance_id>.json`. Closing an Editor
removes only its lease. The broker remains while any owner PID is live and
stops ten seconds after the last lease disappears unless `keep_alive=true`.
Broker leases contain only `schema_version`, Editor instance identity, owner
PID/start time, heartbeat, and expiry. The Editor renews only its matching
existing lease; malformed, expired, heartbeat-stale, and PID-reused leases are
rejected.
