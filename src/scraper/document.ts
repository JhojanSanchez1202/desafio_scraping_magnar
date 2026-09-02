import * as cheerio from "cheerio";
import { PjeClient } from "../http/client";
import { withBackoff } from "../utils/retry";
import { logger } from "../utils/logger";
import { DocumentoRef } from "./types";

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
 * Descarga el PDF de un documento. Flujo real del sitio (confirmado con
 * capturas reales, no es AJAX):
 *  1. GET documentoSemLoginHTML.seam?ca=X&idProcessoDoc=Y → vista HTML del
 *     documento, con un link "Gerar PDF" que trae un `ca`/`idProcDocBin`
 *     propios (regenerados en cada render, distintos de los de arriba).
 *  2. POST normal (no A4J.AJAX.Submit) al mismo formulario con esos valores.
 */
export async function downloadDocumento(
  client: PjeClient,
  documento: DocumentoRef,
  numeroProcesso: string,
  retryConfig: RetryConfig
): Promise<{ buffer: Buffer; filename: string }> {
  const viewPath = `/ConsultaPublica/DetalheProcessoConsultaPublica/documentoSemLoginHTML.seam?ca=${documento.ca}&idProcessoDoc=${documento.idProcessoDoc}`;
  const viewRes = await client.get(viewPath);
  const $ = cheerio.load(viewRes.data);

  const pdfLink = $('a[id$=":downloadPDF"]').first();
  const pdfOnclick = pdfLink.attr("onclick") || "";
  const ca = pdfOnclick.match(/'ca'\s*:\s*'([^']+)'/)?.[1];
  const idProcDocBin = pdfOnclick.match(/'idProcDocBin'\s*:\s*'([^']+)'/)?.[1];
  const formId = pdfLink.closest("form").attr("id");

  if (!ca || !idProcDocBin || !formId) {
    throw new Error(
      `No se encontró el link "Gerar PDF" para el documento "${documento.descricao}" del proceso ${numeroProcesso}. ` +
        "El sitio pudo haber cambiado la estructura de la vista de documento."
    );
  }

  const downloadRes = await withBackoff(
    () =>
      client.postForm(viewPath, viewRes.data, formId, {
        [`${formId}:downloadPDF`]: `${formId}:downloadPDF`,
        ca,
        idProcDocBin,
      }),
    {
      maxRetries: retryConfig.maxRetries,
      baseDelayMs: retryConfig.baseDelayMs,
      maxDelayMs: retryConfig.maxDelayMs,
      isRetryable: isHttp429,
      onRetry: (attempt, delayMs) =>
        logger.warn("429 al descargar PDF, reintentando", { numeroProcesso, attempt, delayMs }),
    }
  );

  const contentType = String(downloadRes.headers["content-type"] ?? "");
  if (!contentType.includes("pdf")) {
    throw new Error(
      `La descarga del documento "${documento.descricao}" del proceso ${numeroProcesso} no devolvió un PDF ` +
        `(content-type: ${contentType || "desconocido"}). El POST a "Gerar PDF" puede necesitar un parámetro adicional.`
    );
  }

  const filename = sanitizeFilename(`${documento.data}_${documento.descricao}`) + ".pdf";
  return { buffer: Buffer.from(downloadRes.data), filename };
}
