# Cambios de Quant Radar

## Registro horario de señales

- Captura señales técnicas de BTC/USD, ETH/USD, EUR/USD y USD/JPY en velas horarias cerradas. GitHub Actions las guarda en Neon y conserva una sola captura por par y hora.

## v11.3.0 · Decisión por plazo y valoración fundamental

### Navegación y gráficos

- La barra lateral permite buscar por nombre o símbolo y desplazar el listado de activos.
- El resaltado se desliza entre opciones en el selector de plazo y en la navegación principal. Al pasar el cursor por la lista, las filas cercanas se amplían con un efecto inspirado en el Dock.
- El gráfico principal y la minigráfica del activo seleccionado usan tonos vivos según la señal. Las demás minigráficas usan tonos suaves de la misma familia. La fila seleccionada se distingue con un sombreado más intenso y sin borde.

### Motor y valoración

- **Corto plazo e intradía.** La ficha muestra Comprar, Vender o Esperar y explica la relación entre cierre, media de 20 velas, rendimiento de 10 velas y MACD.
- **Largo plazo.** Usa el valor del negocio y los datos de solvencia y rentabilidad cuando el DCF está disponible. Para otros activos o si faltan datos fundamentales, aplica un criterio semanal con media de 40 semanas y rendimiento a 26 semanas. Una salida a largo plazo requiere una posición registrada.
- **Valoración fundamental.** Añade tres escenarios de flujos descontados, coste de capital, puente a valor por acción, indicadores, sensibilidad, múltiplos y crecimiento implícito.
- **Interfaz.** El selector de plazo está en la cabecera y conserva la ficha anterior, con un aviso, mientras carga el nuevo historial. El precio muestra la señal y un motivo breve. Cada minigráfica comparte color con su etiqueta. Indicadores y cotización se pueden desplegar.
- **Integración.** `GET /api/valuation` devuelve información trazable con fecha de corte y estados por falta de datos o revisión. El análisis de IA puede incluir el resultado fundamental cuando esté disponible.

El cálculo completo con datos reales requiere perfiles financieros revisados y una prima de mercado fechada. Los umbrales están documentados como política inicial. Las comprobaciones automatizadas verifican fórmulas y casos de decisión. La validación histórica de rendimiento queda pendiente.
