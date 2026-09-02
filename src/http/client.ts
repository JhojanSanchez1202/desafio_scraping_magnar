import axios, { AxiosInstance, AxiosResponse } from "axios";
import * as cheerio from "cheerio";
import { CookieJar } from "./cookieJar";
import { AjaxAction, toRelativePath } from "./ajaxAction";

export const BASE_URL = "https://pjett.trf5.jus.br/pjeconsulta";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

/**
 * Serializa todos los campos de un <form> (como hace un browser real /
 * A4J.AJAX.Submit al armar el POST) para no perder inputs ocultos de
 * RichFaces que hacen falta para que el postback sea válido.
 */
export function serializeForm(html: string, formId: string): URLSearchParams {
  const $ = cheerio.load(html);
  const form = $(`form#${formId}`);
  const params = new URLSearchParams();
  form.find("input, select, textarea").each((_, el) => {
    const $el = $(el);
    const name = $el.attr("name");
    if (!name) return;
    const type = ($el.attr("type") || "").toLowerCase();
    if (type === "checkbox" || type === "radio") {
      if ($el.is(":checked")) params.append(name, $el.attr("value") || "on");
      return;
    }
    if (el.tagName === "select") {
      const val = $el.find("option:selected").attr("value");
      params.append(name, val ?? "");
      return;
    }
    params.append(name, $el.attr("value") || "");
  });
  return params;
}

/** Cliente HTTP con sesión (cookies) persistida entre requests al PJe. */
export class PjeClient {
  private jar = new CookieJar();
  private axios: AxiosInstance;

  constructor() {
    this.axios = axios.create({
      baseURL: BASE_URL,
      validateStatus: () => true, // manejamos nosotros los status (429 incluido)
      headers: { "User-Agent": USER_AGENT },
    });
  }

  private captureCookies(res: AxiosResponse): void {
    this.jar.update(res.headers["set-cookie"] as unknown as string[] | undefined);
  }

  /** Sólo incluye el header Cookie cuando ya hay algo que mandar. */
  private cookieHeaders(): Record<string, string> {
    const cookie = this.jar.header();
    return cookie ? { Cookie: cookie } : {};
  }

  /**
   * Además de la app JSF, el sitio tiene un WAF de borde que devuelve HTTP 200
   * con una página "Requisição - Rejeitada" cuando detecta tráfico automatizado
   * (lo vimos en pruebas reales). No es un 429 de la app, pero es la misma
   * situación de fondo: hay que frenar y no insistir en loop apretado.
   */
  private assertNotWafBlocked(html: string, path: string): void {
    if (html.includes("Requisi") && html.includes("Rejeitada")) {
      const err = new Error(
        `El WAF del sitio bloqueó la request a ${path} ("Requisição - Rejeitada"). ` +
          "Bajar la frecuencia de requests (REQUEST_DELAY_MS) y reintentar más tarde."
      ) as Error & { status?: number };
      err.status = 429;
      throw err;
    }
  }

  async get(path: string): Promise<AxiosResponse<string>> {
    const res = await this.axios.get<string>(path, {
      headers: this.cookieHeaders(),
    });
    this.captureCookies(res);
    this.assertNotWafBlocked(res.data, path);
    return res;
  }

  /** GET binario (para PDFs). No usa validateStatus especial: lanza si !2xx para que withBackoff lo detecte. */
  async getBinary(path: string): Promise<AxiosResponse<ArrayBuffer>> {
    const res = await this.axios.get<ArrayBuffer>(path, {
      responseType: "arraybuffer",
      headers: this.cookieHeaders(),
    });
    this.captureCookies(res);
    const contentType = String(res.headers["content-type"] ?? "");
    if (res.status === 200 && contentType.includes("text/html")) {
      this.assertNotWafBlocked(Buffer.from(res.data).toString("utf-8"), path);
    }
    if (res.status === 429) {
      const err = new Error(`429 Too Many Requests: ${path}`) as Error & { status?: number };
      err.status = 429;
      throw err;
    }
    if (res.status < 200 || res.status >= 300) {
      const err = new Error(`HTTP ${res.status} descargando ${path}`) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }
    return res;
  }

  /**
   * Replica un A4J.AJAX.Submit: serializa el form tal como está en `sourceHtml`,
   * pisa/agrega los campos de `overrides`, y postea con los headers de partial-ajax.
   */
  async postAjax(
    actionPath: string,
    sourceHtml: string,
    formId: string,
    overrides: Record<string, string>
  ): Promise<AxiosResponse<string>> {
    const params = serializeForm(sourceHtml, formId);
    for (const [k, v] of Object.entries(overrides)) params.set(k, v);

    const res = await this.axios.post<string>(actionPath, params.toString(), {
      headers: {
        ...this.cookieHeaders(),
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        "Faces-Request": "partial/ajax",
        Referer: `${BASE_URL}/ConsultaPublica/listView.seam`,
      },
    });
    this.captureCookies(res);
    this.assertNotWafBlocked(res.data, actionPath);
    return res;
  }

  /**
   * POST de formulario normal (no-AJAX) — el botón "Gerar PDF" hace un
   * `f.submit()` nativo, no un A4J.AJAX.Submit. La respuesta puede ser
   * binaria (el PDF) o HTML, por eso se pide como arraybuffer.
   */
  async postForm(
    actionPath: string,
    sourceHtml: string,
    formId: string,
    overrides: Record<string, string>
  ): Promise<AxiosResponse<ArrayBuffer>> {
    const params = serializeForm(sourceHtml, formId);
    for (const [k, v] of Object.entries(overrides)) params.set(k, v);

    const res = await this.axios.post<ArrayBuffer>(actionPath, params.toString(), {
      responseType: "arraybuffer",
      headers: {
        ...this.cookieHeaders(),
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Referer: `${BASE_URL}${actionPath}`,
      },
    });
    this.captureCookies(res);
    const contentType = String(res.headers["content-type"] ?? "");
    if (res.status === 429) {
      const err = new Error(`429 Too Many Requests: ${actionPath}`) as Error & { status?: number };
      err.status = 429;
      throw err;
    }
    if (contentType.includes("text/html")) {
      this.assertNotWafBlocked(Buffer.from(res.data).toString("utf-8"), actionPath);
    }
    return res;
  }

  /** Repite una `AjaxAction` extraída de un onclick real (ver ajaxAction.ts). */
  async submitAjaxAction(action: AjaxAction, sourceHtml: string): Promise<AxiosResponse<string>> {
    const path = toRelativePath(action.actionUrl, BASE_URL);
    return this.postAjax(path, sourceHtml, action.formId, action.parameters);
  }
}
