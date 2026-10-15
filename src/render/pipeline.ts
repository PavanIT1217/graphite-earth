import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DepthTexture,
  LinearSRGBColorSpace,
  Mesh,
  MeshNormalMaterial,
  NearestFilter,
  NoToneMapping,
  OrthographicCamera,
  type PerspectiveCamera,
  type Scene,
  ShaderMaterial,
  UnsignedIntType,
  WebGLRenderTarget,
  WebGLRenderer,
} from 'three';
import { sketchFragment, sketchVertex } from './shaders/sketch';
import type { SketchStyle } from './styles';
import { createHatchTexture } from './textures/hatch';
import { createPaperTexture } from './textures/paper';

/** Raw display-space colour (no sRGB→linear conversion: the composite writes display values). */
const raw = (hex: string) => new Color().setStyle(hex, LinearSRGBColorSpace);

/**
 * Three-pass non-photorealistic pipeline:
 *  1. scene pass  → colour target (lighting + surface class, with shadow map)
 *  2. normal pass → normal target + depth texture (scene.overrideMaterial = MeshNormalMaterial)
 *  3. composite   → full-screen sketch shader to the canvas
 */
export class SketchPipeline {
  readonly renderer: WebGLRenderer;
  private readonly sceneTarget: WebGLRenderTarget;
  private readonly normalTarget: WebGLRenderTarget;
  private readonly normalMaterial = new MeshNormalMaterial();
  private readonly quad: Mesh;
  private readonly quadCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  readonly material: ShaderMaterial;
  private pixelRatio = 1;
  maxPixelRatio: number;

  constructor(canvas: HTMLCanvasElement, isMobile: boolean) {
    this.renderer = new WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
    this.renderer.toneMapping = NoToneMapping;
    this.renderer.outputColorSpace = LinearSRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.maxPixelRatio = isMobile ? 1.5 : 2;

    this.sceneTarget = new WebGLRenderTarget(1, 1, { minFilter: NearestFilter, magFilter: NearestFilter });
    this.normalTarget = new WebGLRenderTarget(1, 1, { minFilter: NearestFilter, magFilter: NearestFilter });
    this.normalTarget.depthTexture = new DepthTexture(1, 1, UnsignedIntType);

    this.material = new ShaderMaterial({
      vertexShader: sketchVertex,
      fragmentShader: sketchFragment,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tScene: { value: this.sceneTarget.texture },
        tNormal: { value: this.normalTarget.texture },
        tDepth: { value: this.normalTarget.depthTexture },
        tHatch: { value: createHatchTexture() },
        tPaper: { value: createPaperTexture() },
        uResolution: { value: [1, 1] },
        uPixelRatio: { value: 1 },
        uNear: { value: 1 },
        uFar: { value: 1000 },
        uSeed: { value: 0 },
        uWobble: { value: 1.6 },
        uPaper: { value: new Color() },
        uInk: { value: new Color() },
        uHatch: { value: new Color() },
        uLineWidth: { value: 1 },
        uLineStrength: { value: 1 },
        uHatchScale: { value: 1 },
        uHatchStrength: { value: 1 },
        uSmudge: { value: 0 },
        uGrain: { value: 0.5 },
        uVignette: { value: 0.3 },
        uGrid: { value: 0 },
      },
    });
    // One oversized triangle covers the screen.
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
    this.quad = new Mesh(g, this.material);
    this.quad.frustumCulled = false;
  }

  setStyle(style: SketchStyle): void {
    const u = this.material.uniforms;
    u.uPaper.value = raw(style.paper);
    u.uInk.value = raw(style.ink);
    u.uHatch.value = raw(style.hatch);
    u.uLineWidth.value = style.lineWidth;
    u.uLineStrength.value = style.lineStrength;
    u.uHatchScale.value = style.hatchScale;
    u.uHatchStrength.value = style.hatchStrength;
    u.uSmudge.value = style.smudge;
    u.uGrain.value = style.grain;
    u.uVignette.value = style.vignette;
    u.uGrid.value = style.grid;
    this.renderer.setClearColor(0xffffff, 1);
  }

  setSeed(seed: number): void {
    this.material.uniforms.uSeed.value = seed;
  }

  setSize(cssW: number, cssH: number, pixelRatio = Math.min(window.devicePixelRatio || 1, this.maxPixelRatio)): void {
    this.pixelRatio = pixelRatio;
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(cssW, cssH, false);
    const w = Math.max(1, Math.round(cssW * pixelRatio));
    const h = Math.max(1, Math.round(cssH * pixelRatio));
    this.sceneTarget.setSize(w, h);
    this.normalTarget.setSize(w, h);
    this.material.uniforms.uResolution.value = [w, h];
    this.material.uniforms.uPixelRatio.value = pixelRatio;
  }

  get currentPixelRatio(): number {
    return this.pixelRatio;
  }

  render(scene: Scene, camera: PerspectiveCamera): void {
    const r = this.renderer;
    const bg = scene.background;
    scene.background = null;
    r.setClearColor(0x000000, 1);

    r.shadowMap.autoUpdate = true;
    r.setRenderTarget(this.sceneTarget);
    r.render(scene, camera);

    // Normals/depth: no need to re-render the shadow map.
    r.shadowMap.autoUpdate = false;
    scene.overrideMaterial = this.normalMaterial;
    r.setClearColor(0x8080ff, 1);
    r.setRenderTarget(this.normalTarget);
    r.render(scene, camera);
    scene.overrideMaterial = null;
    scene.background = bg;

    this.material.uniforms.uNear.value = camera.near;
    this.material.uniforms.uFar.value = camera.far;
    r.setRenderTarget(null);
    r.render(this.quad, this.quadCamera);
  }

  dispose(): void {
    this.sceneTarget.dispose();
    this.normalTarget.dispose();
    this.material.dispose();
    this.renderer.dispose();
  }
}
