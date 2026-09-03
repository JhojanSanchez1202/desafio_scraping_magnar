import * as cheerio from "cheerio";
import { logger } from "../utils/logger";
import { MovimentacaoRecord } from "../types";

/**
 * JSF/RichFaces 3.3.3, sin API. Casi toda la interacción es un POST
 * `A4J.AJAX.Submit('formId', event, {'actionUrl':'...','parameters':{...}})`
 * — en vez de hardcodear cada pantalla, se parsea ese literal desde el
 * `onclick`/`<script>` real del HTML devuelto por el servidor.
 */
export interface AjaxAction {
  formId: string;
  actionUrl: string;
  parameters: Record<string, string>;
}

export interface PageSlider {
  /** name= del <input> del slider — se manda con el número de página deseado. */
  fieldName: string;
  maxPage: number;
  action: AjaxAction;
}

export interface ProcessoSearchResult {
  numeroProcesso: string;
  classeJudicial: string;
  ultimaMovimentacao: string;
  /** Token de un solo uso (ligado a la sesión) para abrir el detalle. */
  ca: string;
}

export interface DocumentoLink {
  idProcessoDoc: string;
  /** Token de la vista del documento — ligado a la sesión, se regenera por render. */
  ca: string;
  descricao: string;
  data: string;
}

export interface GerarPdfTrigger {
  formId: string;
  actionPath: string;
  ca: string;
  idProcDocBin: string;
}

export class PageParser {
  /** Convierte escapes `\x2D` (RichFaces escapa `-` así dentro del JS) y entidades HTML. */
  private static unescapeJs(s: string): string {
    return s.replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16))).replace(/&amp;/g, "&");
  }

  static extractAjaxAction(js: string): AjaxAction | null {
    const submitMatch = js.match(/A4J\.AJAX\.Submit\(\s*'([^']+)'/);
    const actionUrlMatch = js.match(/'actionUrl'\s*:\s*'([^']+)'/);
    const parametersBlockMatch = js.match(/'parameters'\s*:\s*\{([\s\S]*?)\}\s*(?:,\s*'status'|\)\s*;?\s*$|\}\s*\))/);
    if (!submitMatch || !actionUrlMatch) return null;

    const parameters: Record<string, string> = {};
    const paramsSrc = parametersBlockMatch?.[1] ?? "";
    const pairRegex = /'([^']+)'\s*:\s*'([^']*)'/g;
    let m: RegExpExecArray | null;
    while ((m = pairRegex.exec(paramsSrc)) !== null) {
      parameters[PageParser.unescapeJs(m[1])] = PageParser.unescapeJs(m[2]);
    }

    return { formId: submitMatch[1], actionUrl: PageParser.unescapeJs(actionUrlMatch[1]), parameters };
  }

  /** `url` viene absoluta o `/pjeconsulta/...`; la volvemos relativa a `config.target.baseUrl`. */
  static toRelativePath(url: string): string {
    let path = url;
    const httpIdx = path.indexOf("://");
    if (httpIdx !== -1) {
      const afterHost = path.indexOf("/", httpIdx + 3);
      path = afterHost === -1 ? "/" : path.slice(afterHost);
    }
    if (path.startsWith("/pjeconsulta")) path = path.slice("/pjeconsulta".length);
    return path || "/";
  }

  /**
   * Serializa todos los campos de un `<form>` (como hace un browser real /
   * A4J.AJAX.Submit al armar el POST) para no perder inputs ocultos de
   * RichFaces que hacen falta para que el postback sea válido. Usa un
   * selector de atributo, no `#id`: los ids de RichFaces llevan ":" (ej.
   * "j_id146:j_id561"), que en un selector CSS `#id` es una pseudo-clase
   * inválida.
   */
  static extractFormSnapshot(html: string, formId: string): Record<string, string> {
    const $ = cheerio.load(html);
    const form = $(`form[id="${formId}"]`);
    const fields: Record<string, string> = {};

    form.find("input, select, textarea").each((_, el) => {
      const $el = $(el);
      const name = $el.attr("name");
      if (!name) return;
      const type = ($el.attr("type") || "").toLowerCase();
      if (type === "checkbox" || type === "radio") {
        if ($el.is(":checked")) fields[name] = $el.attr("value") || "on";
        return;
      }
      if (el.tagName === "select") {
        fields[name] = $el.find("option:selected").attr("value") ?? "";
        return;
      }
      fields[name] = $el.attr("value") || "";
    });

    return fields;
  }

  static extractFormAction(html: string, formId: string): string | null {
    const $ = cheerio.load(html);
    return $(`form[id="${formId}"]`).attr("action") ?? null;
  }

  /**
   * Busca el `rich:inputNumberSlider` de "página" que RichFaces renderiza
   * cuando una tabla (movimentações, documentos) tiene más de una página —
   * no son botones next/prev, es un slider numérico.
   */
  static extractPageSlider(html: string): PageSlider | null {
    const m = html.match(
      /new Richfaces\.Slider\("([^"]+)",\{'minValue':'\d+','maxValue':'(\d+)','sliderValue':'\d+','width':'[^']*','onchange':'((?:[^'\\]|\\.)*)'/
    );
    if (!m) return null;
    const [, fieldName, maxValue, onchangeEscaped] = m;
    const action = PageParser.extractAjaxAction(onchangeEscaped.replace(/\\'/g, "'"));
    if (!action) return null;
    return { fieldName, maxPage: Number(maxValue), action };
  }

  /** Fila de `fPP:processosTable` — celda combinada "CLASSE numero - assunto partes...". */
  static parseSearchResults(html: string): ProcessoSearchResult[] {
    const $ = cheerio.load(html);
    const table = $('[id="fPP:processosTable"]');
    if (table.length === 0) return [];

    const rows: ProcessoSearchResult[] = [];
    table.find("tbody tr").each((_, tr) => {
      const $tr = $(tr);
      const cells = $tr.find("td");
      if (cells.length < 2) return;

      const processoText = $(cells[1]).text().replace(/\s+/g, " ").trim();
      const ultimaMovimentacao = $(cells[2] ?? cells[1])
        .text()
        .replace(/\s+/g, " ")
        .trim();

      const cnjMatch = processoText.match(/\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/);
      const numeroProcesso = cnjMatch?.[0];
      const classeJudicial = numeroProcesso ? processoText.split(numeroProcesso)[0].trim() : processoText;

      const caMatch = ($tr.html() || "").match(/[?&]ca=([0-9a-fA-F]+)/);
      if (!numeroProcesso || !caMatch) {
        logger.warn("Fila de resultado sin número de processo o token 'ca', se omite", { processoText });
        return;
      }

      rows.push({ numeroProcesso: numeroProcesso.trim(), classeJudicial, ultimaMovimentacao, ca: caMatch[1] });
    });
    return rows;
  }

  static findNextResultsPageAction(html: string): AjaxAction | null {
    const $ = cheerio.load(html);
    const next = $('[id="fPP:processosTable"]')
      .closest("table")
      .find(".rich-datascr-button-fastforward, .rich-datascr-button-next")
      .first();
    const onclick = next.attr("onclick");
    return onclick ? PageParser.extractAjaxAction(onclick) : null;
  }

  static extractPartes(html: string): string | undefined {
    const $ = cheerio.load(html);
    return $(".partes, #polos").first().text().replace(/\s+/g, " ").trim() || undefined;
  }

  /** "Movimentações do Processo" (tabla `processoEvento`) — solo informativo. */
  static parseMovimentacoes(html: string): MovimentacaoRecord[] {
    const $ = cheerio.load(html);
    const movimentacoes: MovimentacaoRecord[] = [];
    $('[id$=":processoEvento:tb"] > tr').each((_, tr) => {
      const texto = $(tr).find("td").first().text().replace(/\s+/g, " ").trim();
      const m = texto.match(/^(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2})\s*-\s*(.+)$/);
      if (!m) return;
      movimentacoes.push({ data: m[1], descricao: m[2].trim() });
    });
    return movimentacoes;
  }

  /**
   * "Documentos juntados ao processo" (tabla `processoDocumentoGridTab`) —
   * cada fila tiene un link directo a
   * `documentoSemLoginHTML.seam?ca=...&idProcessoDoc=...` (no hace falta
   * ningún AJAX para "abrir" un documento, es un GET directo).
   */
  static parseDocumentos(html: string): DocumentoLink[] {
    const $ = cheerio.load(html);
    const documentos: DocumentoLink[] = [];
    $('a[onclick*="documentoSemLoginHTML"]').each((_, a) => {
      const onclick = $(a).attr("onclick") || "";
      const urlMatch = onclick.match(/openPopUp\('[^']*',\s*'([^']+)'\)/);
      if (!urlMatch) return;
      const url = urlMatch[1];
      const ca = url.match(/[?&]ca=([0-9a-fA-F]+)/)?.[1];
      const idProcessoDoc = url.match(/[?&]idProcessoDoc=(\d+)/)?.[1];
      if (!ca || !idProcessoDoc) return;

      const texto = $(a).text().replace(/\s+/g, " ").trim();
      const m = texto.match(/(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2})\s*-\s*(.+)$/);
      documentos.push({ idProcessoDoc, ca, data: m?.[1] ?? "", descricao: (m?.[2] ?? texto).trim() });
    });
    return documentos;
  }

  /**
   * El botón "Gerar PDF" de la vista del documento. Es un POST de formulario
   * NORMAL (no AJAX — `f.submit()` nativo vía `jsfcljs`), a la action del
   * `<form>` SIN el query string de la vista, con un `ca`/`idProcDocBin`
   * propios que se regeneran en cada render (distintos de los usados para
   * llegar a la vista).
   */
  static extractGerarPdfTrigger(html: string): GerarPdfTrigger | null {
    const $ = cheerio.load(html);
    const pdfLink = $('a[id$=":downloadPDF"]').first();
    const onclick = pdfLink.attr("onclick") || "";
    const ca = onclick.match(/'ca'\s*:\s*'([^']+)'/)?.[1];
    const idProcDocBin = onclick.match(/'idProcDocBin'\s*:\s*'([^']+)'/)?.[1];
    const form = pdfLink.closest("form");
    const formId = form.attr("id");
    const rawAction = form.attr("action");
    if (!ca || !idProcDocBin || !formId || !rawAction) return null;
    return { formId, actionPath: PageParser.toRelativePath(rawAction), ca, idProcDocBin };
  }
}
