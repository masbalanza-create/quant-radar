# Ramas de trabajo

`main` es la versión integrada. Las ramas base por área son `ui/base`, `motor/base` y `entrenamiento/base`. Sirven como puntos de partida compartidos. Los PR de tareas apuntan a `main`.

Para empezar una tarea:

```sh
git fetch origin
git switch -c ui/descripcion-breve origin/main
```

Usa el prefijo `motor/` o `entrenamiento/` cuando corresponda. También puedes partir de la rama base de tu área si coincide con `origin/main`. Si está atrasada, parte de `origin/main` para incorporar el último código de las demás áreas.

Conserva tu tarea en una rama corta. Si un PR depende de otro, indícalo y vuelve a ejecutar las pruebas al actualizarte desde `main`. Evita acumular commits de áreas distintas en ramas base. Las ramas anteriores se conservan y pueden contener trabajo en curso.
