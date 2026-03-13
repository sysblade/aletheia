import type { MetricsSnapshot } from "../utils/metrics.ts";

/**
 * Messages sent from ingest worker thread/process to main thread.
 * Used for status updates and metrics reporting.
 */
export type WorkerMessage =
  | { type: "ready" }
  | { type: "batch-written"; metrics: MetricsSnapshot }
  | { type: "error"; message: string }
  | { type: "stopped" };

/**
 * Messages sent from main thread to ingest worker thread/process.
 * Currently only supports shutdown signal.
 */
export type MainMessage = { type: "shutdown" };
