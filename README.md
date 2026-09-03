# Scraper de la Consulta Publica del PJe (TRF5)

Este es un scraper hecho en TypeScript para un desafio tecnico. La idea del desafio sonaba sencilla: entrar a la Consulta Publica del PJe de la Justicia Federal de Brasil, buscar procesos, recorrer los resultados, sacar la informacion de cada proceso y descargar los PDFs de los documentos.

La condicion importante era hacerlo sin navegador automatizado, es decir, nada de Puppeteer ni Playwright. Todo tenia que hacerse directamente con peticiones HTTP y leyendo el HTML que devuelve el servidor.

En este README cuento un poco como lo fui resolviendo, los problemas que me encontre y como dejarlo corriendo.

## Primero, entender el sitio

Antes de empezar a escribir el scraper preferi entender bien como funcionaba la pagina. Entre al sitio, hice varias busquedas, revise los resultados y fui mirando que peticiones se hacian realmente cuando uno interactuaba con la pagina.

Lo primero que me encontre es que es una aplicacion bastante vieja, basada en Java Server Faces y RichFaces 3.3.3.

No hay una API como tal. Cada accion de la pagina, buscar, cambiar de pagina, abrir un proceso, cargar mas movimientos, etc., termina generando peticiones POST manejadas por JavaScript del propio framework.

Algo como:

`A4J.AJAX.Submit('formId', event, {'actionUrl':'...', 'parameters':{...}})`

Esto fue importante porque no bastaba con mirar el HTML y tratar de armar los POST a mano. Los parametros que realmente necesita el servidor estan dentro del JavaScript que genera la pagina, normalmente en el `onclick` o dentro de algun `<script>`.

Por eso termine haciendo un parser generico (`PageParser.extractAjaxAction`) que busca esa informacion y arma la peticion correspondiente.

De esta forma no tuve que hacer un codigo diferente para cada pantalla. Buscar, cambiar de pagina o cargar mas movimientos termina usando el mismo mecanismo.

## Las trampas que no se veian a simple vista

Estas fueron las cosas que mas tiempo me quitaron. Varias no aparecieron hasta que empece a probar contra el sitio real y comparar las peticiones con las que hacia el navegador.

### Un `Cookie: ""` vacio te puede bloquear

Al principio, cuando todavia no tenia ninguna cookie de sesion, mi codigo mandaba el header `Cookie` vacio.

El sitio tiene un WAF y eso era suficiente para que respondiera con un status 200, pero en realidad devolvia una pagina que decia `"Requisição - Rejeitada"`.

Ese fue uno de los problemas mas molestos porque a nivel HTTP parecia que todo habia salido bien.

La solucion fue sencilla: mientras no exista una cookie real, no mando el header `Cookie`.

Ademas, deje que `HttpClient` detecte esa pagina de bloqueo y la trate como un error temporal, igual que un 429, para que pueda esperar y volver a intentar.

### El boton que ves no es necesariamente el que hace el POST

En la pagina aparece el boton "Pesquisar", pero ese boton realmente termina llamando una funcion `executarPesquisa()`.

Revisando el JavaScript encontre que la funcion termina haciendo el submit de otro componente, con un id como `fPP:j_id244`.

Mi primer intento fue mandar el nombre del boton que se veia en pantalla y el servidor simplemente respondia con `0 resultados`.

No habia ningun error que dijera que estaba mal.

Tuve que comparar la peticion que hacia el navegador con la que estaba haciendo mi codigo. Para eso capture la peticion desde Network y la compare con el POST que estaba enviando.

Ahí fue cuando quedo claro que tenia que replicar la peticion real y no simplemente el boton visual.

### Faltaban dos parametros para que el servidor entendiera que era AJAX

La peticion real tenia dos parametros que yo no estaba enviando:

`AJAXREQUEST=_viewRoot`

y

`AJAX:EVENTS_COUNT=1`

Sin esos parametros el servidor recibia el POST como un postback normal.

Lo raro es que tampoco devolvia un error. Simplemente devolvia la pagina completa y no aplicaba el cambio que yo estaba intentando hacer.

Me paso especialmente cuando estaba trabajando con la paginacion de las movimentacoes.

Una vez encontre el problema, lo corregi directamente en `HttpClient` para que todos los POST AJAX pasaran por el mismo flujo. Asi no tuve que repetir el arreglo en cada parte del scraper.

### Los ids con `:` tambien dieron guerra

RichFaces genera ids como:

`j_id146:j_id561`

Al principio estaba buscando el formulario con un selector CSS asi:

`form#j_id146:j_id561`

El problema es que `:` tiene un significado especial en CSS.

Entonces `cheerio` no encontraba el formulario y terminaba mandando un formulario practicamente vacio.

Lo peor es que nuevamente el servidor no mostraba un error claro.

La solucion fue cambiar la forma de buscar esos elementos y usar selectores por atributo:

`form[id="..."]`

Asi da igual si el id tiene `:`, `_` o cualquier otro caracter.

Este problema estuvo escondido un buen rato porque el formulario principal de la busqueda se llama `fPP`, que no tiene `:`. Solo aparecio cuando empece a trabajar con otros formularios.

### Descargar un documento fue diferente a lo que esperaba

Al principio pense que abrir un documento iba a ser otro POST AJAX como los demas.

Pero no.

Cada documento tiene un link parecido a:

`documentoSemLoginHTML.seam?ca=...&idProcessoDoc=...`

Ese GET devuelve una pagina HTML con el contenido del documento.

Al final de esa pagina hay un boton "Gerar PDF".

Ese boton ya no usa AJAX. Es un submit normal del formulario.

Ahí tuve un par de problemas mas.

Primero estaba haciendo el POST contra la misma URL que tenia el `?ca=` y el `&idProcessoDoc=`.

El servidor respondia con un 200, pero devolvia una pagina de error.

Cuando compare nuevamente la peticion real del navegador, vi que el POST iba directamente al `action` del formulario, sin ese query string.

El segundo problema fue con la URL del `action`. Venia con `/pjeconsulta/ConsultaPublica/...` y mi codigo estaba agregando nuevamente el prefijo `/pjeconsulta`, terminando con una URL duplicada.

Despues de corregir esas dos cosas, finalmente empece a recibir el PDF real.

Para asegurarme de que no fuera simplemente otra pagina HTML con status 200, valide que los primeros bytes fueran:

`%PDF-`

Tambien lo confirme con `file`, que me devolvio algo como:

`PDF document, version 1.4, 5 page(s)`

## Un token que parecia de un solo uso

Otra cosa que tuve que entender fue el parametro `ca`.

Mi primera idea era que tanto `ca` como `idProcessoDocBin` se generaban cada vez y que ninguno podia reutilizarse.

Con las pruebas vi que no era exactamente asi.

El `ca` si esta relacionado con la sesion. Si intento reutilizarlo desde otra sesion, ya no funciona y el servidor devuelve una pagina generica.

Pero `idProcessoDoc`, que identifica el documento, se mantuvo igual entre diferentes sesiones.

Esto termino siendo importante para la forma en que hice la reanudacion del scraper.

No puedo guardar simplemente una URL de descarga y asumir que va a funcionar despues.

Lo que puedo guardar es el identificador del documento y, cuando vuelva a correr el scraper, hacer nuevamente la navegacion necesaria para conseguir un `ca` valido y pedir el documento otra vez.

## Un limite del sitio, no del scraper

Haciendo pruebas con un rango de fechas de un año completo, todo 2024, la consulta publica me devolvio exactamente 30 resultados.

No aparecia ningun control de paginacion para esos resultados.

Por lo que pude comprobar, parece ser un limite propio de la consulta publica y no un problema del scraper.

Lo dejo documentado porque inicialmente la idea era recorrer todos los resultados paginados, pero en este caso la misma consulta no estaba entregando mas de esos 30.

## La paginacion de movimentacoes (otro caso que costo bastante)

Dentro del detalle de un proceso existe una tabla de "Movimentações do Processo".

Cuando tiene muchas filas, esa tabla tambien se pagina, pero no con los tipicos botones de siguiente y anterior. RichFaces usa un `rich:inputNumberSlider`, un control donde se selecciona directamente el numero de pagina.

Reconocer el POST como AJAX ya no era el problema en si (eso quedo solucionado con los cambios de `AJAXREQUEST`/`AJAX:EVENTS_COUNT` de mas arriba), pero el servidor seguia sin aplicar el cambio de pagina: respondia con `Ajax-Update-Ids=""`, es decir, recibia el pedido pero no devolvia ningun contenido para actualizar. Probe varias combinaciones de parametros sin resultado y por un tiempo lo deje documentado como limite conocido.

Terminó siendo el mismo tipo de problema que ya me habia pasado con `AJAXREQUEST`: no es un valor fijo. El `A4J.AJAX.Submit` de este slider trae un campo extra, `containerId`, que identifica la region que hay que re-renderizar — y ese es justamente el valor que hay que mandar como `AJAXREQUEST`, no `_viewRoot`. Lo confirme comparando otra vez una peticion real capturada del navegador contra la mia. Con eso corregido, `PageParser.extractAjaxAction` ahora tambien lee ese `containerId` cuando el componente lo trae, y `ResultsPaginator` lo usa en vez de asumir siempre `_viewRoot`.

Probado contra un proceso real con 54 movimentacoes en 4 paginas: el scraper ahora las trae completas, sin duplicar ni perder ninguna.

## Como correrlo

### Paso 0 - instalar lo necesario

Necesitas tener instalado Node.js 18 o superior.

### Paso 1 - instalar y configurar

```bash
git clone <la-url-de-este-repo>
cd scraper-challenge
npm install
cp .env.example .env
```

El ultimo comando crea el archivo `.env` a partir de la plantilla.

Los valores por defecto ya sirven para hacer pruebas. Antes de una corrida real, lo principal que se puede ajustar es `MAX_PROCESSOS` y el rango de fechas usando `DATA_INICIO` / `DATA_FIM` o `DIAS_ATRAS`.

### Paso 2 - correrlo

```bash
npm run dev
```

Hace todo el proceso: busca, guarda los procesos, descarga los PDFs y reintenta lo que haya fallado.

Tambien hay modos separados:

```bash
npm run dev -- --mode=scrape
```

Solo busca y guarda procesos, movimentacoes y documentos. No descarga PDFs.

```bash
npm run dev -- --mode=download
```

Descarga los PDFs que ya estan guardados y siguen pendientes.

```bash
npm run dev -- --mode=retry
```

Reintenta unicamente las descargas que fallaron anteriormente.

El proceso se puede detener con `Ctrl+C` y continuar despues.

`scrape` no vuelve a guardar procesos que ya existen porque se hace deduplicacion por numero de proceso en `data/scraper-state.json`.

Los modos `download` y `retry` solamente trabajan con lo que sigue pendiente.

### Paso 3 - probar con pocos procesos

Antes de correr una cantidad grande, recomiendo probar con algo pequeño:

```bash
MAX_PROCESSOS=3 REQUEST_DELAY_MS=3000 npm run dev
```

Con eso se puede comprobar todo el flujo sin tener que esperar una corrida completa.

La idea es verificar que haga correctamente:

1. Buscar los procesos.
2. Entrar al detalle.
3. Sacar las movimentacoes.
4. Encontrar los documentos.
5. Descargar el PDF.
6. Detectar errores.
7. Reintentar cuando sea necesario.

Durante las pruebas lo hice con diferentes cantidades de procesos, incluyendo 6, 22 y 30, antes de dar por terminadas las diferentes partes.

## Tests

Para ejecutar los tests:

```bash
npm test
```

Los tests no hacen peticiones contra el sitio real.

`PageParser` utiliza fixtures HTML basados en la estructura real del sitio. Tambien incluye casos que encontraron bugs durante el desarrollo, como los ids que tienen `:`.

`PdfDownloader` utiliza un servidor HTTP local que simula las dos etapas reales: abrir la vista del documento y luego hacer el POST de "Gerar PDF".

Tambien se prueban casos como un 429 con retry y una respuesta 200 que realmente contiene HTML en vez de un PDF.

`StateManager` prueba la deduplicacion de procesos y la actualizacion del estado.

## Manejo del 429 y otros bloqueos

Esta fue una de las partes a las que mas atencion le puse.

Primero, cada peticion tiene un tiempo minimo entre una y otra. Esto se controla con `REQUEST_DELAY_MS` y por defecto son 1.5 segundos.

Si aun asi el servidor responde con un error temporal, `HttpClient` puede reintentar automaticamente ante:

* 429
* 500
* 502
* 503
* 504
* La pagina de bloqueo que devuelve el sitio con `"Requisição - Rejeitada"`

Si el servidor envia `Retry-After`, se respeta ese tiempo.

Si no lo envia, el tiempo entre intentos va aumentando de forma progresiva y con un pequeño jitter, hasta llegar al limite definido por `RETRY_MAX_DELAY_MS`.

Si un documento definitivamente no se puede descargar despues de los reintentos, el scraper no se cae completo.

Lo guarda como pendiente en:

`data/scraper-state.json`

y continua con el siguiente.

Despues se puede ejecutar:

```bash
npm run dev -- --mode=retry
```

para intentar nuevamente solamente esos documentos.

Todo el manejo de retry y backoff esta centralizado en `HttpClient`.

Esto tambien ayuda a que si despues agrego otra peticion al scraper, automaticamente tenga el mismo comportamiento sin tener que implementar el retry nuevamente.

Durante las primeras pruebas, mientras estaba entendiendo como funcionaba el sitio, hice varias peticiones seguidas y termine encontrandome con el bloqueo real del servidor.

Aunque no era algo que buscara provocar, sirvio para comprobar que el scraper detectaba correctamente la respuesta y que no confundia un bloqueo con una respuesta exitosa.

## Que se genera despues de correrlo

Se crean tres carpetas principales:

* `data/`

  * `documents.jsonl`: guarda un proceso por linea con sus movimentacoes y documentos.
  * `scraper-state.json`: guarda el progreso, procesos ya procesados y descargas pendientes.

* `pdfs/<numeroProcesso>/`

  * Contiene los PDFs descargados.
  * Los archivos quedan con nombres como `<fecha>_<descripcion>.pdf`.

* `logs/`

  * Guarda un archivo de texto por cada corrida con lo que fue pasando.

Ninguna de estas carpetas se sube al repositorio.

## Como esta organizado el codigo

```text
src/
├── index.ts                      # CLI: --mode=scrape|download|retry|full
├── config.ts                     # configuracion general desde .env
├── types/index.ts                # tipos usados en el proyecto
├── scraper/
│   ├── PjeScraper.ts             # coordina scrape -> download -> retry
│   ├── ResultsPaginator.ts       # busqueda, paginacion y detalle
│   ├── PageParser.ts             # parsing del HTML
│   └── PageParser.test.ts
├── http/HttpClient.ts            # cookies, delay y retry/backoff
├── downloader/
│   ├── PdfDownloader.ts          # documento -> Gerar PDF -> valida PDF
│   └── PdfDownloader.test.ts
├── storage/
│   ├── StateManager.ts            # estado, dedup y JSONL
│   └── StateManager.test.ts
└── utils/                         # delay, backoff, logger, nombres
```

La idea fue mantener cada parte lo mas separada posible.

`PageParser` solamente se preocupa por leer HTML.

`HttpClient` solamente se preocupa por hacer peticiones, manejar cookies, delays y retries.

`ResultsPaginator` es el que conoce como navegar realmente por el PJe.

Y `PjeScraper` se encarga de organizar todo el flujo.

Asi, si algo falla, es mas facil saber donde mirar sin tener que revisar todo el proyecto.

## Algunas decisiones que tome

### Todo secuencial

Podria descargar varios PDFs al mismo tiempo, pero preferi no hacerlo.

El desafio tenia bastante enfasis en manejar correctamente los limites del sitio y, ademas, durante las pruebas ya habia visto que hacer muchas peticiones seguidas podia terminar en un bloqueo.

Por eso preferi mantenerlo secuencial y controlar bien el tiempo entre peticiones.

### `download` y `retry` vuelven a navegar por el sitio

Como el `ca` esta ligado a la sesion, no es buena idea guardar un link de descarga y asumir que va a seguir funcionando dias despues.

Por eso estos modos vuelven a hacer la busqueda para conseguir una referencia valida y despues buscan el documento usando `idProcessoDoc`, que fue el identificador que se mantuvo estable entre sesiones durante las pruebas.

### Validar que realmente sea un PDF

No confio solamente en el `Content-Type`.

Antes de guardar una descarga como correcta, reviso que los primeros bytes sean:

`%PDF-`

Esto es importante porque el servidor puede devolver un status 200 aunque en realidad este devolviendo una pagina HTML de error.

Sin esta validacion podria terminar con archivos llamados `.pdf` que en realidad no son PDFs.

### Backoff con un limite

El tiempo de espera entre reintentos aumenta cuando hay errores temporales, pero tiene un limite.

La idea es darle tiempo al servidor para recuperarse sin que el scraper quede esperando indefinidamente.

## Para cerrar

El scraper lo probe siempre con cantidades y rangos de fechas controlados.

La idea nunca fue dejarlo haciendo peticiones sin limite, sino poder procesar los resultados por tandas y tener un estado que permita continuar despues sin empezar desde cero.

Al final, mas que hacer un scraper que simplemente "funcione", la idea fue dejar una estructura que pueda recuperarse de errores, no duplicar informacion y manejar de forma razonable las respuestas que entrega un sitio bastante antiguo y con una logica diferente a la de una API moderna.
