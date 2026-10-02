---
name: motoneta-3d
description: Produce and validate new MotoNeta motorcycle and rider variants with Blender 5.2.2 LTS, preserving the physics and rig contracts.
---

# MotoNeta: piezas 3D

## Contrato visual

- Usar el concepto aprobado en `assets/motocross/concepts/competition-fluid.png`: silueta de competición fluida, paneles de curvas continuas, biseles coherentes y detalles legibles tanto lejos como en las repeticiones.
- Mantener +X hacia delante, +Y arriba y +Z a la izquierda en glTF. No mover centros de ruedas, contacto de manos/pies, 15 huesos ni nodos requeridos por `src/bike-model.ts`.
- Cada categoría de `src/appearance.ts` debe tener `core`, `sprint` y `trail`, bajo nombres `Slot_<slot>_<variant>`; guardabarros y ruedas contienen pares frontal/trasero. Cada pieza debe contener canales primario y acento y combinar con las otras sin intersecciones visibles. Un solo material por pieza y colores de vértice con alfa 0, 0.5 o 1 codifican primario, acento o neutro; el runtime clona la geometría y aplica los colores del perfil.
- Cambios de apariencia solo en render. No modificar `src/core/racing.ts` ni trazas físicas por razones estéticas.

## Producción reproducible

1. Editar `scripts/build-motocross.py`, que es la fuente. Usar Blender 5.2.2 LTS en modo background: `blender --background --factory-startup --python scripts/build-motocross.py`. El script guarda `assets/motocross/motocross.blend`, los GLB High/Low y `assets/motocross/manifest.json`.
2. Inspeccionar el `.blend` en Blender o Blender Lab MCP. Si se ajusta algo en la interfaz o por MCP, trasladar las coordenadas y reglas al script, regenerar y comprobar que el resultado coincide. El `.blend` no es la fuente de verdad. El script conecta `Palette` al shader solo después de exportar los GLB, para que la escena fuente muestre los colores sin aumentar el coste del juego.
3. Mantener los pivotes del manifiesto y pintar con materiales PBR de roughness coherente. Preservar la jerarquía de huesos, grupos de vértices y vértices ponderados. Revisar la sombra y el volumen en lateral, frontal y tres cuartos.
4. Revisar la pieza nueva con todas las opciones del slot opuesto en el garaje. Usar la matriz de pares para detectar interferencias, luego comprobar caída, casco, fantasmas y primer plano de repetición.
5. Ejecutar build y pruebas del repositorio, `npm run models:validate` sobre ambos GLB, y comprobar triángulos de una combinación activa en el manifiesto. Metas: Low ≤ 8.000 y High ≤ 24.000. Medir p95 con seis pilotos y cinco fantasmas frente a la referencia, en el mismo equipo y condiciones; guardar método y resultados en `assets/motocross/performance-comparison.json`.

## Notas de exportación

- El catálogo completo va incluido en cada GLB; el runtime oculta las opciones no elegidas. `trianglesSelected` mide geometría dibujada para una combinación, `trianglesCatalog` mide el archivo entero.
- Los IDs se persisten en perfiles y repeticiones. Renombrar o quitar un ID requiere migración explícita del formato. Para esta entrega el formato v2 reinicia los datos v1.
- No añadir texturas externas ni dependencias del equipo del autor sin incorporarlas al repositorio y revisar licencias.
