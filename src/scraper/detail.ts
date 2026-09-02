import * as cheerio from "cheerio";
import { PjeClient } from "../http/client";
import { logger } from "../utils/logger";
import { DocumentoRef, Movimentacao, ResultadoBusca } from "./types";

interface DetalheProcesso {
  partes?: string;
  movimentacoes: Movimentacao[];
  documentos: DocumentoRef[];
}

/** "Movimentações do Processo" (tabla `processoEvento`) — solo informativo. */
function parseMovimentacoes($: cheerio.CheerioAPI): Movimentacao[] {
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
function parseDocumentos($: cheerio.CheerioAPI): DocumentoRef[] {
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

/** Abre el detalle de un proceso (token `ca` de un solo uso) y parsea movimentações + documentos. */
export async function fetchDetalheProcesso(client: PjeClient, resultado: ResultadoBusca): Promise<DetalheProcesso> {
  // La URL real lleva "ConsultaPublica/" de nuevo antes del detalle (confirmado con una fila real).
  const res = await client.get(
    `/ConsultaPublica/DetalheProcessoConsultaPublica/listView.seam?ca=${resultado.tokenDetalhe}`
  );
  const $ = cheerio.load(res.data);

  const partes = $(".partes, #polos").first().text().replace(/\s+/g, " ").trim() || undefined;
  const movimentacoes = parseMovimentacoes($);
  const documentos = parseDocumentos($);

  if (movimentacoes.length === 0 && documentos.length === 0) {
    logger.warn(`Proceso ${resultado.numeroProcesso}: no se encontraron movimentações ni documentos en el detalle.`, {
      token: resultado.tokenDetalhe,
    });
  }

  return { partes, movimentacoes, documentos };
}
