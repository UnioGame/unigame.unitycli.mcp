import { createHash } from "node:crypto";

export const managedMarker = "unigame-unitycli-mcp";

export function fingerprint(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")
    .slice(0, 16);
}

export function stripJsonComments(text: string): string {
  let result = "";
  let string = false;
  let escape = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    const next = text[index + 1];
    if (string) {
      result += char;
      if (escape) escape = false;
      else if (char === "\\") escape = true;
      else if (char === '"') string = false;
      continue;
    }
    if (char === '"') {
      string = true;
      result += char;
      continue;
    }
    if (char === "/" && next === "/") {
      while (index < text.length && text[index] !== "\n") index++;
      result += "\n";
      continue;
    }
    if (char === "/" && next === "*") {
      index += 2;
      while (
        index < text.length &&
        !(text[index] === "*" && text[index + 1] === "/")
      )
        index++;
      index++;
      continue;
    }
    result += char;
  }
  return result.replace(/,\s*([}\]])/g, "$1");
}

export function parseJsonc(text: string): Record<string, unknown> {
  if (!text.trim()) return {};
  return JSON.parse(stripJsonComments(text)) as Record<string, unknown>;
}

export function patchServerJsonc(
  text: string,
  property: "mcpServers" | "servers",
  serverName: string,
  value: unknown | undefined,
): string {
  const parsed = parseJsonc(text);
  const servers =
    parsed[property] && typeof parsed[property] === "object"
      ? (parsed[property] as Record<string, unknown>)
      : {};
  if (value === undefined) delete servers[serverName];
  else servers[serverName] = value;
  parsed[property] = servers;
  const comments = extractComments(text);
  return `${comments.length ? `${comments.join("\n")}\n` : ""}${JSON.stringify(parsed, null, 2)}\n`;
}

export function managedTomlBlock(name: string, value?: {
  command: string;
  args: string[];
  env: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}): string {
  if (!value) return "";
  const begin = `# ${managedMarker}:${name}:begin`;
  const end = `# ${managedMarker}:${name}:end`;
  if (value.url) {
    const headers = value.headers && Object.keys(value.headers).length
      ? `http_headers = { ${Object.entries(value.headers)
          .map(([key, entry]) => `${tomlKey(key)} = ${quote(entry)}`)
          .join(", ")} }\n`
      : "";
    return `${begin}\n[mcp_servers.${tomlKey(name)}]\nurl = ${quote(value.url)}\n${headers}${end}\n`;
  }
  return (
    `${begin}\n[mcp_servers.${tomlKey(name)}]\n` +
    `command = ${quote(value.command)}\n` +
    `args = [${value.args.map(quote).join(", ")}]\n` +
    `env = { ${Object.entries(value.env)
      .map(([key, entry]) => `${key} = ${quote(entry)}`)
      .join(", ")} }\n${end}\n`
  );
}

export function patchManagedToml(
  text: string,
  name: string,
  block: string,
): string {
  const begin = `# ${managedMarker}:${name}:begin`;
  const end = `# ${managedMarker}:${name}:end`;
  const start = text.indexOf(begin);
  const finish = text.indexOf(end);
  let base = text;
  if (start >= 0 && finish >= start) {
    const lineEnd = text.indexOf("\n", finish);
    base = text.slice(0, start) + text.slice(lineEnd < 0 ? text.length : lineEnd + 1);
  }
  return `${base.trimEnd()}${base.trim() && block ? "\n\n" : ""}${block}`;
}

export function managedTomlFingerprint(
  text: string,
  name: string,
): string | null {
  const begin = `# ${managedMarker}:${name}:begin`;
  const end = `# ${managedMarker}:${name}:end`;
  const start = text.indexOf(begin);
  const finish = text.indexOf(end, start + begin.length);
  if (start < 0 || finish < 0) return null;
  const block = text.slice(start, finish + end.length);
  const url = scalar(block, "url");
  if (url !== null) {
    return fingerprint({
      type: "http",
      url,
      headers: inlineTable(block, "http_headers"),
    });
  }
  const command = scalar(block, "command");
  const argsMatch = block.match(/^args\s*=\s*(\[[^\r\n]*\])/m);
  if (command === null || !argsMatch) return null;
  let args: string[];
  try {
    args = JSON.parse(argsMatch[1]) as string[];
  } catch {
    return null;
  }
  return fingerprint({
    command,
    args,
    env: inlineTable(block, "env"),
  });
}

function scalar(block: string, key: string): string | null {
  const match = block.match(new RegExp(`^${key}\\s*=\\s*("(?:\\\\.|[^"])*")`, "m"));
  if (!match) return null;
  try {
    return JSON.parse(match[1]) as string;
  } catch {
    return null;
  }
}

function inlineTable(block: string, key: string): Record<string, string> {
  const match = block.match(new RegExp(`^${key}\\s*=\\s*\\{([^\\r\\n]*)\\}`, "m"));
  if (!match) return {};
  const result: Record<string, string> = {};
  const entries = match[1].matchAll(
    /("(?:\\.|[^"])*"|[A-Za-z_][A-Za-z0-9_-]*)\s*=\s*("(?:\\.|[^"])*")/g,
  );
  for (const entry of entries) {
    try {
      const keyName = entry[1].startsWith('"')
        ? JSON.parse(entry[1]) as string
        : entry[1];
      result[keyName] = JSON.parse(entry[2]) as string;
    } catch {
      return {};
    }
  }
  return result;
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function tomlKey(value: string): string {
  return JSON.stringify(value);
}

function extractComments(text: string): string[] {
  const comments: string[] = [];
  const pattern = /(?:^|\s)(\/\/[^\r\n]*|\/\*[\s\S]*?\*\/)/gm;
  for (const match of text.matchAll(pattern)) comments.push(match[1].trim());
  return [...new Set(comments)].filter(
    (comment) => !comment.includes(managedMarker),
  );
}
