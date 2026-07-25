import type { CatalogTool } from "./types.js";
import { ToolkitError } from "./errors.js";

export function requireConfirmation(
  tool: CatalogTool,
  input: Record<string, unknown>,
): void {
  if (tool.dangerous && input.confirm !== true) {
    throw new ToolkitError(
      "CONFIRMATION_REQUIRED",
      `${tool.toolName} is classified as high risk. Retry with confirm=true after explicit authorization.`,
    );
  }
}
