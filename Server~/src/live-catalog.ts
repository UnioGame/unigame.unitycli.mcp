import type {
  CatalogParameter,
  CatalogTool,
  ToolCatalog,
} from "./types.js";

interface LiveParameter {
  name: string;
  type?: string;
  description?: string;
  required?: boolean;
  default?: unknown;
}

interface LiveTool {
  name: string;
  description?: string;
  parameters?: LiveParameter[];
}

function liveParameter(parameter: LiveParameter): CatalogParameter {
  const type = String(parameter.type ?? "string");
  return {
    name: parameter.name,
    type,
    description: parameter.description ?? parameter.name,
    required: Boolean(parameter.required),
    default: parameter.default,
    positional: false,
    multiple: type.endsWith("[]"),
  };
}

export function mergeLiveSchemas(
  snapshot: ToolCatalog,
  liveTools: LiveTool[],
): ToolCatalog {
  const liveByName = new Map(liveTools.map((tool) => [tool.name, tool]));
  const tools: CatalogTool[] = snapshot.tools.map((tool) => {
    const live = liveByName.get(tool.name);
    if (!live) return tool;
    return {
      ...tool,
      description: live.description ?? tool.description,
      parameters: (live.parameters ?? []).map(liveParameter),
    };
  });
  return {
    ...snapshot,
    generatedAt: new Date().toISOString(),
    tools,
  };
}
