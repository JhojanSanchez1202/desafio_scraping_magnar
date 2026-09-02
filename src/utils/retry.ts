/**
 * Reintentos con backoff exponencial + jitter. Pensado para el 429 de
 * download.seam, pero genérico (recibe qué errores son reintentables).
 */

export interface BackoffOptions {
  maxRetries: number;
  baseDelayMs: number;
  /** techo para no dejar que el backoff crezca sin límite */
  maxDelayMs: number;
  isRetryable: (err: unknown) => boolean;
  onRetry?: (attempt: number, delayMs: number, err: unknown) => void;
}

/** Predicado reutilizable: sólo reintenta errores tageados con status 429 (ver client.ts). */
export function isHttp429(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { status?: number }).status === 429;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function withBackoff<T>(fn: () => Promise<T>, opts: BackoffOptions): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      attempt++;
      if (attempt > opts.maxRetries || !opts.isRetryable(err)) throw err;
      const exp = opts.baseDelayMs * 2 ** (attempt - 1);
      const jitter = Math.random() * opts.baseDelayMs;
      const delayMs = Math.min(exp + jitter, opts.maxDelayMs);
      opts.onRetry?.(attempt, delayMs, err);
      await sleep(delayMs);
    }
  }
}
