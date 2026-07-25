export type ToolkitErrorCode = "CLI_NOT_FOUND" | "VERSION_MISMATCH" | "EDITOR_NOT_CONNECTED" | "PLAYER_NOT_CONNECTED" | "CONFIRMATION_REQUIRED" | "TIMEOUT" | "UPSTREAM_FAILED" | "INVALID_OUTPUT";
export declare class ToolkitError extends Error {
    readonly code: ToolkitErrorCode;
    readonly details?: unknown | undefined;
    constructor(code: ToolkitErrorCode, message: string, details?: unknown | undefined);
}
//# sourceMappingURL=errors.d.ts.map