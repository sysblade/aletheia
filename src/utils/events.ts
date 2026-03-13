import { getLogger } from "./logger.ts";

type Listener<T> = (data: T) => void;

const log = getLogger(["aletheia", "events"]);

/**
 * Simple synchronous event bus for pub/sub communication.
 * Used for live certificate stream updates to SSE clients.
 */
export class EventBus<T> {
  private listeners = new Set<Listener<T>>();

  subscribe(listener: Listener<T>): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(data: T): void {
    for (const listener of this.listeners) {
      Promise.resolve(listener(data)).catch((err) => {
        log.error("EventBus listener error: {error}", { error: String(err) });
      });
    }
  }
}
