#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { runHttpServer } from "./setup/http.js";

const transportName = value("--transport") ?? "stdio";
if (transportName === "http") {
  await runHttpServer({
    host: "127.0.0.1",
    port: Number(value("--port") ?? "0"),
    tokenFile: value("--token-file"),
    ownerPid: Number(value("--owner-pid") ?? "0") || undefined,
    stateFile: value("--state-file"),
  });
} else {
  const server = await createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function value(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
