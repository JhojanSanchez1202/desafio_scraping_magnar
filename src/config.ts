import "dotenv/config";

const env = (key: string, fallback: string) => process.env[key] ?? fallback;
const envNum = (key: string, fallback: number) => Number(process.env[key] ?? fallback);

function fmtDate(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

function defaultDataInicio(): string {
  const dias = envNum("DIAS_ATRAS", 30);
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return fmtDate(d);
}

export const config = {
  target: {
    origin: "https://pjett.trf5.jus.br",
    baseUrl: "https://pjett.trf5.jus.br/pjeconsulta",
    listViewPath: "/ConsultaPublica/listView.seam",
    search: {
      formId: "fPP",
      dataInicio: env("DATA_INICIO", defaultDataInicio()),
      dataFim: env("DATA_FIM", fmtDate(new Date())),
    },
  },
  requestDelayMs: envNum("REQUEST_DELAY_MS", 1500),
  requestTimeoutMs: envNum("REQUEST_TIMEOUT_MS", 30000),
  maxRetries: envNum("MAX_RETRIES", 5),
  retryBaseDelayMs: envNum("RETRY_BASE_DELAY_MS", 2000),
  retryMaxDelayMs: envNum("RETRY_MAX_DELAY_MS", 30000),
  maxProcessos: envNum("MAX_PROCESSOS", 0), // 0 = sin límite, para pruebas cortas
  paths: {
    documentsJsonl: "data/documents.jsonl",
    stateJson: "data/scraper-state.json",
    pdfsDir: "pdfs",
    logsDir: "logs",
  },
};
