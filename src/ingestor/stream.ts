import WebSocket from "ws";
import { parseCertStreamMessage } from "./parser.ts";
import { CertFilter } from "./filter.ts";
import { BatchBuffer } from "./buffer.ts";
import type { MetricsCollector } from "../utils/metrics.ts";
import { getLogger } from "../utils/logger.ts";

const log = getLogger(["ctlog", "stream"]);

const MAX_BACKOFF_MS = 60_000;
const INITIAL_BACKOFF_MS = 1_000;
const PING_INTERVAL_MS = 30_000;

/**
 * WebSocket client for CertStream API with automatic reconnection and backoff.
 * Parses incoming certificates, filters them, and buffers for batch writing.
 */
export class CertStreamClient {
  private ws: WebSocket | null = null;
  private backoff = INITIAL_BACKOFF_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  constructor(
    private url: string,
    private filter: CertFilter,
    private buffer: BatchBuffer,
    private metrics: MetricsCollector,
  ) {}

  start() {
    this.stopped = false;
    this.connect();
  }

  stop() {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private connect() {
    if (this.stopped) return;

    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }

    log.info("Connecting to CertStream at {url}", { url: this.url });

    this.ws = new WebSocket(this.url);

    this.ws.on("open", () => {
      log.info("Connected to CertStream");
      this.backoff = INITIAL_BACKOFF_MS;
      this.startPing();
    });

    this.ws.on("message", (data: WebSocket.RawData) => {
      const message = data.toString();
      const cert = parseCertStreamMessage(message);
      if (!cert) return;

      this.metrics.increment("certsReceived");

      if (!this.filter.matches(cert)) {
        this.metrics.increment("certsFiltered");
        return;
      }

      this.buffer.push(cert);
    });

    this.ws.on("error", (err: Error) => {
      log.error("WebSocket error: {error}", { error: err.message });
    });

    this.ws.on("close", (code: number, reason: Buffer) => {
      log.warn("WebSocket closed with code {code}: {reason}", {
        code,
        reason: reason.toString(),
      });
      this.ws = null;
      this.stopPing();
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect() {
    if (this.stopped) return;

    this.metrics.increment("wsReconnections");
    log.info("Scheduling reconnect in {backoffMs}ms", { backoffMs: this.backoff });

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, this.backoff);

    this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
  }

  private startPing() {
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        try {
          this.ws.ping();
        } catch {
          log.debug("Ping send failed, connection may be closing");
        }
      }
    }, PING_INTERVAL_MS);
  }

  private stopPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }
}
