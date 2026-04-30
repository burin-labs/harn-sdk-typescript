import type { ErrorResponse } from "./types.js";

export class HarnApiError extends Error {
  readonly status: number;
  readonly response: Response;
  readonly error?: ErrorResponse["error"];

  constructor(response: Response, body: unknown) {
    const error = isErrorResponse(body) ? body.error : undefined;
    super(error?.message ?? `Harn API request failed with HTTP ${response.status}`);
    this.name = "HarnApiError";
    this.status = response.status;
    this.response = response;
    this.error = error;
  }
}

function isErrorResponse(value: unknown): value is ErrorResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as { error?: unknown }).error === "object"
  );
}
