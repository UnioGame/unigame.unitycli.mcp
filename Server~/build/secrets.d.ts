import type { CatalogTool } from "./types.js";
export declare function isSecretParameter(name: string): boolean;
export declare function resolveSecretInputs(tool: CatalogTool, input: Record<string, unknown>): Promise<Record<string, unknown>>;
//# sourceMappingURL=secrets.d.ts.map