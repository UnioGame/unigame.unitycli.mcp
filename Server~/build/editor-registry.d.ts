export declare const editorMetadataSchemaVersion = 1;
export declare const editorLeaseExpiryMs = 10000;
export interface EditorMetadata {
    schema_version: number;
    metadata_revision: number;
    project_id: string;
    project_name: string;
    project_path: string;
    editor_instance_id: string;
    editor_pid: number;
    editor_started_at_utc: string;
    editor_version: string;
    package_version: string;
    pipeline_version: string;
    connection_state: string;
    heartbeat_at_utc: string;
    lease_expires_at_utc: string;
    pipeline_descriptor_path: string;
    capability_catalog_hash: string;
    tool_count: number;
    is_playing: boolean;
    is_compiling: boolean;
    compile_errors_count: number;
}
export interface EditorRegistrySnapshot {
    active_editors: EditorMetadata[];
    stale_editors: Array<EditorMetadata & {
        stale_reason: string;
    }>;
    corrupt_entries: Array<{
        path: string;
        error: string;
    }>;
}
export interface EditorSelectors {
    editor_instance_id?: string;
    project_id?: string;
    project_path?: string;
    projectPath?: string;
}
export interface RegistryOptions {
    dataPath?: string;
    now?: Date;
    processMatches?: (metadata: EditorMetadata) => boolean | Promise<boolean>;
}
export declare function defaultDataPath(): string;
export declare function normalizeProjectPath(path: string): string;
export declare function projectId(path: string): string;
export declare function validateEditorMetadata(value: unknown): EditorMetadata;
export declare function processMatchesStart(pid: number, startedAtUtc: string): Promise<boolean>;
export declare function discoverEditors(options?: RegistryOptions): Promise<EditorRegistrySnapshot>;
export declare function resolveEditor(selectors: EditorSelectors, options?: RegistryOptions): Promise<EditorMetadata>;
//# sourceMappingURL=editor-registry.d.ts.map