import * as cheerio from "cheerio";
import { PjeClient } from "../http/client";
import { parseAjaxSubmit } from "../http/ajaxAction";
import { logger } from "../utils/logger";
import { Movimentacao, ResultadoBusca } from "./types";

const MOVIMENTACOES_TABLE_ID = "movimentacaoProcessoList"; // aproximado, a confirmar con una captura real

interface DetalheProcesso {
  html: string;
  partes?: string;
  movimentacoes: Movimentacao[];
}

function parseMovimentacoes($: cheerio.CheerioAPI): Movimentacao[] {
  const movimentacoes: Movimentacao[] = [];
  $(`[id*="${MOVIMENTACOES_TABLE_ID}"] tbody tr, .rich-table tbody tr`).each((_, tr) => {
    const $tr = $(tr);
    const cells = $tr.find("td");
    if (cells.length < 2) return;

    const data = $(cells[0]).text().replace(/\s+/g, " ").trim();
    const descricao = $(cells[1]).text().replace(/\s+/g, " ").trim();
    const onclick = $tr.find("[onclick*='A4J.AJAX.Submit']").attr("onclick") || $tr.attr("onclick");
    const action = onclick ? parseAjaxSubmit(onclick) : null;

    if (!data && !descricao) return;
    movimentacoes.push({
      data,
      descricao,
      temDocumento: Boolean(action),
      ajaxParams: action ? { ...action.parameters, __formId: action.formId, __actionUrl: action.actionUrl } : undefined,
    });
  });
  return movimentacoes;
}

/** Abre el detalle de un proceso (token `ca` de un solo uso) y parsea sus movimentações. */
export async function fetchDetalheProcesso(client: PjeClient, resultado: ResultadoBusca): Promise<DetalheProcesso> {
  const res = await client.get(`/DetalheProcessoConsultaPublica/listView.seam?ca=${resultado.tokenDetalhe}`);
  const $ = cheerio.load(res.data);

  const partes = $(".partes, #polos").first().text().replace(/\s+/g, " ").trim() || undefined;
  const movimentacoes = parseMovimentacoes($);

  if (movimentacoes.length === 0) {
    logger.warn(`Proceso ${resultado.numeroProcesso}: no se encontraron movimentações en el detalle.`, {
      token: resultado.tokenDetalhe,
    });
  }

  return { html: res.data, partes, movimentacoes };
}
