import { afterEach, describe, expect, it } from "vitest";
import { resolveSecretInputs } from "../src/secrets.js";
import { ToolkitError } from "../src/errors.js";
import type { CatalogTool } from "../src/types.js";

const tool: CatalogTool = {
  name: "projects clone",
  toolName: "unity_cli_projects_clone",
  description: "Clone",
  source: "cli",
  command: ["projects", "clone"],
  parameters: [
    {
      name: "gitToken",
      type: "string",
      description: "Git token",
      required: false,
    },
  ],
};

afterEach(() => {
  delete process.env.UNIGAME_TEST_GIT_TOKEN;
});

describe("secret references", () => {
  it("resolves environment references without changing the public schema", async () => {
    process.env.UNIGAME_TEST_GIT_TOKEN = "temporary-test-value";
    await expect(
      resolveSecretInputs(tool, { gitToken: "env:UNIGAME_TEST_GIT_TOKEN" }),
    ).resolves.toEqual({ gitToken: "temporary-test-value" });
  });

  it("rejects direct secret values", async () => {
    await expect(
      resolveSecretInputs(tool, { gitToken: "do-not-accept-this" }),
    ).rejects.toBeInstanceOf(ToolkitError);
  });
});
