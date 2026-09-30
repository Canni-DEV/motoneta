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
