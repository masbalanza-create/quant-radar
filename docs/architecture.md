# Arquitectura y contrato

`server.py` entrega la aplicación y las rutas de mercado. La interfaz obtiene las velas de `GET /api/series?symbol=…&interval=…`. Cada vela contiene `datetime` y `close`, y puede incluir `open`, `high`, `low`, `volume` y `adjusted_close`. Los datos de origen, moneda y sesión van en `meta`. La interfaz muestra el estado de carga y los errores devueltos por las fuentes.

`index.html` reúne el estado del navegador, la presentación y la traducción de los ajustes de cartera a entradas numéricas. `decision.js` contiene el núcleo reutilizable. El navegador lo carga como script clásico y Node lo importa para ejecutar pruebas.

## Decisión compartida

1. `auditForecastInputs` comprueba las velas y `prepareForecastSeries` prepara la serie.
2. `evaluateQuantDecision(prices, state)` genera el informe histórico y las señales de regla.
3. `backtestUncertainty(report.historicalTest)` estima la incertidumbre frente a la referencia.
4. `integratedVerdict(report, signal, cost, profile, sizing)` devuelve la decisión final.

`signal` admite `buy`, `sell` y `hold`. `cost` es un porcentaje de ida y vuelta, o `null` cuando se desconoce. Por ejemplo, `0.5` equivale al 0,5 %. El informe histórico usa rendimientos decimales. El perfil aporta capital y límite. El escenario de tamaño aporta presupuesto de pérdida, stop, exposición previa y efectivo. Los importes están en EUR y los porcentajes se expresan en puntos porcentuales.

| Campo de salida | Significado |
|---|---|
| `action` | `buy`, `sell`, `hold` o `pending` |
| `stance` | Comprar, Vender, Esperar o Datos insuficientes |
| `reason` | Motivo legible que explica el resultado |
| `percent` | Porcentaje adicional de capital en una compra virtual. En los otros estados, el código devuelve cero |

La tabla, la ficha y el paso 26 usan ese resultado. La venta es una posible salida técnica de una posición larga virtual. Los ejemplos de los cuatro estados están en `tests/decision.test.cjs`. Conserva la compatibilidad de campos y unidades cuando añadas datos.
