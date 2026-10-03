import { describe, expect, it } from 'vitest';
import { Box2, Box3, OrthographicCamera, PerspectiveCamera, Vector2, Vector3 } from 'three';
import { advanceGhostOpacity, ghostOverlapOpacity, projectGhostBounds } from '../src/ghost-visibility';

const rect = (x: number, y: number, width = 1, height = 1) =>
  new Box2(new Vector2(x, y), new Vector2(x + width, y + height));

describe('ghost coverage', () => {
  it('keeps separated, touching, empty and zero-area envelopes at normal opacity', () => {
    for (const ghost of [rect(2, 0), rect(1, 0), new Box2(), rect(0, 0, 0)])
      expect(ghostOverlapOpacity(rect(0, 0), ghost)).toBe(0.35);
  });
  it('smoothly fades partial coverage and saturates at half coverage', () => {
    expect(ghostOverlapOpacity(rect(0, 0), rect(0.75, 0))).toBeCloseTo(0.225);
    expect(ghostOverlapOpacity(rect(0, 0), rect(0.5, 0))).toBeCloseTo(0.1);
    expect(ghostOverlapOpacity(rect(0, 0), rect(0, 0))).toBeCloseTo(0.1);
    expect(ghostOverlapOpacity(rect(0, 0), rect(0.9, 0))).toBeGreaterThan(0.225);
  });
  it('normalizes to the smaller visible model and is symmetric', () => {
    expect(ghostOverlapOpacity(rect(0, 0), rect(0.25, 0.25, 0.25, 0.25))).toBeCloseTo(0.1);
    expect(ghostOverlapOpacity(rect(0, 0), rect(0.8, 0.1, 0.5, 0.5))).toBeCloseTo(
      ghostOverlapOpacity(rect(0.8, 0.1, 0.5, 0.5), rect(0, 0)),
    );
  });
});

describe('ghost transitions', () => {
  it.each([20, 30, 60, 144])('respects elapsed time at %i fps', (fps) => {
    const advance = (start: number, target: number, duration: number) => {
      let opacity = start, time = 0;
      while (time < duration) {
        const dt = Math.min(1 / fps, duration - time);
        opacity = advanceGhostOpacity(opacity, target, dt);
        time += dt;
      }
      return opacity;
    };
    expect(advance(0.35, 0.1, 0.075)).toBeCloseTo(0.225);
    expect(advance(0.35, 0.1, 0.15)).toBe(0.1);
    expect(advance(0.1, 0.35, 0.125)).toBeCloseTo(0.225);
    expect(advance(0.1, 0.35, 0.25)).toBe(0.35);
  });
  it('stays bounded during reversals, pauses and long frames', () => {
    const faded = advanceGhostOpacity(0.35, 0.1, 0.06);
    expect(advanceGhostOpacity(faded, 0.35, 0)).toBe(faded);
    expect(advanceGhostOpacity(faded, 0.35, -1)).toBe(faded);
    expect(advanceGhostOpacity(faded, 0.35, 0.03)).toBeCloseTo(faded + 0.03);
    expect(advanceGhostOpacity(1, -1, 2)).toBe(0.1);
    expect(advanceGhostOpacity(-1, 1, 2)).toBe(0.35);
  });
});

describe('screen projection', () => {
  it.each(['orthographic', 'perspective'])('uses the active %s camera and reusable bounds', (kind) => {
    const camera = kind === 'orthographic'
      ? new OrthographicCamera(-2, 2, 2, -2, 0.1, 20)
      : new PerspectiveCamera(60, 1, 0.1, 20);
    camera.position.z = 5;
    camera.updateMatrixWorld(true);
    const target = new Box2(), scratch = new Vector3();
    const bounds = new Box3(new Vector3(-0.5, -0.5, -0.5), new Vector3(0.5, 0.5, 0.5));
    expect(projectGhostBounds(bounds, camera, target, scratch)).toBe(target);
    expect(target.containsPoint(new Vector2())).toBe(true);
    const width = target.max.x - target.min.x;
    camera.zoom = 2;
    camera.updateProjectionMatrix();
    projectGhostBounds(bounds, camera, target, scratch);
    expect(target.max.x - target.min.x).toBeCloseTo(width * 2);
    bounds.translate(new Vector3(100, 0, 0));
    expect(projectGhostBounds(bounds, camera, target, scratch).isEmpty()).toBe(true);
    bounds.translate(new Vector3(-100, 0, 100));
    expect(projectGhostBounds(bounds, camera, target, scratch).isEmpty()).toBe(true);
  });
  it('clips partial envelopes to the viewport', () => {
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.z = 5;
    camera.updateMatrixWorld(true);
    const target = projectGhostBounds(
      new Box3(new Vector3(0.5, -2, 0), new Vector3(2, 2, 1)), camera, new Box2(), new Vector3(),
    );
    expect(target.min.toArray()).toEqual([0.5, -1]);
    expect(target.max.toArray()).toEqual([1, 1]);
  });
});
