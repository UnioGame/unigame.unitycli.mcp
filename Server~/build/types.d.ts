export type ToolSource = "cli" | "editor" | "player" | "service";
export interface CatalogParameter {
    name: string;
    cliName?: string;
    type: string;
    description: string;
    required: boolean;
    default?: unknown;
    positional?: boolean;
    multiple?: boolean;
}
export interface CatalogTool {
    name: string;
    toolName: string;
    description: string;
    source: ToolSource;
    command: string[];
    dangerous?: boolean;
    parameters: CatalogParameter[];
}
export interface ToolCatalog {
    schemaVersion: 1;
    source: Exclude<ToolSource, "service">;
    productVersion: string;
    editorVersion?: string;
    generatedAt: string;
    tools: CatalogTool[];
}
export interface ProcessResult {
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
    durationMs: number;
}
export interface ParsedOutput {
    data: unknown;
    progress: unknown[];
    text: string | null;
    validJson: boolean;
}
export interface ToolkitResult {
    ok: boolean;
    source: ToolSource;
    command: string;
    target: string | null;
    exitCode: number | null;
    data: unknown;
    warnings: unknown[];
    errors: unknown[];
    durationMs: number;
    logs?: {
        stdout?: string;
        stderr?: string;
    };
}
//# sourceMappingURL=types.d.ts.map