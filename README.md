# Quant Radar

Panel de análisis de activos con señales de corto y largo plazo, valoración fundamental por escenarios y registro local de posiciones. La integración opcional con OpenAI explica el informe y el entrenamiento de modelos es una línea de trabajo independiente.

## Arranque desde cero

Instala Python 3.10 o posterior. Para ejecutar las comprobaciones del motor necesitas Node.js 22.

```sh
git clone https://github.com/masbalanza-create/quant-radar.git
cd quant-radar
python3 server.py
```

Abre [Quant Radar local](http://127.0.0.1:8767). En macOS también puedes abrir `INICIAR.command`. El servidor usa la biblioteca estándar de Python. Puede iniciarse sin claves. Las cotizaciones y noticias requieren conexión a las fuentes externas.

Copia `.env.example` a `.env` si necesitas habilitar Alpaca u OpenAI. Cada colaborador crea sus propias credenciales. La cartera personal se guarda en el navegador.

## Decisiones por plazo

La ficha muestra **Comprar**, **Vender** o **Esperar**, con el motivo. **Ver largo plazo**
usa el DCF cuando hay una valoración válida y la tendencia semanal en los demás casos.
El modelo DCF admite las acciones estadounidenses cubiertas que publican en USD y
requiere un perfil financiero revisado. Consulta el [registro de cambios](CHANGELOG.md)
y la [guía para preparar los datos fundamentales](docs/valuation.md).

## Áreas de trabajo

| Área | Punto de partida | Documento |
|---|---|---|
| Interfaz | `index.html`, iconos y manifiesto | [Arquitectura y contrato](docs/architecture.md) |
| Motor y datos | `market-data.js`, `server.py`, `macro.py` y `relevance.py` | [Arquitectura y contrato](docs/architecture.md) |
| Entrenamiento | Objetivo, datos, baseline y validación futura | [Plan de entrenamiento](docs/training.md) |

Lee [CONTRIBUTING.md](CONTRIBUTING.md) antes de abrir un cambio. Si trabajas con un asistente de IA, su punto de entrada es [AGENTS.md](AGENTS.md). Consulta la [guía y el estado de las ramas](docs/branches.md) para empezar una tarea o localizar una versión histórica.

## Comprobaciones locales

```sh
node --test tests/market-data.test.cjs
python3 -m unittest discover -s tests -p 'check*.py'
```

Las mismas comprobaciones se ejecutan en GitHub Actions con datos sintéticos y sin credenciales.

## Referencias

- [Manual operativo (PDF)](Quant_Radar_Manual_Operativo.pdf)
- [Manual de valoración fundamental (PDF)](docs/Quant_Radar_Manual_Valoracion_Fundamental.pdf)
- [Arranque rápido](README.txt)
- [Manual de integración con backend independiente](docs/backend-integration.md)
- [Versiones publicadas](https://github.com/masbalanza-create/quant-radar/releases)
