---
name: operate-unity-mcp
description: Operate a Unity project through Unity CLI's official built-in MCP server. Use when an agent needs to inspect or modify scenes, GameObjects, prefabs, assets, scripts, tests, builds, packages, or Project Settings through `unity mcp`, or when it needs to diagnose the official Unity MCP connection and select the correct absolute project path.
---

# Operate Unity MCP

Use the official `unity mcp --project-path <absolute-project>` server. Do not
substitute the package's optional Node broker unless the user explicitly asks
for its advanced HTTP or catalog compatibility features.

## Start

1. Resolve the absolute Unity project path and read
   `ProjectSettings/ProjectVersion.txt`.
2. Check `unity --version`, `unity status --project <project>
   --format json`, and the MCP client's available tools.
3. If Pipeline is absent and project mutation is authorized, run
   `unity pipeline install --project-path <project>`.
4. Wait for compilation and require a ready connection before authoring.
5. Read the relevant state before mutation, make the narrowest change, save
   explicitly, and inspect the result.

Use `unity mcp configure --list --format json --no-banner` to discover supported
clients. Preview upstream configuration with `--dry-run`. A managed registration
should run the Unity CLI executable with arguments
`mcp --project-path <absolute-project>` and use a unique project-pinned name.

## Work safely

- Select the intended project explicitly; never guess between live Editors.
- Prefer structured output, named arguments, bounded waits, and status polling.
- Ask for confirmation when a tool exposes a confirmation boundary.
- Treat asset imports, package changes, target switches, and builds as
  potentially non-Undo-able.
- Preserve scenes, settings, credentials, licenses, and Cloud/VCS links unless
  they are in scope.
- Never put tokens, serials, or proxy credentials in prompts or tool arguments.

## Load references progressively

- Read [official-mcp-workflows.md](references/official-mcp-workflows.md) for
  registration, diagnosis, authoring, testing, and build workflows.
- Read
  [unity-cli-guide-1.0.0-beta.2.md](references/unity-cli-guide-1.0.0-beta.2.md)
  for the concise bundled workflow guide.
- Read the installed `references/unity-cli-capabilities.md` for the complete
  versioned command and Pipeline capability map copied into the project-local
  skill. Re-check live help after an upgrade because both surfaces are
  experimental.
