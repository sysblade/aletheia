import type { MetricsSnapshot } from "../utils/metrics.ts";

export type WorkerMessage =
  | { type: "ready" }
  | { type: "batch-written"; metrics: MetricsSnapshot }
  | { type: "error"; message: string }
  | { type: "stopped" };

export type MainMessage = { type: "shutdown" };
