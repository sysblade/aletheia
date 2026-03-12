type Listener<T> = (data: T) => void;

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
      listener(data);
    }
  }
}
