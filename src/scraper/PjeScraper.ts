import { HttpClient } from "../http/HttpClient";
import { ResultsPaginator } from "./ResultsPaginator";
import { PdfDownloader } from "../downloader/PdfDownloader";
import { StateManager } from "../storage/StateManager";
import { config } from "../config";
import { logger } from "../utils/logger";
import { ProcessoRecord } from "../types";

export class PjeScraper {
  private http = new HttpClient();
  private paginator = new ResultsPaginator(this.http);
  private state = new StateManager();
  private downloader = new PdfDownloader(this.http, this.state);

  /** Busca por el rango de fecha configurado y guarda proceso + movimentações + lista de documentos (sin bajar PDFs todavía). */
  async scrape(): Promise<void> {
    const { dataInicio, dataFim } = config.target.search;
    logger.info("Iniciando búsqueda", { dataInicio, dataFim });

    const resultados = await this.paginator.search(dataInicio, dataFim);
    logger.info(`Búsqueda devolvió ${resultados.length} proceso(s)`);

    const limite = config.maxProcessos > 0 ? Math.min(config.maxProcessos, resultados.length) : resultados.length;
    let procesados = 0;

    for (const resultado of resultados) {
      if (procesados >= limite) break;
      if (this.state.hasProcesso(resultado.numeroProcesso)) continue;

      try {
        const detalhe = await this.paginator.fetchDetalhe(resultado.ca);
        const processo: ProcessoRecord = {
          id: resultado.numeroProcesso,
          numeroProcesso: resultado.numeroProcesso,
          classeJudicial: resultado.classeJudicial,
          ultimaMovimentacao: resultado.ultimaMovimentacao,
          partes: detalhe.partes,
          movimentacoes: detalhe.movimentacoes,
          documentos: detalhe.documentos.map((d) => ({
            id: `${resultado.numeroProcesso}:${d.idProcessoDoc}`,
            numeroProcesso: resultado.numeroProcesso,
            idProcessoDoc: d.idProcessoDoc,
            descricao: d.descricao,
            data: d.data,
            pdfPath: null,
          })),
        };
        this.state.appendProcessos([processo]);
        procesados++;
        logger.progress(procesados, limite, "Procesos scrapeados");
      } catch (err) {
        logger.error(`Falló el procesamiento del proceso ${resultado.numeroProcesso}`, { error: (err as Error).message });
      }
    }
  }

  /**
   * Descarga los PDFs pendientes que matcheen `matches`. A diferencia de un
   * link de descarga estable, el token `ca` de cada documento está ligado a
   * la sesión que hizo la búsqueda/detalle — por eso, en vez de asumir que
   * lo guardado en `data/documents.jsonl` sigue siendo válido, se re-navega
   * (búsqueda + detalle) para conseguir un `ca` fresco antes de cada
   * descarga. Correlaciona por `idProcessoDoc`, que sí es estable entre
   * sesiones (a diferencia de `ca`, confirmado contra el sitio real).
   */
  private async downloadPending(matches: (numeroProcesso: string, idProcessoDoc: string) => boolean): Promise<void> {
    const pendentes = this.state
      .loadAllProcessos()
      .filter((p) => p.documentos.some((d) => !d.pdfPath && matches(p.numeroProcesso, d.idProcessoDoc)));

    if (pendentes.length === 0) {
      logger.info("No hay documentos pendientes de descarga.");
      return;
    }

    const { dataInicio, dataFim } = config.target.search;
    const resultados = await this.paginator.search(dataInicio, dataFim);
    const porNumero = new Map(resultados.map((r) => [r.numeroProcesso, r]));

    for (const processo of pendentes) {
      const resultado = porNumero.get(processo.numeroProcesso);
      if (!resultado) {
        logger.warn(
          `Proceso ${processo.numeroProcesso} ya no aparece en la búsqueda (rango de fecha configurado) — ` +
            "no se puede re-navegar para descargar sus PDFs pendientes."
        );
        continue;
      }

      const detalhe = await this.paginator.fetchDetalhe(resultado.ca);
      const porId = new Map(detalhe.documentos.map((d) => [d.idProcessoDoc, d]));

      for (const doc of processo.documentos) {
        if (doc.pdfPath || !matches(processo.numeroProcesso, doc.idProcessoDoc)) continue;
        const fresh = porId.get(doc.idProcessoDoc);
        if (!fresh) {
          logger.warn(`Documento "${doc.descricao}" ya no aparece en el detalle de ${processo.numeroProcesso}.`);
          continue;
        }
        await this.downloader.downloadOne(processo.numeroProcesso, fresh);
      }
    }
  }

  async download(): Promise<void> {
    await this.downloadPending(() => true);
  }

  async retry(): Promise<void> {
    const failedIds = new Set(this.state.failedDownloads.map((f) => f.documentId));
    if (failedIds.size === 0) {
      logger.info("No hay documentos fallidos registrados. Nada que reintentar.");
      return;
    }
    await this.downloadPending((numeroProcesso, idProcessoDoc) => failedIds.has(`${numeroProcesso}:${idProcessoDoc}`));
  }

  async run(): Promise<void> {
    await this.scrape();
    await this.download();
    await this.retry();
  }
}
