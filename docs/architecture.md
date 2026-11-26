# Arquitectura y contrato

`server.py` sirve el panel y las rutas de datos bajo el mismo origen.
`index.html` presenta la ficha del activo y sus decisiones.
`market-data.js` contiene las reglas de decisión y la comprobación de frescura intradiaria.
`valuation_data.py` prepara los datos por fecha y `valuation.py` ejecuta el DCF.

## Cómo se elige el método

| Vista | Método y resultado |
| --- | --- |
| Corto plazo e intradía | Cierre frente a la media de 20 velas, rendimiento de 10 velas y signo del MACD. Una valoración válida puede frenar una señal contradictoria. La sesión cerrada o sin verificar y los datos insuficientes devuelven Esperar. |
| Largo plazo con valoración válida | Comprar con margen de seguridad del 15 % sobre el escenario prudente, ROIC superior al WACC y deuda neta de hasta 3× EBITDA. Una posición registrada puede recibir Vender si el cierre supera el escenario favorable, el ROIC deja de superar el WACC o la deuda rebasa el límite. |
| Largo plazo sin valoración válida | Tendencia histórica común a todos los instrumentos. Usa 40 velas semanales completas y consecutivas. Comprar si el cierre supera la media de 40 semanas y el rendimiento de 26 semanas es positivo. Vender si ambos son bajistas y hay posición registrada. En los demás casos, Esperar. |

El largo plazo es una evaluación informativa incluso fuera de sesión. El gráfico conserva la indicación de cotización y la tarjeta muestra el método y el motivo. La cartera anota importes positivos en este navegador para identificar posiciones. Las señales son orientativas y no se envían órdenes.

## Datos e integración

- `GET /api/series` recibe símbolo e intervalo. Devuelve `meta`, `values` y `fetched_at`, además de `stale` si responde desde datos antiguos. Los tiempos de vela usan ISO 8601 y los campos Unix usan segundos.
- `GET /api/valuation` recibe `symbol` y, opcionalmente, `as_of` UTC. Devuelve versión, identificador, escenario, controles y fuentes. Los estados principales son `ok`, `review_required`, `insufficient_data` y `unsupported`.
- `POST /api/analysis` genera una explicación bajo demanda y puede recibir un resumen de la valoración. Su texto se muestra en **Valoración de IA**.
- [Guía de valoración](valuation.md) y [manual de integración independiente](backend-integration.md).
