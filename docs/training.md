# Entrenamiento y evaluación

El motor actual es la referencia. La integración de OpenAI explica el informe. Aquí se define cómo evaluar futuros modelos antes de conectarlos a la decisión.

1. **Objetivo inicial.** Con los datos disponibles al cierre de la vela t, anticipar si el rendimiento entre el cierre siguiente y el posterior supera el coste de ida y vuelta.
2. **Datos reproducibles.** Registra fuente, activo, intervalo, fechas, tratamiento de ajustes, disponibilidad temporal y versión del conjunto. Mantén fuera del repositorio los datos privados y añade un ejemplo sintético para las pruebas.
3. **Validación temporal.** Ajusta exclusivamente con periodos anteriores al de evaluación. Evita que las ventanas de etiquetas se solapen entre ajuste y prueba. Calcula transformaciones y selecciona hiperparámetros con los tramos de entrenamiento y validación.
4. **Comparación.** Usa el motor actual como referencia en las mismas fechas, con los mismos costes, tamaño y restricciones. Mide rendimiento neto, cobertura, número de operaciones y riesgo. Registra parámetros, semilla, versión de código y resultados por periodo.
5. **Integración.** Empieza registrando las predicciones en simulación sin afectar los veredictos. Si una evaluación posterior justifica su incorporación, documenta el formato de salida y la versión del modelo. El motor conserva las comprobaciones de datos, costes, efectivo y riesgo.

Estado actual: plan de trabajo y contrato del motor disponibles. La canalización de entrenamiento y los modelos entrenados quedan por implementar.
