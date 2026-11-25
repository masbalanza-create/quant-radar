# Quant Radar

## Manual de colaboración

### Responsabilidades

| Área | Rama | Archivos y tarea |
| --- | --- | --- |
| Interfaz web y móvil | `ui/interfaz-v11` | Pantallas, filtros y estados en `index.html`. Instalación y caché en `manifest.webmanifest`, `sw.js` e iconos. [Tarea #1](https://github.com/masbalanza-create/quant-radar/issues/1) |
| Datos y motor de decisión | `motor/datos-y-decision-v11` | API en `server.py`, datos macro en `macro.py`, noticias en `relevance.py` y lógica de decisión en `decision.js`. [Tarea #2](https://github.com/masbalanza-create/quant-radar/issues/2) |

`index.html` también contiene llamadas a la API y al motor. Si las dos personas necesitan cambiar la misma función, acordad quién hace ese cambio e indicadlo en el PR.

### Acordar qué datos se intercambian

1. Antes de editar un campo que use la otra persona, anotad en la tarea o el PR el nombre del campo, su tipo, cuándo puede faltar y qué debe hacer la interfaz en ese caso. Incluid ejemplos de respuesta normal, datos incompletos o desactualizados y error.
2. Usad esos mismos ejemplos para desarrollar y probar ambas partes. Si cambia el formato, conservad temporalmente la compatibilidad o integrad los cambios dependientes en un mismo PR revisado por ambos.
3. Pedid revisión mutua cuando cambie una ruta de la API, un campo usado por la interfaz o la forma de llamar al motor.

Por ejemplo, la interfaz consulta `GET /api/series?symbol=AAPL&interval=1day` y recibe JSON. Después pasa los precios de cierre y el estado de los datos a `evaluateQuantDecision(prices, state)` en `decision.js`. La función devuelve, entre otros campos, `action`, `label`, `checks` y `historicalTest`. Si los datos no son utilizables, `label` incluye «No operar» y el motivo de bloqueo. Un cambio en ese campo requiere coordinar la función y la pantalla que lo muestra.

### Abrir e integrar los PR

1. Trabajad en vuestra rama y abrid un PR hacia `main` con el resumen, la tarea vinculada y los casos probados.
2. Si cada PR funciona por separado, integrad primero el cambio del que dependa el otro. Si ambos cambios tienen que entrar a la vez, probadlos juntos en una rama de integración y fusionad un único PR.
3. Tras fusionar el primer PR, actualizad la rama del segundo y volved a probar. Ejecutad lo siguiente desde vuestra rama, con los cambios locales guardados en un commit.

   ```sh
   git fetch origin
   git merge origin/main
   git push origin HEAD
   ```

4. Si Git señala conflictos, revisad con la otra persona las líneas compartidas, resolvedlos en la rama de trabajo y repetid las pruebas antes de fusionar.

### Prueba antes de fusionar

Con la versión combinada, iniciad la aplicación con `INICIAR.command` y abrid el panel de un activo. Usad los ejemplos acordados cuando el proveedor real no permita reproducir un caso.

| Caso | Resultado esperado |
| --- | --- |
| Datos disponibles | Cargan el panel y los precios. La decisión y sus motivos coinciden con la respuesta del motor. |
| Datos incompletos o desactualizados | La interfaz indica el estado. Si los datos bloquean la decisión, aparece «No operar» con su motivo. |
| Error de la API | La interfaz muestra el error y mantiene disponibles los controles para cambiar de activo o reintentar. |

Si el PR cambia la interfaz, verificad también los filtros y el panel en ancho móvil. Dejad el resultado en el PR e integradlo cuando las pruebas aplicables pasen. Usad etiquetas y notas en [Releases](https://github.com/masbalanza-create/quant-radar/releases) para registrar las versiones que publiquéis.

[Notas operativas e historial anterior](README.txt)
