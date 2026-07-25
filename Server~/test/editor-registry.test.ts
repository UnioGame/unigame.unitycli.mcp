import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  discoverEditors,
  projectId,
  resolveEditor,
  validateEditorMetadata,
  type EditorMetadata,
} from "../src/editor-registry.js";
import {
  editorConnectionSnapshot,
  selectSchemaRefreshEditor,
} from "../src/server.js";

const temporary: string[] = [];

afterEach(async () => {
  delete process.env.UNITY_PROJECT_PATH;
  while (temporary.length)
    await rm(temporary.pop()!, { recursive: true, force: true });
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "unity-editor-registry-"));
  temporary.push(root);
  const dataPath = join(root, "data");
  const projectPath = resolve(root, "project");
  const descriptor = join(projectPath, "Library", "Pipeline", ".unity-pipeline-port");
  await mkdir(join(projectPath, "Library", "Pipeline"), { recursive: true });
  await writeFile(descriptor, "{\"port\":7900,\"token\":\"never-read\"}");
  return { root, dataPath, projectPath, descriptor };
}

function metadata(
  projectPath: string,
  descriptor: string,
  instance = "10000000-0000-4000-8000-000000000001",
  changes: Partial<EditorMetadata> = {},
): EditorMetadata {
  const now = new Date("2026-07-25T00:00:00.000Z");
  return {
    schema_version: 1,
    metadata_revision: 1,
    project_id: projectId(projectPath),
    project_name: "project",
    project_path: projectPath,
    editor_instance_id: instance,
    editor_pid: 1234,
    editor_started_at_utc: "2026-07-24T23:00:00.000Z",
    editor_version: "6000.3.14f1",
    package_version: "0.1.0",
    pipeline_version: "0.4.0-exp.1",
    connection_state: "ready",
    heartbeat_at_utc: now.toISOString(),
    lease_expires_at_utc: new Date(now.getTime() + 10_000).toISOString(),
    pipeline_descriptor_path: descriptor,
    capability_catalog_hash: "abc123",
    tool_count: 140,
    is_playing: false,
    is_compiling: false,
    compile_errors_count: 0,
    ...changes,
  };
}

async function publish(dataPath: string, value: EditorMetadata) {
  const directory = join(
    dataPath, "unity-cli-mcp", "registry", "editors", value.project_id,
  );
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, `${value.editor_instance_id}.json`),
    JSON.stringify(value),
  );
}

describe("dynamic Editor registry", () => {
  it("enforces a closed snake_case metadata contract recursively", async () => {
    const paths = await fixture();
    const value = metadata(paths.projectPath, paths.descriptor);
    expect(validateEditorMetadata(value)).toEqual(value);
    expect(() => validateEditorMetadata({ ...value, projectPath: value.project_path }))
      .toThrow(/additional property/);
    const assertSnakeCase = (item: unknown): void => {
      if (Array.isArray(item)) return item.forEach(assertSnakeCase);
      if (!item || typeof item !== "object") return;
      for (const [key, child] of Object.entries(item)) {
        expect(key).toMatch(/^[a-z][a-z0-9_]*$/);
        expect(key).not.toMatch(/[A-Z]/);
        assertSnakeCase(child);
      }
    };
    assertSnakeCase(value);
  });

  it("connection status always returns discovery for zero, one, ambiguous, and corrupt entries", async () => {
    const paths = await fixture();
    const options = {
      dataPath: paths.dataPath,
      now: new Date("2026-07-25T00:00:05.000Z"),
      processMatches: () => true,
    };
    const empty = await editorConnectionSnapshot({}, options);
    expect(empty).toMatchObject({
      active_editors: [],
      stale_editors: [],
      corrupt_entries: [],
      selected_editor: null,
      selection_error: { code: "TARGET_REQUIRED" },
    });

    const first = metadata(paths.projectPath, paths.descriptor);
    await publish(paths.dataPath, first);
    const single = await editorConnectionSnapshot({}, options);
    expect(single.selected_editor?.editor_instance_id).toBe(first.editor_instance_id);
    expect(single.selection_error).toBeNull();

    const second = metadata(
      paths.projectPath,
      paths.descriptor,
      "20000000-0000-4000-8000-000000000002",
    );
    await publish(paths.dataPath, second);
    const ambiguous = await editorConnectionSnapshot(
      { project_id: first.project_id },
      options,
    );
    expect(ambiguous.active_editors).toHaveLength(2);
    expect(ambiguous.selected_editor).toBeNull();
    expect(ambiguous.selection_error).toMatchObject({ code: "TARGET_AMBIGUOUS" });

    const directory = join(
      paths.dataPath, "unity-cli-mcp", "registry", "editors", first.project_id,
    );
    await writeFile(join(directory, "invalid.json"), "{broken");
    const invalid = await editorConnectionSnapshot(
      { editor_instance_id: "30000000-0000-4000-8000-000000000003" },
      options,
    );
    expect(invalid.corrupt_entries).toHaveLength(1);
    expect(invalid.selection_error).toMatchObject({ code: "TARGET_NOT_FOUND" });
  });

  it("selects a deterministic registry Editor only for schema refresh and warns on N", async () => {
    const paths = await fixture();
    const first = metadata(paths.projectPath, paths.descriptor);
    const second = metadata(
      join(paths.root, "second-project"),
      paths.descriptor,
      "20000000-0000-4000-8000-000000000002",
    );
    const none = selectSchemaRefreshEditor({
      active_editors: [],
      stale_editors: [],
      corrupt_entries: [],
    });
    expect(none).toEqual({ projectPath: undefined });
    const one = selectSchemaRefreshEditor({
      active_editors: [first],
      stale_editors: [],
      corrupt_entries: [],
    });
    expect(one).toEqual({ projectPath: first.project_path });
    const many = selectSchemaRefreshEditor({
      active_editors: [first, second],
      stale_editors: [],
      corrupt_entries: [],
    });
    expect(many.projectPath).toBe(first.project_path);
    expect(many.warning).toMatch(/Multiple ready Editors/);
  });

  it("derives stable project IDs from normalized absolute paths", async () => {
    const paths = await fixture();
    expect(projectId(paths.projectPath)).toBe(projectId(join(paths.projectPath, ".")));
    expect(projectId(paths.projectPath)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("classifies expired, PID-reused, descriptor-missing, and corrupt leases safely", async () => {
    const paths = await fixture();
    const first = metadata(paths.projectPath, paths.descriptor);
    const second = metadata(
      paths.projectPath,
      paths.descriptor,
      "20000000-0000-4000-8000-000000000002",
    );
    await publish(paths.dataPath, first);
    await publish(paths.dataPath, second);
    const directory = join(
      paths.dataPath, "unity-cli-mcp", "registry", "editors", first.project_id,
    );
    await writeFile(join(directory, "partial.json"), "{\"schema_version\":");
    const snapshot = await discoverEditors({
      dataPath: paths.dataPath,
      now: new Date("2026-07-25T00:00:05.000Z"),
      processMatches: (entry) => entry.editor_instance_id === first.editor_instance_id,
    });
    expect(snapshot.active_editors.map((entry) => entry.editor_instance_id))
      .toEqual([first.editor_instance_id]);
    expect(snapshot.stale_editors[0].stale_reason).toBe("editor_process_mismatch");
    expect(snapshot.corrupt_entries).toHaveLength(1);
  });

  it("uses selector precedence and never chooses a newest Editor on ambiguity", async () => {
    const paths = await fixture();
    const first = metadata(paths.projectPath, paths.descriptor);
    const second = metadata(
      paths.projectPath,
      paths.descriptor,
      "20000000-0000-4000-8000-000000000002",
      { metadata_revision: 999 },
    );
    await publish(paths.dataPath, first);
    await publish(paths.dataPath, second);
    const options = {
      dataPath: paths.dataPath,
      now: new Date("2026-07-25T00:00:05.000Z"),
      processMatches: () => true,
    };
    await expect(resolveEditor({ project_id: first.project_id }, options))
      .rejects.toMatchObject({ code: "TARGET_AMBIGUOUS" });
    await expect(resolveEditor({
      editor_instance_id: first.editor_instance_id,
      project_id: "ignored",
    }, options)).resolves.toMatchObject({ editor_instance_id: first.editor_instance_id });
  });

  it("returns stable missing, stale, not-ready, and required errors", async () => {
    const paths = await fixture();
    const value = metadata(paths.projectPath, paths.descriptor, undefined, {
      connection_state: "starting",
    });
    await publish(paths.dataPath, value);
    const readyTime = new Date("2026-07-25T00:00:05.000Z");
    await expect(resolveEditor({}, {
      dataPath: paths.dataPath, now: readyTime, processMatches: () => true,
    })).rejects.toMatchObject({ code: "TARGET_NOT_READY" });
    await expect(resolveEditor({ project_id: "missing" }, {
      dataPath: paths.dataPath, now: readyTime, processMatches: () => true,
    })).rejects.toMatchObject({ code: "TARGET_NOT_FOUND" });
    await expect(resolveEditor({ editor_instance_id: value.editor_instance_id }, {
      dataPath: paths.dataPath,
      now: new Date("2026-07-25T00:00:20.000Z"),
      processMatches: () => true,
    })).rejects.toMatchObject({ code: "TARGET_STALE" });
    await expect(resolveEditor({}, {
      dataPath: join(paths.root, "empty"),
    })).rejects.toMatchObject({ code: "TARGET_REQUIRED" });
  });

  it("keeps a live not-ready Editor discoverable before Pipeline publishes a descriptor", async () => {
    const paths = await fixture();
    const missingDescriptor = join(paths.projectPath, "Library", "Pipeline", "missing");
    const value = metadata(paths.projectPath, missingDescriptor, undefined, {
      connection_state: "not_ready",
    });
    await publish(paths.dataPath, value);
    const options = {
      dataPath: paths.dataPath,
      now: new Date("2026-07-25T00:00:05.000Z"),
      processMatches: () => true,
    };

    const snapshot = await discoverEditors(options);
    expect(snapshot.active_editors).toHaveLength(1);
    expect(snapshot.stale_editors).toHaveLength(0);
    await expect(resolveEditor({ editor_instance_id: value.editor_instance_id }, options))
      .rejects.toMatchObject({ code: "TARGET_NOT_READY" });
  });
});
