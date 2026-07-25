import type { ToolCatalog } from "./types.js";
interface LiveParameter {
    name: string;
    type?: string;
    description?: string;
    required?: boolean;
    default?: unknown;
}
interface LiveTool {
    name: string;
    description?: string;
    parameters?: LiveParameter[];
}
export declare function mergeLiveSchemas(snapshot: ToolCatalog, liveTools: LiveTool[]): ToolCatalog;
export {};
//# sourceMappingURL=live-catalog.d.ts.map