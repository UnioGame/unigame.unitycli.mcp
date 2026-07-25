import { createHash } from "node:crypto";
export const managedMarker = "unigame-unitycli-mcp";
export function fingerprint(value) {
    return createHash("sha256")
        .update(JSON.stringify(value))
        .digest("hex")
        .slice(0, 16);
}
export function stripJsonComments(text) {
    let result = "";
    let string = false;
    let escape = false;
    for (let index = 0; index < text.length; index++) {
        const char = text[index];
        const next = text[index + 1];
        if (string) {
            result += char;
            if (escape)
                escape = false;
            else if (char === "\\")
                escape = true;
            else if (char === '"')
                string = false;
            continue;
        }
        if (char === '"') {
            string = true;
            result += char;
            continue;
        }
        if (char === "/" && next === "/") {
            while (index < text.length && text[index] !== "\n")
                index++;
            result += "\n";
            continue;
        }
        if (char === "/" && next === "*") {
            index += 2;
            while (index < text.length &&
                !(text[index] === "*" && text[index + 1] === "/"))
                index++;
            index++;
            continue;
        }
        result += char;
    }
    return result.replace(/,\s*([}\]])/g, "$1");
}
export function parseJsonc(text) {
    if (!text.trim())
        return {};
    return JSON.parse(stripJsonComments(text));
}
export function patchServerJsonc(text, property, serverName, value) {
    const parsed = parseJsonc(text);
    const servers = parsed[property] && typeof parsed[property] === "object"
        ? parsed[property]
        : {};
    if (value === undefined)
        delete servers[serverName];
    else
        servers[serverName] = value;
    parsed[property] = servers;
    const comments = extractComments(text);
    return `${comments.length ? `${comments.join("\n")}\n` : ""}${JSON.stringify(parsed, null, 2)}\n`;
}
export function managedTomlBlock(name, value) {
    if (!value)
        return "";
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
    return (`${begin}\n[mcp_servers.${tomlKey(name)}]\n` +
        `command = ${quote(value.command)}\n` +
        `args = [${value.args.map(quote).join(", ")}]\n` +
        `env = { ${Object.entries(value.env)
            .map(([key, entry]) => `${key} = ${quote(entry)}`)
            .join(", ")} }\n${end}\n`);
}
export function patchManagedToml(text, name, block) {
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
function quote(value) {
    return JSON.stringify(value);
}
function tomlKey(value) {
    return JSON.stringify(value);
}
function extractComments(text) {
    const comments = [];
    const pattern = /(?:^|\s)(\/\/[^\r\n]*|\/\*[\s\S]*?\*\/)/gm;
    for (const match of text.matchAll(pattern))
        comments.push(match[1].trim());
    return [...new Set(comments)].filter((comment) => !comment.includes(managedMarker));
}
//# sourceMappingURL=config.js.map