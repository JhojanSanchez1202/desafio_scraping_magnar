/** Tipos del dominio: Consulta Pública PJe TRF5. */

export interface MovimentacaoRecord {
  data: string;
  descricao: string;
}

export interface DocumentoRecord {
  /** `${numeroProcesso}:${idProcessoDoc}` */
  id: string;
  numeroProcesso: string;
  /** Id estable del documento en el sitio (a diferencia de `ca`, que es de un solo render). */
  idProcessoDoc: string;
  descricao: string;
  data: string;
  pdfPath: string | null;
}

export interface ProcessoRecord {
  /** = numeroProcesso, para calzar con la convención `id` del resto de records. */
  id: string;
  numeroProcesso: string;
  classeJudicial: string;
  ultimaMovimentacao: string;
  partes?: string;
  movimentacoes: MovimentacaoRecord[];
  documentos: DocumentoRecord[];
}

export interface DownloadTask {
  documentId: string;
  numeroProcesso: string;
  idProcessoDoc: string;
  descricao: string;
  attempts: number;
  lastError: string | null;
}

export interface ScraperState {
  /** numeroProcesso ya scrapeados (búsqueda + detalle), para dedup/resume. */
  processoIds: string[];
  failedDownloads: DownloadTask[];
}

export type RunMode = "scrape" | "download" | "retry" | "full";
