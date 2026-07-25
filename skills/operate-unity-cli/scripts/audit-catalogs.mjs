#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const catalogDirectory = join(
  scriptDirectory,
  "..",
  "..",
  "..",
  "Server~",
  "catalogs",
);

const expectations = [
  ["unity-cli-1.0.0-beta.2.json", 112, "cli"],
  ["pipeline-editor-0.4.0-exp.1-6000.3.14f1.json", 140, "editor"],
  ["pipeline-player-0.4.0-exp.1-6000.3.14f1.json", 14, "player"],
];

let failed = false;
const results = [];

for (const [file, expected, source] of expectations) {
  try {
    const parsed = JSON.parse(
      await readFile(join(catalogDirectory, file), "utf8"),
    );
    const names = parsed.tools.map((tool) => tool.name);
    const unique = new Set(names);
    const ok = names.length === expected && unique.size === expected;
    failed ||= !ok;
    results.push({
      source,
      file,
      expected,
      actual: names.length,
      unique: unique.size,
      ok,
    });
  } catch (error) {
    failed = true;
    results.push({ source, file, expected, ok: false, error: error.message });
  }
}

console.log(JSON.stringify({ ok: !failed, catalogs: results }, null, 2));
process.exitCode = failed ? 1 : 0;
