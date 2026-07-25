import type { CatalogTool, ToolCatalog } from "./types.js";
export declare function loadCatalogs(): Promise<ToolCatalog[]>;
export declare function normalizeToolName(value: string): string;
export declare function inputSchema(tool: CatalogTool): Record<string, unknown>;
export declare function resolveUnityCli(): Promise<string | null>;
//# sourceMappingURL=catalog.d.ts.map