import { ToolkitError } from "./errors.js";
export function requireConfirmation(tool, input) {
    if (tool.dangerous && input.confirm !== true) {
        throw new ToolkitError("CONFIRMATION_REQUIRED", `${tool.toolName} is classified as high risk. Retry with confirm=true after explicit authorization.`);
    }
}
//# sourceMappingURL=safety.js.map