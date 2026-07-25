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
3. Review the agents. Found clients start with **MCP On** on first use.
   **Missing** clients cannot be enabled unless a managed registration already
   exists and can be switched off.
4. Keep stdio selected unless a shared endpoint is required.
5. Enable the project-local skill.
6. Choose **Preview changes** and inspect every enable, disable, and target
   inline.
7. Choose **Apply preview** only after user confirmation.
8. Restart clients listed by the result and call
   `unity_connection_status`.

Do not manually duplicate a registration already managed by the Control
Center.

## Managed locations

Each private registration is named
`unity_cli_mcp` without a project environment variable. Open Editors publish
short-lived metadata under the user-local `unity-cli-mcp/registry/editors`
registry; tool calls select the intended live instance.
The server bundle lives in stable user-local UniGame data, not UPM cache or
Unity `Library`.

The canonical skill is `.agents/skills/operate-unity-cli`. Cline and Claude
Code receive managed mirrors. Manifests and hashes distinguish package-owned
copies from user-owned content.

## Lifecycle

- **Refresh** reads state only.
- **Preview changes** lists files, processes, conflicts, pending agent toggles,
  and restart requirements without mutation.
- **Apply preview** creates a backup, performs atomic managed writes, and
  restores missing managed state.
- **Remove** is available under Advanced and removes only
  fingerprinted registrations and selected skill copies.
- **Rollback** appears under Advanced only when a backup is available.

An unknown user-owned `unity_cli_mcp` entry is preserved by default. Replace it
only through a reviewed Apply with explicit `force` authorization.

## HTTP

stdio is agent-owned and recommended. Optional Streamable HTTP binds to
`127.0.0.1`, validates Host and Origin, and protects both health and MCP with a
capability-file reference. Each Editor owns only its
`broker-leases/<editor_instance_id>.json` lease.

Start or stop HTTP from **Advanced**. Closing one Editor removes only its lease;
the shared broker remains for other live leases, then waits ten seconds after
the last lease before stopping unless keep-alive is enabled. Do not expose this
endpoint on a LAN or public interface.

With an automatically assigned port, start HTTP first, refresh until the actual
endpoint appears, then preview and apply agent registrations. With a fixed free
port, registration may be applied before startup. The manager returns
`HTTP_ENDPOINT_NOT_READY` instead of persisting port `0`.

## Recovery

- `CLI_NOT_FOUND`: install Unity CLI or set `UNITY_CLI_PATH`.
- Node missing/old: install Node 20+; the package does not alter the runtime.
- `CONFLICT`: inspect and rename the unmanaged entry, or explicitly authorize
  the reviewed `force` replacement.
- Missing Editor tools: install Pipeline, open the target project normally,
  wait for compilation, and refresh schemas.
- Stale HTTP state: stop the recorded process if still alive, then start it
  again from the owning Editor.
- Bad update: select the last backup and Rollback.
