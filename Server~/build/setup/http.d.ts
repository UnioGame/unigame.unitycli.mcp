export interface HttpOptions {
    host: "127.0.0.1";
    port: number;
    tokenFile?: string;
    ownerPid?: number;
    stateFile?: string;
}
export declare function runHttpServer(options: HttpOptions): Promise<void>;
//# sourceMappingURL=http.d.ts.map