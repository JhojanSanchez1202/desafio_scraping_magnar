/**
 * El sitio entero (búsqueda, paginación, apertura de documento) dispara
 * interacciones con el mismo patrón JS:
 *   A4J.AJAX.Submit('formId', event, {'actionUrl':'...','parameters':{'a':'b', ...}})
 * En vez de hardcodear cada pantalla, parseamos ese literal desde el
 * `onclick`/`<script>` real de cada botón/fila y lo repetimos como POST.
 */

export interface AjaxAction {
  formId: string;
  actionUrl: string;
  parameters: Record<string, string>;
}

/** Convierte escapes `\x2D` (RichFaces escapa `-` así dentro del JS) y entidades HTML. */
function unescapeJs(s: string): string {
  return s.replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16))).replace(/&amp;/g, "&");
}

export function parseAjaxSubmit(js: string): AjaxAction | null {
  const submitMatch = js.match(/A4J\.AJAX\.Submit\(\s*'([^']+)'/);
  const actionUrlMatch = js.match(/'actionUrl'\s*:\s*'([^']+)'/);
  const parametersBlockMatch = js.match(/'parameters'\s*:\s*\{([\s\S]*?)\}\s*(?:,\s*'status'|\)\s*;?\s*$|\}\s*\))/);
  if (!submitMatch || !actionUrlMatch) return null;

  const parameters: Record<string, string> = {};
  const paramsSrc = parametersBlockMatch?.[1] ?? "";
  const pairRegex = /'([^']+)'\s*:\s*'([^']*)'/g;
  let m: RegExpExecArray | null;
  while ((m = pairRegex.exec(paramsSrc)) !== null) {
    parameters[unescapeJs(m[1])] = unescapeJs(m[2]);
  }

  return {
    formId: submitMatch[1],
    actionUrl: unescapeJs(actionUrlMatch[1]),
    parameters,
  };
}

export interface PageSlider {
  /** name= del <input> del slider — se manda con el número de página deseado. */
  fieldName: string;
  maxPage: number;
  action: AjaxAction;
}

/**
 * Algunas listas paginadas dentro del detalle de un proceso (ej. las
 * "Movimentações do Processo") no usan botones next/prev sino un
 * `rich:inputNumberSlider` de RichFaces — un slider "página" que al
 * cambiar dispara `onchange: A4J.AJAX.Submit(...)`. Para pedir la página N
 * hay que mandar el propio campo del slider con el valor N.
 */
export function parsePageSlider(html: string): PageSlider | null {
  const m = html.match(
    /new Richfaces\.Slider\("([^"]+)",\{'minValue':'\d+','maxValue':'(\d+)','sliderValue':'\d+','width':'[^']*','onchange':'((?:[^'\\]|\\.)*)'/
  );
  if (!m) return null;
  const [, fieldName, maxValue, onchangeEscaped] = m;
  const action = parseAjaxSubmit(onchangeEscaped.replace(/\\'/g, "'"));
  if (!action) return null;
  return { fieldName, maxPage: Number(maxValue), action };
}

/** `actionUrl` viene como URL absoluta o `/pjeconsulta/...`; la volvemos relativa a BASE_URL. */
export function toRelativePath(actionUrl: string, baseUrl: string): string {
  let path = actionUrl;
  const httpIdx = path.indexOf("://");
  if (httpIdx !== -1) {
    const afterHost = path.indexOf("/", httpIdx + 3);
    path = afterHost === -1 ? "/" : path.slice(afterHost);
  }
  if (path.startsWith("/pjeconsulta")) path = path.slice("/pjeconsulta".length);
  return path || "/";
}
