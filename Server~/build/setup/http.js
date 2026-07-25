import { randomUUID } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createServer } from "../server.js";
export async function runHttpServer(options) {
    const sessions = new Map();
    const token = options.tokenFile
        ? (await readFile(options.tokenFile, "utf8")).trim()
        : "";
    const expectedReference = options.tokenFile
        ? `Bearer file:${options.tokenFile}`
        : "";
    const http = createHttpServer(async (request, response) => {
        try {
            if (!validHost(request, options.host) || !validOrigin(request)) {
                response.writeHead(403).end("Forbidden");
                return;
            }
            if (token &&
                request.headers.authorization !== `Bearer ${token}` &&
                request.headers.authorization !== expectedReference) {
                response.writeHead(401).end("Unauthorized");
                return;
            }
            if (request.url === "/health") {
                response
                    .writeHead(200, { "content-type": "application/json" })
                    .end(JSON.stringify({ ok: true, pid: process.pid, transport: "http" }));
                return;
            }
            if (request.url !== "/mcp") {
                response.writeHead(404).end("Not found");
                return;
            }
            const sessionId = header(request, "mcp-session-id");
            let transport = sessionId ? sessions.get(sessionId) : undefined;
            const body = request.method === "POST" ? await readBody(request) : undefined;
            if (!transport && request.method === "POST" && isInitializeRequest(body)) {
                transport = new StreamableHTTPServerTransport({
                    sessionIdGenerator: randomUUID,
                    onsessioninitialized: (id) => {
                        sessions.set(id, transport);
                    },
                });
                transport.onclose = () => {
                    if (transport?.sessionId)
                        sessions.delete(transport.sessionId);
                };
                await (await createServer()).connect(transport);
            }
            if (!transport) {
                response.writeHead(400).end("Invalid or missing MCP session");
                return;
            }
            await transport.handleRequest(request, response, body);
        }
        catch {
            if (!response.headersSent)
                response.writeHead(500).end("Internal error");
        }
    });
    await new Promise((resolve, reject) => {
        http.once("error", reject);
        http.listen(options.port, options.host, () => resolve());
    });
    const address = http.address();
    const port = typeof address === "object" && address ? address.port : options.port;
    if (options.stateFile) {
        await writeFile(options.stateFile, JSON.stringify({
            pid: process.pid,
            ownerPid: options.ownerPid ?? null,
            projectPath: process.env.UNITY_PROJECT_PATH ?? null,
            host: options.host,
            port,
            endpoint: `http://${options.host}:${port}/mcp`,
            startedAt: new Date().toISOString(),
        }, null, 2), { mode: 0o600 });
    }
    process.stdout.write(`${JSON.stringify({ ok: true, pid: process.pid, port, endpoint: `http://${options.host}:${port}/mcp` })}\n`);
    const close = async () => {
        for (const transport of sessions.values())
            await transport.close();
        await new Promise((resolve) => http.close(() => resolve()));
    };
    process.once("SIGTERM", () => void close().then(() => process.exit(0)));
    process.once("SIGINT", () => void close().then(() => process.exit(0)));
    if (options.ownerPid) {
        const timer = setInterval(() => {
            try {
                process.kill(options.ownerPid, 0);
            }
            catch {
                clearInterval(timer);
                void close().then(() => process.exit(0));
            }
        }, 2_000);
        timer.unref();
    }
}
function header(request, name) {
    const value = request.headers[name];
    return Array.isArray(value) ? value[0] : value;
}
function validHost(request, host) {
    const value = request.headers.host ?? "";
    return value === host || value.startsWith(`${host}:`) || value.startsWith("localhost:");
}
function validOrigin(request) {
    const origin = request.headers.origin;
    return !origin || origin.startsWith("http://127.0.0.1") || origin.startsWith("http://localhost");
}
async function readBody(request) {
    const chunks = [];
    for await (const chunk of request)
        chunks.push(Buffer.from(chunk));
    if (!chunks.length)
        return undefined;
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
//# sourceMappingURL=http.js.map