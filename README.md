# Scraper — Consulta Pública PJe TRF5

Scraper en TypeScript (sin automatización de navegador — solo `axios` +
`cheerio`) para `https://pjett.trf5.jus.br/pjeconsulta/ConsultaPublica/listView.seam`.
Busca procesos por rango de fecha de autuação, entra a cada uno, descarga los
PDFs de sus movimentações y maneja el rate limiting (HTTP 429) con reintentos
y backoff exponencial.

## Instalación

```bash
npm install
```

## Ejecución

```bash
npm start                # corrida normal
npm run retry-failed     # reintenta solo lo que quedó en output/failed.json
npm run build             # compila a dist/ (tsc)
npm test                   # self-check del backoff (src/utils/retry.test.ts)
```

### Variables de entorno

| Variable          | Default          | Descripción                                    |
|-------------------|------------------|-------------------------------------------------|
| `DATA_INICIO`      | hoy - `DIAS_ATRAS` | Fecha de autuação inicial, `dd/MM/yyyy`        |
| `DATA_FIM`         | hoy               | Fecha de autuação final, `dd/MM/yyyy`           |
| `DIAS_ATRAS`       | `30`              | Si no se pasa `DATA_INICIO`, cuántos días atrás usar |
| `REQUEST_DELAY_MS` | `1500`            | Delay entre requests (cortesía con el servidor) |
| `MAX_RETRIES`      | `5`               | Reintentos máx. ante 429 al descargar un PDF    |
| `BASE_DELAY_MS`    | `2000`            | Delay base del backoff exponencial              |
| `MAX_DELAY_MS`     | `30000`           | Techo del backoff                               |

Ejemplo:

```bash
DATA_INICIO=01/01/2024 DATA_FIM=31/01/2024 REQUEST_DELAY_MS=2000 npm start
```

## Salida

```
output/
├── data.json     # array de procesos: número, clase, movimentações, PDFs descargados
├── failed.json   # documentos que agotaron reintentos (para --retry-failed)
└── pdfs/
    └── <numeroProcesso>/
        └── <fecha>_<descrição-movimentação>.pdf
```

No hace falta bajar todo en una corrida: si se corta, `npm run retry-failed`
vuelve a buscar los mismos procesos y reintenta solo las movimentações que
quedaron en `failed.json` (los tokens del sitio son de un solo uso, así que
el reintento re-navega el proceso en vez de reusar un link viejo).

## Estructura

```
src/
├── http/
│   ├── cookieJar.ts   # cookie jar manual (axios no persiste cookies solo)
│   ├── ajaxAction.ts  # parsea los A4J.AJAX.Submit(...) del HTML/JS del sitio
│   └── client.ts       # sesión + serialización de forms + detección de bloqueo
├── scraper/
│   ├── search.ts       # búsqueda por rango de fecha + paginación de resultados
│   ├── detail.ts        # detalle del proceso + movimentações
│   ├── document.ts      # genera el `cid` de descarga y baja el PDF (con 429/backoff)
│   └── types.ts
├── storage/output.ts    # data.json / failed.json / pdfs a disco
├── utils/{retry,logger}.ts
└── main.ts               # orquestador
```

## Cómo funciona el sitio (y por qué el scraper está armado así)

Es una aplicación JSF/RichFaces 3.3.3 clásica: no hay una API REST — cada
acción (buscar, paginar, abrir un documento) es un POST `A4J.AJAX.Submit(...)`
al mismo `listView.seam`, con cookies de sesión y `javax.faces.ViewState`.
En vez de hardcodear cada pantalla, `ajaxAction.ts` parsea ese literal JS
desde el `onclick`/`<script>` real de cada botón/fila del HTML devuelto por
el servidor y lo repite como POST (`client.submitAjaxAction`) — así búsqueda,
paginación (datascroller) y apertura de documento comparten la misma lógica.

Flujo de descarga de un PDF: la movimentação dispara un AJAX que genera un
token `cid`; el PDF se descarga con `GET download.seam?cid=<cid>` usando la
misma sesión (`document.ts`).

## Limitaciones conocidas / próximos pasos

- **reCAPTCHA inactivo hoy**: la página carga `grecaptcha` pero la llamada
  está en una rama muerta (`if (false) { grecaptcha.execute(); }`) al momento
  de este desarrollo — no se exige token para buscar. Si el sitio la
  reactiva, la búsqueda no se puede resolver sin un navegador; el scraper no
  intenta resolver captcha, solo fallaría con un error claro en ese caso.
- **WAF de borde**: además del 429 de la app (documentos), el sitio tiene un
  WAF que devuelve HTTP 200 con una página "Requisição - Rejeitada" cuando
  detecta tráfico automatizado muy seguido (lo vimos en pruebas reales
  durante el desarrollo). `client.ts` lo detecta y lo trata como un 429
  (mismo camino de backoff/registro de fallidos) — bajar `REQUEST_DELAY_MS`
  agresivamente aumenta el riesgo de pegar contra este bloqueo.
- **Parámetros exactos del AJAX de búsqueda**: `search.ts` arma el POST
  serializando todos los campos del formulario real + los overrides de fecha,
  que es el mismo mecanismo que usa el sitio para paginación y documentos.
  No llegamos a confirmar contra una respuesta real con resultados (las
  pruebas se cortaron por el WAF antes de lograrlo) que el servidor
  devuelva la tabla `fPP:processosTable` actualizada con exactamente estos
  parámetros. Si al correrlo aparece el warning *"La búsqueda no devolvió
  filas..."*, el siguiente paso es capturar la pestaña Network del navegador
  al hacer una búsqueda real (clic en "Pesquisar") y comparar el payload
  exacto contra los `overrides` de `searchByDateRange` en `search.ts` —
  la arquitectura (form-serialize + parseo genérico de AJAX) no cambia,
  sólo ajustaría esa lista de parámetros.
- Los selectores de `detail.ts` (id de la tabla de movimentações) son un
  best-effort ya que no llegamos a capturar una página de detalle real por
  el mismo motivo; mismo ajuste si hace falta.
- Procesos en segredo de justiça no aparecen en los resultados (restricción
  del propio sitio, no del scraper).
