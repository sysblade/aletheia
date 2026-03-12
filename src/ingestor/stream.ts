import { parseCertStreamMessage } from "./parser.ts";
import { CertFilter } from "./filter.ts";
import { BatchBuffer } from "./buffer.ts";
import { metrics } from "../utils/metrics.ts";
import { getLogger } from "../utils/logger.ts";

const log = getLogger(["ctlog", "stream"]);

const MAX_BACKOFF_MS = 60_000;
const INITIAL_BACKOFF_MS = 1_000;
const PING_INTERVAL_MS = 30_000;

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

    log.info("Connecting to CertStream at {url}", { url: this.url });

    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      log.info("Connected to CertStream");
      this.backoff = INITIAL_BACKOFF_MS;
      this.startPing();
    };

    this.ws.onmessage = (event) => {
      const data = typeof event.data === "string" ? event.data : String(event.data);
      const cert = parseCertStreamMessage(data);
      log.debug("Processed certificate for {domain}", {"domain": cert?.domains})
      if (!cert) return;

      metrics.increment("certsReceived");

      if (!this.filter.matches(cert)) {
        metrics.increment("certsFiltered");
        return;
      }

      this.buffer.push(cert);
    };

    this.ws.onerror = (event) => {
      log.error("WebSocket error: {error}", { error: String(event) });
    };

    this.ws.onclose = (event) => {
      log.warn("WebSocket closed with code {code}: {reason}", { code: event.code, reason: event.reason });
      this.stopPing();
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect() {
    if (this.stopped) return;

    metrics.increment("wsReconnections");
    log.info("Scheduling reconnect in {backoffMs}ms", { backoffMs: this.backoff });

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, this.backoff);

    this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
  }

  private startPing() {
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "ping" }));
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
