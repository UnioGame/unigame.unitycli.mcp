export type ToolkitErrorCode =
  | "CLI_NOT_FOUND"
  | "VERSION_MISMATCH"
  | "EDITOR_NOT_CONNECTED"
  | "PLAYER_NOT_CONNECTED"
  | "CONFIRMATION_REQUIRED"
  | "TIMEOUT"
  | "UPSTREAM_FAILED"
  | "INVALID_OUTPUT"
  | "TARGET_REQUIRED"
  | "TARGET_NOT_FOUND"
  | "TARGET_AMBIGUOUS"
  | "TARGET_STALE"
  | "TARGET_NOT_READY";

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
