// Pure constants and helpers of the sync state machine (the stateful part lives in store.ts).

export const DEBOUNCE_MS = 500;
const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 30000;

/** Delay before the retry number `attempt` (0-based) when the server is unreachable: 1 s, 2 s, 4 s... capped at 30 s. */
export function retryDelay(attempt: number): number {
  return Math.min(RETRY_BASE_MS * 2 ** Math.max(0, attempt), RETRY_MAX_MS);
}

export type SyncStatus = "saved" | "unsaved" | "saving" | "conflict" | "invalid" | "offline" | "error";

export const STATUS_LABELS: Record<SyncStatus, string> = {
  saved: "Saved",
  unsaved: "Unsaved changes",
  saving: "Saving...",
  conflict: "Conflict",
  invalid: "Invalid file",
  offline: "Unsaved (server unreachable)",
  error: "Save failed",
};
