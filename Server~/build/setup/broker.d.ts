export interface BrokerLease {
    schema_version: 1;
    editor_instance_id: string;
    owner_pid: number;
    owner_started_at_utc: string;
    heartbeat_at_utc: string;
    lease_expires_at_utc: string;
}
export interface BrokerLeaseOptions {
    now?: Date;
    processMatches?: (lease: BrokerLease) => boolean | Promise<boolean>;
    cleanupStale?: boolean;
}
export interface BrokerStartLock {
    token: string;
    owner_pid: number;
    owner_started_at_utc: string;
    acquired_at_utc: string;
}
export declare function validateBrokerLease(value: unknown): BrokerLease;
export declare function liveBrokerLeases(directory: string, options?: BrokerLeaseOptions): Promise<BrokerLease[]>;
export declare function acquireBrokerStartLock(path: string, options?: {
    now?: Date;
    ownerPid?: number;
    ownerStartedAtUtc?: string;
    processMatches?: (lock: BrokerStartLock) => boolean | Promise<boolean>;
    staleAfterMs?: number;
}): Promise<BrokerStartLock | null>;
export declare function releaseBrokerStartLock(path: string, lock: BrokerStartLock): Promise<boolean>;
//# sourceMappingURL=broker.d.ts.map