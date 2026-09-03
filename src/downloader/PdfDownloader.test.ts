import assert from "assert";
import fs from "fs";
import path from "path";
import http from "http";
import { HttpClient } from "../http/HttpClient";
import { PdfDownloader } from "./PdfDownloader";
import { StateManager } from "../storage/StateManager";
import { config } from "../config";
import { DocumentoLink } from "../scraper/PageParser";

// no pisar data/ real ni pegarle al sitio real
config.paths.documentsJsonl = "data/.test2/documents.jsonl";
config.paths.stateJson = "data/.test2/scraper-state.json";
config.paths.pdfsDir = "data/.test2/pdfs";
config.requestDelayMs = 0;
config.retryBaseDelayMs = 10;
config.retryMaxDelayMs = 20;

const DOC_PATH = "/ConsultaPublica/DetalheProcessoConsultaPublica/documentoSemLoginHTML.seam";

function viewHtml(formId: string): string {
  return `<html><body><form id="${formId}" method="post" action="${DOC_PATH}">
    <input type="hidden" name="${formId}" value="${formId}" />
    <a id="${formId}:downloadPDF" onclick="jsfcljs(document.getElementById('${formId}'),{'${formId}:downloadPDF':'${formId}:downloadPDF','ca':'freshca','idProcDocBin':'999'},'')">Gerar PDF</a>
  </form></body></html>`;
}

let okAttempts = 0;

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "", "http://localhost");

  if (req.method === "GET" && url.pathname === DOC_PATH && url.searchParams.get("idProcessoDoc") === "ok") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(viewHtml("formOk"));
    return;
  }
  if (req.method === "GET" && url.pathname === DOC_PATH && url.searchParams.get("idProcessoDoc") === "bad") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(viewHtml("formBad"));
    return;
  }
  if (req.method === "POST" && url.pathname === DOC_PATH) {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (body.includes("formOk")) {
        if (okAttempts === 0) {
          okAttempts++;
          res.writeHead(429, { "Retry-After": "0" });
          res.end();
          return;
        }
        res.writeHead(200, { "Content-Type": "application/pdf" });
        res.end(Buffer.from("%PDF-1.4 fake content"));
        return;
      }
      // formBad: el sitio a veces devuelve un HTML de error con 200 en vez del PDF
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html>Erro inesperado</html>");
    });
    return;
  }
  res.writeHead(404);
  res.end();
});

function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`OK   ${name}`))
    .catch((err) => {
      console.error(`FAIL ${name}`);
      throw err;
    });
}

async function main() {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  config.target.baseUrl = `http://127.0.0.1:${port}`;

  for (const f of [config.paths.documentsJsonl, config.paths.stateJson]) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
  fs.rmSync(config.paths.pdfsDir, { recursive: true, force: true });

  const http_ = new HttpClient();
  const state = new StateManager();
  const downloader = new PdfDownloader(http_, state);

  await test("descarga OK tras un 429 (retry/backoff funcionando) y valida %PDF-", async () => {
    const doc: DocumentoLink = { idProcessoDoc: "ok", ca: "x", descricao: "Decisão", data: "01/01/2024" };
    await downloader.downloadOne("PROC-1", doc);
    const destPath = path.join(config.paths.pdfsDir, "PROC-1", "01_01_2024_Decisão.pdf");
    assert.ok(fs.existsSync(destPath), "el pdf debería existir en disco");
    assert.strictEqual(okAttempts, 1, "debería haber reintentado una vez tras el 429");
    assert.strictEqual(state.failedDownloads.length, 0);
  });

  await test("respuesta 200 que no es un PDF real se registra como fallida", async () => {
    const doc: DocumentoLink = { idProcessoDoc: "bad", ca: "x", descricao: "Decisão", data: "01/01/2024" };
    await downloader.downloadOne("PROC-2", doc);
    assert.strictEqual(state.failedDownloads.length, 1);
    assert.strictEqual(state.failedDownloads[0].documentId, "PROC-2:bad");
    const destPath = path.join(config.paths.pdfsDir, "PROC-2", "01_01_2024_Decisão.pdf");
    assert.ok(!fs.existsSync(destPath), "el archivo inválido no debería quedar en disco");
  });

  server.close();
  console.log("\nTodos los tests de PdfDownloader pasaron.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
