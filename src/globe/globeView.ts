import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  LinearSRGBColorSpace,
  Mesh,
  OrthographicCamera,
  PerspectiveCamera,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  type WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EARTH_RADIUS } from '../geo/projection';
import { type TileId, allTiles, latLngToUnit, tileBounds, tileKey, tileV, tilesAround, unitToLatLng, zoomForAltitude } from '../geo/tiles';
import type { SketchStyle } from '../render/styles';
import { globeFragment, globeVertex, paperFragment } from './globeShader';
import { BASE_ZOOM, TileCache } from './tileCache';

/** Globe radius in scene units: kilometres. */
export const R = EARTH_RADIUS / 1000;
const MAX_TILE_ZOOM = 17;
const FADE_MS = 350;
const raw = (hex: string) => new Color().setStyle(hex, LinearSRGBColorSpace);

interface TileMesh {
  mesh: Mesh;
  material: ShaderMaterial;
}

/**
 * A sketch-rendered Earth. OpenStreetMap raster tiles are streamed by zoom level around the
 * point under the camera (plus a permanent low-zoom base layer), draped on sphere patches and
 * drawn with the sketch tile shader.
 */
export class GlobeView {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(45, 1, 0.1, R * 6);
  readonly controls: OrbitControls;
  private readonly cache = new TileCache();
  private readonly meshes = new Map<string, TileMesh>();
  private readonly paperScene = new Scene();
  private readonly paperCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly paperMaterial: ShaderMaterial;
  private readonly baseMaterial: ShaderMaterial;
  private readonly shared: Record<string, { value: unknown }>;
  private fly: { from: Vector3; to: Vector3; fromAlt: number; toAlt: number; start: number; dur: number; done?: () => void } | null = null;
  private viewportPx = 800;
  private lastTileUpdate = '';
  needsRender = true;

  constructor(dom: HTMLElement, hatch: DataTexture, paper: DataTexture) {
    this.shared = {
      tHatch: { value: hatch },
      tPaper: { value: paper },
      uPaper: { value: new Color() },
      uInk: { value: new Color() },
      uHatch: { value: new Color() },
      uSunDir: { value: new Vector3(0.6, 0.35, 0.7).normalize() },
      uCamPos: { value: new Vector3() },
      uPixelRatio: { value: 1 },
      uHatchScale: { value: 1 },
      uHatchStrength: { value: 0.5 },
      uLineStrength: { value: 0.85 },
      uGrain: { value: 0.4 },
    };

    this.baseMaterial = this.tileMaterial(null);
    const base = new Mesh(new SphereGeometry(R * 0.9995, 96, 64), this.baseMaterial);
    base.renderOrder = 0;
    this.scene.add(base);

    this.paperMaterial = new ShaderMaterial({
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: paperFragment,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tPaper: this.shared.tPaper,
        uPaper: this.shared.uPaper,
        uInk: this.shared.uInk,
        uPixelRatio: this.shared.uPixelRatio,
        uGrain: this.shared.uGrain,
        uVignette: { value: 0.25 },
        uGrid: { value: 0 },
        uResolution: { value: [1, 1] },
      },
    });
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
    const quad = new Mesh(g, this.paperMaterial);
    quad.frustumCulled = false;
    this.paperScene.add(quad);

    this.controls = new OrbitControls(this.camera, dom);
    this.controls.enablePan = false;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.minDistance = R + 1.2;
    this.controls.maxDistance = R * 4.2;
    this.controls.zoomSpeed = 1.2;
    this.camera.position.set(0, R * 0.5, R * 2.9);
    this.controls.update();

    // A tile arrived: re-run selection so its mesh gets created, and redraw.
    this.cache.onLoad = () => {
      this.lastTileUpdate = '';
      this.needsRender = true;
    };
  }

  private tileMaterial(tex: DataTexture | import('three').Texture | null): ShaderMaterial {
    return new ShaderMaterial({
      vertexShader: globeVertex,
      fragmentShader: globeFragment,
      transparent: !!tex,
      uniforms: {
        ...this.shared,
        map: { value: tex },
        uHasMap: { value: tex ? 1 : 0 },
        uOpacity: { value: 1 },
        uTexel: { value: 1 / 256 },
      },
    });
  }

  setStyle(s: SketchStyle): void {
    this.shared.uPaper.value = raw(s.paper);
    this.shared.uInk.value = raw(s.ink);
    this.shared.uHatch.value = raw(s.hatch);
    this.shared.uHatchScale.value = s.hatchScale;
    this.shared.uHatchStrength.value = s.hatchStrength;
    this.shared.uLineStrength.value = s.lineStrength;
    this.shared.uGrain.value = s.grain;
    this.paperMaterial.uniforms.uVignette.value = s.vignette;
    this.paperMaterial.uniforms.uGrid.value = s.grid;
    this.needsRender = true;
  }

  /** Sun direction from compass azimuth/elevation relative to the point under the camera. */
  setSun(azimuthDeg: number, elevationDeg: number): void {
    const { lat, lng } = this.center();
    const up = new Vector3(...latLngToUnit(lat, lng));
    const north = new Vector3(0, 1, 0).sub(up.clone().multiplyScalar(up.y)).normalize();
    const east = new Vector3().crossVectors(north, up).normalize();
    const az = (azimuthDeg * Math.PI) / 180;
    const el = (elevationDeg * Math.PI) / 180;
    const horiz = north.multiplyScalar(Math.cos(az)).add(east.multiplyScalar(Math.sin(az))).multiplyScalar(Math.cos(el));
    (this.shared.uSunDir.value as Vector3).copy(horiz.add(up.multiplyScalar(Math.sin(el))).normalize());
    this.needsRender = true;
  }

  resize(w: number, h: number, pixelRatio: number): void {
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    this.viewportPx = h;
    this.shared.uPixelRatio.value = pixelRatio;
    this.paperMaterial.uniforms.uResolution.value = [w * pixelRatio, h * pixelRatio];
    this.needsRender = true;
  }

  get altitudeKm(): number {
    return this.camera.position.length() - R;
  }

  /** The point directly under the camera. */
  center(): { lat: number; lng: number } {
    const p = this.camera.position;
    return unitToLatLng(p.x, p.y, p.z);
  }

  lookAt(lat: number, lng: number, altitudeKm: number): void {
    const v = new Vector3(...latLngToUnit(lat, lng)).multiplyScalar(R + altitudeKm);
    this.fly = null;
    this.camera.position.copy(v);
    this.controls.update();
    this.needsRender = true;
  }

  /** Smooth great-circle flight with a zoom-out "hop" for long distances. */
  flyTo(lat: number, lng: number, altitudeKm: number, done?: () => void): void {
    const from = this.camera.position.clone().normalize();
    const to = new Vector3(...latLngToUnit(lat, lng));
    const angle = from.angleTo(to);
    this.fly = { from, to, fromAlt: this.altitudeKm, toAlt: altitudeKm, start: performance.now(), dur: 1400 + angle * 1300, done };
  }

  get flying(): boolean {
    return this.fly !== null;
  }

  /** Per-frame update. Returns true if the view changed. */
  update(now: number): boolean {
    let changed = false;
    if (this.fly) {
      const f = this.fly;
      const t = Math.min(1, (now - f.start) / f.dur);
      const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
      const dir = slerp(f.from, f.to, e);
      const hop = Math.sin(Math.PI * e) * Math.min(R * 1.6, f.from.angleTo(f.to) * R * 0.9);
      const alt = Math.exp(Math.log(f.fromAlt) + (Math.log(f.toAlt) - Math.log(f.fromAlt)) * e) + hop;
      this.camera.position.copy(dir.multiplyScalar(R + alt));
      this.camera.lookAt(0, 0, 0);
      changed = true;
      if (t >= 1) {
        this.fly = null;
        this.controls.update();
        f.done?.();
      }
    } else {
      // Rotation speed proportional to altitude keeps dragging "attached" to the ground.
      this.controls.rotateSpeed = Math.min(0.5, Math.max(1e-5, (0.16 * this.altitudeKm) / R));
      changed = this.controls.update();
    }
    const alt = this.altitudeKm;
    this.camera.near = Math.max(0.02, alt * 0.3);
    this.camera.far = this.camera.position.length() + R;
    this.camera.updateProjectionMatrix();
    (this.shared.uCamPos.value as Vector3).copy(this.camera.position);
    this.updateTiles(now);
    return changed || this.needsRender;
  }

  private updateTiles(now: number): void {
    const { lat, lng } = this.center();
    const z = Math.min(MAX_TILE_ZOOM, zoomForAltitude(this.altitudeKm, lat, this.camera.fov, this.viewportPx));
    const key = `${z}|${lat.toFixed(4)}|${lng.toFixed(4)}`;
    const wanted: TileId[] = [];
    if (key !== this.lastTileUpdate) {
      this.lastTileUpdate = key;
      // Highest detail first, then coarser fall-backs, then the whole-world base layer.
      if (z > BASE_ZOOM) {
        wanted.push(...tilesAround(lat, lng, z, 2));
        for (let lz = z - 2; lz > BASE_ZOOM; lz -= 2) wanted.push(...tilesAround(lat, lng, lz, 1));
      }
      wanted.push(...allTiles(BASE_ZOOM));
      this.cache.request(wanted, now);
      this.syncMeshes(new Set(wanted.map(tileKey)), wanted);
    } else {
      this.syncMeshes(null, null);
    }
  }

  private syncMeshes(wantedKeys: Set<string> | null, wanted: TileId[] | null): void {
    const now = performance.now();
    if (wanted && wantedKeys) {
      for (const [k, m] of this.meshes) {
        if (!wantedKeys.has(k)) {
          this.scene.remove(m.mesh);
          m.mesh.geometry.dispose();
          m.material.dispose();
          this.meshes.delete(k);
        }
      }
      for (const t of wanted) {
        const k = tileKey(t);
        if (this.meshes.has(k)) continue;
        const entry = this.cache.get(t, now);
        if (!entry?.tex) continue;
        const material = this.tileMaterial(entry.tex as DataTexture);
        material.polygonOffset = true;
        material.polygonOffsetFactor = -t.z;
        material.polygonOffsetUnits = -t.z * 4;
        const mesh = new Mesh(tilePatch(t), material);
        mesh.renderOrder = t.z;
        this.scene.add(mesh);
        this.meshes.set(k, { mesh, material });
      }
    }
    // Fade new tiles in.
    for (const [k, m] of this.meshes) {
      const entry = this.cache.get(parseKey(k), now);
      const age = entry ? now - entry.loadedAt : FADE_MS;
      const o = Math.min(1, age / FADE_MS);
      if (m.material.uniforms.uOpacity.value !== o) {
        m.material.uniforms.uOpacity.value = o;
        this.needsRender = true;
      }
    }
  }

  render(renderer: WebGLRenderer): void {
    renderer.setRenderTarget(null);
    renderer.autoClear = false;
    renderer.clear();
    renderer.render(this.paperScene, this.paperCamera);
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = true;
    this.needsRender = false;
  }
}

function parseKey(k: string): TileId {
  const [z, x, y] = k.split('/').map(Number);
  return { z, x, y };
}

function slerp(a: Vector3, b: Vector3, t: number): Vector3 {
  const omega = Math.acos(Math.min(1, Math.max(-1, a.dot(b))));
  if (omega < 1e-6) return a.clone();
  const s = Math.sin(omega);
  return a
    .clone()
    .multiplyScalar(Math.sin((1 - t) * omega) / s)
    .add(b.clone().multiplyScalar(Math.sin(t * omega) / s));
}

/** Sphere patch covering one tile, with Mercator-correct v coordinates. */
export function tilePatch(t: TileId): BufferGeometry {
  const b = tileBounds(t);
  const seg = t.z <= 4 ? 16 : t.z <= 8 ? 8 : 4;
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const v3: [number, number, number] = [0, 0, 0];
  const lift = 1 + t.z * 2e-7; // finer tiles sit a hair above coarser ones
  for (let j = 0; j <= seg; j++) {
    // Interpolate in Mercator y so texture rows map exactly.
    const yT = t.y + j / seg;
    const lat = Math.atan(Math.sinh(Math.PI - (2 * Math.PI * yT) / 2 ** t.z)) * (180 / Math.PI);
    for (let i = 0; i <= seg; i++) {
      const lng = b.west + ((b.east - b.west) * i) / seg;
      latLngToUnit(lat, lng, v3);
      pos.push(v3[0] * R * lift, v3[1] * R * lift, v3[2] * R * lift);
      nor.push(v3[0], v3[1], v3[2]);
      uv.push(i / seg, 1 - tileV(lat, t));
    }
  }
  for (let j = 0; j < seg; j++) {
    for (let i = 0; i < seg; i++) {
      const a = j * (seg + 1) + i;
      const c = a + seg + 1;
      idx.push(a, c, a + 1, a + 1, c, c + 1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}
