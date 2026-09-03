import axios, { AxiosRequestConfig, AxiosResponse } from "axios";
import { config } from "../config";
import { logger } from "../utils/logger";
import { sleep, getBackoffDelay, parseRetryAfterMs } from "../utils/delay";

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

// headers de navegador real
const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "es-419,es;q=0.9",
};

/**
 * Además del 429 de la app, el sitio tiene un WAF de borde que devuelve HTTP
 * 200 con una página "Requisição - Rejeitada" cuando detecta tráfico
 * sospechoso (confirmado en pruebas reales). Se trata igual que un 429: hay
 * que frenar y reintentar con backoff, no es un error terminal.
 */
function looksLikeWafBlock(data: unknown): boolean {
  let text: string;
  if (typeof data === "string") text = data;
  else if (Buffer.isBuffer(data)) text = data.toString("latin1");
  else if (data instanceof ArrayBuffer) text = Buffer.from(data).toString("latin1");
  else return false;
  return text.includes("Requisi") && text.includes("Rejeitada");
}

export class HttpClient {
  private cookies = new Map<string, string>();
  private lastRequestAt = 0;

  /** Sólo incluye el header Cookie cuando ya hay algo que mandar — mandar
   * `Cookie: ""` vacío en el primer request gatilla el WAF (confirmado). */
  private cookieHeader(): string | undefined {
    if (this.cookies.size === 0) return undefined;
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  private storeCookies(setCookieHeaders: string[] | undefined) {
    if (!setCookieHeaders) return;
    for (const raw of setCookieHeaders) {
      const [pair] = raw.split(";");
      const eq = pair.indexOf("=");
      if (eq === -1) continue;
      this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }

  private async throttle() {
    const elapsed = Date.now() - this.lastRequestAt;
    if (elapsed < config.requestDelayMs) {
      await sleep(config.requestDelayMs - elapsed);
    }
    this.lastRequestAt = Date.now();
  }

  private async request(requestConfig: AxiosRequestConfig): Promise<AxiosResponse> {
    await this.throttle();

    const cookie = this.cookieHeader();
    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      try {
        const response = await axios({
          ...requestConfig,
          maxRedirects: requestConfig.maxRedirects ?? 5,
          timeout: config.requestTimeoutMs,
          validateStatus: () => true,
          headers: {
            ...DEFAULT_HEADERS,
            ...requestConfig.headers,
            ...(cookie ? { Cookie: cookie } : {}),
          },
        });

        this.storeCookies(response.headers["set-cookie"]);

        const blocked = RETRYABLE_STATUS.has(response.status) || looksLikeWafBlock(response.data);
        if (!blocked) return response;

        if (attempt === config.maxRetries) {
          throw new Error(`HTTP ${response.status} (o bloqueo del WAF) tras ${attempt + 1} intentos en ${requestConfig.url}`);
        }

        const retryAfter = parseRetryAfterMs(response.headers["retry-after"]);
        const delay = retryAfter ?? getBackoffDelay(attempt, config.retryBaseDelayMs, config.retryMaxDelayMs);
        logger.warn(
          `HTTP ${response.status}${looksLikeWafBlock(response.data) ? " (bloqueo del WAF)" : ""} en ${requestConfig.url}, reintento ${attempt + 1}/${config.maxRetries} en ${Math.round(delay)}ms`
        );
        await sleep(delay);
      } catch (err) {
        if (attempt === config.maxRetries) throw err;
        const delay = getBackoffDelay(attempt, config.retryBaseDelayMs, config.retryMaxDelayMs);
        logger.warn(`Error de red en ${requestConfig.url}, reintento ${attempt + 1}/${config.maxRetries} en ${Math.round(delay)}ms`, {
          error: (err as Error).message,
        });
        await sleep(delay);
      }
    }

    throw new Error(`No se pudo completar la request a ${requestConfig.url}`);
  }

  get(url: string, requestConfig: AxiosRequestConfig = {}) {
    return this.request({ ...requestConfig, method: "GET", url });
  }

  post(url: string, data: unknown, requestConfig: AxiosRequestConfig = {}) {
    return this.request({
      ...requestConfig,
      method: "POST",
      url,
      data,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        ...requestConfig.headers,
      },
    });
  }
}
