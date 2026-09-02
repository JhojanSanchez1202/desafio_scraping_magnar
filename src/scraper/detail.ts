import * as cheerio from "cheerio";
import { BASE_URL, PjeClient } from "../http/client";
import { parsePageSlider, toRelativePath } from "../http/ajaxAction";
import { logger } from "../utils/logger";
import { DocumentoRef, Movimentacao, ResultadoBusca } from "./types";

interface DetalheProcesso {
  partes?: string;
  movimentacoes: Movimentacao[];
  documentos: DocumentoRef[];
}

/** "Movimentações do Processo" (tabla `processoEvento`) — solo informativo. */
function parseMovimentacoes(html: string): Movimentacao[] {
  const $ = cheerio.load(html);
  const movimentacoes: Movimentacao[] = [];
  $('[id$=":processoEvento:tb"] > tr').each((_, tr) => {
    const texto = $(tr).find("td").first().text().replace(/\s+/g, " ").trim();
    // formato real: "11/06/2026 15:02:33 - Baixa Definitiva"
    const m = texto.match(/^(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2})\s*-\s*(.+)$/);
    if (!m) return;
    movimentacoes.push({ data: m[1], descricao: m[2].trim() });
  });
  return movimentacoes;
}

/**
 * "Documentos juntados ao processo" (tabla `processoDocumentoGridTab`) — cada
 * fila tiene un link directo a `documentoSemLoginHTML.seam?ca=...&idProcessoDoc=...`.
 */
function parseDocumentos(html: string): DocumentoRef[] {
  const $ = cheerio.load(html);
  const documentos: DocumentoRef[] = [];
  $('a[onclick*="documentoSemLoginHTML"]').each((_, a) => {
    const onclick = $(a).attr("onclick") || "";
    const urlMatch = onclick.match(/openPopUp\('[^']*',\s*'([^']+)'\)/);
    if (!urlMatch) return;
    const url = urlMatch[1];
    const ca = url.match(/[?&]ca=([0-9a-fA-F]+)/)?.[1];
    const idProcessoDoc = url.match(/[?&]idProcessoDoc=(\d+)/)?.[1];
    if (!ca || !idProcessoDoc) return;

    const texto = $(a).text().replace(/\s+/g, " ").trim();
    // formato real: "Visualizar documentos19/03/2026 11:22:22 - Acórdão (Acórdão)"
    const m = texto.match(/(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2})\s*-\s*(.+)$/);
    documentos.push({
      data: m?.[1] ?? "",
      descricao: (m?.[2] ?? texto).trim(),
      ca,
      idProcessoDoc,
    });
  });
  return documentos;
}

/**
 * Recorre todas las páginas de una tabla (movimentações o documentos) usando
 * el `rich:inputNumberSlider` de "página" que RichFaces renderiza cuando hay
 * más de una página — no son botones next/prev, es un slider numérico.
 * `section` acota la búsqueda del slider a ese tramo del HTML, porque el
 * detalle tiene dos tablas paginadas independientes.
 *
 * LÍMITE CONOCIDO: en pruebas reales, el POST se reconoce como AJAX
 * (respuesta válida, sin el bug de "fPP:searchProcessos" que sí resolvimos
 * para la búsqueda) pero el servidor devuelve `Ajax-Update-Ids=""` — no
 * aplica el cambio de página. No identificamos qué parámetro adicional
 * necesita el protocolo interno del slider de RichFaces sin una captura real
 * de un cambio de página en el navegador (mismo método que resolvió la
 * búsqueda y la descarga de PDF). Mientras tanto, esta función devuelve solo
 * la primera página y loggea una advertencia si hay más — no se pierden
 * datos silenciosamente, pero un proceso con muchas movimentações/documentos
 * (más de ~15) no trae el listado completo todavía.
 */
async function fetchAllPages<T>(
  client: PjeClient,
  fullHtml: string,
  section: string,
  parseItems: (html: string) => T[],
  label: string
): Promise<T[]> {
  const items = [...parseItems(fullHtml)];
  const slider = parsePageSlider(section);
  if (!slider || slider.maxPage <= 1) return items;

  const actionPath = toRelativePath(slider.action.actionUrl, BASE_URL);
  const totalAntes = items.length;
  for (let page = 2; page <= slider.maxPage; page++) {
    const res = await client.postAjax(actionPath, fullHtml, slider.action.formId, {
      ...slider.action.parameters,
      [slider.fieldName]: String(page),
    });
    items.push(...parseItems(res.data));
  }

  if (items.length === totalAntes) {
    logger.warn(
      `"${label}" tiene ${slider.maxPage} páginas pero no se pudieron traer las siguientes ` +
        "(límite conocido del slider de RichFaces, ver comentario en fetchAllPages). " +
        `Se devolvió solo la primera página (${totalAntes} ítems).`
    );
  }
  return items;
}

/** Abre el detalle de un proceso (token `ca` de un solo uso) y parsea movimentações + documentos, con paginación completa. */
export async function fetchDetalheProcesso(client: PjeClient, resultado: ResultadoBusca): Promise<DetalheProcesso> {
  // La URL real lleva "ConsultaPublica/" de nuevo antes del detalle (confirmado con una fila real).
  const res = await client.get(
    `/ConsultaPublica/DetalheProcessoConsultaPublica/listView.seam?ca=${resultado.tokenDetalhe}`
  );
  const html = res.data;
  const $ = cheerio.load(html);

  const partes = $(".partes, #polos").first().text().replace(/\s+/g, " ").trim() || undefined;

  // Los paneles de movimentações y documentos están en secciones separadas del HTML;
  // acotamos cada búsqueda de slider a su propio tramo para no cruzar los dos.
  const docPanelIdx = html.indexOf("processoDocumentoGridTabPanel");
  const movSection = docPanelIdx === -1 ? html : html.slice(0, docPanelIdx);
  const docSection = docPanelIdx === -1 ? "" : html.slice(docPanelIdx);

  const movimentacoes = await fetchAllPages(client, html, movSection, parseMovimentacoes, "Movimentações");
  const documentos = await fetchAllPages(client, html, docSection, parseDocumentos, "Documentos");

  if (movimentacoes.length === 0 && documentos.length === 0) {
    logger.warn(`Proceso ${resultado.numeroProcesso}: no se encontraron movimentações ni documentos en el detalle.`, {
      token: resultado.tokenDetalhe,
    });
  }

  return { partes, movimentacoes, documentos };
}
