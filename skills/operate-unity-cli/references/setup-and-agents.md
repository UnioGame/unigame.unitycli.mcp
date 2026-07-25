# Setup and agent registration

## Contents

- [Recommended setup](#recommended-setup)
- [Managed locations](#managed-locations)
- [Lifecycle](#lifecycle)
- [HTTP](#http)
- [Recovery](#recovery)

## Recommended setup

1. Open `UniGame/Unity CLI MCP`.
2. Verify Unity CLI, Node 20+, and Pipeline status.
3. Select only the agents used on this machine.
4. Keep stdio selected unless a shared endpoint is required.
5. Enable the project-local skill.
6. Preview and inspect every target.
7. Apply only after user confirmation.
8. Restart clients listed by the result and call
   `unity_connection_status`.

Do not manually duplicate a registration already managed by the Control
Center.

## Managed locations

Each private registration is named
`unigameUnityCli_<project>_<path-hash>` and pins `UNITY_PROJECT_PATH`.
The server bundle lives in stable user-local UniGame data, not UPM cache or
Unity `Library`.

The canonical skill is `.agents/skills/operate-unity-cli`. Cline and Claude
Code receive managed mirrors. Manifests and hashes distinguish package-owned
copies from user-owned content.

## Lifecycle

- **Probe** reads state only.
- **Preview** lists files, processes, conflicts, and restart requirements.
- **Apply** creates a backup and performs atomic managed writes.
- **Repair** reapplies missing or damaged managed state.
- **Remove** removes only fingerprinted registrations and selected skill
  copies.
- **Rollback** restores the selected backup.

Never force a conflict before inspecting the same-name user configuration.

## HTTP

stdio is agent-owned and recommended. Optional Streamable HTTP binds to
`127.0.0.1`, validates Host and Origin, and protects both health and MCP with a
capability-file reference. The state file records the server and owner Editor
PIDs.

The owner Editor stops HTTP during shutdown. If an Editor crashed, use Health
to detect the stale PID, then Stop or Repair. Do not expose this endpoint on a
LAN or public interface.

## Recovery

- `CLI_NOT_FOUND`: install Unity CLI or set `UNITY_CLI_PATH`.
- Node missing/old: install Node 20+; the package does not alter the runtime.
- `CONFLICT`: inspect the unmanaged same-name entry, then rename it or
  explicitly force the managed replacement.
- Missing Editor tools: install Pipeline, open the target project normally,
  wait for compilation, and refresh schemas.
- Stale HTTP state: stop the recorded process if still alive, then start it
  again from the owning Editor.
- Bad update: select the last backup and Rollback.
