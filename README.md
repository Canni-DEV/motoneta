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

También hay controles táctiles, gamepad y teclas reasignables. Las rampas producen los saltos y los sectores mojados con aspersores enfrían el motor.

Carrera rápida muestra tu récord para la pista, vueltas, cantidad de rivales y dificultad elegidas. Activá “Correr contra mi fantasma” para competir contra tu mejor carrera: al completar cada vuelta verás la diferencia de esa vuelta y la acumulada, con el detalle final en resultados. La elección se conserva mientras el juego está abierto y cada nuevo intento usa la mejor marca disponible.

Dentro de Torneo podés elegir el Torneo personalizado o el **Torneo Motoneta**: cinco pistas oficiales, dos vueltas y tres bots en Difícil, con horarios y climas fijos. Ganar la clasificación general (también con un empate exacto en el primer puesto) desbloquea la scooter clásica para ese perfil. El intento se guarda después de cada carrera y puede continuarse desde Inicio; empezar otro intento conserva la recompensa obtenida. Abandonar una carrera suma cero puntos.

El garaje permite equipar Motocross o Motoneta al guardar, con seis piezas y dos colores por pieza. Las configuraciones de cada moto son independientes y el piloto es compartido; Cancelar descarta la edición. La Motoneta bloqueada permite verla en 3D y muestra el requisito. Ambos vehículos tienen la misma física y sonido, comparten marcas y conservan su apariencia original en repeticiones y fantasmas.

Obtener la Motoneta habilita el **Torneo Tanque**: cinco pistas largas de 6144 unidades, dos vueltas y tres bots en Difícil. Las pistas se generan por fecha de Argentina, con 0, 1, 1, 2 y 2 loops en orden diario variable, y cubren mañana, tarde, noche, despejado, lluvia y nieve. A medianoche de Argentina cambia el calendario de nuevos intentos; los intentos pendientes conservan sus cinco pistas, condiciones y resultados. Todos los perfiles reciben el mismo calendario para esa fecha y versión del juego. Se permiten reintentos ilimitados, con las mismas reglas de puntos y desempate de Motoneta. Se usa el reloj del dispositivo, sin servidor.

Ganar el campeonato desbloquea el **Tanque**, una scooter inspirada en la Yamaha Axis de la referencia, para ese perfil. Su carrocería es fija y se personaliza con un color principal y uno secundario; asiento, piso, neumáticos y metales conservan sus materiales. El piloto mantiene sus piezas y colores compartidos. El premio abre el garaje con el Tanque seleccionado y se equipa al Guardar. Los tres vehículos comparten física, sonido y récords; repeticiones y fantasmas conservan su vehículo y colores originales. Los guardados de formato 3 existentes incorporan el Tanque bloqueado sin perder datos.

Las repeticiones pueden verse con cámaras cinematográficas y el tema de resultados. En Inicio, tras 60 segundos de inactividad en un equipo no móvil, se reproducen automáticamente las marcas del perfil activo; Escape vuelve al menú. Esta opción se puede desactivar en Ajustes → Interfaz.

Las caídas conservan la inercia de la moto: puede rodar hasta salir de una rampa, mientras el conductor se reincorpora y vuelve a montarla.

El editor incluye **T · Loop**, con entrada automática desde el piso del carril 4 y salida elevada sobre los carriles 1 y 2. La cinta se ensancha gradualmente durante la subida y conserva dos carriles hasta el despegue. Hay que seguirla usando ↑ y ↓: conservan su dirección hacia los carriles 1 y 4 aun cabeza abajo. Se puede completar manteniendo A a velocidad normal; salir del camino o perder contacto permite corregir la moto en el aire. Recorrer toda la cinta otorga un impulso mayor que la superrampa, que B conserva. Los otros tres carriles permiten circular por debajo.

El loop tiene dimensiones fijas y solo permite cambiar su posición longitudinal. El editor rechaza piezas elevadas superpuestas, protege la meta y avisa si hay piezas en la zona de aterrizaje. El generador reserva primero la cantidad independiente de loops y sus espacios de aproximación y salida; los valores iniciales son 0, 1 y 2 para Fácil, Normal y Difícil. Una cantidad superior a la capacidad de la longitud elegida muestra un error.

La geometría del loop usa versión 2, registrada en los cursos y repeticiones que incluyen la pieza. Al cargar el guardado se retiran solo los récords, repeticiones y competencias con una geometría de loop incompatible. Se conservan perfiles, desbloqueos, mapas, borrador y datos de circuitos sin loops. Los mapas existentes usan la salida nueva; las repeticiones anteriores con loops se rechazan al importar.

Esta versión usa archivos de formato **4**, reglas **`motoneta-4`**, generador **3** y almacenamiento **5**. Migra mapas y borradores de formato 3 conservando perfiles, vehículos, personalización y preferencias. Una transacción atómica retira marcas, fantasmas, repeticiones y competencias anteriores; el menú anuncia una sola vez la nueva etapa de marcas. Las repeticiones antiguas se rechazan al importar. Los guardados de desarrollo anteriores al formato 3 mantienen su política de reinicio.

Los cinco modificadores planos tienen contornos irregulares deterministas, compartidos entre imagen y física. Carriles contiguos forman una mancha; los separados forman islas. Las cinco pistas oficiales conservan sus posiciones, longitudes, carriles y obstáculos.

| Terreno | Velocidad respecto de tierra | Aceleración | Particularidad |
| --- | --- | --- | --- |
| Barro | 65 % | 70 % | Surcos húmedos, terrones y pequeñas acumulaciones de agua |
| Césped | 90 % | 90 % | Matas agrupadas y rodadas aplastadas |
| Aspersores | 100 % | 100 % | Temperatura cero y recuperación del motor una vez por entrada |
| U · Arena | 80 % | 50 % | Huellas hundidas, dunas bajas y polvo fino |
| V · Grava | 100 % | 100 % | Cambio de carril al 60 %, piedras y sonido granular |

Los factores se aplican a aceleración normal y turbo únicamente en contacto con el suelo. La reducción hasta el límite de velocidad es gradual, con un máximo de 0,08 unidades por cuadro. El caballito elimina el 40 % de la penalización de velocidad y aceleración; conserva la resistencia lateral de la grava. El clima cambia la apariencia y cobertura, con la misma física. No hay caídas aleatorias ni avisos nuevos durante la carrera.

El editor muestra efectos y contornos, incorpora arena y grava sobre cuatro carriles, y permite **Cambiar variante** con deshacer/rehacer. Mover, duplicar y redimensionar conservan la variante. El generador incorpora pesos de césped, arena y grava de 5, 10 y 15 para Fácil, Normal y Difícil; conserva los demás pesos y las reservas de loops. Torneo Tanque usa el generador nuevo, con calendario versión 2.

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

## Validación local y rendimiento

```sh
npm run typecheck
npm test
npm run build
```

`typecheck` comprueba también las pruebas y sus configuraciones. TypeScript detecta símbolos sin uso; se mantienen las dependencias y el workflow de publicación actuales.

`tests/terrain.test.ts` comprueba contornos, triangulación, cruces entre cuadros y vueltas, balance, caballitos, aterrizajes, enfriamiento, generación y repeticiones. `tests/e2e/terrain.spec.ts` verifica migración atómica con fallos inyectados, conservación de perfiles, aviso único, variantes y exportación. Las referencias físicas de reglas anteriores se conservan en `tests/fixtures/motoneta-physics.json`; las referencias nuevas están en `tests/fixtures/motoneta-4-physics.json`. `node scripts/capture-terrain-physics.mjs` regenera solamente las nuevas, después de validar las reglas.

Con Vite en el puerto 5173 y Chromium instalado, `node scripts/review-terrain.mjs` guarda en `tmp/terrain/review/` una galería de escritorio y móvil horizontal, High/Low, tres horarios y tres climas, y verifica estabilidad de contornos. Los materiales son procedurales y los detalles se agrupan por instancias o geometría combinada, sin luces ni pases nuevos. `npm run audio:terrain` reproduce los cuatro sonidos originales de arena y grava; su manifiesto y hashes están en `src/audio/terrain-manifest.json`.

`node scripts/compare-terrain-resources.mjs` compara una escena equivalente con seis motos entre Vite de referencia (puerto 5175) y la versión actual (5173), incluyendo reconstrucciones repetidas para detectar recursos que no se liberan. La referencia necesita el código, `public/` y el manifiesto original del loop; los dos materiales nuevos se añaden solamente al candidato. Estima bytes de atributos y texturas RGBA con mipmaps, excluyendo los destinos de postprocesado comunes y el consumo interno del controlador. El resultado queda en `tmp/terrain/resources/comparison.json`.

La renovación de terrenos se comparó con `9ae671e` en el Core Ultra 7 265 y la RTX 5070 Ti, con tres muestras de 30 segundos por escenario y versión. La pasada final sostuvo aproximadamente 60 FPS, con p95 de cuadro de 16,7–16,8 ms; los bytes estimados de recursos aumentaron un 4,6 % y permanecieron estables al reconstruir el circuito. El objetivo del 10 % se cumple para esos dos indicadores. La CPU presenta una limitación: la mediana de sus tres p95 en High despejado pasó de 5,0 a 7,9 ms (+58 %), aunque su mediana habitual pasó de 2,9 a 3,0 ms. Low despejado pasó de 4,9 a 4,1 ms, Low lluvia de 4,4 a 4,5 ms y High lluvia de 8,3 a 5,5 ms. Se conservan las muestras iniciales y finales, los cuadros largos y los diagnósticos con posiciones equivalentes en [el informe de terrenos](tests/benchmarks/terrain-performance.json). La pantalla de 60 Hz puede ocultar diferencias de margen; no se afirma una regresión de CPU inferior al 10 % ni se midieron teléfonos físicos.

Las pruebas de `tests/loop.test.ts` verifican el manejo manual, impulso, vuelo, estructura sólida, choques, progreso y repeticiones con las tres dificultades. `tests/e2e/loop.spec.ts` recorre editor, generador, reinicio del guardado anterior y limpieza selectiva de resultados con geometrías de loop incompatibles. `node scripts/review-loop-integration.mjs` captura poses de la simulación en el renderer del juego y valida el GLB; el modelo se regenera con Blender ejecutando `scripts/build-loop-prototype.py`. El manifiesto compartido define recorrido, marcos locales, límites y soportes tanto para física como para render.

Las pruebas de navegador pueden seleccionarse según el cambio. Por ejemplo, `npm run test:e2e -- tests/e2e/game.spec.ts tests/e2e/persistence.spec.ts` comprueba controles, editor y guardado. `npm run test:compat -- tests/e2e/ui-compat.spec.ts` realiza una comprobación breve con Firefox y WebKit; este último aproxima Safari, sin sustituir una prueba en iPhone.

Si faltan los navegadores, preparar sus versiones con Playwright. Para conservar los binarios de compatibilidad dentro del proyecto, en PowerShell:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = "$PWD\tmp\playwright-browsers"
node node_modules/playwright/cli.js install firefox webkit
npm run test:compat -- tests/e2e/ui-compat.spec.ts
Remove-Item Env:\PLAYWRIGHT_BROWSERS_PATH
```

El ensayo de rendimiento usa la compilación de producción, FullHD, cinco rivales y los efectos predeterminados. Compara High/Low de día despejado y de noche con lluvia, con cinco segundos de calentamiento y tres muestras de treinta segundos por escenario:

```sh
npm run build
npm run benchmark:runtime -- --label=candidate
```

El script sirve `dist/` temporalmente en el puerto 4174, abre un contexto limpio por muestra y guarda los resultados en `tmp/refactor/candidate-gpu.json`. Registra el equipo, la GPU, los tiempos de cuadro, los cuadros largos y el tiempo de CPU de los callbacks de animación; este último incluye la presentación de comandos gráficos, pero no mide el tiempo de ejecución de la GPU. Rechaza el renderizado por software y las GPU que no puede identificar. La configuración D3D11 está destinada a Windows.

Para comparar otra compilación, usar `--directory=RUTA --label=baseline`. Ejecutar referencia y candidato secuencialmente, evitando otros ensayos gráficos simultáneos. En una pantalla limitada a 60 Hz puede bajar el trabajo de CPU sin aumentar los FPS. El benchmark existente de `tests/e2e/performance.spec.ts` se conserva por separado como control de estabilidad de recursos con renderizado por software.

La refactorización del 3 de octubre de 2026 se comparó con `b556637` en un Core Ultra 7 265 y una RTX 5070 Ti. La mediana de los tres p95 de CPU pasó de 3,2 a 3,0 ms en Low despejado; de 4,5 a 3,6 ms en Low con lluvia nocturna; de 4,7 a 3,5 ms en High despejado; y de 5,2 a 3,6 ms en High con lluvia nocturna. Ambos grupos sostuvieron aproximadamente 60 FPS, sin cuadros de más de 33,4 ms en las muestras. Son mediciones locales con variación entre corridas: la mediana de CPU de Low con lluvia subió de 2,2 a 2,4 ms aunque mejoró su p95. No se midió la notebook Ryzen 5 ni un teléfono físico. Los resultados por muestra y la metodología se conservan en [el informe de rendimiento](tests/benchmarks/refactor-performance.json).

## Modelos 3D

La fuente reproducible es `scripts/build-motocross.py`, para Blender 5.2.2 LTS. Reconstruye el archivo editable, ambos GLB y el manifiesto; las ediciones manuales del `.blend` deben trasladarse al generador antes de regenerarlo.

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' --background --factory-startup --python-exit-code 1 --python scripts/build-motocross.py
# Añadir -- --render --render-all para las vistas de estudio de las tres familias y ambas calidades.
npm run models:validate
```

La scooter usa el mismo generador con un objetivo separado, después de aprobar Esencial a partir de la referencia del usuario. Sus archivos editables, rig y manifiesto están en `assets/motoneta/`, y el juego carga `motoneta-high.glb` y `motoneta-low.glb` junto con los dos modelos de motocross y el estadio antes de habilitar el menú.

El objetivo `--vehicle=tanque` genera el modelo fijo del Tanque en `assets/tanque/` y sus GLB High/Low en `public/models/`. Las referencias fotográfica, de modelado, de frente/atrás/lateral y la comparación del usuario se conservan en `assets/tanque/concepts/`. La revisión `classic-scooter-reference-v5` conserva el frente inclinado y añade nervaduras continuas en V, chaflanes, una punta con borde redondeado y aletas inferiores más estrechas. El guardabarros tiene una corona más plana, hombros definidos y esquinas frontales redondeadas. La toma de aire queda al ras y los tres tornillos siguen la distribución triangular de la captura. Sus paneles inferiores continúan hasta el piso. Modela los pliegues diagonales y el receso del lateral, un asiento con techo plano y bordes moldeados, faro con lente translúcida y reflector interior, espejos, portaequipajes y ruedas de tres radios, sin logos ni letras. El piso y el zócalo usan plástico mate neutro, independiente de la pintura. Conserva los centros de ruedas, contactos de manos/pies y jerarquía de 15 huesos de Motoneta, con una posición sentada ajustada al asiento del Tanque. Incluye todas las opciones compartidas del piloto y limita la combinación visible a 8000 triángulos Low y 24 000 High. Los seis GLB de vehículos se cargan antes de habilitar carreras y garaje.

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' --background --factory-startup --python-exit-code 1 --python scripts/build-motocross.py -- --vehicle=tanque
& 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' --background assets/tanque/tanque.blend --python-exit-code 1 --python scripts/check-motoneta-model.py -- --vehicle=tanque
npm run models:validate
# Con Vite activo:
npm run models:review:tanque -- 5ce238a
npm run models:benchmark:tanque -- <commit-de-referencia>
# Comparar el frente nuevo con el Tanque del checkpoint anterior:
npm run models:benchmark:tanque -- 5ce238a tanque
```

La revisión visual captura ambos modelos, frente, atrás, lateral y ambas perspectivas sin piloto, las tres familias del piloto, repintado, conducción, salto, caída, reincorporación, faro nocturno y fantasma. Si se pasa un commit, añade primeros planos del frente anterior y actual con la misma cámara e iluminación. El piso y los paneles acompañan la suspensión como una sola carrocería; el reflector se ilumina detrás de la lente y los fantasmas no emiten luz. `assets/tanque/reproducibility.json` compara los hashes de dos exportaciones consecutivas de GLB, manifiesto y rig. El benchmark compara el Tanque con la Motoneta del commit de referencia por defecto; agregar `tanque` después del commit permite comparar con una revisión anterior del Tanque. Usa seis pilotos y cinco fantasmas, High/Low y dos condiciones ambientales en la misma GPU. Registra p95 de CPU de render y presentación de comandos, sin sincronizar ni medir el tiempo de ejecución de la GPU; la regresión máxima admitida es del 10 %. El informe, los hashes del candidato y las muestras quedan en `assets/tanque/performance-comparison.json`.

La revisión frontal v5 se comparó con `5ce238a` usando el Tanque anterior en la misma RTX 5070 Ti. Las muestras iniciales de 10 segundos quedaron dentro del objetivo en Low despejado, Low lluvia y High lluvia; High despejado registró una subida del 13,70 %. Una comprobación de High despejado con tres muestras de 30 segundos, calentamiento de 6 segundos y orden alternado dio 5,7 ms para ambas versiones, sin cambios de geometría ni runtime entre mediciones. Se conservan [el informe inicial completo](assets/tanque/performance-initial-v5.json) y [la comprobación prolongada](assets/tanque/performance-high-confirmation.json); el informe principal identifica la duración y procedencia de cada comparación. No se midió rendimiento en teléfonos físicos.

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' --background --factory-startup --python-exit-code 1 --python scripts/build-motocross.py -- --vehicle=motoneta
# Con Vite activo:
npm run models:review:motoneta
npm run models:benchmark:motoneta -- <commit-de-referencia>
& 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' --background --factory-startup assets/motoneta/motoneta.blend --python-exit-code 1 --python scripts/check-motoneta-model.py
```

Las capturas de Esencial, Competición, Travesía, ambas calidades, saltos y recuperación quedan en `assets/motoneta/review/essential/index.html`. `assets/motoneta/performance-comparison.json` registra tres corridas comparables con seis pilotos y cinco fantasmas, escritorio y móvil horizontal emulado, usando Chromium/SwiftShader; mide el p95 de render y la estabilidad de recursos y no reemplaza una medición en teléfonos físicos.

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
