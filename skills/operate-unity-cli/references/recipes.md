# Unity CLI recipes

## Contents

- [Environment bootstrap](#environment-bootstrap)
- [Connected Editor authoring](#connected-editor-authoring)
- [Compilation and tests](#compilation-and-tests)
- [Player build](#player-build)
- [Development Player](#development-player)
- [Failure recovery](#failure-recovery)

## Environment bootstrap

```sh
unity --version
unity doctor --format json
unity editors list --format json
unity auth status --format json
unity projects info <project> --format json
```

Install Pipeline only after confirming the target:

```sh
unity pipeline list --project-path <project> --format json
unity pipeline install --project-path <project> --package-version 0.4.0-exp.1
unity status --format json
unity list --project-path <project> --format json
```

## Connected Editor authoring

```sh
unity command --project-path <project> set_authoring_root \
  --root Assets/Automation --confirm true
unity command --project-path <project> create_scene \
  --path Scenes/Automation.unity --confirm true
unity command --project-path <project> create_gameobject \
  --name ProbeCube --primitive cube --confirm true
unity command --project-path <project> set_transform \
  --target /ProbeCube --position '[0,1,0]' --confirm true
unity command --project-path <project> create_prefab \
  --source /ProbeCube --path Prefabs/ProbeCube.prefab --confirm true
unity command --project-path <project> save_scene --confirm true
```

Use explicit `--confirm true` and `--dry_run true` according to the returned
schema. Read hierarchy and asset state after each logical mutation.

## Compilation and tests

```sh
unity command --project-path <project> recompile --confirm true
unity command --project-path <project> recompile_status
unity command --project-path <project> list_tests --mode EditMode
unity command --project-path <project> run_tests \
  --mode EditMode --filter Namespace.Tests

unity test <project> --mode EditMode \
  --output Logs/test-results.xml --non-interactive --format json
```

Poll asynchronous Pipeline tests with `test_status`.

## Player build

Connected Editor:

```sh
unity command --project-path <project> build \
  --target StandaloneWindows64 \
  --outputPath Builds/Game.exe \
  --scenes Assets/Scenes/Main.unity \
  --confirm true
unity command --project-path <project> build_status
```

Batch Editor:

```sh
unity build <project> \
  --target StandaloneWindows64 \
  --execute-method Company.Build.Perform \
  --output-path Builds/Game.exe \
  --non-interactive --format json
```

The custom method must read `-buildOutput` and call `BuildPipeline.BuildPlayer`.

## Development Player

Add `Unity.Pipeline.RuntimePipelineManager` to a build scene, enable
`enableInBuilds`, and build with `Development`. Then:

```sh
unity list --runtime-path <player-directory> --format json
unity command --runtime-path <player-directory> runtime_status
unity command --runtime-path <player-directory> quit --exitCode 0
```

Do not ship the manager in production.

## Failure recovery

- `CLI_NOT_FOUND`: resolve `UNITY_CLI_PATH` or install the official CLI.
- `EDITOR_NOT_CONNECTED`: open the exact project and wait for `status=ready`.
- `PLAYER_NOT_CONNECTED`: verify Development Build, manager, and descriptor.
- `CONFIRMATION_REQUIRED`: obtain authorization, then retry with `confirm=true`.
- `TIMEOUT`: query the relevant status tool before retrying.
- `UPSTREAM_FAILED`: inspect sanitized stderr and the upstream structured error.
- Version mismatch: regenerate catalogs before relying on changed flags.
