# Official Unity MCP workflows

## Register or diagnose a client

1. Run `unity mcp configure --list --format json --no-banner`.
2. Prefer installed or detected entries from that result.
3. Preview an upstream adapter with:

   `unity mcp configure <client> --project-path <absolute-project> --dry-run`

4. For a manually managed stdio entry, use the absolute Unity CLI executable,
   arguments `mcp --project-path <absolute-project>`, and a stable unique name.
5. Restart the client after a registration change.
6. Verify the project and connection using MCP discovery/status tools before
   any mutation.

Do not edit repository `.mcp.json`, `.vscode/mcp.json`, or similar workspace
files implicitly. Preserve unrelated user-global JSON, JSONC, and TOML content.
Do not delete a legacy `unity_cli_mcp` registration unless the user selects it
explicitly after review.

## Author

1. Inspect scene hierarchy or assets.
2. Set a narrow authoring root when the tool supports it.
3. Create or update one logical unit at a time.
4. Save the scene or assets explicitly.
5. Re-read the changed object and check compilation state.

## Test

- Use connected Pipeline test discovery and execution for a running Editor.
- Poll the returned test operation until terminal.
- Use top-level `unity test` only when isolated batch execution is preferable.
- Keep NUnit XML and bounded logs when a failure needs investigation.

## Build

- Prefer the Pipeline build tool for a connected Editor and poll build status.
- Use top-level `unity build` only when the project owns the required static
  execute method.
- Confirm target, scenes, and absolute output path before starting.

## Recover

- `CLI_NOT_FOUND`: install Unity CLI or set `UNITY_CLI_PATH`.
- Missing MCP tools: verify Pipeline installation, compilation, and project
  path, then restart the client.
- Multiple Editors: select an exact editor instance or project path.
- Registration conflict: preserve the user-owned entry until replacement is
  explicitly authorized.
- Stale schema: re-run live `--help`, `unity list --format json`, and reconnect.
