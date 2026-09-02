# Scraper — Consulta Pública PJe TRF5

Scraper en TypeScript (sin automatización de navegador — solo `axios` +
`cheerio`) para `https://pjett.trf5.jus.br/pjeconsulta/ConsultaPublica/listView.seam`.
Busca procesos por rango de fecha de autuação, entra a cada uno, descarga los
PDFs de sus documentos y maneja el rate limiting (HTTP 429) con reintentos y
backoff exponencial.

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

Ejemplo (recomendado para probar: rango chico, delay alto):

```bash
DATA_INICIO=01/01/2024 DATA_FIM=15/01/2024 REQUEST_DELAY_MS=3000 npm start
```

## Salida

```
output/
├── data.json     # array de procesos: número, clase, movimentações, PDFs descargados
├── failed.json   # documentos que agotaron reintentos (para --retry-failed)
└── pdfs/
    └── <numeroProcesso>/
        └── <fecha>_<descrição-documento>.pdf
```

No hace falta bajar todo en una corrida: si se corta, `npm run retry-failed`
vuelve a buscar los mismos procesos y reintenta solo los documentos que
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
│   ├── detail.ts        # detalle del proceso: movimentações + lista de documentos
│   ├── document.ts      # vista HTML del documento → POST "Gerar PDF" (con 429/backoff)
│   └── types.ts
├── storage/output.ts    # data.json / failed.json / pdfs a disco
├── utils/{retry,logger}.ts
└── main.ts               # orquestador
```

## Cómo funciona el sitio (confirmado contra el sitio real)

Es una aplicación JSF/RichFaces 3.3.3 clásica, sin API REST. Casi todo pasa
por POST `A4J.AJAX.Submit(...)` al mismo `listView.seam`, con cookies de
sesión. En vez de hardcodear cada pantalla, `ajaxAction.ts` parsea ese literal
JS desde el `onclick`/`<script>` real del HTML devuelto por el servidor y lo
repite como POST (`client.submitAjaxAction`) — así búsqueda y paginación
(datascroller) comparten la misma lógica.

Flujo completo, de punta a punta:

1. **Búsqueda** (`search.ts`): POST al form `fPP` con el rango de fecha de
   autuação. El componente real que dispara la búsqueda es
   `fPP:j_id244` (el botón visible "Pesquisar" en realidad manda ese
   componente, no su propio id) con `AJAXREQUEST=_viewRoot`. Cada fila de
   `fPP:processosTable` trae un link con `openPopUp(...DetalheProcessoConsultaPublica/listView.seam?ca=<token>)`.
2. **Detalle del proceso** (`detail.ts`): GET a
   `/ConsultaPublica/DetalheProcessoConsultaPublica/listView.seam?ca=<token>`
   (el token es de un solo uso). Trae dos tablas separadas:
   - `processoEvento` — "Movimentações do Processo", solo informativo.
   - `processoDocumentoGridTab` — "Documentos juntados ao processo", cada fila
     con un link directo `documentoSemLoginHTML.seam?ca=...&idProcessoDoc=...`.
     (Es más simple de lo que parecía al principio: **no** hace falta ningún
     AJAX para "abrir" un documento, es un GET directo.)
3. **Descarga del PDF** (`document.ts`): el GET anterior devuelve una vista
   HTML del documento (texto completo de la decisión/pieza procesal) con un
   botón "Gerar PDF". Ese botón hace un **POST de formulario normal** (no
   AJAX — `f.submit()` nativo vía `jsfcljs`) a la **action del form sin query
   string** (`ca`/`idProcessoDoc` no van en la URL del POST, solo en el body
   como `ca`/`idProcDocBin`, con valores que se regeneran en cada render de
   la vista). `client.postForm` replica ese POST y devuelve el PDF
   (`Content-Type: application/pdf`, verificado con datos reales — magic
   bytes `%PDF-`).

Flujo confirmado de punta a punta contra el sitio real: búsqueda (30
procesos), detalle, movimentações, documentos y descarga de PDF real.

Además, la búsqueda pública parece tener un tope duro de **30 resultados**:
probamos con un rango de un año completo (2024) y siguió devolviendo
exactamente 30, sin ningún control de paginación en el HTML — no es un límite
del scraper, es lo que el sitio devuelve.

## Manejo de errores 429 / robustez

- 429 se detecta en **todos** los métodos HTTP del cliente (`get`, `getBinary`,
  `postAjax`, `postForm`), no sólo en la descarga de PDFs — cualquier request
  (búsqueda, detalle, documento) puede reintentarse con el mismo backoff
  exponencial + jitter (`utils/retry.ts`).
- Backoff aplicado en: búsqueda inicial, apertura de detalle de cada proceso,
  y descarga de cada PDF. Si un documento agota los reintentos, se registra en
  `output/failed.json` con el motivo y se sigue con el siguiente (no aborta la
  corrida).
- Timeout de 30s por request (axios) — si el servidor cuelga la respuesta en
  vez de rechazarla, el scraper no se queda esperando para siempre.
- Errores inesperados por proceso (ej. HTML con estructura distinta a la
  esperada) se loggean y el scraper sigue con el siguiente proceso, no aborta
  toda la corrida.

## Limitaciones conocidas

- **Paginación de movimentações dentro de un proceso**: RichFaces pagina esa
  tabla con un `rich:inputNumberSlider` (un slider numérico de "página", no
  botones next/prev). Confirmamos contra un proceso real con 4 páginas
  (54 movimentações) que el POST se reconoce como AJAX pero el servidor
  responde sin aplicar el cambio de página — no identificamos qué parámetro
  adicional necesita el protocolo interno del slider sin una captura real de
  un cambio de página en el navegador (mismo método que resolvió la búsqueda
  y la descarga de PDF). `detail.ts` devuelve la primera página igual
  (sin duplicar ni perder datos silenciosamente) y loggea una advertencia
  explícita cuando esto pasa. La tabla de **documentos** (la que importa para
  las descargas de PDF) usa el mismo mecanismo, pero en ningún proceso real
  de los que probamos tuvo más de una página.
- **reCAPTCHA inactivo hoy**: la página carga `grecaptcha` pero la llamada
  está en una rama muerta (`if (false) { grecaptcha.execute(); }`) al momento
  de este desarrollo — no se exige token para buscar. Si el sitio la
  reactiva, la búsqueda no se puede resolver sin un navegador; el scraper no
  intenta resolver captcha, solo fallaría con un error claro en ese caso.
- **WAF de borde**: además del 429 de la app, el sitio tiene un WAF que
  devuelve HTTP 200 con una página "Requisição - Rejeitada" cuando detecta
  tráfico sospechoso. Una causa concreta que encontramos y ya está
  arreglada: mandar el header `Cookie: ""` vacío en el primer request lo
  gatilla inmediatamente — `cookieJar.ts` ahora omite el header hasta tener
  algo real que mandar. `client.ts` igual sigue detectando esta página (por
  si se gatilla por otro motivo, ej. frecuencia) y la trata como un 429.
- Procesos en segredo de justiça no aparecen en los resultados (restricción
  del propio sitio, no del scraper).
