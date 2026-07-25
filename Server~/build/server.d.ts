import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { ToolCatalog } from "./types.js";
import { discoverEditors, type EditorSelectors, type RegistryOptions } from "./editor-registry.js";
interface LiveRefreshStatus {
    editor: boolean;
    player: boolean;
    warnings: string[];
}
export declare function selectSchemaRefreshEditor(snapshot: Awaited<ReturnType<typeof discoverEditors>>): {
    projectPath?: string;
    warning?: string;
};
export declare function refreshLivePipelineSchemas(catalogs: ToolCatalog[]): Promise<LiveRefreshStatus>;
export declare function editorConnectionSnapshot(selectors: EditorSelectors, registryOptions?: RegistryOptions): Promise<{
    active_editors: import("./editor-registry.js").EditorMetadata[];
    stale_editors: (import("./editor-registry.js").EditorMetadata & {
        stale_reason: string;
    })[];
    corrupt_entries: {
        path: string;
        error: string;
    }[];
    selected_editor: import("./editor-registry.js").EditorMetadata | null;
    selection_error: {
        code: import("./errors.js").ToolkitErrorCode;
        message: string;
        details: {} | null;
    } | null;
}>;
export declare function createServer(): Promise<Server>;
export {};
//# sourceMappingURL=server.d.ts.map