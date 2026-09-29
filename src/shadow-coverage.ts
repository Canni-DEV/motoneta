import * as THREE from 'three';

/** The lit stadium and its shadow receivers, excluding the distant decorative mountains. */
const GROUND = -0.7;
const BACK = -24;
const FRONT = 10;
const PADDING = 2;

/** Fits one directional shadow map to the view, including casters outside the camera. */
export class ShadowCoverage {
  readonly receivers = new THREE.Box3();
  readonly casters = new THREE.Box3();
  private view = new THREE.Matrix4();
  private lightBounds = new THREE.Box3();
  private point = new THREE.Vector3();
  private direction = new THREE.Vector3();
  private offset = new THREE.Vector3();

  setView(camera: THREE.OrthographicCamera, top = 10) {
    camera.updateMatrixWorld();
    const e = this.view.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    ).elements;
    let min = Infinity,
      max = -Infinity;
    // Solve the horizontal edges at every corner of the stadium's height/depth envelope.
    // Unlike a radius around the rider, this also covers look-ahead, zoom and wide windows.
    for (const y of [GROUND, top])
      for (const z of [BACK, FRONT])
        for (const edge of [-1, 1]) {
          const x = (edge - e[4] * y - e[8] * z - e[12]) / e[0];
          min = Math.min(min, x);
          max = Math.max(max, x);
        }
    this.receivers.min.set(min - PADDING, GROUND, BACK);
    this.receivers.max.set(max + PADDING, top, FRONT);
    this.casters.copy(this.receivers);
  }

  fit(light: THREE.DirectionalLight) {
    this.offset.subVectors(light.position, light.target.position);
    this.direction.copy(this.offset).normalize();
    // A receiver can be shadowed by an offscreen object anywhere along this ray,
    // up to the tallest caster. Reserve that depth BEFORE positioning the light.
    const reach = (this.receivers.max.y - GROUND) / this.direction.y;
    this.casters.expandByPoint(
      this.point.copy(this.direction).multiplyScalar(reach).add(this.receivers.min),
    );
    this.casters.expandByPoint(
      this.point.copy(this.direction).multiplyScalar(reach).add(this.receivers.max),
    );
    const shadow = light.shadow,
      camera = shadow.camera;
    camera.position.set(0, 0, 0);
    camera.lookAt(this.point.copy(this.direction).negate());
    camera.updateMatrixWorld();
    this.lightBounds.makeEmpty();
    for (const x of [this.receivers.min.x, this.receivers.max.x])
      for (const y of [this.receivers.min.y, this.receivers.max.y])
        for (const z of [this.receivers.min.z, this.receivers.max.z])
          this.lightBounds.expandByPoint(
            this.point.set(x, y, z).applyMatrix4(camera.matrixWorldInverse),
          );
    const bounds = this.lightBounds;
    // Quantize the size and snap the center to texels in world light space. Panning
    // must not slide the shadow texture over stationary ramps, rails or buildings.
    const width = Math.ceil((bounds.max.x - bounds.min.x + PADDING * 2) * 16) / 16;
    const height = Math.ceil((bounds.max.y - bounds.min.y + PADDING * 2) * 16) / 16;
    const texelX = width / shadow.mapSize.x,
      texelY = height / shadow.mapSize.y;
    this.point
      .set(
        Math.round((bounds.min.x + bounds.max.x) / 2 / texelX) * texelX,
        Math.round((bounds.min.y + bounds.max.y) / 2 / texelY) * texelY,
        bounds.max.z + reach + PADDING,
      )
      .applyQuaternion(camera.quaternion);
    light.position.copy(this.point);
    light.target.position.copy(this.point).sub(this.offset);
    camera.left = -width / 2;
    camera.right = width / 2;
    camera.bottom = -height / 2;
    camera.top = height / 2;
    camera.near = 0.5;
    camera.far = bounds.max.z - bounds.min.z + reach + PADDING * 2;
    camera.updateProjectionMatrix();
    light.updateMatrixWorld();
    light.target.updateMatrixWorld();
    shadow.updateMatrices(light);
  }
}
