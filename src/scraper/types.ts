/** Modelos de datos extraídos del PJe TRF5 - Consulta Pública. */

export interface ResultadoBusca {
  /** Número do processo en formato CNJ, ej: 0001234-56.2024.4.05.0000 */
  numeroProcesso: string;
  classeJudicial: string;
  ultimaMovimentacao: string;
  /** Token de un solo uso (?ca=) para acceder al detalle del proceso. */
  tokenDetalhe: string;
}

export interface Movimentacao {
  data: string;
  descricao: string;
  /** true si esta movimentação tiene documento asociado para descargar. */
  temDocumento: boolean;
  /** ids/params necesarios para replicar el AJAX que genera el `cid` de descarga. */
  ajaxParams?: Record<string, string>;
}

export interface DocumentoBaixado {
  movimentacao: string;
  data: string;
  arquivo: string;
  tamanhoBytes: number;
}

export interface DocumentoFalhado {
  numeroProcesso: string;
  movimentacao: string;
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
