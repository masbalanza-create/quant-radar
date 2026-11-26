# Manual de integración de Quant Radar con un backend independiente

**Versión de referencia:** rama `main`, commit `6cfe5a5fee618db17e6aa405abc4f583eb41594c`.

**Objetivo:** conectar la web existente a un backend desarrollado y desplegado por separado, manteniendo los archivos del frontend idénticos a los de la versión de referencia.

## 1. Alcance y fuentes de verdad

| Archivo | Qué determina |
|---|---|
| `index.html` | Rutas que llama la web, parámetros que envía, campos que lee y estados que muestra. |
| `server.py` | Respuestas actuales de la API, proveedores, autenticación y manejo de errores. |
| `market-data.js` | Cálculo del protocolo que se ejecuta en el navegador. |
| `relevance.py` | Estructura del filtro de noticias y reglas del ajuste de titulares. |
| `macro.py` | Estructura del informe macroeconómico. |
| `tests/market-data.test.cjs` y `tests/check_app.py` | Pruebas de referencia para comprobar regresiones. |

Verifica el contrato comparando lo que devuelve el servidor con lo que lee el navegador. Para campos anidados y casos opcionales, usa los archivos de referencia y genera respuestas de prueba a partir de ellos.

Mantén `index.html`, `market-data.js`, `manifest.webmanifest`, `sw.js` y los iconos tal como están. Los cambios de integración van en el backend nuevo, en el proxy y en las pruebas del backend.

## 2. Arquitectura

Publica la web y la API bajo **un mismo origen público** mediante un proxy inverso. El navegador ya hace peticiones a rutas como `/api/series`. El proxy permite conservar esas rutas aunque el backend esté en otro puerto o servidor.

| Petición | Destino |
|---|---|
| `/`, `/index.html` y recursos de la aplicación | Servicio que publica los archivos originales del frontend. |
| `/api/*` | Backend independiente. |
| Rutas internas de los bots | Red interna del backend o acceso autenticado para pruebas. |

**Ejemplo local:** el navegador abre `http://127.0.0.1:8767/`. El proxy escucha en `8767`, el frontend estático en `8768` y el backend nuevo en `8769`. Solo el proxy necesita estar accesible al navegador. Antes de iniciarlo, libera el puerto público si está ocupado por la instancia anterior de Quant Radar.

El proxy debe conservar el método HTTP, la ruta, la cadena de consulta, el cuerpo JSON y el código de respuesta. Mantén el control de acceso cuando la app se exponga fuera del equipo y utiliza HTTPS en ese entorno. En el servicio estático, publica solo los archivos que necesita la web. Mantén `.env`, bases de datos y código privado fuera del directorio público.

## 3. Contrato público obligatorio

Conserva las rutas, los campos, los tipos y las unidades actuales, aunque el backend nuevo use una estructura interna distinta.

| Método y ruta | Entrada | Respuesta compatible |
|---|---|---|
| `GET /api/status` | Sin parámetros | Booleanos `market`, `alpaca`, `twelve` y `ai`. `market` indica si el servicio de mercado está habilitado. `ai` indica si el análisis bajo demanda está disponible. |
| `GET /api/series` | `symbol`, `interval` | `{meta, values, fetched_at}`. Conserva `stale` cuando entregues una copia antigua. Ante error, devuelve un JSON con `error`. |
| `GET /api/clock` | Sin parámetros | `state` con `open`, `closed` o `unknown`. Si hay reloj válido, conserva `asof`, `source`, `next_open` y `next_close` según la respuesta de referencia. |
| `GET /api/fx` | Sin parámetros | `{rates, asof, source, stale}` en éxito. `rates` usa USD como base y contiene `USD: 1`. Si falla sin datos disponibles, devuelve `rates: {}` y `error`. |
| `GET /api/news` | `symbol`, `force=1` opcional | `{items, sources, errors, asof, filter}`. `force=1` solicita actualizar la consulta de ese activo. |
| `GET /api/market-quote` | `symbol` | Cotización `bid` y `ask`, con tamaños y marcas de tiempo cuando estén disponibles, o una respuesta con `reason`. |
| `GET /api/options` | `symbol` | Datos del subyacente y `pair` con `expiration`, `strike`, `call` y `put`, o `reason` cuando falte cobertura. Conserva el caso `pair: null`. |
| `GET /api/fundamentals` | `symbol` | Ejercicio anual con `end`, `filed`, `currency`, `revenue`, `income`, `eps`, `metrics` y `filingUrl`, o `reason` cuando falte cobertura. |
| `GET /api/valuation` | `symbol`, `as_of` UTC opcional | Contrato versionado con `status`, `reasons`, `quote`, `scenarios`, `ratios`, `sensitivity` y `run_id`. Consulta [valoración](valuation.md). |
| `GET /api/macro` | `symbol` | `{economies, difference}`. Para un activo sin cobertura, `{"economies":[],"difference":null}`. |
| `POST /api/analysis` | JSON generado por `context(d)` en `index.html` | `{text, status}` en éxito. Ante fallo, devuelve un JSON con `error`. `text` se muestra en **Valoración de IA**. |

### Velas y cotizaciones

- Acepta los intervalos `1min`, `5min`, `15min`, `30min`, `1h`, `1day` y `1week`.
- Conserva los símbolos internos del Radar, incluidos separadores como `:` y `/`. Por ejemplo, `7203:JPX`, `SAP:XETR`, `EUR/USD` y `BTC/USD`. El backend traduce esos identificadores al formato de cada proveedor.
- Devuelve las velas de más antigua a más reciente. Cada vela lleva `datetime`, `open`, `high`, `low`, `close` y `volume`. Conserva `adjusted_close` cuando esté disponible. La serie necesita al menos 21 cierres válidos para calcular los indicadores del frontend.
- En `meta`, conserva los campos disponibles de la implementación original, incluidos `currency`, `source`, `timezone`, `quality`, `quote_time`, `quote_price`, `session` y `exchange_timezone`. `session` usa `start` y `end`.
- `datetime` usa ISO 8601 con zona horaria. Los campos Unix como `fetched_at`, `asof` y `session.start/end` usan **segundos**. `quote_time` conserva la representación de la fuente original. Verifica el flujo en vivo porque el frontend interpreta esa marca de tiempo de forma distinta según el flujo.
- Los valores de calidad como `alpaca_iex`, `alpaca_sip`, `public_rest` y `unverified` influyen en el comportamiento del frontend. Devuelve cada calificación cuando se cumplan sus condiciones.

### Noticias y errores

Cada noticia conserva `title`, `date`, `source`, `url`, `group` y `summary` si existe. El filtro conserva `relevant`, `discarded`, `adjustment`, `total` y `method`. `adjustment` utiliza la escala de **−12 a +12 puntos**.

Una consulta válida sin titulares puede devolver `items: []` y `errors: []`, con el filtro correspondiente. Si una fuente falla, refléjalo en `errors` o devuelve `error` según la ruta. Los titulares aportan contexto al informe bajo demanda.

Devuelve `Content-Type: application/json` para las respuestas de la API, incluidos los errores que va a leer la web. Usa tiempos de espera definidos para los proveedores y permite que las demás rutas sigan entregando sus datos válidos cuando falle un proveedor.

## 4. Integración de los tres bots

El backend puede implementar cada bot como módulo o servicio interno. Los tres deben trabajar con **la misma evaluación**, identificada por un ID, símbolo, horizonte y hora de corte. Guarda la procedencia y la fecha de los datos usados.

| Bot | Entrada | Salida |
|---|---|---|
| **Matemático** | Velas verificadas, estado de sesión y parámetros cuantitativos disponibles | Señal `buy`, `sell`, `hold` o `unavailable`, motivo, indicadores y bloqueos de riesgo o datos. |
| **Noticias** | Titulares del activo disponibles hasta la hora de corte | Contexto positivo, negativo, mixto, neutral o no disponible, con sus evidencias. |
| **Jefe** | Ambos informes, estado del mercado y posición virtual conocida | Decisión final interna, regla aplicada, motivo y, cuando proceda, tamaño virtual validado. |

Implementa el orden de decisión del jefe con reglas comprobables. Evalúa primero la sesión y la calidad de datos. Comprueba la posición antes de emitir una salida y verifica costes y riesgo antes de emitir una compra. Si el motor matemático ya incorpora el ajuste de titulares, evita sumar el mismo impacto en el jefe. Los textos externos son evidencia para analizar. El jefe clasifica decisiones virtuales y el backend conserva el registro de la evaluación.

### Qué puede verse en la web actual

- **Decisión del activo** aplica en el navegador las reglas técnicas o la política de largo plazo. Consume la serie y, si procede, el resultado de `GET /api/valuation` como dato para la decisión. El campo `chief` de un backend externo carece de consumidor en ese recuadro.
- **Valoración de IA** puede mostrar el informe de los tres bots a través de `POST /api/analysis`. Devuelve en `text` la decisión del jefe y la evidencia de ambos informes. El flujo de la versión de referencia sigue indicando OpenAI.
- **Entrenamiento de IA** muestra únicamente su título. La pestaña actual carece de controles y llamadas al servidor.

Trata la respuesta interna del jefe como un resultado distinto de la decisión del navegador. Si difieren, explícalo en el informe. Mantén precios, noticias y estados de mercado fieles a las fuentes. Sustituir el recuadro principal por la decisión del jefe requeriría un cambio explícito de alcance.

## 5. Implementación y puesta en marcha

1. **Fija la versión del frontend.** Guarda el identificador del commit y calcula las huellas de los archivos estáticos que vas a publicar.
2. **Obtén ejemplos del backend original.** Conserva respuestas de prueba sin claves ni datos privados para cada ruta. Incluye éxito, falta de cobertura, sesión cerrada, datos antiguos y caída de proveedor.
3. **Construye un adaptador público.** Transforma el modelo de datos del backend independiente al contrato que consume la web.
4. **Integra los bots dentro del backend.** Haz que `POST /api/analysis` invoque al orquestador y convierta el resultado estructurado en el campo `text`. Valida el cuerpo recibido y usa datos verificados por el servidor para sustentar una decisión.
5. **Configura el proxy y las credenciales.** Usa credenciales solo en el servidor. Mantén separadas las URL del frontend, el backend y el origen público. Documenta cómo arrancar cada componente.
6. **Prueba en paralelo.** Mantén el backend anterior disponible durante la verificación. Si falla la nueva integración, vuelve a dirigir `/api/*` al backend anterior mediante el proxy.
7. **Entrega instrucciones reproducibles.** Incluye el flujo, los puertos, un `.env.example` sin secretos, pruebas de contrato, cómo arrancar el sistema y cómo recuperar el backend anterior.

## 6. Criterios de aceptación

- Los archivos entregados al navegador coinciden con los de la versión de referencia.
- Al abrir el origen público, el Radar carga activos y dibuja la gráfica. Cambiar de activo u horizonte muestra la serie correcta.
- Los símbolos con `:` o `/` llegan intactos al backend. Los rangos, la moneda y los estados de sesión se muestran correctamente.
- La decisión técnica muestra **Esperar** con el motivo **Mercado cerrado**. La decisión de largo plazo identifica el cierre de sesión cuando se conoce. Una sesión sin verificar, una serie antigua y una consulta fallida tienen estados distinguibles.
- La caída de noticias conserva la información técnica disponible. Una consulta correcta sin titulares se reconoce como tal.
- Las pestañas y el cambio de método por horizonte siguen siendo accesibles. Las rutas de cotización, opciones, fundamentales y macro devuelven datos o su estado de falta de cobertura.
- Con `ai: true`, **Generar valoración** muestra un informe que identifica la decisión del jefe y la evidencia de los dos especialistas. La decisión principal conserva el comportamiento de la versión de referencia.
- La pestaña **Entrenamiento de IA** sigue disponible con su título.
- Pasan `node --test tests/market-data.test.cjs`, `python3 -m unittest discover -s tests -p 'check*.py'` y las pruebas de contrato del backend nuevo. Se prueba la web a través del proxy y se indica qué escenarios usaron datos reales y cuáles usaron datos simulados.
