import fs from "fs";
import path from "path";
import { DownloadTask, ProcessoRecord, ScraperState } from "../types";
import { config } from "../config";

/** Persistencia: `data/documents.jsonl` (un `ProcessoRecord` por línea) + checkpoint `data/scraper-state.json`. */
export class StateManager {
  private state: ScraperState;

  constructor() {
    fs.mkdirSync(config.paths.pdfsDir, { recursive: true });
    fs.mkdirSync(path.dirname(config.paths.stateJson), { recursive: true });
    this.state = this.loadState();
  }

  private loadState(): ScraperState {
    if (!fs.existsSync(config.paths.stateJson)) {
      return { processoIds: [], failedDownloads: [] };
    }
    return JSON.parse(fs.readFileSync(config.paths.stateJson, "utf-8"));
  }

  private saveState(): void {
    fs.writeFileSync(config.paths.stateJson, JSON.stringify(this.state, null, 2));
  }

  hasProcesso(numeroProcesso: string): boolean {
    return this.state.processoIds.includes(numeroProcesso);
  }

  appendProcessos(processos: ProcessoRecord[]): void {
    const seenInBatch = new Set<string>();
    const fresh = processos.filter((p) => {
      if (this.hasProcesso(p.id) || seenInBatch.has(p.id)) return false;
      seenInBatch.add(p.id);
      return true;
    });
    if (fresh.length === 0) return;
    const lines = fresh.map((p) => JSON.stringify(p)).join("\n") + "\n";
    fs.appendFileSync(config.paths.documentsJsonl, lines);
    this.state.processoIds.push(...fresh.map((p) => p.id));
    this.saveState();
  }

  loadAllProcessos(): ProcessoRecord[] {
    if (!fs.existsSync(config.paths.documentsJsonl)) return [];
    return fs
      .readFileSync(config.paths.documentsJsonl, "utf-8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ProcessoRecord);
  }

  private rewriteProcessos(processos: ProcessoRecord[]): void {
    fs.writeFileSync(config.paths.documentsJsonl, processos.map((p) => JSON.stringify(p)).join("\n") + "\n");
  }

  markDownloadOk(numeroProcesso: string, documentId: string, pdfPath: string): void {
    const processos = this.loadAllProcessos().map((p) => {
      if (p.numeroProcesso !== numeroProcesso) return p;
      return { ...p, documentos: p.documentos.map((d) => (d.id === documentId ? { ...d, pdfPath } : d)) };
    });
    this.rewriteProcessos(processos);
    this.state.failedDownloads = this.state.failedDownloads.filter((f) => f.documentId !== documentId);
    this.saveState();
  }

  markDownloadFailed(task: DownloadTask): void {
    const existing = this.state.failedDownloads.find((f) => f.documentId === task.documentId);
    if (existing) {
      existing.attempts = task.attempts;
      existing.lastError = task.lastError;
    } else {
      this.state.failedDownloads.push(task);
    }
    this.saveState();
  }

  get failedDownloads(): DownloadTask[] {
    return this.state.failedDownloads;
  }
}
