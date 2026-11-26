# Cambios de Quant Radar

## Decisión por plazo y valoración fundamental

- **Corto plazo e intradía.** La ficha muestra Comprar, Vender o Esperar y explica la relación entre cierre, media de 20 velas, rendimiento de 10 velas y MACD.
- **Largo plazo.** Usa el valor del negocio y los datos de solvencia y rentabilidad cuando el DCF está disponible. Para otros activos o si faltan datos fundamentales, aplica un criterio semanal con media de 40 semanas y rendimiento a 26 semanas. Una salida a largo plazo requiere una posición registrada.
- **Valoración fundamental.** Añade tres escenarios de flujos descontados, coste de capital, puente a valor por acción, indicadores, sensibilidad, múltiplos y crecimiento implícito.
- **Interfaz.** La decisión aparece debajo de los indicadores. Se puede cambiar de plazo desde la tarjeta y consultar las métricas, la valoración o la cartera local.
- **Integración.** `GET /api/valuation` devuelve información trazable con fecha de corte y estados por falta de datos o revisión. El análisis de IA puede incluir el resultado fundamental cuando esté disponible.

El cálculo completo con datos reales requiere perfiles financieros revisados y una prima de mercado fechada. Los umbrales están documentados como política inicial. Las comprobaciones automatizadas verifican fórmulas y casos de decisión. La validación histórica de rendimiento queda pendiente.
