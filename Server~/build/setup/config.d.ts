export declare const managedMarker = "unigame-unitycli-mcp";
export declare function fingerprint(value: unknown): string;
export declare function stripJsonComments(text: string): string;
export declare function parseJsonc(text: string): Record<string, unknown>;
export declare function patchServerJsonc(text: string, property: "mcpServers" | "servers", serverName: string, value: unknown | undefined): string;
export declare function managedTomlBlock(name: string, value?: {
    command: string;
    args: string[];
    env: Record<string, string>;
    url?: string;
    headers?: Record<string, string>;
}): string;
export declare function patchManagedToml(text: string, name: string, block: string): string;
export declare function managedTomlFingerprint(text: string, name: string): string | null;
//# sourceMappingURL=config.d.ts.map