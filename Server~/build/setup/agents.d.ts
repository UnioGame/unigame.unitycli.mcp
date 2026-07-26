import type { AgentId, AgentRegistration, SetupContext, TransportName } from "./types.js";
export declare const supportedAgents: AgentId[];
/** Parses the intentionally loose JSON returned by experimental Unity CLI builds. */
export declare function parseOfficialClientList(value: unknown): Map<AgentId, boolean>;
export declare function discoverAgents(context: SetupContext, official?: Map<AgentId, boolean>): AgentRegistration[];
export declare function registrationValue(context: SetupContext, unityCli: string, transport: TransportName, broker: {
    token_file: string;
    port: number;
}): Record<string, unknown>;
//# sourceMappingURL=agents.d.ts.map