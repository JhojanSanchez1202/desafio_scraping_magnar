/** Modelos de datos extraídos del PJe TRF5 - Consulta Pública. */

export interface ResultadoBusca {
  /** Número do processo en formato CNJ, ej: 0001234-56.2024.4.05.0000 */
  numeroProcesso: string;
  classeJudicial: string;
  ultimaMovimentacao: string;
  /** Token de un solo uso (?ca=) para acceder al detalle del proceso. */
  tokenDetalhe: string;
}

/** Fila de "Movimentações do Processo" — informativo, sin documento asociado. */
export interface Movimentacao {
  data: string;
  descricao: string;
}

/** Fila de "Documentos juntados ao processo" — sí tiene descarga. */
export interface DocumentoRef {
  data: string;
  descricao: string;
  /** Token de un solo uso para ver el documento (?ca=). */
  ca: string;
  /** Id del documento dentro del proceso (?idProcessoDoc=). */
  idProcessoDoc: string;
}

export interface DocumentoBaixado {
  descricao: string;
  data: string;
  arquivo: string;
  tamanhoBytes: number;
}

export interface DocumentoFalhado {
  numeroProcesso: string;
  documento: string;
  motivo: string;
  tentativas: number;
  timestamp: string;
}

export interface ProcessoExtraido {
  numeroProcesso: string;
  classeJudicial: string;
  ultimaMovimentacao: string;
  partes?: string;
  movimentacoes: Movimentacao[];
  documentosBaixados: DocumentoBaixado[];
}
