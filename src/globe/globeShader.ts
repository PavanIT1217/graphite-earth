/**
 * Draws an OpenStreetMap raster tile as a sketch, matching the city post-process:
 *  - ink lines from a Sobel filter on the tile's luminance (roads, coastlines, borders, labels)
 *  - tonal hatching from tile darkness + the sun on the globe (night side gets cross-hatched)
 *  - water (OSM carto blue) as horizontal ripples, green areas as stipple
 *  - paper grain, and an ink rim along the globe's silhouette
 * With uHasMap = 0 it draws the bare paper sphere underneath (poles, not-yet-loaded tiles).
 */
export const globeVertex = /* glsl */ `
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

export const globeFragment = /* glsl */ `
precision highp float;
uniform sampler2D map;
uniform sampler2D tHatch;
uniform sampler2D tPaper;
uniform float uHasMap;
uniform float uOpacity;
uniform vec3 uPaper;
uniform vec3 uInk;
uniform vec3 uHatch;
uniform vec3 uSunDir;
uniform vec3 uCamPos;
uniform float uPixelRatio;
uniform float uHatchScale;
uniform float uHatchStrength;
uniform float uLineStrength;
uniform float uGrain;
uniform float uTexel;
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorld;

float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float toneCurve(float d) { return smoothstep(0.18, 1.0, clamp(d, 0.0, 1.0)) * 0.9; }

float hatchLayer(vec2 p, float darkness) {
  vec4 h = texture2D(tHatch, p);
  float d = toneCurve(darkness) * 4.0;
  float v = clamp(d, 0.0, 1.0) * h.r;
  v = max(v, clamp(d - 1.0, 0.0, 1.0) * h.g);
  v = max(v, clamp(d - 2.0, 0.0, 1.0) * h.b);
  v = max(v, clamp(d - 3.0, 0.0, 1.0) * h.a);
  return v;
}

void main() {
  float px = uPixelRatio;
  vec2 frag = gl_FragCoord.xy;
  vec3 n = normalize(vNormal);
  float sun = dot(n, normalize(uSunDir));
  float night = smoothstep(0.15, -0.35, sun);

  float ink = 0.0;
  float darkness = night * 0.75;
  float hatch = 0.0;
  float hatchPx = 256.0 * uHatchScale * px;

  if (uHasMap > 0.5) {
    vec3 c = texture2D(map, vUv).rgb;
    // One screen pixel in tile UV space (thin, even lines at any magnification), capped to a texel.
    float t = clamp(max(fwidth(vUv.x), fwidth(vUv.y)), uTexel * 0.35, uTexel);
    float l00 = lum(texture2D(map, vUv + vec2(-t, -t)).rgb);
    float l10 = lum(texture2D(map, vUv + vec2(0.0, -t)).rgb);
    float l20 = lum(texture2D(map, vUv + vec2(t, -t)).rgb);
    float l01 = lum(texture2D(map, vUv + vec2(-t, 0.0)).rgb);
    float l21 = lum(texture2D(map, vUv + vec2(t, 0.0)).rgb);
    float l02 = lum(texture2D(map, vUv + vec2(-t, t)).rgb);
    float l12 = lum(texture2D(map, vUv + vec2(0.0, t)).rgb);
    float l22 = lum(texture2D(map, vUv + vec2(t, t)).rgb);
    float gx = -l00 - 2.0 * l01 - l02 + l20 + 2.0 * l21 + l22;
    float gy = -l00 - 2.0 * l10 - l20 + l02 + 2.0 * l12 + l22;
    float L = lum(c);
    // Map labels and dark symbols are inked directly (reads like hand lettering); everything
    // else gets outlines from the Sobel edges.
    float text = smoothstep(0.55, 0.32, L);
    ink = max(smoothstep(0.08, 0.3, sqrt(gx * gx + gy * gy)) * (1.0 - text) * 0.55, text * 0.9) * uLineStrength;

    bool water = distance(c, vec3(0.667, 0.827, 0.875)) < 0.12;
    bool green = c.g > c.r + 0.04 && c.g > c.b + 0.02;
    if (water) {
      vec2 w = frag / hatchPx;
      w.y += sin(frag.x / (26.0 * px)) * 0.01;
      float ripple = texture2D(tHatch, vec2(w.x * 0.35, w.y * 2.4)).r;
      hatch = ripple * (0.38 + night * 0.35);
    } else if (green) {
      float dots = step(0.86, hash12(floor(frag / (2.2 * px))));
      hatch = max(dots * 0.35, hatchLayer(frag / hatchPx, night));
    } else {
      darkness = max(darkness, clamp((0.93 - L) * 1.6, 0.0, 1.0) * 0.7);
      hatch = hatchLayer(frag / hatchPx, darkness);
    }
  } else {
    hatch = hatchLayer(frag / hatchPx, darkness);
  }

  // Ink rim along the silhouette.
  vec3 view = normalize(uCamPos - vWorld);
  float rim = 1.0 - max(dot(view, n), 0.0);
  ink = max(ink, smoothstep(0.82, 0.97, rim) * 0.85);

  float grain = texture2D(tPaper, frag / (512.0 * px)).r;
  vec3 col = uPaper * mix(1.0, 0.82 + grain * 0.32, uGrain);
  col = mix(col, uHatch, clamp(hatch * uHatchStrength * mix(0.75, 1.0, grain), 0.0, 1.0));
  float lineGrain = mix(0.6, 1.0, hash12(floor(frag / (1.5 * px))));
  col = mix(col, uInk, clamp(ink * lineGrain, 0.0, 1.0));
  gl_FragColor = vec4(col, uOpacity);
}
`;

/** Plain paper background with grain and vignette for the globe view. */
export const paperFragment = /* glsl */ `
precision highp float;
uniform sampler2D tPaper;
uniform vec3 uPaper;
uniform vec3 uInk;
uniform float uGrain;
uniform float uVignette;
uniform float uGrid;
uniform float uPixelRatio;
uniform vec2 uResolution;
varying vec2 vUv;
void main() {
  vec2 frag = vUv * uResolution;
  float px = uPixelRatio;
  float grain = texture2D(tPaper, frag / (512.0 * px)).r;
  vec3 col = uPaper * mix(1.0, 0.82 + grain * 0.32, uGrain);
  if (uGrid > 0.5) {
    vec2 g = abs(fract(frag / (48.0 * px) + 0.5) - 0.5) * 48.0;
    col = mix(col, uInk, (1.0 - smoothstep(0.0, px, min(g.x, g.y))) * 0.12);
  }
  vec2 v = vUv - 0.5;
  col *= 1.0 - uVignette * smoothstep(0.35, 0.95, length(v * vec2(1.1, 1.0)));
  gl_FragColor = vec4(col, 1.0);
}
`;
