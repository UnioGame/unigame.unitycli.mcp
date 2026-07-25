function liveParameter(parameter) {
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
export function mergeLiveSchemas(snapshot, liveTools) {
    const liveByName = new Map(liveTools.map((tool) => [tool.name, tool]));
    const tools = snapshot.tools.map((tool) => {
        const live = liveByName.get(tool.name);
        if (!live)
            return tool;
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
//# sourceMappingURL=live-catalog.js.map