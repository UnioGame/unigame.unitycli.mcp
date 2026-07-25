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
3. Review the detected agents selected automatically on first use.
4. Keep stdio selected unless a shared endpoint is required.
5. Enable the project-local skill.
6. Choose **Review Configuration** and inspect every target inline.
7. Choose **Apply Configuration** only after user confirmation.
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

- **Refresh Status** reads state only.
- **Review Configuration** lists files, processes, conflicts, and restart
  requirements without mutation.
- **Apply Configuration** creates a backup, performs atomic managed writes, and
  restores missing managed state.
- **Remove managed configuration** is available under Advanced and removes only
  fingerprinted registrations and selected skill copies.
- **Rollback** appears under Advanced only when a backup is available.

Force is shown only after Review detects a conflict. Never enable it before
inspecting the same-name user configuration.

## HTTP

stdio is agent-owned and recommended. Optional Streamable HTTP binds to
`127.0.0.1`, validates Host and Origin, and protects both health and MCP with a
capability-file reference. The state file records the server and owner Editor
PIDs.

Start or stop HTTP from **Advanced**. The owner Editor stops HTTP during
shutdown. If an Editor crashed, refresh status to detect the stale ownership,
then use the contextual HTTP action or reapply the reviewed configuration. Do
not expose this endpoint on a LAN or public interface.

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
