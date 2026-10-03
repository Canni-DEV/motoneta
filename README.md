# MotoNeta

Juego web de motocross en 3D, con interfaz en español, cinco circuitos, carrera rápida, torneos, versus por turnos, editor de pistas, repeticiones y récords locales. Incluye modelos, público animado, música, efectos de sonido, horarios y clima.

**[Jugar en el navegador](https://canni-dev.github.io/motoneta/)** · [Repositorio](https://github.com/Canni-DEV/motoneta) · [Publicaciones](https://github.com/Canni-DEV/motoneta/actions/workflows/deploy.yml)

Funciona como sitio estático: no necesita backend, cuentas ni servicios externos durante el juego. Los perfiles, mapas y récords se guardan en el navegador. Requiere WebGL 2 y aceleración gráfica; en móvil se juega en horizontal.

## Jugar

| Control         | Acción                                                                               |
| --------------- | ------------------------------------------------------------------------------------ |
| Z               | Acelerar; pulsar repetidamente después del rodado para levantarse y volver a la moto |
| X               | Turbo                                                                                |
| ↑ / ↓           | Cambiar de carril                                                                    |
| ← / →           | Inclinar la moto                                                                     |
| Enter           | Iniciar, pausar o continuar                                                          |
| Escape          | Pausar                                                                               |
| C               | Cambiar entre cámara normal y cinematográfica durante una repetición                 |
| Rueda del mouse | Zoom de cámara                                                                       |

También hay controles táctiles, gamepad y teclas reasignables. Las rampas producen los saltos y las zonas claras enfrían el motor.

Carrera rápida muestra tu récord para la pista, vueltas, cantidad de rivales y dificultad elegidas. Activá “Correr contra mi fantasma” para competir contra tu mejor carrera: al completar cada vuelta verás la diferencia de esa vuelta y la acumulada, con el detalle final en resultados. La elección se conserva mientras el juego está abierto y cada nuevo intento usa la mejor marca disponible.

Las repeticiones pueden verse con cámaras cinematográficas y el tema de resultados. En Inicio, tras 60 segundos de inactividad en un equipo no móvil, se reproducen automáticamente las marcas del perfil activo; Escape vuelve al menú. Esta opción se puede desactivar en Ajustes → Interfaz.

Las caídas conservan la inercia de la moto: puede rodar hasta salir de una rampa, mientras el conductor se reincorpora y vuelve a montarla. Al pasar a las reglas `motoneta-2`, los datos locales de la versión anterior se reinician (perfiles, pistas, marcas, sesiones, repeticiones y ajustes).

## Ejecutar localmente

Con Node.js 24 LTS (mínimo 22.12):

```sh
npm ci
npm run dev
```

Abrir la dirección que muestra Vite, normalmente `http://127.0.0.1:5173/`.

Para comprobar la versión de producción:

```sh
npm run build
npm run preview
```

Abrir la dirección de preview, normalmente `http://127.0.0.1:4173/`. El resultado está en `dist/`; debe servirse por HTTP, no abrirse como archivo.

## Modelos 3D

La fuente reproducible es `scripts/build-motocross.py`, para Blender 5.2.2 LTS. Reconstruye el archivo editable, ambos GLB y el manifiesto; las ediciones manuales del `.blend` deben trasladarse al generador antes de regenerarlo.

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' --background --factory-startup --python-exit-code 1 --python scripts/build-motocross.py
# Añadir -- --render --render-all para las vistas de estudio de las tres familias y ambas calidades.
npm run models:validate
```

El rediseño incluye **Esencial**, **Competición** y **Travesía**, con uniones comunes y diferencias locales de volumen, protección y pintura. Incorpora la devolución sobre Esencial: visera más corta, casco más compacto y mayor volumen corporal. Con Vite activo, abrir `/assets/motocross/review/index.html` para comparar los modelos, sus calidades, poses y combinaciones. `node scripts/review-model-quality.mjs catalogo --families --mixed` regenera las capturas del juego. Las evidencias nuevas se guardan en `assets/motocross/review/catalogo/`, preservando la primera revisión y las históricas.

`scripts/check-motocross-topology.py` comprueba las superficies conectadas, los pesos y el rig desde Blender. La comparación de rendimiento conserva tres ejecuciones por modelo; `node scripts/compare-model-performance.mjs <commit-original> catalogo` calcula la mediana de los p95 guardados en `review/catalogo/performance/` y actualiza `performance-comparison.json`.

La revisión de ergonomía está en `/assets/motocross/review/ergonomia/index.html`: compara Esencial neutro con la versión 2 preservada, incluyendo asiento sin piloto, contacto de pelvis y transparencias. La nueva base recalibra las posiciones del rig visual, conservando los 15 nombres, jerarquía y contactos de manos/pies. El generador escribe la misma definición en `assets/motocross/rig.json` y `src/bike-rig.json`. Asiento y plásticos siguen la suspensión; la recuperación eleva y desplaza la pierna por fuera del cuerpo de la moto. El acabado final de las familias queda pendiente de esta revisión visual.

```powershell
node scripts/review-model-quality.mjs volumen-pelvis --neutral --poses-json --sweep --clearance-families
& 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' --background assets/motocross/motocross.blend --python-exit-code 1 --python scripts/check-motocross-topology.py -- --stage=volumen-pelvis
& 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' --background --factory-startup --python-exit-code 1 --python scripts/check-rider-clearance.py -- --stage=volumen-pelvis
```

El barrido comprueba cruces de triángulos, vértices contenidos y distancia de apoyo entre pantalón/torso/botas y asiento/carenado. Incluye todas sus parejas de variantes en High y Low y cada fotograma entero del rodado y montaje, además de conducción, giro, vuelo y aterrizaje. No sustituye la revisión visual ni constituye una prueba de colisión contra todas las piezas mecánicas. El JSON comprimido de geometría se regenera y queda fuera de Git; `clearance.json` conserva los resultados.

Para comparar el rendimiento con la versión 2, `MODEL_BENCHMARK_MODELS=assets/motocross/review/ergonomia/baseline` y `MODEL_BENCHMARK_RUNTIME=/assets/motocross/review/ergonomia/baseline/benchmark-bike-model.ts` seleccionan sus GLB, código visual y rig preservados. Ejecutar `tests/e2e/performance.spec.ts --repeat-each=3` por separado para referencia y candidato, guardando cada grupo con `MODEL_BENCHMARK_OUTPUT` en `review/ergonomia/performance/baseline` o `candidate`; quitar ambos overrides para el candidato. `node scripts/compare-model-performance.mjs connected-families-v2-snapshot ergonomia` compara sus medianas. El adaptador `benchmark-bike-model.ts` solo cambia las rutas de importación del archivo preservado; no altera sus cálculos.

La corrección posterior de glúteos y muslos se revisa en `/assets/motocross/review/volumen-pelvis/index.html`, con comparación en color y neutro centrada en la vista posterior. Conserva el asiento y altura aprobados y cambia solo el pantalón: secciones posteriores redondeadas, muslos con espesor y una transición interna que apoya sobre la espuma. `approved-parts.json` verifica que las otras 100 mallas, el rig y el runtime son idénticos a la referencia. Las pruebas incluyen el espesor sagital de ambos glúteos y muslos y el contacto durante todo el recorrido de suspensión. Para este benchmark, basta `MODEL_BENCHMARK_MODELS=assets/motocross/review/volumen-pelvis/baseline` en la referencia; el código visual coincide con el candidato. Las tres ejecuciones de cada versión y sus medianas quedan en `review/volumen-pelvis/performance/`.

La revisión de anatomía se encuentra en `/assets/motocross/review/anatomia/index.html`. Sustituye la unión plana de pelvis y muslos por una superficie fusionada y suavizada en Blender, con cortes comunes en cintura y botas y una cavidad medial de apoyo. Mantiene el asiento y altura aprobados; reduce ligeramente la apertura de rodillas y redistribuye la elevación de cadera y pierna durante la recuperación. Low reserva más geometría para el pantalón y simplifica el relieve fino de las ruedas.

`node scripts/review-model-quality.mjs anatomia --poses-json --sweep --clearance-families` captura esta revisión. Ambos comprobadores de Blender admiten `-- --stage=anatomia`. El control de poses detecta también auto-intersecciones del pantalón; las pruebas de apoyo muestrean seis puntos de la superficie independientemente de los vértices de cada LOD. El benchmark usa los modelos de `review/anatomia/baseline` y su `benchmark-bike-model.ts`, porque esta revisión ajusta el rig visual. La galería conserva la revisión anterior y permite comparar color, volumen neutro y tres cuartos posterior.

La corrección de los bultos posteriores se revisa en `/assets/motocross/review/cadera-natural/index.html`. Una única envolvente de cadera sustituye los dos volúmenes glúteos; el muslo se afina gradualmente hacia la rodilla. Las pruebas acotan el grosor de glúteos y muslos y comprueban que no aparezcan lóbulos salientes en el contorno posterior. Se conserva el rig, el runtime y las otras 100 mallas. Los pesos de la cara interna del muslo distribuyen la flexión sin fijarla excesivamente a la pelvis; los cortes de pintura de la rodilla atraviesan las caras adyacentes para evitar uniones que se abran al deformarse. La galería y los comprobadores usan `cadera-natural` como etiqueta; el benchmark requiere sólo los GLB de su carpeta `baseline` porque el código visual coincide.

Los límites se aplican a la combinación de piezas más costosa: Low hasta 8.000 triángulos; High con objetivo de 24.000 y máximo de 30.000 sujeto a la comparación de rendimiento. El manifiesto conserva el conteo del conjunto Esencial y añade `trianglesSelectedMax`. Se mantienen los IDs de piezas, los nombres del rig y los formatos de datos.

## Publicar en GitHub Pages

1. Crear un repositorio vacío en GitHub, sin README, licencia ni `.gitignore` iniciales. Pages debe estar disponible para su visibilidad y plan.
2. Conectar este repositorio y subir **solo `main`** (si `origin` ya está configurado, omitir `git remote add`):

   ```sh
   git remote add origin https://github.com/Canni-DEV/motoneta.git
   git push -u origin main
   ```

3. En GitHub, abrir **Settings → Pages → Build and deployment → Source** y elegir **GitHub Actions**.
4. Abrir **Actions → Deploy MotoNeta to GitHub Pages → Run workflow**, seleccionar `main` y ejecutar. Si el primer intento empezó antes de habilitar Pages, ejecutar el workflow otra vez después del paso anterior.
5. La URL publicada aparece en el entorno `github-pages` y en Settings → Pages. Los siguientes pushes a `main` publican automáticamente.

El workflow instala con `npm ci`, comprueba TypeScript, compila y publica únicamente `dist/`. Usa el token automático de GitHub; no requiere un PAT ni secretos adicionales. La ruta base se obtiene de Pages: funciona tanto en `https://USUARIO.github.io/REPO/` como en la raíz de un sitio o en un dominio personalizado configurado en Pages. No hay que escribir el nombre del repositorio en el código. Tras cambiar el dominio o la configuración de Pages, ejecutar el workflow de nuevo.

La configuración sigue las guías de [Vite para GitHub Pages](https://vite.dev/guide/static-deploy.html#github-pages) y [workflows de GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

## Contenido del repositorio

- `src/`: código del juego y datos de los circuitos.
- `public/`: assets que carga el juego, incluida la licencia de las fuentes.
- `.github/workflows/deploy.yml`: compilación y publicación.
- Archivos raíz: entrada HTML, configuración, dependencias fijadas, `.gitignore` y este README.
- `tests/`, `scripts/` y `assets/motocross/`: pruebas, herramientas y fuentes del modelo agregadas explícitamente para revisar la implementación.
- `docs/24-motoneta.md` y sus evidencias: documentación de trabajo de MotoNeta incluida en esta rama.

El resto de la documentación de trabajo, capturas y originales de audio se conservan localmente y quedan fuera de Git. `main` tiene un historial de publicación limpio. Las ramas locales anteriores conservan el historial de desarrollo: no usar `git push --all` ni `git push --mirror` para publicar este proyecto.

## Créditos

MotoNeta es una implementación propia inspirada en Excitebike (Nintendo, 1984). No se distribuyen ROM, sprites ni audio extraídos del juego original. Modelos y síntesis de motores, rodadura, viento y señales: originales del proyecto.

- Fuentes **Barlow**, Copyright 2017 The Barlow Project Authors: [SIL Open Font License 1.1](public/fonts/OFL.txt), incluida con las fuentes.
- Impactos e interfaz: [Kenney Impact Sounds](https://kenney.nl/assets/impact-sounds) y [Interface Sounds](https://kenney.nl/assets/interface-sounds), [CC0](https://creativecommons.org/publicdomain/zero/1.0/). Selección, filtrado, edición y mezcla propios.
- Público: [Free Crowd Cheering Sounds — Gregor Quendel](https://opengameart.org/content/free-crowd-cheering-sounds), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Extractos 04, 05, 06 y 10, filtrados, normalizados y adaptados a bucles en `crowd.wav` y `cheer-0.wav` a `cheer-2.wav`. El uso no implica respaldo del autor.
- Lluvia: [AMB Rain Loop 2 — Kresiek The Furry](https://opengameart.org/content/amb-rain-loop-2), CC0. Extracto filtrado, normalizado y adaptado a bucle.
- Música de menú, editor y resultados: archivos aportados desde Suno, preparados para bucles, con arreglos basados en el motivo de Excitebike. No se atribuye CC0 ni CC BY a estos temas.
