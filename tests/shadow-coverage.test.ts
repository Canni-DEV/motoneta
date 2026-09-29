import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Environment } from '../src/environment';
import { defaultSettings } from '../src/core/types';

function view(aspect: number, zoom: number, focus: number, menu = false) {
  const span = menu ? 18 : 20;
  const camera = new THREE.OrthographicCamera(
    (-span * aspect) / 2,
    (span * aspect) / 2,
    span / 2,
    -span / 2,
    0.1,
    180,
  );
  const lookX = focus + (menu ? -3 : Math.min(5, (span / zoom) * aspect * 0.14));
  camera.position.set(lookX - 6, menu ? 10.5 : 11.5, menu ? 18 : 20);
  camera.lookAt(lookX, menu ? 1 : 0.65, 0);
  camera.zoom = zoom;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  return camera;
}

describe('directional shadow coverage', () => {
  it.each(['morning', 'afternoon', 'night'] as const)(
    'covers visible receivers and offscreen casters in %s, across views and laps',
    (time) => {
      const scene = new THREE.Scene(),
        environment = new Environment(scene);
      environment.setTimeOfDay(time);
      let samples = 0,
        offscreen = 0;
      for (const aspect of [0.462, 1.6, 4])
        for (const zoom of [1, 2, 5])
          for (const focus of [-500, 0, 9000])
            for (const menu of [false, true]) {
              const camera = view(aspect, zoom, focus, menu);
              environment.update(0, focus, 18, defaultSettings, { toneMappingExposure: 1 });
              const bounds = environment.fitShadows(camera, 10);
              const light = scene.children.find(
                (o) => (o as THREE.DirectionalLight).castShadow,
              ) as THREE.DirectionalLight;
              const direction = light.position.clone().sub(light.target.position).normalize();
              const e = new THREE.Matrix4().multiplyMatrices(
                camera.projectionMatrix,
                camera.matrixWorldInverse,
              ).elements;
              for (const y of [-0.225, 0, 1.5, 4, 7.85, 10])
                for (const z of [-23, -14, -6, 0, 4, 9])
                  for (const edge of [-0.99, -0.5, 0, 0.5, 0.99]) {
                    const x = (edge - e[4] * y - e[8] * z - e[12]) / e[0];
                    const receiver = new THREE.Vector3(x, y, z);
                    if (Math.abs(receiver.clone().project(camera).y) > 1) continue;
                    const caster = receiver
                      .clone()
                      .addScaledVector(direction, (10 - y) / direction.y);
                    for (const point of [receiver, caster]) {
                      const uv = point.clone().applyMatrix4(light.shadow.matrix);
                      expect(Math.min(uv.x, uv.y, uv.z)).toBeGreaterThan(0);
                      expect(Math.max(uv.x, uv.y, uv.z)).toBeLessThan(1);
                      expect(point.x).toBeGreaterThanOrEqual(bounds.min.x - 1e-8);
                      expect(point.x).toBeLessThanOrEqual(bounds.max.x + 1e-8);
                    }
                    samples++;
                    if (Math.abs(caster.clone().project(camera).x) > 1) offscreen++;
                  }
            }
      expect(samples).toBeGreaterThan(1000);
      if (time !== 'night') expect(offscreen).toBeGreaterThan(100);
      environment.dispose();
    },
  );

  it('keeps stationary shadows aligned to texels while the rider moves', () => {
    const scene = new THREE.Scene(),
      environment = new Environment(scene);
    const point = new THREE.Vector3(12, 0, 0);
    for (const time of ['morning', 'afternoon', 'night'] as const) {
      environment.setTimeOfDay(time);
      let previous: THREE.Vector3 | undefined;
      for (const focus of [0, 0.001, 0.05, 0.4, 2, 4]) {
        environment.update(0, focus, 18, defaultSettings, { toneMappingExposure: 1 });
        const light = scene.children.find(
          (o) => (o as THREE.DirectionalLight).castShadow,
        ) as THREE.DirectionalLight;
        const direction = light.position.clone().sub(light.target.position);
        environment.fitShadows(view(1.6, 1, focus), 10);
        expect(
          light.position.clone().sub(light.target.position).distanceTo(direction),
        ).toBeLessThan(1e-10);
        const uv = point.clone().applyMatrix4(light.shadow.matrix);
        if (previous) {
          for (const axis of ['x', 'y'] as const) {
            const travel = (uv[axis] - previous[axis]) * light.shadow.mapSize[axis];
            expect(travel).toBeCloseTo(Math.round(travel), 6);
          }
        }
        previous = uv;
      }
    }
    environment.dispose();
  });

  it('fits interpolated light directions and keeps low quality free of shadow passes', () => {
    const scene = new THREE.Scene(),
      environment = new Environment(scene);
    environment.setTimeOfDay('afternoon', true);
    for (let i = 0; i < 10; i++) {
      environment.update(0.05, 15, 18, defaultSettings, { toneMappingExposure: 1 });
      environment.fitShadows(view(4, 1, 15), 15);
      const uv = new THREE.Vector3(40, 5, 0).applyMatrix4(environment.sun.shadow.matrix);
      expect(uv.z).toBeGreaterThan(0);
      expect(uv.z).toBeLessThan(1);
    }
    environment.update(
      0,
      15,
      18,
      { ...defaultSettings, quality: 'low' },
      { toneMappingExposure: 1 },
    );
    environment.fitShadows(view(4, 1, 15), 15);
    expect(scene.children.some((o) => o.castShadow)).toBe(false);
    environment.dispose();
  });
});
