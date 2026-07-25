import { describe, expect, it } from "vitest";
import { parseMixedOutput } from "../src/output.js";
import { redact } from "../src/redaction.js";

describe("parseMixedOutput", () => {
  it("parses a normal JSON envelope", () => {
    const parsed = parseMixedOutput(
      JSON.stringify({ success: true, data: { count: 3 } }),
    );
    expect(parsed.validJson).toBe(true);
    expect(parsed.data).toEqual({ success: true, data: { count: 3 } });
  });

  it("extracts the last JSON object from progress and logs", () => {
    const parsed = parseMixedOutput(
      'starting\n{"type":"progress","value":1}\n{"success":true,"data":{"ok":true}}',
    );
    expect(parsed.validJson).toBe(true);
    expect(parsed.data).toEqual({ success: true, data: { ok: true } });
    expect(parsed.progress).toHaveLength(2);
  });

  it("parses nested JSON returned by Pipeline commands", () => {
    const parsed = parseMixedOutput(
      JSON.stringify({
        success: true,
        data: {
          result: "{\"status\":\"up_to_date\",\"errors\":[]}",
        },
      }),
    );
    expect(parsed.data).toEqual({
      success: true,
      data: {
        result: { status: "up_to_date", errors: [] },
      },
    });
  });
});

describe("redact", () => {
  it("removes secrets from flags, URLs, and JSON", () => {
    const value =
      '--accessToken abcdef https://user:password@example.test {"serial":"AAAA-BBBB","evalToken":"pipeline-secret"} Bearer bearer-secret';
    const result = redact(value);
    expect(result).not.toContain("abcdef");
    expect(result).not.toContain("password");
    expect(result).not.toContain("AAAA-BBBB");
    expect(result).not.toContain("pipeline-secret");
    expect(result).not.toContain("bearer-secret");
    expect(result).toContain("<redacted>");
  });
});
