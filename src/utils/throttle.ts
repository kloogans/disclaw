/**
 * Creates a throttled function that runs at most once per `delayMs`.
 * The last call within a window is always executed (trailing edge).
 */
export function createThrottle<T extends (...args: any[]) => Promise<void>>(
  fn: T,
  delayMs: number,
): (...args: Parameters<T>) => void {
  let lastRun = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: Parameters<T> | null = null;

  return (...args: Parameters<T>) => {
    lastArgs = args;
    const now = Date.now();
    const elapsed = now - lastRun;

    if (elapsed >= delayMs) {
      lastRun = now;
      fn(...args);
      return;
    }

    if (timer === null) {
      timer = setTimeout(() => {
        lastRun = Date.now();
        timer = null;
        if (lastArgs) {
          fn(...lastArgs);
        }
      }, delayMs - elapsed);
    }
  };
}
