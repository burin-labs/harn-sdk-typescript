export type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>;

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(new DOMException("Operation was aborted.", "AbortError"));
      },
      { once: true },
    );
  });
}
