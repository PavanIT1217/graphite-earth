import type { WebGLRenderer } from 'three';
import type { SketchStyle } from './styles';

/** Largest drawing-buffer edge we ask for (most mobile GPUs support 8192, many 16384). */
const MAX_EDGE = 8192;

/**
 * Re-render the current view at `scale`× the CSS size, stamp the OSM attribution in the corner
 * (required by the ODbL), and return a PNG blob. The canvas is restored by the caller's resize.
 */
export async function exportView(
  renderer: WebGLRenderer,
  canvas: HTMLCanvasElement,
  scale: number,
  style: SketchStyle,
  /** Resize everything to `pixelRatio` and draw one frame. */
  renderAt: (pixelRatio: number) => void,
): Promise<Blob> {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const gl = renderer.getContext();
  const maxTex = Math.min(MAX_EDGE, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number);
  const ratio = Math.min(scale, maxTex / Math.max(w, h));
  renderAt(ratio);

  // Copy immediately (same task) — the WebGL drawing buffer is not preserved.
  const out = document.createElement('canvas');
  out.width = canvas.width;
  out.height = canvas.height;
  const ctx = out.getContext('2d')!;
  ctx.drawImage(canvas, 0, 0);
  const fs = Math.round(13 * ratio);
  ctx.font = `italic ${fs}px Georgia, serif`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = style.ink;
  ctx.globalAlpha = 0.8;
  ctx.fillText('Map data © OpenStreetMap contributors · Graphite Earth', out.width - fs, out.height - fs * 0.8);

  return new Promise((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'));
}
