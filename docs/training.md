# Entrenamiento y evaluación

El motor actual es la referencia. La integración de OpenAI explica el informe. Aquí se define cómo evaluar futuros modelos antes de conectarlos a la decisión.

1. **Objetivo inicial.** Con los datos disponibles al cierre de la vela t, anticipar si el rendimiento entre el cierre siguiente y el posterior supera el coste de ida y vuelta.
2. **Datos reproducibles.** Registra fuente, activo, intervalo, fechas, tratamiento de ajustes, disponibilidad temporal y versión del conjunto. Mantén fuera del repositorio los datos privados y añade un ejemplo sintético para las pruebas.
3. **Validación temporal.** Ajusta exclusivamente con periodos anteriores al de evaluación. Evita que las ventanas de etiquetas se solapen entre ajuste y prueba. Calcula transformaciones y selecciona hiperparámetros con los tramos de entrenamiento y validación.
4. **Comparación.** Usa el motor actual como referencia en las mismas fechas, con los mismos costes, tamaño y restricciones. Mide rendimiento neto, cobertura, número de operaciones y riesgo. Registra parámetros, semilla, versión de código y resultados por periodo.
5. **Integración.** Empieza registrando las predicciones en simulación sin afectar los veredictos. Si una evaluación posterior justifica su incorporación, documenta el formato de salida y la versión del modelo. El motor conserva las comprobaciones de datos, costes, efectivo y riesgo.

Estado actual: plan de trabajo y contrato del motor disponibles. La canalización de entrenamiento y los modelos entrenados quedan por implementar.

## Registro horario de señales

Ejecuta `python3 signal_registry.py` con Python y Node.js disponibles. Reutiliza
las fuentes actuales del radar: Kraken para BTC/USD y ETH/USD y Yahoo Finance
para EUR/USD y USD/JPY. Los datos de Yahoo quedan identificados como no verificados.

El registro espera cinco minutos tras cada cierre horario. Guarda la primera
captura válida de cada par y hora UTC con sus indicadores, fuente,
decisión técnica y huella del código del motor. Descarta la vela abierta y
omite las horas sin datos del proveedor, por ejemplo cuando forex está cerrado.
La decisión registrada corresponde al motor técnico sin ajuste fundamental.

La base `hourly-signals.sqlite3` se mantiene fuera de Git. Para una ejecución
programada, define `QR_SIGNAL_DATABASE` con una ruta de almacenamiento persistente.

En GitHub Actions, el flujo **Registro horario de señales** se ejecuta en
`main` a los 12 minutos de cada hora UTC. Usa `DATABASE_URL` como secreto
del repositorio para guardar en Neon. Se puede lanzar manualmente desde
Actions. Las velas se guardan una sola vez por par, proveedor y hora, y la
primera captura válida importa también las velas anteriores de su ventana.
Las velas históricas recuperadas quedan en su propia tabla, sin generar
señales retrospectivas.

### Evaluación de las señales

Cada ejecución evalúa las señales vencidas. La entrada simulada usa la apertura
de la primera hora UTC que empieza después de registrar la señal. La salida
usa el cierre de la cuarta vela consecutiva. Si falta alguna vela, la
evaluación queda pendiente. La comparación inicial usa un coste ilustrativo
de ida y vuelta del 0,20 % para una compra y su salida. En una venta mide la
diferencia bruta entre cerrar una posición existente y mantenerla. Los
resultados se guardan una sola vez por señal y versión de la evaluación.

### Panel de entrenamiento

La pestaña **Entrenamiento de IA** consulta el registro mediante
`GET /api/training-summary`. Para habilitarla en Render, añade
`QR_TRAINING_DATABASE_URL` como variable secreta del servicio. Usa un rol de
Neon con permiso de lectura sobre `hourly_signals` y
`hourly_signal_outcomes`. GitHub Actions continúa usando su propio secreto
para escribir los datos.

### Cartera simulada

El panel compara entradas largas del motor y de la media de 20 velas usando
las señales evaluadas de BTC/USD y ETH/USD. Cada estrategia empieza con
2.000 USD y asigna 500 USD por entrada. Admite una posición abierta por par.
Las salidas de una hora se contabilizan antes de las nuevas entradas de esa
misma hora. Se reutiliza la rentabilidad neta con el coste simulado de 0,20 %.
La caída máxima se calcula con el capital al cierre de las operaciones,
valorando al coste las demás posiciones abiertas.
