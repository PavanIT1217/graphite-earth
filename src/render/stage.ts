import { AmbientLight, DirectionalLight, MOUSE, PerspectiveCamera, Scene, TOUCH, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const AMBIENT = 0.42;
const SUN = 0.58; // ambient + sun ≤ 1 keeps the class encoding (G / R) exact

/** Scene graph, camera, orbit controls and the sun. */
export class Stage {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(45, 1, 2, 14000);
  readonly controls: OrbitControls;
  readonly sun = new DirectionalLight(0xffffff, SUN);
  private transition: { from: Vector3; to: Vector3; start: number; dur: number } | null = null;
  private azimuth = 210;
  private elevation = 38;
  private extent = 800;

  constructor(dom: HTMLElement, isMobile: boolean) {
    this.scene.add(new AmbientLight(0xffffff, AMBIENT));
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(isMobile ? 1024 : 2048, isMobile ? 1024 : 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    this.scene.add(this.sun, this.sun.target);

    this.controls = new OrbitControls(this.camera, dom);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.screenSpacePanning = false;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.minDistance = 60;
    this.controls.maxDistance = 4600;
    this.controls.mouseButtons = { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN };
    this.controls.touches = { ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN };
    this.updateSun();
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  /**
   * Frame an area of `size` metres, looking from `heading` degrees (0 = from the south looking
   * north). With `fromAbove` (metres) the camera starts straight overhead at that height and
   * swoops down to the oblique view — the hand-off from the globe.
   */
  frame(size: number, heading: number, fromAbove?: number): void {
    this.extent = size;
    // Portrait screens have a narrow horizontal field of view: pull back so the area still fits.
    const dist = size * 0.95 * Math.max(1, 1 / (this.camera.aspect * 1.35));
    const h = (heading * Math.PI) / 180;
    this.controls.target.set(0, 0, 0);
    const to = new Vector3(Math.sin(h) * dist * 0.75, dist * 0.62, Math.cos(h) * dist * 0.75);
    if (fromAbove) {
      const from = new Vector3(Math.sin(h) * 1, fromAbove, Math.cos(h) * 1);
      this.camera.position.copy(from);
      this.transition = { from, to, start: performance.now(), dur: 1300 };
    } else {
      this.camera.position.copy(to);
      this.transition = null;
    }
    this.camera.lookAt(0, 0, 0);
    this.controls.update();
    this.updateSun();
  }

  /** Keep the current view but shift it by (dx, dz) — used when the city re-centres. */
  shift(dx: number, dz: number): void {
    this.camera.position.x -= dx;
    this.camera.position.z -= dz;
    this.controls.target.x -= dx;
    this.controls.target.z -= dz;
    this.controls.update();
  }

  /** Advance camera transitions and damping. Returns true while something moved. */
  tick(now: number): boolean {
    if (this.transition) {
      const t = Math.min(1, (now - this.transition.start) / this.transition.dur);
      const e = 1 - (1 - t) ** 3;
      this.camera.position.lerpVectors(this.transition.from, this.transition.to, e);
      this.camera.lookAt(this.controls.target);
      if (t >= 1) this.transition = null;
      this.controls.update();
      return true;
    }
    return this.controls.update();
  }

  get distance(): number {
    return this.camera.position.distanceTo(this.controls.target);
  }

  /** Azimuth: compass bearing the sun shines *from* (0 = north, 90 = east). Elevation in degrees. */
  setSun(azimuth: number, elevation: number): void {
    this.azimuth = azimuth;
    this.elevation = elevation;
    this.updateSun();
  }

  private updateSun(): void {
    const az = (this.azimuth * Math.PI) / 180;
    const el = (this.elevation * Math.PI) / 180;
    const d = this.extent * 1.5;
    const dir = new Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    this.sun.position.copy(dir.multiplyScalar(d));
    this.sun.target.position.set(0, 0, 0);
    const cam = this.sun.shadow.camera;
    const half = this.extent * 0.75;
    cam.left = -half;
    cam.right = half;
    cam.top = half;
    cam.bottom = -half;
    cam.near = 1;
    cam.far = d * 2.5;
    cam.updateProjectionMatrix();
    this.sun.shadow.needsUpdate = true;
  }
}
