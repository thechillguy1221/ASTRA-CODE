export class CancellationToken {
  private readonly controller = new AbortController();
  private cancellationReason: string | undefined;

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  get reason(): string | undefined {
    return this.cancellationReason;
  }

  cancel(reason = 'Task cancelled'): void {
    if (this.controller.signal.aborted) return;
    this.cancellationReason = reason;
    this.controller.abort(reason);
  }

  throwIfCancelled(): void {
    if (!this.controller.signal.aborted) return;
    throw new Error(this.cancellationReason ?? 'Task cancelled');
  }
}

export function waitForCancellation(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    const rejectWithAbort = (): void => {
      const error = new Error(
        signal.reason instanceof Error
          ? signal.reason.message
          : String(signal.reason ?? 'Task cancelled'),
      );
      error.name = 'AbortError';
      reject(error);
    };

    if (signal.aborted) {
      rejectWithAbort();
      return;
    }

    signal.addEventListener('abort', rejectWithAbort, { once: true });
  });
}
