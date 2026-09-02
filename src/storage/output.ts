import { promises as fs } from "fs";
import * as path from "path";
import { logger } from "../utils/logger";
import { DocumentoFalhado, ProcessoExtraido } from "../scraper/types";

const OUTPUT_DIR = path.resolve(__dirname, "..", "..", "output");
const PDFS_DIR = path.join(OUTPUT_DIR, "pdfs");
const DATA_FILE = path.join(OUTPUT_DIR, "data.json");
const FAILED_FILE = path.join(OUTPUT_DIR, "failed.json");

export async function ensureOutputDirs(): Promise<void> {
  await fs.mkdir(PDFS_DIR, { recursive: true });
}

async function readJsonArray<T>(file: string): Promise<T[]> {
  try {
    const raw = await fs.readFile(file, "utf-8");
    return JSON.parse(raw) as T[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error(`No se pudo leer ${file}: ${(err as Error).message}`);
  }
}

async function writeJsonArray<T>(file: string, data: T[]): Promise<void> {
  await fs.writeFile(file, JSON.stringify(data, null, 2), "utf-8");
}

/** Guarda un PDF en output/pdfs/<numeroProcesso>/<filename>. Devuelve la ruta relativa usada. */
export async function savePdf(numeroProcesso: string, filename: string, buffer: Buffer): Promise<string> {
  const dir = path.join(PDFS_DIR, numeroProcesso.replace(/[\\/:*?"<>|]/g, "_"));
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, filename);
  await fs.writeFile(filePath, buffer);
  return path.relative(OUTPUT_DIR, filePath);
}

export async function appendProcesso(processo: ProcessoExtraido): Promise<void> {
  const data = await readJsonArray<ProcessoExtraido>(DATA_FILE);
  data.push(processo);
  await writeJsonArray(DATA_FILE, data);
}

export async function appendFailed(doc: DocumentoFalhado): Promise<void> {
  const failed = await readJsonArray<DocumentoFalhado>(FAILED_FILE);
  failed.push(doc);
  await writeJsonArray(FAILED_FILE, failed);
  logger.error("Documento registrado como fallido", { ...doc });
}

export async function loadFailed(): Promise<DocumentoFalhado[]> {
  return readJsonArray<DocumentoFalhado>(FAILED_FILE);
}

export async function saveFailed(failed: DocumentoFalhado[]): Promise<void> {
  await writeJsonArray(FAILED_FILE, failed);
}
