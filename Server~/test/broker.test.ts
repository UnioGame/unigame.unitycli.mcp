import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  acquireBrokerStartLock,
  liveBrokerLeases,
  releaseBrokerStartLock,
  type BrokerLease,
} from "../src/setup/broker.js";

const temporary: string[] = [];
afterEach(async () => {
  while (temporary.length)
    await rm(temporary.pop()!, { recursive: true, force: true });
});

function lease(
  id: string,
  changes: Partial<BrokerLease> = {},
): BrokerLease {
  return {
    schema_version: 1,
    editor_instance_id: id,
    owner_pid: 1234,
    owner_started_at_utc: "2026-07-25T00:00:00.000Z",
    heartbeat_at_utc: "2026-07-25T00:00:05.000Z",
    lease_expires_at_utc: "2026-07-25T00:00:15.000Z",
    ...changes,
  };
}

describe("shared HTTP broker", () => {
  it("prevents duplicate startup while a live lock owner exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "unity-broker-lock-"));
    temporary.push(root);
    const path = join(root, "broker-start.lock");
    const first = await acquireBrokerStartLock(path, {
      now: new Date("2026-07-25T00:00:00.000Z"),
      ownerPid: 100,
      ownerStartedAtUtc: "2026-07-24T23:00:00.000Z",
      processMatches: () => true,
    });
    const second = await acquireBrokerStartLock(path, {
      now: new Date("2026-07-25T00:00:20.000Z"),
      processMatches: () => true,
    });
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(await releaseBrokerStartLock(path, first!)).toBe(true);
  });

  it("reclaims a stale dead lock and narrowly releases only its own token", async () => {
    const root = await mkdtemp(join(tmpdir(), "unity-broker-lock-"));
    temporary.push(root);
    const path = join(root, "broker-start.lock");
    const first = await acquireBrokerStartLock(path, {
      now: new Date("2026-07-25T00:00:00.000Z"),
      processMatches: () => false,
    });
    const reclaimed = await acquireBrokerStartLock(path, {
      now: new Date("2026-07-25T00:00:20.000Z"),
      processMatches: () => false,
      staleAfterMs: 10_000,
    });
    expect(reclaimed).not.toBeNull();
    expect(await releaseBrokerStartLock(path, first!)).toBe(false);
    expect(existsSync(path)).toBe(true);
    expect(await releaseBrokerStartLock(path, reclaimed!)).toBe(true);
  });

  it("keeps independent fresh leases and rejects expiry, PID reuse, and malformed fields", async () => {
    const root = await mkdtemp(join(tmpdir(), "unity-broker-leases-"));
    temporary.push(root);
    await mkdir(root, { recursive: true });
    const first = lease("first");
    const second = lease("second");
    const expired = lease("expired", {
      lease_expires_at_utc: "2026-07-25T00:00:04.000Z",
    });
    const reused = lease("reused", { owner_pid: 9999 });
    await writeFile(join(root, "first.json"), JSON.stringify(first));
    await writeFile(join(root, "second.json"), JSON.stringify(second));
    await writeFile(join(root, "expired.json"), JSON.stringify(expired));
    await writeFile(join(root, "reused.json"), JSON.stringify(reused));
    await writeFile(join(root, "malformed.json"), JSON.stringify({
      ...lease("malformed"),
      ownerPid: 1234,
    }));
    const live = await liveBrokerLeases(root, {
      now: new Date("2026-07-25T00:00:06.000Z"),
      processMatches: (entry) => entry.owner_pid === 1234,
    });
    expect(live.map((entry) => entry.editor_instance_id)).toEqual(["first", "second"]);
    expect(existsSync(join(root, "expired.json"))).toBe(false);
    expect(existsSync(join(root, "reused.json"))).toBe(false);
    expect(existsSync(join(root, "malformed.json"))).toBe(false);
    expect(await readFile(join(root, "first.json"), "utf8")).toContain("heartbeat_at_utc");
  });

  it("expires a heartbeat that is older than ten seconds even if its lease date is future", async () => {
    const root = await mkdtemp(join(tmpdir(), "unity-broker-heartbeat-"));
    temporary.push(root);
    await writeFile(join(root, "old.json"), JSON.stringify(lease("old", {
      heartbeat_at_utc: "2026-07-25T00:00:00.000Z",
      lease_expires_at_utc: "2026-07-25T00:01:00.000Z",
    })));
    expect(await liveBrokerLeases(root, {
      now: new Date("2026-07-25T00:00:11.000Z"),
      processMatches: () => true,
    })).toEqual([]);
  });
});
