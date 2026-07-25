export class ToolkitError extends Error {
    code;
    details;
    constructor(code, message, details) {
        super(message);
        this.code = code;
        this.details = details;
        this.name = "ToolkitError";
    }
}
//# sourceMappingURL=errors.js.map