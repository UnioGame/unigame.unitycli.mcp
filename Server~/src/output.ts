import { redact } from "./redaction.js";
import type { ParsedOutput } from "./types.js";

function parseNestedJson(value: unknown, depth = 0): unknown {
  if (depth >= 4) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      const parsed = tryParse(trimmed);
      return parsed === undefined ? value : parseNestedJson(parsed, depth + 1);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => parseNestedJson(entry, depth + 1));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        parseNestedJson(entry, depth + 1),
      ]),
    );
  }
  return value;
}

function tryParse(value: string): unknown | undefined {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function findLastJson(value: string): unknown | undefined {
  for (let index = value.lastIndexOf("{"); index >= 0; index = value.lastIndexOf("{", index - 1)) {
    const parsed = tryParse(value.slice(index).trim());
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

export function parseMixedOutput(raw: string): ParsedOutput {
  const sanitized = redact(raw).trim();
  if (!sanitized) {
    return { data: null, progress: [], text: null, validJson: true };
  }

  const complete = tryParse(sanitized);
  if (complete !== undefined) {
    return {
      data: parseNestedJson(complete),
      progress: [],
      text: null,
      validJson: true,
    };
  }

  const progress: unknown[] = [];
  let lastParsed: unknown | undefined;
  const textLines: string[] = [];
  for (const line of sanitized.split(/\r?\n/)) {
    const parsed = tryParse(line.trim());
    if (parsed !== undefined) {
      progress.push(parsed);
      lastParsed = parsed;
    } else if (line.trim()) {
      textLines.push(line);
    }
  }

  const trailing = findLastJson(sanitized);
  if (trailing !== undefined) lastParsed = trailing;

  return {
    data: parseNestedJson(lastParsed ?? null),
    progress,
    text: textLines.length ? textLines.join("\n") : null,
    validJson: lastParsed !== undefined,
  };
}
