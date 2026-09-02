import * as cheerio from "cheerio";
import { BASE_URL, PjeClient } from "../http/client";
import { parseAjaxSubmit, toRelativePath } from "../http/ajaxAction";
import { logger } from "../utils/logger";
import { ResultadoBusca } from "./types";

const RESULTS_TABLE_ID = "fPP:processosTable";

function extractFormActionUrl(html: string, formId: string): string {
  const $ = cheerio.load(html);
  const action = $(`form#${formId}`).attr("action");
  if (!action) {
    throw new Error(
      `No se encontró el <form id="${formId}"> en la página. El sitio pudo haber cambiado su estructura.`
    );
  }
  return action;
}

function toMonthYear(ddMMyyyy: string): string {
  const [, mm, yyyy] = ddMMyyyy.split("/");
  return `${mm}/${yyyy}`;
}

/** Extrae los resultados visibles en la tabla de procesos de un fragmento de respuesta AJAX. */
function parseResultsPage(html: string): ResultadoBusca[] {
  const $ = cheerio.load(html);
  const table = $(`[id="${RESULTS_TABLE_ID}"]`);
  if (table.length === 0) return [];

  const rows: ResultadoBusca[] = [];
  table.find("tbody tr").each((_, tr) => {
    const $tr = $(tr);
    const cells = $tr.find("td");
    if (cells.length < 2) return;

    const processoText = $(cells[1]).text().replace(/\s+/g, " ").trim();
    const ultimaMovimentacao = $(cells[2] ?? cells[1])
      .text()
      .replace(/\s+/g, " ")
      .trim();

    // La celda trae todo junto: "APELAÇÃO CÍVEL ApCiv 0000288-95.2018.8.25.0049 - Assunto Partes..."
    // (confirmado con una fila real). El número sigue siempre el formato CNJ.
    const cnjMatch = processoText.match(/\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/);
    const numeroProcesso = cnjMatch?.[0];
    const classeJudicial = numeroProcesso ? processoText.split(numeroProcesso)[0].trim() : processoText;

    const rowHtml = $tr.html() || "";
    const caMatch = rowHtml.match(/[?&]ca=([0-9a-fA-F]+)/);

    if (!numeroProcesso || !caMatch) {
      logger.warn("Fila de resultado sin número de processo o token 'ca', se omite", { processoText });
      return;
    }

    rows.push({
      numeroProcesso: numeroProcesso.trim(),
      classeJudicial,
      ultimaMovimentacao,
      tokenDetalhe: caMatch[1],
    });
  });
  return rows;
}

/** Busca el control "próxima página" del datascroller de resultados, si existe. */
function findNextPageAction(html: string) {
  const $ = cheerio.load(html);
  const next = $(`[id="${RESULTS_TABLE_ID}"]`)
    .closest("table")
    .find(".rich-datascr-button-fastforward, .rich-datascr-button-next")
    .first();
  const onclick = next.attr("onclick");
  if (!onclick) return null;
  return parseAjaxSubmit(onclick);
}

/**
 * Busca procesos por rango de fecha de autuação (dd/MM/yyyy) y recorre toda
 * la paginación de resultados.
 */
export async function searchByDateRange(
  client: PjeClient,
  dataInicio: string,
  dataFim: string
): Promise<ResultadoBusca[]> {
  const home = await client.get("/ConsultaPublica/listView.seam");
  const actionPath = toRelativePath(extractFormActionUrl(home.data, "fPP"), BASE_URL);

  const overrides: Record<string, string> = {
    "fPP:dataAutuacaoDecoration:dataAutuacaoInicioInputDate": dataInicio,
    "fPP:dataAutuacaoDecoration:dataAutuacaoInicioInputCurrentDate": toMonthYear(dataInicio),
    "fPP:dataAutuacaoDecoration:dataAutuacaoFimInputDate": dataFim,
    "fPP:dataAutuacaoDecoration:dataAutuacaoFimInputCurrentDate": toMonthYear(dataFim),
    // El botón "Pesquisar" llama executarPesquisa(), que en realidad manda
    // el submit ligado al componente fPP:j_id244 (no fPP:searchProcessos) —
    // confirmado con una captura real del navegador (Network tab).
    "fPP:j_id244": "fPP:j_id244",
    AJAXREQUEST: "_viewRoot",
    "AJAX:EVENTS_COUNT": "1",
  };

  const res = await client.postAjax(actionPath, home.data, "fPP", overrides);
  const all: ResultadoBusca[] = parseResultsPage(res.data);
  if (all.length === 0) {
    logger.warn(
      "La búsqueda no devolvió filas en fPP:processosTable. " +
        "Es posible que el sitio requiera parámetros AJAX distintos a los replicados " +
        "(ver README: sección 'Ajustar la búsqueda con una captura real del navegador') " +
        "o que no existan procesos en el rango de fechas dado."
    );
  }

  let page = res.data;
  for (;;) {
    const nextAction = findNextPageAction(page);
    if (!nextAction) break;
    const nextRes = await client.submitAjaxAction(nextAction, page);
    const parsed = parseResultsPage(nextRes.data);
    if (parsed.length === 0) break;
    all.push(...parsed);
    page = nextRes.data;
  }

  return all;
}
