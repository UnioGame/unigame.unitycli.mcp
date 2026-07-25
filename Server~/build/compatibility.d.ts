import type { ToolSource } from "./types.js";
export declare function disconnectedTargetCode(source: ToolSource, output: string): "EDITOR_NOT_CONNECTED" | "PLAYER_NOT_CONNECTED" | null;
export declare function versionMismatchWarning(expected: string, installed: string | null): {
    code: "VERSION_MISMATCH";
    message: string;
} | null;
//# sourceMappingURL=compatibility.d.ts.map