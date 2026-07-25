export function disconnectedTargetCode(source, output) {
    const normalized = output.toLowerCase();
    if (source === "editor" &&
        /no.*(?:editor|pipeline instance)|not connected|port file|descriptor/.test(normalized)) {
        return "EDITOR_NOT_CONNECTED";
    }
    if (source === "player" &&
        /no.*(?:player|runtime)|not connected|port file|descriptor/.test(normalized)) {
        return "PLAYER_NOT_CONNECTED";
    }
    return null;
}
export function versionMismatchWarning(expected, installed) {
    if (!installed || installed === expected)
        return null;
    return {
        code: "VERSION_MISMATCH",
        message: `Installed CLI ${installed} differs from snapshot ${expected}.`,
    };
}
//# sourceMappingURL=compatibility.js.map