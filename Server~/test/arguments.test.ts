import { describe, expect, it } from "vitest";
import { buildArguments } from "../src/arguments.js";
import type { CatalogTool } from "../src/types.js";

describe("buildArguments", () => {
  it("builds standalone commands without a shell", () => {
    const tool: CatalogTool = {
      name: "projects info",
      toolName: "unity_cli_projects_info",
      description: "Project info",
      source: "cli",
      command: ["projects", "info"],
      parameters: [
        {
          name: "project",
          type: "string",
          description: "Project",
          required: true,
          positional: true,
        },
        {
          name: "verbose",
          cliName: "--verbose",
          type: "bool",
          description: "Verbose",
          required: false,
        },
      ],
    };

    expect(
      buildArguments(tool, {
        project: "C:/Projects/Game",
        verbose: true,
        extraArgs: ["--proxy-disable"],
      }),
    ).toEqual({
      args: [
        "projects",
        "info",
        "C:/Projects/Game",
        "--verbose",
        "--format",
        "json",
        "--non-interactive",
        "--proxy-disable",
      ],
      target: null,
    });
  });

  it("adds Editor targeting and serializes JSON values", () => {
    const tool: CatalogTool = {
      name: "set_transform",
      toolName: "unity_editor_set_transform",
      description: "Set transform",
      source: "editor",
      command: ["set_transform"],
      parameters: [
        {
          name: "target",
          type: "string",
          description: "Target",
          required: true,
        },
        {
          name: "position",
          type: "object",
          description: "Position",
          required: false,
        },
      ],
    };

    expect(
      buildArguments(tool, {
        projectPath: "C:/Projects/Game",
        target: "/Cube",
        position: [1, 2, 3],
      }).args,
    ).toEqual([
      "command",
      "--project-path",
      "C:/Projects/Game",
      "--format",
      "json",
      "set_transform",
      "--target",
      "/Cube",
      "--position",
      "[1,2,3]",
    ]);
  });

  it("serializes Pipeline matrix parameters as one JSON value", () => {
    const tool: CatalogTool = {
      name: "create_gameobjects",
      toolName: "unity_editor_create_gameobjects",
      description: "Create objects",
      source: "editor",
      command: ["create_gameobjects"],
      risk: "destructive",
      parameters: [
        {
          name: "positions",
          cliName: "--positions",
          type: "single[][]",
          description: "Positions",
          multiple: true,
        },
      ],
    };

    expect(
      buildArguments(tool, {
        projectPath: "C:/project",
        positions: [[0, 0, 0], [1.1, 0, 0]],
      }).args,
    ).toEqual([
      "command",
      "--project-path",
      "C:/project",
      "--format",
      "json",
      "create_gameobjects",
      "--positions",
      "[[0,0,0],[1.1,0,0]]",
    ]);
  });
});
