import assert from "assert";
import { PageParser } from "./PageParser";

const searchFormHtml = `
<html><body>
<form id="fPP" method="post" action="/pjeconsulta/ConsultaPublica/listView.seam;jsessionid=X">
  <input type="hidden" name="fPP" value="fPP" />
  <input type="hidden" name="javax.faces.ViewState" value="j_id2" />
  <input type="radio" name="mascaraProcessoReferenciaRadio" checked="checked" value="NUN" />
  <input type="radio" name="mascaraProcessoReferenciaRadio" value="LIV" />
  <select name="fPP:Decoration:estadoComboOAB">
    <option value="">UF</option>
    <option value="PE" selected="selected">PE</option>
  </select>
  <input type="button" name="fPP:searchProcessos" value="Pesquisar" />
</form>
</body></html>
`;

const searchResultsHtml = `
<html><body>
<table id="fPP:processosTable"><tbody>
  <tr>
    <td><a onclick="openPopUp('t','/pjeconsulta/ConsultaPublica/DetalheProcessoConsultaPublica/listView.seam?ca=abc123def')"><i></i></a></td>
    <td>APELAÇÃO CÍVEL <a onclick="openPopUp('t','/pjeconsulta/ConsultaPublica/DetalheProcessoConsultaPublica/listView.seam?ca=abc123def')"><b>ApCiv 0000288-95.2018.8.25.0049 - Incapacidade Laborativa</b></a> INSS X FULANO</td>
    <td>Baixa Definitiva (11/06/2026 15:02:33)</td>
  </tr>
</tbody></table>
</body></html>
`;

const detailHtml = `
<html><body>
<table id="j_id146:processoEvento"><tbody id="j_id146:processoEvento:tb">
  <tr><td>11/06/2026 15:02:33 - Baixa Definitiva</td><td></td></tr>
  <tr><td>19/03/2026 11:22:22 - Publicado Acórdão em 19/03/2026.</td><td></td></tr>
</tbody></table>
<script>new Richfaces.Slider("j_id146:j_id561:j_id562",{'minValue':'1','maxValue':'4','sliderValue':'1','width':'250px','onchange':'A4J.AJAX.Submit(\\'j_id146:j_id561\\',event,{\\'actionUrl\\':\\'/pjeconsulta/ConsultaPublica/DetalheProcessoConsultaPublica/listView.seam\\',\\'containerId\\':\\'j_id146:j_id474\\',\\'parameters\\':{\\'j_id146:j_id561:j_id563\\':\\'j_id146:j_id561:j_id563\\'}} )','showArrows':true} )</script>
<div id="processoDocumentoGridTabPanel">
  <a onclick="openPopUp('doc','https://pjett.trf5.jus.br/pjeconsulta/ConsultaPublica/DetalheProcessoConsultaPublica/documentoSemLoginHTML.seam?ca=cafe01&idProcessoDoc=7091586')">19/03/2026 11:22:22 - Acórdão (Acórdão)</a>
</div>
</body></html>
`;

const documentViewHtml = `
<html><body>
<form id="j_id42" method="post" action="/pjeconsulta/ConsultaPublica/DetalheProcessoConsultaPublica/documentoSemLoginHTML.seam">
  <input type="hidden" name="j_id42" value="j_id42" />
  <input type="hidden" name="javax.faces.ViewState" value="j_id26" />
  <a id="j_id42:downloadPDF" onclick="jsfcljs(document.getElementById('j_id42'),{'j_id42:downloadPDF':'j_id42:downloadPDF','ca':'freshca999','idProcDocBin':'7001008'},'')">Gerar PDF</a>
</form>
</body></html>
`;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`OK   ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`);
    throw err;
  }
}

test("extractFormSnapshot captura hidden/radio-checked/select, no botones", () => {
  const snapshot = PageParser.extractFormSnapshot(searchFormHtml, "fPP");
  assert.strictEqual(snapshot["fPP"], "fPP");
  assert.strictEqual(snapshot["javax.faces.ViewState"], "j_id2");
  assert.strictEqual(snapshot["mascaraProcessoReferenciaRadio"], "NUN");
  assert.strictEqual(snapshot["fPP:Decoration:estadoComboOAB"], "PE");
});

test("extractFormSnapshot funciona con ids que llevan ':' (no rompe el selector CSS)", () => {
  const html = `<form id="j_id146:j_id561"><input type="text" name="j_id146:j_id561:j_id562" value="1" /></form>`;
  const snapshot = PageParser.extractFormSnapshot(html, "j_id146:j_id561");
  assert.strictEqual(snapshot["j_id146:j_id561:j_id562"], "1");
});

test("extractFormAction lee la action del form", () => {
  const action = PageParser.extractFormAction(searchFormHtml, "fPP");
  assert.ok(action && action.includes("listView.seam"));
});

test("extractAjaxAction parsea formId, actionUrl y parameters de un A4J.AJAX.Submit", () => {
  const js = `A4J.AJAX.Submit('fPP',null,{'actionUrl':'/pjeconsulta/ConsultaPublica/listView.seam','parameters':{'fPP:j_id244':'fPP:j_id244'}} )`;
  const action = PageParser.extractAjaxAction(js);
  assert.ok(action);
  assert.strictEqual(action!.formId, "fPP");
  assert.strictEqual(action!.actionUrl, "/pjeconsulta/ConsultaPublica/listView.seam");
  assert.strictEqual(action!.parameters["fPP:j_id244"], "fPP:j_id244");
});

test("toRelativePath saca el host y el prefijo /pjeconsulta", () => {
  assert.strictEqual(
    PageParser.toRelativePath("https://pjett.trf5.jus.br/pjeconsulta/ConsultaPublica/listView.seam"),
    "/ConsultaPublica/listView.seam"
  );
  assert.strictEqual(PageParser.toRelativePath("/pjeconsulta/ConsultaPublica/x"), "/ConsultaPublica/x");
});

test("parseSearchResults extrae numeroProcesso (formato CNJ), classe y token ca", () => {
  const rows = PageParser.parseSearchResults(searchResultsHtml);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].numeroProcesso, "0000288-95.2018.8.25.0049");
  assert.ok(rows[0].classeJudicial.includes("APELAÇÃO CÍVEL"));
  assert.strictEqual(rows[0].ca, "abc123def");
  assert.ok(rows[0].ultimaMovimentacao.includes("Baixa Definitiva"));
});

test("parseSearchResults devuelve vacío si no encuentra la tabla", () => {
  assert.strictEqual(PageParser.parseSearchResults("<html></html>").length, 0);
});

test("extractPageSlider lee minValue/maxValue y el AjaxAction del onchange", () => {
  const slider = PageParser.extractPageSlider(detailHtml);
  assert.ok(slider);
  assert.strictEqual(slider!.fieldName, "j_id146:j_id561:j_id562");
  assert.strictEqual(slider!.maxPage, 4);
  assert.strictEqual(slider!.action.formId, "j_id146:j_id561");
  assert.strictEqual(slider!.action.parameters["j_id146:j_id561:j_id563"], "j_id146:j_id561:j_id563");
  assert.strictEqual(slider!.action.containerId, "j_id146:j_id474");
});

test("extractAjaxAction captura containerId cuando el componente lo trae, undefined si no", () => {
  const withContainer = PageParser.extractAjaxAction(
    `A4J.AJAX.Submit('f',event,{'actionUrl':'/x','containerId':'panel1','parameters':{}} )`
  );
  assert.strictEqual(withContainer!.containerId, "panel1");

  const withoutContainer = PageParser.extractAjaxAction(`A4J.AJAX.Submit('f',event,{'actionUrl':'/x','parameters':{}} )`);
  assert.strictEqual(withoutContainer!.containerId, undefined);
});

test("extractPageSlider devuelve null si no hay slider en la sección", () => {
  assert.strictEqual(PageParser.extractPageSlider("<html></html>"), null);
});

test("parseMovimentacoes extrae data + descricao de processoEvento:tb", () => {
  const movs = PageParser.parseMovimentacoes(detailHtml);
  assert.strictEqual(movs.length, 2);
  assert.strictEqual(movs[0].data, "11/06/2026 15:02:33");
  assert.strictEqual(movs[0].descricao, "Baixa Definitiva");
});

test("parseDocumentos extrae ca, idProcessoDoc, data y descricao del link", () => {
  const docs = PageParser.parseDocumentos(detailHtml);
  assert.strictEqual(docs.length, 1);
  assert.strictEqual(docs[0].idProcessoDoc, "7091586");
  assert.strictEqual(docs[0].ca, "cafe01");
  assert.strictEqual(docs[0].descricao, "Acórdão (Acórdão)");
});

test('extractGerarPdfTrigger lee ca/idProcDocBin frescos del botón "Gerar PDF"', () => {
  const trigger = PageParser.extractGerarPdfTrigger(documentViewHtml);
  assert.ok(trigger);
  assert.strictEqual(trigger!.formId, "j_id42");
  assert.strictEqual(trigger!.ca, "freshca999");
  assert.strictEqual(trigger!.idProcDocBin, "7001008");
  assert.strictEqual(trigger!.actionPath, "/ConsultaPublica/DetalheProcessoConsultaPublica/documentoSemLoginHTML.seam");
});

console.log("\nTodos los tests de PageParser pasaron.");
