import { HttpClient } from "../http/HttpClient";
import { PageParser, ProcessoSearchResult, DocumentoLink } from "./PageParser";
import { config } from "../config";
import { logger } from "../utils/logger";
import { MovimentacaoRecord } from "../types";

export interface DetalheProcesso {
  html: string;
  partes?: string;
  movimentacoes: MovimentacaoRecord[];
  documentos: DocumentoLink[];
}

function toMonthYear(ddMMyyyy: string): string {
  const [, mm, yyyy] = ddMMyyyy.split("/");
  return `${mm}/${yyyy}`;
}

/** Navegación contra el sitio: búsqueda, paginación y detalle de proceso. Delega todo el parsing a `PageParser`. */
export class ResultsPaginator {
  constructor(private http: HttpClient) {}

  /**
   * Replica un `A4J.AJAX.Submit`: toma una foto del `<form>` real (para no
   * perder inputs ocultos de RichFaces), la mezcla con `overrides`, y postea
   * con los headers de partial-ajax + los dos parámetros que el servidor
   * exige para reconocer el POST como AJAX (`AJAXREQUEST`,
   * `AJAX:EVENTS_COUNT`) — sin ellos devuelve la página completa sin
   * aplicar la acción, confirmado contra el sitio real.
   */
  private async postAjax(actionPath: string, sourceHtml: string, formId: string, overrides: Record<string, string>) {
    const snapshot = PageParser.extractFormSnapshot(sourceHtml, formId);
    const body = new URLSearchParams({
      ...snapshot,
      AJAXREQUEST: "_viewRoot",
      "AJAX:EVENTS_COUNT": "1",
      ...overrides,
    });
    return this.http.post(`${config.target.baseUrl}${actionPath}`, body.toString(), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        "Faces-Request": "partial/ajax",
        Referer: `${config.target.baseUrl}${config.target.listViewPath}`,
      },
    });
  }

  /**
   * Busca por rango de fecha de autuação y recorre toda la paginación de
   * resultados. Nota: en pruebas reales, incluso con un rango de un año
   * completo, el sitio siempre devolvió como máximo 30 resultados y sin
   * ningún control de paginación en el HTML — parece un tope duro de la
   * consulta pública. El recorrido de páginas queda como fallback por si
   * algún rango sí pagina.
   */
  async search(dataInicio: string, dataFim: string): Promise<ProcessoSearchResult[]> {
    const { formId } = config.target.search;
    const home = await this.http.get(`${config.target.baseUrl}${config.target.listViewPath}`);
    const homeHtml = home.data as string;

    const actionUrl = PageParser.extractFormAction(homeHtml, formId);
    if (!actionUrl) {
      throw new Error(`No se encontró el <form id="${formId}"> en la página. El sitio pudo haber cambiado su estructura.`);
    }

    const overrides: Record<string, string> = {
      "fPP:dataAutuacaoDecoration:dataAutuacaoInicioInputDate": dataInicio,
      "fPP:dataAutuacaoDecoration:dataAutuacaoInicioInputCurrentDate": toMonthYear(dataInicio),
      "fPP:dataAutuacaoDecoration:dataAutuacaoFimInputDate": dataFim,
      "fPP:dataAutuacaoDecoration:dataAutuacaoFimInputCurrentDate": toMonthYear(dataFim),
      // El botón "Pesquisar" llama executarPesquisa(), que en realidad manda
      // el submit ligado al componente fPP:j_id244 (no fPP:searchProcessos) —
      // confirmado con una captura real del navegador (Network tab).
      "fPP:j_id244": "fPP:j_id244",
    };

    const res = await this.postAjax(PageParser.toRelativePath(actionUrl), homeHtml, formId, overrides);
    let html = res.data as string;
    let all = PageParser.parseSearchResults(html);
    if (all.length === 0) {
      logger.warn(
        "La búsqueda no devolvió resultados. Puede que no existan procesos en el rango de fechas dado, " +
          "o que el sitio requiera parámetros AJAX distintos a los replicados en ResultsPaginator.search()."
      );
    }

    for (;;) {
      const nextAction = PageParser.findNextResultsPageAction(html);
      if (!nextAction) break;
      const nextRes = await this.postAjax(
        PageParser.toRelativePath(nextAction.actionUrl),
        html,
        nextAction.formId,
        nextAction.parameters
      );
      const parsed = PageParser.parseSearchResults(nextRes.data as string);
      if (parsed.length === 0) break;
      all = all.concat(parsed);
      html = nextRes.data as string;
    }

    return all;
  }

  /** Abre el detalle de un proceso (token `ca` de un solo uso, ligado a la sesión) y trae movimentações + documentos, con paginación. */
  async fetchDetalhe(ca: string): Promise<DetalheProcesso> {
    const url = `${config.target.baseUrl}/ConsultaPublica/DetalheProcessoConsultaPublica/listView.seam?ca=${ca}`;
    const res = await this.http.get(url);
    const html = res.data as string;

    // Los paneles de movimentações y documentos están en secciones separadas del HTML;
    // acotamos cada búsqueda de slider a su propio tramo para no cruzar los dos.
    const docPanelIdx = html.indexOf("processoDocumentoGridTabPanel");
    const movSection = docPanelIdx === -1 ? html : html.slice(0, docPanelIdx);
    const docSection = docPanelIdx === -1 ? "" : html.slice(docPanelIdx);

    const movimentacoes = await this.fetchAllPages(html, movSection, PageParser.parseMovimentacoes, "Movimentações");
    const documentos = await this.fetchAllPages(html, docSection, PageParser.parseDocumentos, "Documentos");

    return { html, partes: PageParser.extractPartes(html), movimentacoes, documentos };
  }

  /**
   * LÍMITE CONOCIDO: el POST se reconoce como AJAX (respuesta válida) pero
   * el servidor responde `Ajax-Update-Ids=""` — no aplica el cambio de
   * página. No identificamos qué parámetro adicional necesita el protocolo
   * interno del slider sin una captura real de un cambio de página en el
   * navegador. Devuelve solo la primera página y loggea una advertencia
   * explícita en vez de perder datos en silencio.
   */
  private async fetchAllPages<T>(
    fullHtml: string,
    section: string,
    parseItems: (html: string) => T[],
    label: string
  ): Promise<T[]> {
    const items = [...parseItems(fullHtml)];
    const slider = PageParser.extractPageSlider(section);
    if (!slider || slider.maxPage <= 1) return items;

    const totalAntes = items.length;
    for (let page = 2; page <= slider.maxPage; page++) {
      const res = await this.postAjax(PageParser.toRelativePath(slider.action.actionUrl), fullHtml, slider.action.formId, {
        ...slider.action.parameters,
        [slider.fieldName]: String(page),
      });
      items.push(...parseItems(res.data as string));
    }

    if (items.length === totalAntes) {
      logger.warn(
        `"${label}" tiene ${slider.maxPage} páginas pero no se pudieron traer las siguientes ` +
          `(límite conocido del slider de RichFaces). Se devolvió solo la primera página (${totalAntes} ítems).`
      );
    }
    return items;
  }
}
