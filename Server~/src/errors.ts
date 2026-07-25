export type ToolkitErrorCode =
  | "CLI_NOT_FOUND"
  | "VERSION_MISMATCH"
  | "EDITOR_NOT_CONNECTED"
  | "PLAYER_NOT_CONNECTED"
  | "CONFIRMATION_REQUIRED"
  | "TIMEOUT"
  | "UPSTREAM_FAILED"
  | "INVALID_OUTPUT";

export class ToolkitError extends Error {
  public constructor(
    public readonly code: ToolkitErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ToolkitError";
  }
}
