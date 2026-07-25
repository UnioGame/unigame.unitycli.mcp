import type { AgentId, AgentRegistration, SetupContext, TransportName } from "./types.js";
export declare const supportedAgents: AgentId[];
export declare function discoverAgents(context: SetupContext): AgentRegistration[];
export declare function registrationValue(context: SetupContext, transport: TransportName, serverPath: string, tokenFile: string, port?: number): Record<string, unknown>;
//# sourceMappingURL=agents.d.ts.map