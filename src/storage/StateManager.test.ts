import assert from "assert";
import fs from "fs";
import { StateManager } from "./StateManager";
import { config } from "../config";
import { ProcessoRecord } from "../types";

// no pisar data/ real
config.paths.documentsJsonl = "data/.test/documents.jsonl";
config.paths.stateJson = "data/.test/scraper-state.json";
config.paths.pdfsDir = "data/.test/pdfs";

function test(name: string, fn: () => void) {
  fn();
  console.log(`OK   ${name}`);
}

const processo = (numero: string, docs: { id: string; pdfPath: string | null }[] = []): ProcessoRecord => ({
  id: numero,
  numeroProcesso: numero,
  classeJudicial: "APELAÇÃO CÍVEL",
  ultimaMovimentacao: "",
  movimentacoes: [],
  documentos: docs.map((d) => ({
    id: d.id,
    numeroProcesso: numero,
    idProcessoDoc: d.id.split(":")[1],
    descricao: "Acórdão",
    data: "01/01/2024",
    pdfPath: d.pdfPath,
  })),
});

for (const f of [config.paths.documentsJsonl, config.paths.stateJson]) {
  if (fs.existsSync(f)) fs.unlinkSync(f);
}

const state = new StateManager();

test("appendProcessos descarta duplicados por numeroProcesso (misma llamada)", () => {
  state.appendProcessos([processo("A"), processo("A"), processo("B")]);
  assert.strictEqual(state.loadAllProcessos().length, 2);
});

test("appendProcessos descarta duplicados ya persistidos (resume)", () => {
  state.appendProcessos([processo("A"), processo("C")]);
  const all = state.loadAllProcessos();
  assert.strictEqual(all.length, 3, "A no debería duplicarse al reintentar la misma búsqueda");
  assert.deepStrictEqual(
    all.map((p) => p.id),
    ["A", "B", "C"]
  );
});

test("hasProcesso refleja lo ya guardado", () => {
  assert.ok(state.hasProcesso("A"));
  assert.ok(!state.hasProcesso("Z"));
});

test("markDownloadOk actualiza el pdfPath del documento correcto y limpia failedDownloads", () => {
  state.appendProcessos([processo("D", [{ id: "D:111", pdfPath: null }])]);
  state.markDownloadFailed({ documentId: "D:111", numeroProcesso: "D", idProcessoDoc: "111", descricao: "x", attempts: 1, lastError: "boom" });
  assert.strictEqual(state.failedDownloads.length, 1);

  state.markDownloadOk("D", "D:111", "pdfs/D/x.pdf");
  const doc = state.loadAllProcessos().find((p) => p.id === "D")!.documentos[0];
  assert.strictEqual(doc.pdfPath, "pdfs/D/x.pdf");
  assert.strictEqual(state.failedDownloads.length, 0, "debería limpiarse de failedDownloads al tener éxito");
});

test("markDownloadFailed acumula intentos para el mismo documento", () => {
  state.markDownloadFailed({ documentId: "E:1", numeroProcesso: "E", idProcessoDoc: "1", descricao: "x", attempts: 1, lastError: "e1" });
  state.markDownloadFailed({ documentId: "E:1", numeroProcesso: "E", idProcessoDoc: "1", descricao: "x", attempts: 2, lastError: "e2" });
  const failed = state.failedDownloads.filter((f) => f.documentId === "E:1");
  assert.strictEqual(failed.length, 1, "no debería duplicar la entrada, solo actualizarla");
  assert.strictEqual(failed[0].attempts, 2);
  assert.strictEqual(failed[0].lastError, "e2");
});

console.log("\nTodos los tests de StateManager pasaron.");
