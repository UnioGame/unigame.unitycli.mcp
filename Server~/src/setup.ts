#!/usr/bin/env node

import { executeSetup } from "./setup/manager.js";
import type { SetupRequest } from "./setup/types.js";

const input = await readStdin();
try {
  const request = JSON.parse(input) as SetupRequest;
  const response = await executeSetup(request);
  process.stdout.write(`${JSON.stringify(response)}\n`);
  process.exitCode = response.ok ? 0 : 1;
} catch (error) {
  process.stdout.write(
    `${JSON.stringify({
      ok: false,
      operation: "handshake",
      changes: [],
      warnings: [],
      errors: [error instanceof Error ? error.message : String(error)],
      backup: null,
      restartRequired: [],
      data: {},
    })}\n`,
  );
  process.exitCode = 1;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}
