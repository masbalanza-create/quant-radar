# Colaborar en Quant Radar

Consulta las [instrucciones para IA](AGENTS.md) y la [guía de ramas](docs/branches.md).

1. Crea una rama desde la versión actual de `main`. Usa un prefijo descriptivo como `ui/`, `motor/` o `entrenamiento/`.
2. Trabaja desde tu propio clon. Mantén `.env`, datos privados, resultados locales y credenciales fuera de Git.
3. Haz cambios pequeños. Si un cambio afecta al contrato, actualiza su documentación y los ejemplos en el mismo pull request.
4. Ejecuta las comprobaciones del README y prueba el flujo afectado. Para UI, indica el dispositivo o ancho usado. Para el motor, explica qué decisión debería cambiar y por qué. Para entrenamiento, registra el periodo de evaluación, referencia y supuesto de costes.
5. Abre un pull request a `main`. Indica el área, cómo reproducir el cambio y cualquier dependencia de otro PR. Acordad una revisión por la otra persona y esperad a que pasen las comprobaciones antes de integrar.
6. Actualiza tu rama desde `main` y vuelve a comprobarla si cambió una interfaz compartida. Integra primero los cambios compatibles del contrato y después los consumidores.

Si los dos necesitáis modificar `index.html`, acordad antes qué funciones o secciones toca cada uno. Los cambios nuevos de lógica que se puedan probar de forma aislada van en `market-data.js`. Las tareas de entrenamiento se mantienen fuera del recorrido interactivo.

Las tareas iniciales están en [Interfaz #1](https://github.com/masbalanza-create/quant-radar/issues/1) y [Motor #2](https://github.com/masbalanza-create/quant-radar/issues/2). Antes de fusionar, probad en el navegador el panel de un activo con datos válidos y verificad que la ficha muestra el método, el motivo y la señal esperados. Si el cambio afecta a la carga, comprobad también un error de la fuente y el reintento.
