# MotoNeta: identidad, contratos y refactor

MotoNeta es el nombre del proyecto. El logo se escribe **MOTONETA**, con `MOTO` y `NETA` en los dos colores de la interfaz, y el favicon usa el monograma MN. Excitebike identifica exclusivamente al juego original de Nintendo en las fuentes y atribuciones; no se alteraron esas referencias.

## Identidad compartida

`src/identity.json` define identificador, nombre y palabras del logo. `src/identity.ts` deriva título, logo, almacenamiento, depuración y nombres de descarga. Vite sustituye el título HTML en desarrollo y producción. Las herramientas de revisión leen la misma identidad mediante `scripts/game-identity.mjs`.

El paquete npm se llama `motoneta`; no se actualizaron dependencias ni se cambió la carpeta local. `window.__motoneta` existe solo en desarrollo. El header, los diálogos, los carteles 3D y la página de audio consumen la identidad compartida.

## Datos y archivos vigentes

Los ajustes se guardan en `motoneta.settings.v2`. IndexedDB `motoneta-game`, versión 2, conserva perfiles, mapas, marcas, competiciones, borrador y repeticiones. La actualización desde versión 1 vacía los datos de carrera y creación locales; el ajuste anterior se elimina. Las escrituras mantienen atomicidad, rollback, cola e idempotencia.

Mapas, repeticiones y respaldos llevan `game: "motoneta"` y `version: 1`. Las repeticiones nuevas usan `ruleset: "motoneta-2"`. Es el único contrato aceptado: no hay conversores, aliases ni lectores de versiones anteriores. Un archivo incompatible muestra un error sin reemplazar el mapa ni iniciar una repetición.

Las descargas son `motoneta-datos.json`, `motoneta-repeticion.json` y `motoneta-mapa-<nombre>.json`. El nombre del mapa se normaliza a minúsculas sin diacríticos, con guiones entre grupos alfanuméricos; un nombre sin caracteres utilizables produce `motoneta-mapa-circuito.json`. La exportación de respaldo conserva el alcance previo; no se añadió un importador de respaldos.

## Motor y ajustes

La carrera actual usa `Race`, `createRace`, `stepRace` y `Recording`. Se eliminaron clasificatorias, progresión antigua, modos A/B, diseños por separación, repeticiones anteriores y marcas heredadas. Tus marcas muestra directamente los registros actuales. Los helpers compartidos de conducción, terreno, choque y presentación siguen vigentes.

La configuración de efectos usa `vfx.race`, `vfx.tracks`, `vfx.ambient` e intensidad. El volumen de interfaz usa `audioLevels.ui`. Se retiraron `particles`, `uiSounds` y sus migraciones de ajustes; los campos internos que describen partículas gráficas no son preferencias antiguas.

## Verificación y evidencias

Antes de modificar la física se capturaron diez carreras completas: cinco circuitos, con cero y cinco bots, semilla 1984 y entradas fijas. `tests/fixtures/motoneta-physics.json` conserva hashes de trazas y resultados. `tests/physics-regression.test.ts` y `node scripts/check-audio-physics.mjs` comparan el motor actual con esa referencia, sin ejecutar un motor retirado.

Las pruebas vigentes cubren los contratos, la persistencia, el rechazo de archivos incompatibles, los nombres de descarga y las carreras y herramientas actuales. La distribución bajo una subcarpeta se comprueba con `node scripts/check-motoneta-production.mjs` después de `npm run build`.

Las capturas, videos y mediciones anteriores de `docs/media/` se conservan como evidencia histórica, sin retoques ni sobrescritura. Las evidencias actuales se guardan en `docs/media/motoneta/`.

Las herramientas de revisión derivan esa carpeta de la identidad compartida. Sus salidas predeterminadas ya no reemplazan las evidencias históricas. Las pruebas de audio guardan las nuevas capturas y mediciones en `test-results/`. Capturas actuales:

- [Inicio en escritorio](media/motoneta/motoneta-inicio-escritorio.png)
- [Inicio móvil horizontal](media/motoneta/motoneta-inicio-movil.png)
- [Ancho mínimo](media/motoneta/motoneta-inicio-minimo.png)
- [Estadio](media/motoneta/motoneta-estadio.png)
- [Página de audio](media/motoneta/motoneta-audio.png)
- [Icono MN](media/motoneta/motoneta-icono.png)
- [Comprobación de producción](media/motoneta/motoneta-production.json)

Resultados del 28/09/2026:

- `npm test`: 154 pruebas aprobadas, incluidas las diez comparaciones contra las trazas previas.
- `npm run test:e2e`: 63 recorridos aprobados en Chromium. Tras la última limpieza de nombres internos del editor, se repitieron únicamente sus dos recorridos afectados; ambos aprobaron.
- `npm run build`, `npm run format:check` y `git diff --check`: aprobados.
- `node scripts/check-motoneta-production.mjs`: aprobado bajo `/preview/`, sin errores de recursos ni API de depuración. Capturas revisadas en escritorio, móvil horizontal, estadio y audio.
- La revisión de compatibilidad se redujo a `npm run test:compat -- tests/e2e/motoneta.spec.ts` tras revisar con el usuario el alcance de las pruebas. Se canceló mientras Firefox permanecía en el arranque, sin completar ningún caso. No se afirma validación de Firefox/WebKit para este refactor; la matriz completa quedó sin ejecutar.

La búsqueda final de `excite` conserva únicamente fuentes, atribuciones del original y evidencias históricas. No se modificaron archivos de evidencias anteriores ni dependencias npm.
