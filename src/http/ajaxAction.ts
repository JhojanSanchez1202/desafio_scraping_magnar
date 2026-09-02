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
