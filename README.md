# Quant Radar

Panel de análisis de activos, simulación de cartera y evaluación de señales. El motor aplica reglas cuantitativas. La integración opcional con OpenAI explica el informe y el entrenamiento de modelos es una línea de trabajo independiente.

## Arranque desde cero

Instala Python 3.10 o posterior. Para ejecutar las comprobaciones del motor necesitas Node.js 22.

```sh
git clone https://github.com/masbalanza-create/quant-radar.git
cd quant-radar
python3 server.py
```

Abre [Quant Radar local](http://127.0.0.1:8767). En macOS también puedes abrir `INICIAR.command`. El servidor usa la biblioteca estándar de Python. Puede iniciarse sin claves. Las cotizaciones y noticias requieren conexión a las fuentes externas.

Copia `.env.example` a `.env` si necesitas habilitar Alpaca u OpenAI. Cada colaborador crea sus propias credenciales. La configuración de estrategia, los ajustes y la cartera se guardan en el navegador.

## Áreas de trabajo

| Área | Punto de partida | Documento |
|---|---|---|
| Interfaz | `index.html`, iconos y manifiesto | [Arquitectura y contrato](docs/architecture.md) |
| Motor y datos | `decision.js`, `server.py`, `macro.py` y `relevance.py` | [Arquitectura y contrato](docs/architecture.md) |
| Entrenamiento | Objetivo, datos, baseline y validación futura | [Plan de entrenamiento](docs/training.md) |

Lee [CONTRIBUTING.md](CONTRIBUTING.md) antes de abrir un cambio. Si trabajas con un asistente de IA, su punto de entrada es [AGENTS.md](AGENTS.md). Consulta la [guía y el estado de las ramas](docs/branches.md) para empezar una tarea o localizar una versión histórica.

## Comprobaciones locales

```sh
node --test tests/decision.test.cjs
python3 tests/check_app.py
```

Las mismas comprobaciones se ejecutan en GitHub Actions con datos sintéticos y sin credenciales.

## Referencias

- [Manual operativo (PDF)](Quant_Radar_Manual_Operativo.pdf)
- [Notas operativas e historial anterior](README.txt)
- [Versiones publicadas](https://github.com/masbalanza-create/quant-radar/releases)
