/**
 * Full-screen composite that turns the G-buffer into a drawing.
 *
 * Inputs (all screen-sized):
 *   tScene  – RGB from the lit scene pass: R = Lambert lighting incl. shadows, G = R × surface class
 *   tNormal – view-space normals (MeshNormalMaterial), tDepth – depth buffer of the same pass
 *   tHatch  – 4 tileable stroke layers in RGBA, tPaper – paper grain (red channel)
 *
 * (a) Edges: Sobel on linearised depth (relative) and on normals. Sample positions are pushed
 *     around by low-frequency value noise so lines wobble like a hand-drawn stroke; a second,
 *     offset pass adds the occasional doubled stroke. "Sketchy" mode re-seeds the noise ~8×/s.
 * (b) Hatching: darkness = 1 − lighting is split into four bands that switch on R, G, B, A stroke
 *     layers in turn, so lit faces get sparse lines and shadows get dense cross-hatching. The
 *     hatch direction rotates with the surface normal so each wall reads as its own plane.
 *     Water gets horizontal ripples, parks stipple, roads stay paper-white.
 * (c) Paper: grain texture multiplied in, plus a soft vignette.
 */
export const sketchVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const sketchFragment = /* glsl */ `
precision highp float;

uniform sampler2D tScene;
uniform sampler2D tNormal;
uniform sampler2D tDepth;
uniform sampler2D tHatch;
uniform sampler2D tPaper;
uniform vec2 uResolution;     // drawing-buffer pixels
uniform float uPixelRatio;
uniform float uNear;
uniform float uFar;
uniform float uSeed;          // changes over time in sketchy mode
uniform float uWobble;        // wobble amplitude in CSS px
uniform vec3 uPaper;
uniform vec3 uInk;
uniform vec3 uHatch;
uniform float uLineWidth;
uniform float uLineStrength;
uniform float uHatchScale;
uniform float uHatchStrength;
uniform float uSmudge;
uniform float uGrain;
uniform float uVignette;
uniform float uGrid;

varying vec2 vUv;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}

float linearDepth(vec2 uv) {
  float d = texture2D(tDepth, uv).x;
  float z = d * 2.0 - 1.0;
  return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
}

vec3 normalAt(vec2 uv) {
  return texture2D(tNormal, uv).xyz * 2.0 - 1.0;
}

float surfaceAt(vec2 uv) {
  vec3 s = texture2D(tScene, uv).rgb;
  return s.r > 0.02 ? s.g / s.r : 0.0;
}

// Sobel edge magnitude from depth discontinuities (relative), normal creases and changes of
// surface class (outlines roads, water and parks, which are flat and invisible to the others).
float sobelEdge(vec2 uv, vec2 texel) {
  float dC = linearDepth(uv);
  float dz[9];
  vec3 nz[9];
  float cz[9];
  int k = 0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 o = vec2(float(x), float(y)) * texel;
      dz[k] = linearDepth(uv + o);
      nz[k] = normalAt(uv + o);
      cz[k] = surfaceAt(uv + o);
      k++;
    }
  }
  float gxD = -dz[0] - 2.0 * dz[3] - dz[6] + dz[2] + 2.0 * dz[5] + dz[8];
  float gyD = -dz[0] - 2.0 * dz[1] - dz[2] + dz[6] + 2.0 * dz[7] + dz[8];
  vec3 gxN = -nz[0] - 2.0 * nz[3] - nz[6] + nz[2] + 2.0 * nz[5] + nz[8];
  vec3 gyN = -nz[0] - 2.0 * nz[1] - nz[2] + nz[6] + 2.0 * nz[7] + nz[8];
  float gxC = -cz[0] - 2.0 * cz[3] - cz[6] + cz[2] + 2.0 * cz[5] + cz[8];
  float gyC = -cz[0] - 2.0 * cz[1] - cz[2] + cz[6] + 2.0 * cz[7] + cz[8];
  float depthEdge = sqrt(gxD * gxD + gyD * gyD) / max(dC, 1.0);
  float normalEdge = sqrt(dot(gxN, gxN) + dot(gyN, gyN));
  float classEdge = sqrt(gxC * gxC + gyC * gyC);
  return max(max(smoothstep(0.035, 0.09, depthEdge), smoothstep(0.55, 1.1, normalEdge)), smoothstep(0.25, 0.6, classEdge) * 0.8);
}

// Tone curve: sunlit faces stay almost blank, half-shade gets single strokes and only real
// shadow reaches the cross-hatch layers. Keeps the drawing light and balanced.
float toneCurve(float darkness) {
  return smoothstep(0.18, 1.0, clamp(darkness, 0.0, 1.0)) * 0.9;
}

float hatchLayer(vec2 p, float darkness) {
  vec4 h = texture2D(tHatch, p);
  float d = toneCurve(darkness) * 4.0;
  float v = clamp(d, 0.0, 1.0) * h.r;
  v = max(v, clamp(d - 1.0, 0.0, 1.0) * h.g);
  v = max(v, clamp(d - 2.0, 0.0, 1.0) * h.b);
  v = max(v, clamp(d - 3.0, 0.0, 1.0) * h.a);
  return v;
}

mat2 rot(float a) {
  float c = cos(a), s = sin(a);
  return mat2(c, -s, s, c);
}

void main() {
  vec2 frag = vUv * uResolution;
  vec2 texel = 1.0 / uResolution;
  float px = uPixelRatio;

  // --- (a) wobbly ink lines --------------------------------------------------------------
  vec2 wob = vec2(vnoise(frag / (38.0 * px) + uSeed * 1.7), vnoise(frag / (38.0 * px) + 17.3 + uSeed * 2.3)) - 0.5;
  vec2 uvA = vUv + wob * uWobble * px * texel * 2.0;
  float lineW = uLineWidth * px;
  float edge = sobelEdge(uvA, texel * lineW);
  vec2 wob2 = vec2(vnoise(frag / (55.0 * px) + 91.0 + uSeed), vnoise(frag / (55.0 * px) + 47.0 - uSeed)) - 0.5;
  float edge2 = sobelEdge(vUv + wob2 * uWobble * px * texel * 3.0, texel * lineW);
  edge = max(edge, edge2 * 0.45);

  float depth = texture2D(tDepth, vUv).x;
  float zLin = linearDepth(vUv);
  bool background = depth >= 0.99999;
  vec3 sc = texture2D(tScene, vUv).rgb;
  // Edge-of-map fade (B / R): the drawing dissolves into blank paper beyond the loaded area.
  float mapFade = background ? 0.0 : (sc.r > 0.02 ? clamp(sc.b / sc.r, 0.0, 1.0) : 1.0);
  // Thin out far-away linework so distant blocks don't turn into noise.
  float distFade = 1.0 - smoothstep(1400.0, 3200.0, zLin);
  // Pencil lines are grainy, not solid.
  float lineGrain = mix(0.55, 1.0, vnoise(frag / (1.6 * px) + uSeed * 5.0));
  float ink = edge * lineGrain * uLineStrength * mix(0.35, 1.0, distFade) * mapFade;

  // --- (b) tonal hatching ---------------------------------------------------------------
  float light = clamp(sc.r, 0.0, 1.0);
  float cls = sc.r > 0.02 ? sc.g / sc.r : 0.0;
  int surface = int(floor(cls * 5.0 + 0.5)); // 0 ground, 1 water, 2 park, 3 sand, 4 road, 5 building
  vec3 n = normalAt(vUv);

  float hatchPx = 256.0 * uHatchScale * px;
  float angle = 0.0;
  float darkness = 1.0 - light;
  float hatch = 0.0;

  if (!background) {
    if (surface == 5) {
      angle = n.x * 1.2 + n.y * 0.7;
      hatch = hatchLayer(rot(angle) * frag / hatchPx, darkness);
    } else if (surface == 1) {
      // Water: wavy horizontal strokes, denser in shadow.
      vec2 w = frag / hatchPx;
      w.y += sin(frag.x / (22.0 * px) + uSeed) * 0.012;
      float ripple = texture2D(tHatch, vec2(w.x * 0.35, w.y * 2.2) * rot(1.4)).r;
      hatch = ripple * (0.18 + darkness * 0.22);
    } else if (surface == 2) {
      // Parks: stipple dots + light hatch in shade.
      float dots = step(0.86, hash12(floor(frag / (2.2 * px))));
      hatch = max(dots * 0.4, hatchLayer(rot(0.4) * frag / hatchPx, darkness * 0.6));
    } else if (surface == 3) {
      float dots = step(0.93, hash12(floor(frag / (2.0 * px))));
      hatch = max(dots * 0.4, hatchLayer(frag / hatchPx, darkness * 0.5));
    } else if (surface == 4) {
      hatch = hatchLayer(frag / hatchPx, darkness * 0.35);
    } else {
      // Bare ground: blank paper in the sun, hatched only where shadows fall.
      hatch = hatchLayer(rot(-0.2) * frag / hatchPx, max(0.0, darkness - 0.25) * 1.1);
    }
    hatch *= mapFade;
  }

  // --- (c) paper -----------------------------------------------------------------------
  float grain = texture2D(tPaper, frag / (512.0 * px)).r;
  vec3 col = uPaper * mix(1.0, 0.82 + grain * 0.32, uGrain);
  if (uGrid > 0.5) {
    vec2 g = abs(fract(frag / (48.0 * px) + 0.5) - 0.5) * 48.0;
    float gl = 1.0 - smoothstep(0.0, 1.0 * px, min(g.x, g.y));
    col = mix(col, uInk, gl * 0.12);
  }
  if (!background) col = mix(col, uHatch, uSmudge * darkness * mapFade * (0.7 + grain * 0.6));
  col = mix(col, uHatch, clamp(hatch * uHatchStrength * mix(0.75, 1.0, grain), 0.0, 1.0));
  col = mix(col, uInk, clamp(ink, 0.0, 1.0));

  vec2 v = vUv - 0.5;
  col *= 1.0 - uVignette * smoothstep(0.35, 0.95, length(v * vec2(1.1, 1.0)));
  gl_FragColor = vec4(col, 1.0);
}
`;
