# Ramas de trabajo

`main` es la versión integrada. Las ramas base por área son `ui/base`, `motor/base` y `entrenamiento/base`. Sirven como puntos de partida compartidos. Los PR de tareas apuntan a `main`.

Para empezar una tarea:

```sh
git fetch origin
git switch -c ui/descripcion-breve origin/main
```

Usa el prefijo `motor/` o `entrenamiento/` cuando corresponda. También puedes partir de la rama base de tu área si coincide con `origin/main`. Si está atrasada, parte de `origin/main` para incorporar el último código de las demás áreas.

Conserva tu tarea en una rama corta. Si un PR depende de otro, indícalo y vuelve a ejecutar las pruebas al actualizarte desde `main`. Evita acumular commits de áreas distintas en ramas base. Las ramas anteriores se conservan y pueden contener trabajo en curso.

## Estado de las ramas existentes

| Ramas | Estado | Uso |
|---|---|---|
| `main` | Activa | Fuente de la versión integrada y punto de partida de tareas nuevas. |
| `ui/base`, `motor/base`, `entrenamiento/base` | Referencia por área | Úsalas solo si coinciden con `main`. Trabaja en una rama corta para cada cambio. |
| `proyecto/base-colaboracion`, `proyecto/instrucciones-ia` | **Integradas · redundantes** | Los PR #3 y #4 ya están en `main`. No se necesitan para trabajar ni contienen una versión distinta de la aplicación. |
| `ui/interfaz-v11`, `motor/datos-y-decision-v11` | **Históricas · conservar** | Ambas apuntan a `e4bfff9`, una instantánea anterior de la aplicación con diferencias de interfaz y motor. No son ramas activas. |

Para recuperar una versión publicada, consulta [Releases](https://github.com/masbalanza-create/quant-radar/releases) y usa su etiqueta. Las etiquetas de versiones y las instantáneas históricas se conservan. Las ramas redundantes quedan identificadas en esta guía.
