import type { ProcessResult } from "./types.js";
export interface RunProcessOptions {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
    signal?: AbortSignal;
    maxOutputBytes?: number;
}
export declare function runProcess(executable: string, args: string[], options?: RunProcessOptions): Promise<ProcessResult>;
//# sourceMappingURL=process.d.ts.map