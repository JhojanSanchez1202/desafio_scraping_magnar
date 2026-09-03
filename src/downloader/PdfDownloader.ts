import fs from "fs";
import path from "path";
import { HttpClient } from "../http/HttpClient";
import { PageParser, DocumentoLink } from "../scraper/PageParser";
import { StateManager } from "../storage/StateManager";
import { config } from "../config";
import { logger } from "../utils/logger";
import { sanitizeFilename } from "../utils/delay";

/**
 * Descarga el PDF de un documento. Flujo real del sitio (confirmado con
 * capturas reales, no es AJAX):
 *  1. GET documentoSemLoginHTML.seam?ca=X&idProcessoDoc=Y → vista HTML del
 *     documento, con un botón "Gerar PDF" que trae un `ca`/`idProcDocBin`
 *     propios (regenerados en cada render).
 *  2. POST de formulario NORMAL (no AJAX — `f.submit()` nativo) a la action
 *     del `<form>` SIN el query string de la vista.
 *
 * A diferencia de un link de descarga estable, el `ca` de `doc` está ligado
 * a la sesión que hizo la búsqueda/detalle — por eso este downloader recibe
 * siempre un `DocumentoLink` recién resuelto (no uno guardado de una corrida
 * anterior), y quien orquesta (`PjeScraper`) es responsable de re-navegar
 * para conseguirlo fresco antes de llamar acá.
 */
export class PdfDownloader {
  constructor(private http: HttpClient, private state: StateManager) {}

  private buildFileName(doc: DocumentoLink): string {
    return sanitizeFilename(`${doc.data}_${doc.descricao}`) + ".pdf";
  }

  private isValidPdf(filePath: string): boolean {
    const fd = fs.openSync(filePath, "r");
    const buffer = Buffer.alloc(5);
    fs.readSync(fd, buffer, 0, 5, 0);
    fs.closeSync(fd);
    return buffer.toString("ascii") === "%PDF-";
  }

  async downloadOne(numeroProcesso: string, doc: DocumentoLink): Promise<void> {
    const documentId = `${numeroProcesso}:${doc.idProcessoDoc}`;
    const fileName = this.buildFileName(doc);
    const destDir = path.join(config.paths.pdfsDir, numeroProcesso.replace(/[\\/:*?"<>|]/g, "_"));
    const destPath = path.join(destDir, fileName);
    fs.mkdirSync(destDir, { recursive: true });

    try {
      const viewPath = `/ConsultaPublica/DetalheProcessoConsultaPublica/documentoSemLoginHTML.seam?ca=${doc.ca}&idProcessoDoc=${doc.idProcessoDoc}`;
      const viewUrl = `${config.target.baseUrl}${viewPath}`;
      const viewRes = await this.http.get(viewUrl);
      const viewHtml = viewRes.data as string;

      const trigger = PageParser.extractGerarPdfTrigger(viewHtml);
      if (!trigger) {
        throw new Error(
          `No se encontró el botón "Gerar PDF" para "${doc.descricao}". El sitio pudo haber cambiado la vista de documento.`
        );
      }

      const snapshot = PageParser.extractFormSnapshot(viewHtml, trigger.formId);
      const body = new URLSearchParams({
        ...snapshot,
        [`${trigger.formId}:downloadPDF`]: `${trigger.formId}:downloadPDF`,
        ca: trigger.ca,
        idProcDocBin: trigger.idProcDocBin,
      });

      const pdfRes = await this.http.post(`${config.target.baseUrl}${trigger.actionPath}`, body.toString(), {
        responseType: "arraybuffer",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Origin: config.target.origin,
          Referer: viewUrl,
        },
      });

      const contentType = String(pdfRes.headers["content-type"] ?? "");
      if (!contentType.includes("pdf")) {
        throw new Error(`El POST a "Gerar PDF" no devolvió un PDF (content-type: ${contentType || "desconocido"}).`);
      }

      fs.writeFileSync(destPath, Buffer.from(pdfRes.data));
      if (!this.isValidPdf(destPath)) {
        fs.unlinkSync(destPath);
        throw new Error('El archivo descargado no tiene header "%PDF-" válido.');
      }

      logger.info(`PDF descargado: ${fileName}`, { numeroProcesso });
      this.state.markDownloadOk(numeroProcesso, documentId, destPath);
    } catch (err) {
      logger.error(`Falló la descarga de "${doc.descricao}"`, { numeroProcesso, error: (err as Error).message });
      this.state.markDownloadFailed({
        documentId,
        numeroProcesso,
        idProcessoDoc: doc.idProcessoDoc,
        descricao: doc.descricao,
        attempts: 1,
        lastError: (err as Error).message,
      });
    }
  }
}
