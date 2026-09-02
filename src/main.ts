/**
 * Orquestador del scraper: busca procesos por rango de fecha de autuação,
 * entra a cada uno, descarga los PDFs de sus movimentações y persiste todo
 * en output/. Ver README.md para las variables de entorno disponibles.
 */
import { PjeClient } from "./http/client";
import { searchByDateRange } from "./scraper/search";
import { fetchDetalheProcesso } from "./scraper/detail";
import { downloadDocumento, RetryConfig } from "./scraper/document";
import { appendProcesso, appendFailed, ensureOutputDirs, loadFailed, saveFailed, savePdf } from "./storage/output";
import { logger } from "./utils/logger";
import { DocumentoBaixado, DocumentoFalhado, ProcessoExtraido } from "./scraper/types";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function defaultDateRange(): { dataInicio: string; dataFim: string } {
  const fmt = (d: Date) =>
    `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  const fim = new Date();
  const inicio = new Date();
  inicio.setDate(inicio.getDate() - envInt("DIAS_ATRAS", 30));
  return { dataInicio: fmt(inicio), dataFim: fmt(fim) };
}

async function main(): Promise<void> {
  const retryFailedMode = process.argv.includes("--retry-failed");
  await ensureOutputDirs();

  const requestDelayMs = envInt("REQUEST_DELAY_MS", 1500);
  const retryConfig: RetryConfig = {
    maxRetries: envInt("MAX_RETRIES", 5),
    baseDelayMs: envInt("BASE_DELAY_MS", 2000),
    maxDelayMs: envInt("MAX_DELAY_MS", 30000),
  };

  const defaults = defaultDateRange();
  const dataInicio = process.env.DATA_INICIO ?? defaults.dataInicio;
  const dataFim = process.env.DATA_FIM ?? defaults.dataFim;

  const pendingByProceso = retryFailedMode ? groupByProceso(await loadFailed()) : null;
  if (retryFailedMode && (!pendingByProceso || pendingByProceso.size === 0)) {
    logger.info("No hay documentos fallidos registrados en output/failed.json. Nada que reintentar.");
    return;
  }

  logger.info("Iniciando búsqueda", { dataInicio, dataFim, retryFailedMode });
  const client = new PjeClient();
  const resultados = await searchByDateRange(client, dataInicio, dataFim);
  logger.info(`Búsqueda devolvió ${resultados.length} proceso(s)`);

  const stillFailing: DocumentoFalhado[] = [];

  for (const resultado of resultados) {
    if (pendingByProceso && !pendingByProceso.has(resultado.numeroProcesso)) continue;

    try {
      await sleep(requestDelayMs);
      const detalhe = await fetchDetalheProcesso(client, resultado);

      const documentosBaixados: DocumentoBaixado[] = [];
      const docsAlvo = pendingByProceso?.get(resultado.numeroProcesso);

      for (const doc of detalhe.documentos) {
        if (docsAlvo && !docsAlvo.has(doc.descricao)) continue;

        try {
          await sleep(requestDelayMs);
          const { buffer, filename } = await downloadDocumento(client, doc, resultado.numeroProcesso, retryConfig);
          const relPath = await savePdf(resultado.numeroProcesso, filename, buffer);
          documentosBaixados.push({
            descricao: doc.descricao,
            data: doc.data,
            arquivo: relPath,
            tamanhoBytes: buffer.length,
          });
          logger.info("PDF descargado", { numeroProcesso: resultado.numeroProcesso, arquivo: relPath });
        } catch (err) {
          const falha: DocumentoFalhado = {
            numeroProcesso: resultado.numeroProcesso,
            documento: doc.descricao,
            motivo: (err as Error).message,
            tentativas: retryConfig.maxRetries,
            timestamp: new Date().toISOString(),
          };
          stillFailing.push(falha);
          await appendFailed(falha);
        }
      }

      const processo: ProcessoExtraido = {
        numeroProcesso: resultado.numeroProcesso,
        classeJudicial: resultado.classeJudicial,
        ultimaMovimentacao: resultado.ultimaMovimentacao,
        partes: detalhe.partes,
        movimentacoes: detalhe.movimentacoes,
        documentosBaixados,
      };
      await appendProcesso(processo);
    } catch (err) {
      logger.error(`Falló el procesamiento del proceso ${resultado.numeroProcesso}`, {
        error: (err as Error).message,
      });
    }
  }

  if (retryFailedMode) {
    // sólo quedan en failed.json los que volvieron a fallar en este intento
    await saveFailed(stillFailing);
  }

  logger.info("Scraper finalizado", { procesos: resultados.length, fallidosRestantes: stillFailing.length });
}

function groupByProceso(failed: DocumentoFalhado[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const f of failed) {
    if (!map.has(f.numeroProcesso)) map.set(f.numeroProcesso, new Set());
    map.get(f.numeroProcesso)!.add(f.documento);
  }
  return map;
}

main().catch((err) => {
  logger.error("El scraper terminó con un error no manejado", { error: (err as Error).message });
  process.exit(1);
});
