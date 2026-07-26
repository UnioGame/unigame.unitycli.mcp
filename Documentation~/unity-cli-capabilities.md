# Unity CLI capability map

This document describes the locally verified behavior of Unity CLI
`1.0.0-beta.2`, Unity Editor `6000.3.14f1`, and Unity Pipeline
`0.4.0-exp.1`. It distinguishes native CLI operations from operations that
start the Editor in batch mode, operations supplied by the Pipeline package to
a running Editor or Player, and arbitrary extension code.

The installed command's recursive `--help` and `changelog` are the primary
source for this snapshot. Unity's online reference currently describes an
older command surface and explicitly directs users to the installed help for
the authoritative version.

## Status legend

| Label | Meaning |
| --- | --- |
| **CLI** | Built into the standalone Unity CLI; the Editor is not needed unless the command explicitly installs or opens one. |
| **Batch** | The CLI resolves and starts a Unity Editor process in batch mode. |
| **Pipeline Editor** | Built-in tool supplied by `com.unity.pipeline` to an already running Editor. |
| **Pipeline Player** | Built-in tool supplied by `com.unity.pipeline` to an instrumented Development Player. |
| **Extension** | Possible only through arbitrary C#, a user `[CliCommand]`, `-executeMethod`, an external `unity-<name>` executable, or another integration such as MCP. It is not a finite built-in capability. |
| **Documented** | Described by official documentation but not exposed or exercised by the local versions. |
| **Unavailable** | Absent or explicitly unsupported in the tested configuration. |

“Verified” below means exercised against a disposable project, not merely
observed in help text.

## Executive answer

Unity CLI is not a single headless replacement for the Unity Editor. It is a
front end over three substantially different execution modes:

1. The standalone CLI manages installations, projects, authentication,
   licensing, Cloud/VCS links, configuration, templates, and process
   invocation without loading a project in the Editor.
2. `run`, top-level `build`, and top-level `test` start an Editor in batch
   mode. `build` does not contain a build implementation: it requires a custom
   static `--execute-method`.
3. `com.unity.pipeline` exposes a local authenticated HTTP command server from
   a running Editor. In the tested combination this provides 140 built-in
   Editor tools, including direct scene, prefab, compilation, test, and Player
   build operations. A specially configured standalone Development Player
   exposes a separate 14-tool runtime catalog.

The claims in the original question resolve as follows:

| Action | Built-in answer | Requirements | Local result |
| --- | --- | --- | --- |
| Build a Player | `unity command build` is a real Pipeline build tool. Top-level `unity build` is only a batch launcher and requires `--execute-method`. | Running Editor plus Pipeline for the first form; installed Editor and user build method for the second. | Both forms built `StandaloneWindows64`. Pipeline returned an asynchronous full `BuildReport`; batch returned CLI success plus an Editor log. **Verified.** |
| Create/edit/delete scenes | `create_scene`, `open_scene`, `get_scene_hierarchy`, `save_scene`, `save_all`, `set_active_scene`, and Build Settings scene commands. | Running Editor plus Pipeline. | A scene was created, read, changed, saved, added to Build Settings, and built. **Verified.** |
| Create/edit GameObjects and prefabs | Direct GameObject/component commands plus `create_prefab`, `instantiate_prefab`, `apply_prefab_overrides`, `revert_prefab_overrides`, `save_prefab_contents`, `create_prefab_variant`, and `unpack_prefab`. | Running Editor plus Pipeline; object authoring is blocked in Play Mode. | GameObjects and components were created and edited; a prefab, instance, applied override, saved prefab edit, and variant were produced. **Verified.** |
| Import/update assets | Asset, text-file, importer, material, animation, package, and settings tools. | Running Editor plus Pipeline; authoring paths are sandboxed below the configured authoring root. | File write/read/copy/move/delete and import-triggering operations were exercised. **Verified.** |
| Compile/recompile | `recompile` plus `recompile_status`; package and script changes may also trigger compilation. | Running Editor plus Pipeline. | A generated script compiled and was attached by type after polling. **Verified.** |
| Run EditMode/PlayMode tests | Top-level `unity test`, or Pipeline `list_tests`, `run_tests`, `test_status`, `cancel_tests`. | Batch Editor for the first form; running Editor plus Test Framework for Pipeline. | One EditMode test passed through both paths; batch output was NUnit XML. PlayMode is exposed but was not run. **EditMode verified; PlayMode locally enumerated.** |
| Control a running Player | Limited runtime catalog, not the 140 Editor authoring tools. | `RuntimePipelineManager`, `enableInBuilds=true`, standalone **Development Build**, and a runtime descriptor file. | 14 tools were enumerated; `runtime_status`, `set_timescale`, `log`, and `quit` were executed. **Verified.** |

There is no standalone built-in command that directly edits a scene or prefab.
Without Pipeline, that requires custom `-executeMethod` code or another
extension. Likewise, `eval` is a Pipeline tool, not a top-level CLI command.

## Tested environment and observations

| Item | Value | Status |
| --- | --- | --- |
| CLI | `1.0.0-beta.2` at `%LOCALAPPDATA%\Unity\bin\unity.exe` | Verified with `--version`; the executable was not in `PATH`. |
| Editor | `6000.3.14f1` | Verified installation and disposable-project execution. |
| Pipeline | `com.unity.pipeline@0.4.0-exp.1` | Installed by `unity pipeline install`; experimental package. |
| Editor command catalog | 140 built-in tools | Captured from `unity list --format json`. |
| Player command catalog | 14 built-in tools | Captured from a disposable Development Player. |
| Project creation | `unity projects new` | Locally failed after downloading the built-in 3D template because the archive was unavailable. Direct Editor `-createProject` was used for the disposable probe. This is an observed beta issue, not a documented limitation. |
| MCP | `unity mcp configure codex --dry-run` | Exit code 0; printed the prospective configuration and wrote nothing. It also warned that the CLI was absent from `PATH`. |

The disposable project had no Cloud or VCS binding. No working project
manifest, installed Editor, license, remote repository, or Cloud project was
changed.

## Mode and requirement matrix

| Operation family | No Editor | CLI starts Editor | Running Editor required | Player | Main side effects and limits |
| --- | :---: | :---: | :---: | :---: | --- |
| CLI/version/help/config/analytics/proxy/log discovery | Yes | No | No | No | May persist user-level settings; `analytics opt-in/opt-out` changes telemetry preference. |
| Authentication, licensing, Cloud/VCS | Yes | No | No | No | Network and credentials required; activation, return, link/unlink, and VCS remote changes can be consequential. |
| Editor releases, modules, Hub, templates, cache | Yes | No | No | No | Network, disk, and sometimes elevation required; install/uninstall and cache deletion mutate the machine. |
| Project list/create/clone/import/export/link | Usually | Sometimes | No | No | Network is required for remote/Cloud operations. Project creation may fetch templates. |
| `open` | No | Yes, interactive | No | No | Opens a normal Editor and updates recent-project state. |
| `run` | No | Yes, batch | No | No | CLI owns reserved flags including `-batchmode`, `-projectPath`, and `-quit`; forwarded duplicates are rejected. |
| Top-level `test` | No | Yes, batch | No | No | Produces NUnit XML; requires the Test Framework and may import/compile. |
| Top-level `build` | No | Yes, batch | No | No | Requires custom `--execute-method`; the method owns the actual build and must interpret `-buildOutput` if desired. |
| `status`, `list`, `command` | No | No | Yes | With runtime selector | Local descriptor discovery and bearer-token HTTP; command-specific mutations. |
| Editor scene/asset/prefab/settings/build/test tools | No | No | Yes | No | Undo applies to many scene/object edits, but asset/settings/UPM/build operations are often not undoable. |
| Runtime status/control/eval/hot reload | No | No | No | Development standalone only | Requires an opt-in component. Do not ship it in production. Input simulation additionally requires the Input System. |
| MCP server | CLI process | No | Normally yes for useful tools | Selectable through runtime commands | Stdio transport exposes the same discovered tool schemas to MCP clients. |
| External or user commands | Depends | Depends | Depends | Depends | Capability and safety are defined by extension code, not Unity CLI. |

Pipeline requires Unity 6 or newer. The Editor server listens only on
`127.0.0.1`, using ports 7800–7849 (test range 7850–7899). Runtime uses
7900–7949 (test range 7950–7999). The Editor descriptor is
`Library/Pipeline/.unity-pipeline-port`; the Player descriptor is
`.unity-pipeline-runtime-port` next to the executable or application bundle.
Every request uses the bearer token stored in the descriptor. The server
rejects browser `Origin` requests.

## Complete standalone CLI command catalog

This is the recursive local `--help` inventory: 113 help nodes including the
root. Aliases and compatibility spellings are retained because they are
separate local help nodes.

| Area | Commands and subcommands | Capability, requirements, side effects, output, and status |
| --- | --- | --- |
| General | `changelog`, `env`, `language`, `completion`, `bug`, `doctor`, `diagnose`, `diagnose proxy`, `logs` | Version notes; environment inspection; display language; shell completion; issue reporting; installation/account/network diagnostics; proxy diagnostics; local CLI logs. Mostly read-only, except report generation or preference changes. Human or structured output where supported. **CLI, locally enumerated; changelog/doctor/diagnostics exercised.** |
| Analytics | `analytics`, `analytics status`, `analytics opt-in`, `analytics opt-out` | Inspect or persist the CLI telemetry choice. No Editor. Structured output supported. **CLI, locally enumerated.** |
| Authentication | `auth`, `auth login`, `auth logout`, `auth status` | Device/browser login, credential removal, and status. Network required for login. Never copy credential-store contents into logs. **CLI; status exercised without recording identity.** |
| Licensing | `license`, `license activate`, `license list`, `license return`, `license status`, `license server`, `license server list`, `license server status` | Personal/serial activation and return, local license inventory/status, and licensing-server discovery/status. Network or licensing service may be required. Activation/return are consequential and were not exercised. **CLI, locally enumerated.** |
| Configuration and proxy | `config`, `config proxy`, `config update-check` | Read/write user configuration, proxy behavior, and update checks. Proxy URLs can contain credentials and must be redacted. **CLI, locally enumerated.** |
| Hub | `hub`, `hub install` | Hub discovery and installation. Network/disk mutation; may need elevation. **CLI, locally enumerated.** |
| Editor management, canonical surface | `editors`, `editors list`, `editors info`, `editors path`, `editors install-path`, `editors default`, `editors add`, `editors upgrade`, `editors module`, `editors module list`, `editors module add`, `editors module refresh` | Discover/register installed Editors, resolve paths, choose a default, install/upgrade Editors, and inspect/add/refresh modules. Network, large disk writes, and sometimes elevation. Machine-mutating operations were not exercised. **CLI, local help.** |
| Editor management, compatibility surfaces | `editor`, `editor add`, `editor module`, `editor module list`, `editor module add`, `editor module refresh`, `install`, `uninstall`, `upgrade`, `install-path`, `modules`, `modules list`, `install-modules` | Older aliases/wrappers for Editor and module operations. Treat install/uninstall/upgrade as destructive machine changes. **CLI, local help.** |
| Releases | `releases` | Query available Unity Editor releases and metadata. Network required for fresh results. **CLI, locally enumerated.** |
| Templates | `templates`, `templates list`, `templates info`, `templates location`, `templates create`, `templates edit`, `templates delete` | Inspect and manage local project templates. Create/edit/delete mutate the template store. **CLI, local help.** |
| Cache | `cache`, `cache info`, `cache clean` | Inspect or remove CLI/download cache content. `clean` is destructive but recoverable by re-downloading. **CLI, locally enumerated.** |
| Projects | `projects`, `projects list`, `projects info`, `projects add`, `projects remove`, `projects pin`, `projects unpin`, `projects new`, `projects create`, `projects clone`, `projects open`, `projects upgrade`, `projects export`, `projects import`, `projects require` | Local registry and metadata, pinning, creation, remote clone, opening, version upgrade, archive import/export, and requirement checks. Some operations start an Editor or need network. `remove` removes registry membership rather than project files. `new` had the local template-archive failure described above. **CLI; list/info and disposable creation path investigated.** |
| Project links | `projects link`, `projects link cloud`, `projects link vcs`, `projects unlink`, `projects unlink cloud`, `projects unlink vcs` | Bind/unbind Cloud and VCS metadata. Network/auth required. `projects unlink vcs` can remove **all Git remotes** and must be treated as dangerous. Not exercised. **CLI, local help.** |
| Cloud | `cloud`, `cloud status`, `cloud org`, `cloud org list`, `cloud org current`, `cloud org set-default`, `cloud org clear-default`, `cloud project`, `cloud project list` | Account/organization/project discovery and default organization settings. Network/auth required; setting or clearing the default persists state. **CLI, local help.** |
| Editor execution | `open`, `run`, `build`, `test` | Resolve an Editor and open it, or start batch run/build/test. See the dedicated section below. **Batch, verified on the disposable project.** |
| Pipeline | `pipeline`, `pipeline install`, `pipeline upgrade`, `pipeline list`, `pipeline list-versions` | Add/upgrade `com.unity.pipeline`, inspect installation, and query available package versions. Package install changes the target project and needs registry access. **CLI; `0.4.0-exp.1` install/list/version discovery verified.** |
| Connected tools | `status`, `list`, `command` | Discover running Editors, return actual tool schemas, and invoke one command. Filter `status` with `--project`; target an Editor for `list`/`command` with `--project-path`; target a Player with `--runtime` or `--runtime-path`. `command` timeout defaults to 30 seconds. **Pipeline transport, verified.** |
| MCP | `mcp`, `mcp configure` | Run a stdio MCP server backed by discovered Pipeline tools, or configure a supported client. Local clients include Claude, Claude Code, Cursor, VS Code, VS Code Insiders, Copilot CLI, Windsurf, Cline, Codex, Kiro, Trae, OpenClaw, Antigravity, Zed, Continue, and Inspect. `--dry-run` previews configuration. **CLI/Pipeline bridge; Codex dry-run verified.** |
| Interactive shell | `shell` | Warm REPL that avoids repeated CLI startup and supports command execution in one session. **CLI, introduced locally in beta.2; locally enumerated.** |
| External commands | `unity-<name>` executables discovered by the CLI | Plugin-style extension surface. Behavior, output, and safety belong to the external executable. It is not a built-in Unity capability. **Extension boundary.** |
| Self-management | `self-uninstall` | Removes the Unity CLI itself. Dangerous and not exercised. **CLI, local help.** |

### Batch execution details

| Command | Important parameters and forwarding | Result and limitations |
| --- | --- | --- |
| `unity open [project]` | Editor version/path/architecture overrides, optional build target/group, extra Editor arguments. | Opens a normal Editor. It is not headless authoring. |
| `unity run [project] -- <editor args>` | `--editor-version`, `--editor-path`, `--architecture`, `--allow-install`, `--timeout`; extra Editor arguments follow `--`. | Runs batch mode and exits. Reserved flags managed by the CLI cannot be forwarded; local `-quit` forwarding was rejected with exit 6. A corrected invocation exited 0. |
| `unity test [project]` | `--mode EditMode\|PlayMode`, filters, NUnit XML output, Editor resolution, timeout, extra arguments. | Starts the Editor test runner and writes NUnit XML. Local EditMode result: one test, one pass, exit 0. Test failure uses a nonzero CLI exit (beta.2 notes identify command/test failure handling). |
| `unity build [project]` | Required `--target` and `--execute-method`; optional `--output-path`, version strategy, dirty-build policy, Android options, Editor resolution, timeout/log options, and forwarded Editor arguments. | Starts `-batchmode -nographics -quit -executeMethod`. There is no generic Unity build implementation in this command. `--output-path` is forwarded as `-buildOutput`; custom code must read and honor it. Local Windows build exited 0. |

## Pipeline Editor catalog

All commands in this section were returned by the actual
`unity list --project-path <probe> --format json` response for Editor
`6000.3.14f1`. Parameters marked `*` are required. Unless stated otherwise,
the mode is **Pipeline Editor**, the output is the JSON result inside the CLI
envelope, and the command is **locally enumerated**.

### Assets, files, importers, and search

| Command (parameters) | Purpose and notable effects |
| --- | --- |
| `create_asset(path*, type*, shader, confirm, dry_run)` | Create a Unity object asset under the authoring root. |
| `create_folder(path*)` | Create a folder and intermediate folders. |
| `find_assets(type, name, label, search_in, limit)` | Query Asset Database; at least one filter is required. |
| `import_asset(source*, path*, confirm, dry_run)` | Copy an external file into the authoring root and import it. |
| `copy_asset(asset*, destination*, confirm, dry_run)` | Copy with a fresh GUID. |
| `move_asset(asset*, destination*, dry_run)` | Move/rename while preserving GUID. |
| `rename_asset(asset*, new_name*, dry_run)` | Rename in the same folder, preserving GUID. |
| `delete_asset(asset*, confirm, dry_run)` | Permanently delete an asset; confirmation required. |
| `read_text_file(path*, max_bytes)` | Read UTF-8 below the authoring root. |
| `write_text_file(path*, contents*, confirm, dry_run)` | Write/import UTF-8; overwrite requires confirmation. |
| `get_import_settings(asset*, platform)` | Return structured texture/model/audio importer settings. |
| `set_import_settings(asset*, settings*, platform, dry_run)` | Change importer settings and reimport. |
| `search(query*, limit)` | Run a Unity Search query. |

The asset write/read/copy/move/delete cycle was locally verified. Bare paths
resolve under the authoring root; traversal and paths outside it are rejected.

### Scenes, GameObjects, components, scripts, and selection

| Command (parameters) | Purpose and notable effects |
| --- | --- |
| `create_scene(path*, additive, template)` | Create and save a scene. |
| `open_scene(path*, additive)` | Open an existing scene. |
| `save_scene(path)` | Save the selected or active scene. |
| `save_all()` | Save all dirty open scenes. |
| `list_open_scenes()` | Return load/active/dirty state. |
| `set_active_scene(path*)` | Select the active scene. |
| `get_scene_hierarchy(path)` | Return a reusable object-identity tree. |
| `add_scene_to_build(path*, enabled)` | Idempotently add/enable a Build Settings scene. |
| `remove_scene_from_build(path*)` | Idempotently remove a Build Settings scene. |
| `create_gameobject(name, primitive, parent)` | Create an empty object or built-in primitive. |
| `create_gameobjects(name, primitive, parent, count, positions, rotations, scales)` | Batch-create objects with optional transforms. |
| `find_gameobjects(name, tag, type, hierarchy_path, include_inactive)` | Query loaded scene objects with combined filters. |
| `rename_gameobject(target*, name*)` | Rename with Unity Undo. |
| `delete_gameobject(target*)` | Delete with Unity Undo. |
| `set_active(target*, active*)` | Set `activeSelf`. |
| `set_transform(target*, position, rotation, scale)` | Set selected local transform channels. |
| `set_parent(target*, parent, world_position_stays)` | Reparent or detach. |
| `set_tag(target*, tag*)` | Assign an existing project tag. |
| `set_layer(target*, layer*)` | Assign a layer by name or index. |
| `add_component(target*, type*)` | Add a component by compiled type name. |
| `remove_component(target*, type)` | Remove a component by handle or GameObject plus type. |
| `get_component_properties(target*, type)` | Read serialized component properties. |
| `set_component_properties(target*, properties*, type)` | Set multiple serialized properties as one Undo step. |
| `create_script(name*, path, namespace, base_class, overwrite)` | Generate a C# script; compilation must finish before attachment. |
| `attach_script(target*, type, script)` | Attach by compiled type or script path, exactly one of the two. |
| `get_serialized_fields(target*, field, component)` | Read all or one serialized property, including object handles. |
| `set_serialized_field(target*, field*, value*, component)` | Write primitives, enums, structs, object references, and array paths. |
| `get_selection()` | Return current Editor selection. |
| `set_selection(instance_ids, paths)` | Select scene objects/assets. |

Scene creation/save, hierarchy reads, object creation/rename/transform, component
add/read, script compilation/attachment, and Build Settings insertion were
locally verified. GameObject authoring commands are rejected while the Editor
is in Play Mode.

### Prefabs

| Command (parameters) | Purpose and notable effects |
| --- | --- |
| `create_prefab(source*, path*)` | Save a GameObject as a connected prefab instance. |
| `instantiate_prefab(prefab*, scene_path, name)` | Instantiate into a loaded scene. |
| `create_prefab_variant(base*, path*)` | Create an inherited variant. |
| `apply_prefab_overrides(instance*)` | Apply instance overrides to the source asset. |
| `revert_prefab_overrides(instance*)` | Revert instance overrides. |
| `save_prefab_contents(prefab*, rename_child, new_name, set_active_child, active)` | Open in an isolated prefab stage, perform a declarative edit, and save. |
| `unpack_prefab(instance*, completely)` | Unpack the outermost level or completely. |

Creation, instantiation, apply, isolated save, and variant creation were locally
verified. Prefab asset writes are not equivalent to a reversible scene Undo.

### Animation and Timeline

| Command (parameters) | Purpose and notable effects |
| --- | --- |
| `create_animation_clip(path*, frameRate, loop, confirm, dry_run)` | Create an empty `.anim`. |
| `get_animation_clip(clip*, includeKeys)` | Read metadata and curve bindings/keys. |
| `set_animation_curve(clip*, path, type*, property*, keys*, dry_run)` | Add or replace one float curve. |
| `remove_animation_curve(clip*, path, type*, property*, confirm, dry_run)` | Remove a curve; confirmation required. |
| `create_animator_controller(path*, confirm, dry_run)` | Create a controller with Base Layer. |
| `get_animator_controller(controller*)` | Read parameters, layers, states, motions, and transitions. |
| `add_animator_layer(controller*, name*, weight, blendingMode, dry_run)` | Add a controller layer. |
| `add_animator_parameter(controller*, name*, type*, defaultValue, dry_run)` | Add Float/Int/Bool/Trigger parameter. |
| `add_animator_state(controller*, layer, name*, motion, isDefault, position, dry_run)` | Add a state and optional motion/default assignment. |
| `add_animator_transition(controller*, layer, fromState*, toState*, conditions, hasExitTime, exitTime, duration, hasFixedDuration, dry_run)` | Add and validate a transition. |
| `create_timeline(path*, frameRate, confirm, dry_run)` | Create a TimelineAsset; requires `com.unity.timeline`. |
| `get_timeline(timeline*)` | Read Timeline structure. |
| `add_timeline_track(timeline*, trackType*, name, parentTrack, dry_run)` | Add supported track type; Timeline package required. |
| `add_timeline_clip(timeline*, track*, start*, duration*, asset, dry_run)` | Add a track clip; Timeline package required. |

These schemas were locally enumerated but the animation/Timeline mutation
paths were not exercised.

### Materials and shaders

| Command (parameters) | Purpose and notable effects |
| --- | --- |
| `list_shaders(filter, includeBuiltin, limit)` | Discover usable shader names and support state. |
| `get_shader_properties(shader, material)` | Return shader declarations, types, ranges, dimensions, and flags. |
| `get_material_properties(material*)` | Read shader, render queue, keywords, and property values. |
| `set_material_properties(material*, shader, properties, renderQueue, enableKeywords, disableKeywords, confirm, dry_run)` | Assign shader/properties/queue/keywords with validation. |

### Project settings

| Read command | Write command and parameters | Scope and side effects |
| --- | --- | --- |
| `get_audio_settings()` | `set_audio_settings(settings, confirm, dry_run)` | Audio settings; write is confirmed and not Undo-able. |
| `get_build_settings()` | `set_build_settings(settings, confirm, dry_run)` | Mutable user build fields; scenes and target use dedicated commands. |
| `get_graphics_settings()` | `set_graphics_settings(settings, confirm, dry_run)` | Default render pipeline; not Undo-able. |
| `get_input_settings()` | `set_input_settings(settings, confirm, dry_run)` | Legacy Input Manager axis tuning; not Undo-able. |
| `get_lighting_settings()` | `set_lighting_settings(settings*, dry_run)` | Active LightingSettings subset. |
| `get_navmesh_settings()` | `set_navmesh_settings(settings*, dry_run)` | Default legacy agent bake subset. |
| `get_physics_settings()` | `set_physics_settings(settings, confirm, dry_run)` | Physics settings; not Undo-able. |
| `get_player_settings()` | `set_player_settings(settings, confirm, dry_run)` | PlayerSettings; backend/API changes can reload the domain. |
| `get_quality_settings()` | `set_quality_settings(settings, confirm, dry_run)` | Quality settings; not Undo-able. |
| `get_tags_layers()` | `set_tags_layers(settings, confirm, dry_run)` | Tags and user layers 8–31; not Undo-able. |
| `get_time_settings()` | `set_time_settings(settings, confirm, dry_run)` | Time settings; not Undo-able. |
| `get_authoring_root()` | `set_authoring_root(root*)` | Read or constrain the base folder below `Assets`. |
| — | `switch_build_target(target*, confirm)` | Long-running reimport/domain reload; poll `switch_build_target_status()`. |
| — | `switch_build_target_status()` | Return idle/switching/completed and active target. |
| — | `list_build_targets()` | Return targets, groups, and installed support. |
| — | `list_build_profiles()` | Unity 6 Build Profile discovery. |

### Lighting, navigation, and occlusion

| Command (parameters) | Purpose and notable effects |
| --- | --- |
| `bake_lighting(confirm, dry_run)` | Start async `Lightmapping.BakeAsync`; poll status. |
| `lighting_bake_status()` | Return idle/baking/completed. |
| `cancel_lighting_bake()` | Cancel lighting bake. |
| `clear_baked_lighting(confirm, include_disk_cache, dry_run)` | Destructive clear; confirmation required. |
| `bake_navmesh(confirm, dry_run)` | Start async legacy NavMesh bake. |
| `navmesh_bake_status()` | Return idle/baking/completed. |
| `cancel_navmesh_bake()` | Cancel legacy bake. |
| `clear_navmesh(confirm, dry_run)` | Destructive clear; confirmation required. |
| `bake_navmesh_surfaces()` | AI Navigation bridge; returns `package_not_found` when absent and is described as a v1 stub. |
| `bake_occlusion_culling(smallest_occluder, smallest_hole, backface_threshold, confirm, dry_run)` | Start async occlusion bake. |
| `occlusion_bake_status()` | Return idle/baking/completed. |
| `cancel_occlusion_bake()` | Cancel occlusion bake. |
| `clear_occlusion_culling(confirm, dry_run)` | Destructive clear; confirmation required. |

The schemas were enumerated; no expensive bake was run.

### Build, compilation, tests, and packages

| Command (parameters) | Purpose and notable effects |
| --- | --- |
| `build(target, outputPath, profileName, options, scenes, confirm, dry_run)` | Queue an actual Player build. Confirmation required; poll status. **Verified.** |
| `build_status()` | Return idle/queued/building/completed and the retained full `BuildReport`: files, packed assets, steps, errors, warnings. **Verified.** |
| `get_build_settings()` | Read active target, options, and scenes. **Verified.** |
| `list_build_targets()` | Discover build targets and installed support. **Verified.** |
| `list_build_profiles()` | Discover Unity 6 Build Profiles. |
| `switch_build_target(target*, confirm)` | Start target switch/reimport; confirmation required. |
| `switch_build_target_status()` | Poll target-switch status. |
| `recompile(focus)` | Force script compilation even while unfocused. **Verified.** |
| `recompile_status()` | Return idle/triggered/compiling/completed/up_to_date. **Verified.** |
| `list_tests(mode)` | Enumerate EditMode/PlayMode tests. **Verified.** |
| `run_tests(mode, filter, filter_type, include_explicit, async_tests, timeout)` | Execute tests with filters. **EditMode verified.** |
| `test_status()` | Poll an asynchronous test run. |
| `cancel_tests()` | Cancel test execution. |
| `package_add(identifier*, confirm, dry_run, wait)` | Add UPM package; async by default, then compile/reload. |
| `package_remove(name*, confirm, dry_run, wait)` | Remove UPM package; async by default, then compile/reload. |
| `package_resolve()` | Refresh manifest dependencies; may compile/reload. |
| `package_list(scope, include_indirect, offline)` | Synchronously list installed/registry/all packages. |
| `package_search(query, offline)` | Synchronously search the registry. |
| `package_status()` | Poll the most recent add/remove/resolve operation. |

Pipeline `build` accepted the scene and `Development` option, returned a build
ID immediately, and later returned a successful detailed report. This is a
genuine built-in build path and is materially different from top-level
`unity build`.

### Editor lifecycle, observation, capture, and arbitrary code

| Command (parameters) | Purpose and notable effects |
| --- | --- |
| `editor_status()` | Detailed Editor and project state. **Verified.** |
| `editor_play()`, `editor_pause()`, `editor_stop()` | Control Play Mode. |
| `editor_focus()` | Bring the Editor window forward. |
| `set_autotick(enable, interval_ms)` | Keep an unfocused Editor ticking. |
| `menu(path)` | List or execute Editor menu items. Menu execution may have arbitrary side effects. |
| `console(tail, level, since)` | Cursor-based captured log stream, shared with Player. |
| `get_console_logs(severity, limit)` | Structured recent Editor logs. |
| `clear_console()` | Clear Pipeline log buffer and Editor console. |
| `get_performance_stats()` | Read frame/render/memory counters. |
| `capture_game_view(width, height, camera, save_path, include_inline_image, max_resolution)` | Return PNG inline and/or save it. |
| `capture_scene_view(width, height, save_path, include_inline_image, max_resolution)` | Capture active Scene View. |
| `screenshot(view, output, width, height)` | Save Scene/Game view PNG and return its path. |
| `eval(code*, timeout)` | Compile and execute arbitrary C# with Roslyn. **Extension-equivalent risk.** |
| `eval_file(file*, timeout)` | Execute arbitrary C# from a file. **Extension-equivalent risk.** |
| `reload_file(filename*, timeout, assemblyDir, pdb)` | Apply `[HotReload]` method edits. |
| `reload_file_override(filename*, timeout, assemblyDir)` | Compile/apply an override immediately. |

`eval`, `eval_file`, menu items, and user-defined commands make the potential
surface as broad as the Unity Editor API, but they must not be reclassified as
finite built-in scene/build/etc. features.

Package documentation also describes `capture_editor_element` and
`capture_runtime_element` for Unity `6000.7+`. They were **not** returned by
the local `6000.3.14f1` catalog and are therefore documented but unavailable
in this environment.

## Pipeline Player catalog

Runtime support is compiled only for `UNITY_EDITOR` or
`UNITY_STANDALONE && DEBUG`. A scene must contain
`Unity.Pipeline.RuntimePipelineManager` with `enableInBuilds=true`; the package
must be present, `autoStart` normally remains enabled, and the build must be a
standalone Development Build. It should never be enabled in a production
Player.

The locally verified Player returned exactly these 14 tools:

| Command (parameters) | Capability |
| --- | --- |
| `runtime_status()` | Unity/platform/build/scene/time/performance/memory state. **Verified.** |
| `quit(exitCode)` | Gracefully schedule application exit. **Verified.** |
| `set_target_framerate(frameRate*)` | Change target frame rate. |
| `set_timescale(scale*)` | Change `Time.timeScale`. **Verified.** |
| `simulate_key(key*, action)` | Simulate Input System keyboard down/up/press. |
| `simulate_pointer(x*, y*, action, button)` | Simulate Input System pointer events. |
| `log(message*, level)` | Write to the Unity console. **Verified.** |
| `console(tail, level, since)` | Read captured logs with a cursor. |
| `eval(code*, timeout)` | Execute arbitrary runtime C# with Roslyn. |
| `eval_file(file*, timeout)` | Execute C# from a local file. |
| `reload_file(filename*, timeout, assemblyDir, pdb)` | Apply in-place `[HotReload]` edits. |
| `reload_file_override(filename*, timeout, assemblyDir)` | Apply override source immediately. |
| `hotreload_status()` | Inspect hot-reload registry/statistics. |
| `cleanup_hotreload(assemblyDir*, force_domain_reload)` | Delete old hot-reload DLL versions and clear registry. |

Scene, prefab, Asset Database, UPM, Editor test, and build-authoring tools are
not available in the Player catalog.

## Extension surfaces

The following mechanisms are intentionally classified separately from built-in
capabilities:

- `eval` and `eval_file`: arbitrary C# in a connected Editor or Development
  Player.
- `[CliCommand]`: package/user-defined commands that join the Pipeline catalog.
- top-level `build --execute-method` and `run -- -executeMethod ...`: arbitrary
  static Editor code in batch mode.
- `unity-<name>`: external executable plugins discovered by command name.
- `unity mcp`: exposes the current Pipeline catalog and schemas to an MCP
  client. MCP does not itself add scene/build capabilities; its available tools
  are the commands returned by Pipeline and any installed extensions.

Because these can call arbitrary Unity or .NET APIs, “everything the API can
do” is an extensibility statement, not a list of built-in Unity CLI abilities.

## Automation contract

### Output formats and streams

Global `--format` accepts `human`, `json`, `tsv`, and `ndjson`; it can also be
set with `UNITY_FORMAT`.

- `human` is for terminals.
- `json` normally emits `{ success, command, data, errors, warnings }`.
- `tsv` is intended for shell pipelines and tabular data.
- `ndjson` is appropriate for progress/event streams.
- Diagnostics and errors can appear on stderr. Batch commands may also stream
  Editor logs and progress before the final JSON object, so consumers must not
  assume the entire stdout stream is one JSON document.
- Pipeline results can themselves contain serialized JSON strings, for
  example the locally observed detailed `build_status` result. Consumers may
  need a second JSON parse.

Use `--no-banner`, `--quiet`, `--verbose`, and `--non-interactive` as
appropriate. `--non-interactive` disables prompts and is required for
predictable CI behavior; it does not bypass explicit safety confirmations.

### Exit codes

The documented base contract is exit `0` for success, `1` for a general
failure, and `130` for interruption. The local beta adds more command-specific
codes; local validation observed exit `6` for a rejected/failed command.
Release notes also identify dedicated authentication and termination/build
handling. Automation must treat any nonzero code as failure and use the
structured error code rather than hard-coding only `1`.

### Timeouts and environment

Global environment variables exposed by local help are:

`UNITY_FORMAT`, `UNITY_NO_BANNER`, `UNITY_NON_INTERACTIVE`, `UNITY_QUIET`,
`UNITY_VERBOSE`, `UNITY_PROXY`, and `UNITY_LOG_PROXY`.

Common command-specific variables include `UNITY_EDITOR_VERSION`,
`UNITY_ARCHITECTURE`, `UNITY_RUN_TIMEOUT`, and `UNITY_TEST_TIMEOUT`. Prefer
explicit command arguments in audited CI jobs. Connected `command` calls
default to a 30-second timeout; async Pipeline operations should be polled via
their status commands rather than given an arbitrarily long synchronous
timeout.

### Logging, proxying, and secrets

- `--proxy` supports HTTP/HTTPS/SOCKS/PAC forms. Proxy URLs can include
  credentials; never print them.
- `--log-proxy` or `UNITY_LOG_PROXY=1` writes
  `proxy-request.json`; use only for a focused support reproduction and review
  it as sensitive data. `--no-log-proxy` overrides persisted logging.
- Editor batch logs can include process arguments and transient authentication
  material. Route logs to protected files, avoid publishing raw logs as CI
  artifacts, redact before sharing, and prefer no-tail/log-file options where
  the command offers them.
- Do not store account names, email addresses, tokens, serials, license
  identifiers, descriptor bearer tokens, or proxy credentials in command
  output snapshots.
- Pipeline descriptor files are credentials. Preserve their user-only
  permissions and do not commit them.

### Mutation safety

Pipeline confines authoring paths below `Assets` and the current authoring
root. Many destructive or overwrite operations expose `dry_run` and/or require
`confirm=true`; `dry_run` takes precedence. Scene and GameObject changes
generally use Unity Undo. Asset deletion, settings, UPM, target switching,
builds, and disk-cache operations are commonly not Undo-able.

Outside Pipeline, treat these commands as especially consequential:

- `uninstall`, `upgrade`, module changes, `self-uninstall`, and `cache clean`;
- `license return` and activation/server changes;
- project upgrade/import/export and template deletion;
- Cloud/VCS link changes, especially `projects unlink vcs`, which can remove
  all Git remotes.

## Minimal verified examples

The placeholders deliberately avoid machine-specific paths and credentials.

```powershell
# Discover the connected Editor and actual tool schemas.
unity status --format json
unity list --project-path <project> --format json

# Scene and object authoring in a running Editor.
unity command --project-path <project> create_scene `
  --path Assets/Probe/Probe.unity
unity command --project-path <project> create_gameobject `
  --name ProbeCube --primitive cube
unity command --project-path <project> add_component `
  --target /ProbeCube --type Rigidbody
unity command --project-path <project> save_scene

# Prefab creation and a declarative prefab edit.
unity command --project-path <project> create_prefab `
  --source /ProbeCube --path Assets/Probe/ProbeCube.prefab
unity command --project-path <project> save_prefab_contents `
  --prefab Assets/Probe/ProbeCube.prefab `
  --rename_child ProbeCube --new_name RenamedProbeCube

# Compile, poll, then attach a generated type.
unity command --project-path <project> recompile
unity command --project-path <project> recompile_status
unity command --project-path <project> attach_script `
  --target /ProbeCube --type ProbeBehaviour

# Pipeline test execution.
unity command --project-path <project> list_tests --mode EditMode
unity command --project-path <project> run_tests `
  --mode EditMode --filter CapabilityProbe.Tests

# Built-in Pipeline Player build; poll build_status after the queued response.
unity command --project-path <project> build `
  --target StandaloneWindows64 `
  --outputPath Builds/Probe.exe `
  --scenes Assets/Probe/Probe.unity `
  --confirm true
unity command --project-path <project> build_status

# Top-level batch test produces NUnit XML.
unity test <project> --mode EditMode `
  --output Logs/test-results.xml `
  --editor-version 6000.3.14f1 --non-interactive

# Top-level batch build requires project code with this static method.
unity build <project> --target StandaloneWindows64 `
  --execute-method CapabilityProbeBuild.PerformBuild `
  --output-path Builds/Probe.exe `
  --editor-version 6000.3.14f1 --non-interactive

# Preview MCP client configuration without writing it.
unity mcp configure codex --project-path <project> --dry-run

# Connect to an explicitly instrumented Development Player.
unity list --runtime-path <player-directory> --format json
unity command --runtime-path <player-directory> runtime_status
unity command --runtime-path <player-directory> quit --exitCode 0
```

Dynamic Pipeline parameters are ordinary named options (`--path`, `--target`,
and so on). Shell text such as `path=value` is passed as a positional value and
is not equivalent.

## Network and version constraints

- Unity CLI and Pipeline are experimental; command names, schemas, formats, and
  error codes can change.
- Editor/Hub/module/release/template/package/Cloud/VCS/auth operations can need
  network access. Registry queries can block unless offline options exist.
- Pipeline requires Unity 6+. Individual tools can require additional packages
  such as Timeline, AI Navigation, Input System, or Test Framework.
- The tested Pipeline Player implementation is standalone Development-only.
- Cloud Production Pipeline REST APIs are a separate, currently limited
  service surface and must not be confused with the local
  `com.unity.pipeline` command server.
- Always regenerate `unity --help`, nested help, `unity changelog`, and
  `unity list --format json` after upgrading the CLI, Editor, or Pipeline.

## Official sources

- [Introduction to the Unity command-line interface](https://docs.unity.com/en-us/unity-cli/unity-cli)
- [Unity CLI reference](https://docs.unity.com/en-us/unity-cli/unity-cli-reference)
- [Unity CLI release notes](https://docs.unity.com/en-us/unity-cli/release-notes)
- [Unity Production Pipeline overview](https://docs.unity.com/en-us/unity-production-pipeline/overview)
- [Local Unity Pipeline package](https://docs.unity.com/en-us/unity-production-pipeline/local-tools-cli/unity-pipeline-package)
- [Cloud Pipeline API](https://docs.unity.com/en-us/unity-production-pipeline/pipeline-api)
