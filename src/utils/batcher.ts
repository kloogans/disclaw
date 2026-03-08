/**
 * Batches rapid-fire messages within a time window.
 * When a message arrives, waits `delayMs` for more messages,
 * then calls the handler with all collected messages combined.
 */
export class MessageBatcher {
  private pending: string[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private handler: (combined: string) => void;
  private delayMs: number;

  constructor(handler: (combined: string) => void, delayMs: number) {
    this.handler = handler;
    this.delayMs = delayMs;
  }

  add(message: string): void {
    this.pending.push(message);

    if (this.timer !== null) {
      clearTimeout(this.timer);
    }

    this.timer = setTimeout(() => {
      this.flush();
    }, this.delayMs);
  }

  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.pending.length === 0) return;

    const combined = this.pending.join("\n\n");
    this.pending = [];
    this.handler(combined);
  }

  get hasPending(): boolean {
    return this.pending.length > 0;
  }

  clear(): void {
    this.pending = [];
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
