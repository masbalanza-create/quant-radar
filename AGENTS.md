# Instrucciones para asistentes de IA

## Antes de editar

1. Ejecuta `git status --short --branch` e identifica el área de la tarea. Respeta el trabajo existente y el alcance indicado por el usuario.
2. Lee [README](README.md), [guía de colaboración](CONTRIBUTING.md) y la documentación del área indicada abajo.
3. Trabaja en una rama de tarea actualizada desde `main`. Usa la [guía de ramas](docs/branches.md) para nombrarla y abrir el PR.
4. Usa datos sintéticos para reproducir casos. Mantén fuera del repositorio los archivos `.env`, las claves, la cartera personal y los datos privados. Añade solo variables vacías o ejemplos ficticios a `.env.example`.

## Áreas y límites

| Área | Archivos habituales | Lee antes de cambiar |
|---|---|---|
| Interfaz | `index.html`, iconos, manifiesto y service worker | [Contrato](docs/architecture.md). Conserva los controles, los estados y el significado del veredicto. |
| Motor y datos | `market-data.js`, `server.py`, `macro.py`, `relevance.py` | [Contrato](docs/architecture.md). Conserva los campos, las unidades y los casos de datos incompletos. |
| Entrenamiento | Experimentos reproducibles y evaluación temporal | [Plan](docs/training.md). Mantén las predicciones experimentales fuera del veredicto hasta que se apruebe su integración. |

`index.html` es compartido. Si una tarea cambia tanto la presentación como los datos consumidos, coordina el cambio de contrato en el mismo PR o conserva compatibilidad hasta que se integren los dos PR.

## Verificación y entrega

```sh
node --test tests/market-data.test.cjs
python3 -m unittest discover -s tests -p 'check*.py'
```

Para UI, prueba el flujo afectado en el navegador a ancho normal y móvil. Para motor, prueba el estado que cambia y el caso de datos insuficientes. Para entrenamiento, registra fuente, intervalo, fechas, objetivo, referencia, costes y semilla. Describe en el PR qué cambió, cómo se comprobó y qué queda sin verificar.
