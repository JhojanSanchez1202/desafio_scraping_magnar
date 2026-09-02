import { PjeClient } from "../http/client";
import { AjaxAction } from "../http/ajaxAction";
import { withBackoff } from "../utils/retry";
import { logger } from "../utils/logger";
import { Movimentacao } from "./types";

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

function sanitizeFilename(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, "_").slice(0, 150);
}

function isHttp429(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { status?: number }).status === 429;
}

/**
 * Genera el `cid` de descarga (replicando el AJAX que dispara el click en la
 * movimentação) y descarga el PDF, con reintentos ante 429.
 */
export async function downloadDocumento(
  client: PjeClient,
  detailHtml: string,
  movimentacao: Movimentacao,
  numeroProcesso: string,
  retryConfig: RetryConfig
): Promise<{ buffer: Buffer; filename: string }> {
  if (!movimentacao.ajaxParams) {
    throw new Error(`Movimentação "${movimentacao.descricao}" no tiene documento asociado.`);
  }

  const { __formId, __actionUrl, ...parameters } = movimentacao.ajaxParams;
  const action: AjaxAction = { formId: __formId, actionUrl: __actionUrl, parameters };

  const genRes = await client.submitAjaxAction(action, detailHtml);
  const cidMatch = genRes.data.match(/download\.seam\?cid=([A-Za-z0-9]+)/);
  if (!cidMatch) {
    throw new Error(
      `No se encontró "cid" de descarga para la movimentação "${movimentacao.descricao}" del proceso ${numeroProcesso}. ` +
        "El AJAX que genera el documento puede requerir parámetros distintos a los capturados."
    );
  }
  const cid = cidMatch[1];

  const downloadRes = await withBackoff(() => client.getBinary(`/download.seam?cid=${cid}`), {
    maxRetries: retryConfig.maxRetries,
    baseDelayMs: retryConfig.baseDelayMs,
    maxDelayMs: retryConfig.maxDelayMs,
    isRetryable: isHttp429,
    onRetry: (attempt, delayMs) =>
      logger.warn(`429 al descargar PDF, reintentando`, { numeroProcesso, attempt, delayMs, cid }),
  });

  const filename = sanitizeFilename(`${movimentacao.data}_${movimentacao.descricao}`) + ".pdf";
  return { buffer: Buffer.from(downloadRes.data), filename };
}
