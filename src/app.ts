import { DEFAULT_AREA_M2, MAX_AREA_M2, MIN_AREA_M2, PRESETS } from './core/config';
import { ResponseCache } from './data/cache';
import { type CityData, parseOsm } from './data/osm';
import { fetchOsm } from './data/overpass';
import { GlobeView } from './globe/globeView';
import { LocalProjection, bboxAround, type LatLng } from './geo/projection';
import { zoomForAltitude } from './geo/tiles';
import { type CityMeshes, buildCity } from './mesh/cityBuilder';
import { savePng } from './platform/exportImage';
import { exportView } from './render/exporter';
import { SketchPipeline } from './render/pipeline';
import { Stage } from './render/stage';
import { STYLES, type StyleId } from './render/styles';
import { byId } from './ui/dom';
import { Progress, formatBytes } from './ui/progress';
import { initSearch } from './ui/search';

const SKETCHY_FPS = 8;
/** Below this altitude the globe hands over to the 3D city sketch. */
const ENTER_CITY_KM = 3;
/** Pulling the city camera further than this returns to the globe. */
const EXIT_CITY_M = 4300;
/** Where a fly-to ends: just under the hand-off altitude. */
const FLY_ALTITUDE_KM = 2.4;

type Mode = 'globe' | 'city';

interface Target {
  name: string;
  center: LatLng;
  heading: number;
}

/**
 * Two views share one canvas and renderer:
 *  - globe: OSM tiles drawn as a sketch on a 3D Earth, streamed by zoom level;
 *  - city: 3D buildings/roads/water/parks from Overpass through the sketch pipeline.
 * Zooming the globe below ENTER_CITY_KM loads the city under the camera; zooming the city out
 * returns to the globe; panning the city far enough re-centres it on a fresh area.
 * Frames are only drawn when something changed (battery-friendly on phones).
 */
export class App {
  private readonly isMobile = matchMedia('(pointer: coarse)').matches || /Mobi|Android/i.test(navigator.userAgent);
  private readonly canvas = byId<HTMLCanvasElement>('view');
  private readonly pipeline = new SketchPipeline(this.canvas, this.isMobile);
  private readonly stage = new Stage(this.canvas, this.isMobile);
  private readonly globe: GlobeView;
  private readonly cache = new ResponseCache();
  private readonly progress = new Progress(() => this.cancelLoad());
  private mode: Mode = 'globe';
  private city: CityMeshes | null = null;
  private abort: AbortController | null = null;
  private needsRender = true;
  private sketchy = false;
  private lastSeed = -1;
  private areaM2 = DEFAULT_AREA_M2;
  private style: StyleId = 'pencil';
  private current: Target | null = null;
  private projection: LocalProjection | null = null;
  /** After a failed/cancelled hand-off, wait until the user zooms out before trying again. */
  private handoffBlocked = false;
  private pendingName: string | null = null;
  private sunAz = 210;
  private sunEl = 38;
  private lastHud = '';

  constructor() {
    const u = this.pipeline.material.uniforms;
    this.globe = new GlobeView(this.canvas, u.tHatch.value, u.tPaper.value);
    this.stage.controls.enabled = false;
    this.stage.controls.addEventListener('change', () => this.invalidate());
    this.stage.controls.addEventListener('end', () => this.maybeRecentre());
    new ResizeObserver(() => this.resize()).observe(this.canvas);
    this.resize();
    this.applyStyle(this.style);
    this.bindUi();
    initSearch(this.cache, (p) => this.flyTo(p.name, { lat: p.lat, lng: p.lng }));
    requestAnimationFrame(this.frame);
  }

  start(): void {
    const params = new URLSearchParams(location.search);
    const style = params.get('style') as StyleId | null;
    if (style && STYLES[style]) this.selectStyle(style);
    const lat = Number(params.get('lat'));
    const lng = Number(params.get('lng'));
    const preset = PRESETS.find((p) => p.id === params.get('preset'));
    // Start over the user's side of the world (longitude from their time zone).
    const homeLng = Math.max(-180, Math.min(180, -new Date().getTimezoneOffset() / 4));
    this.globe.lookAt(20, homeLng, 16000);
    this.setMode('globe');
    if (preset) this.flyTo(preset.name, { lat: preset.lat, lng: preset.lng });
    else if (params.has('lat') && params.has('lng') && Number.isFinite(lat) && Number.isFinite(lng)) {
      this.flyTo(params.get('name') ?? 'Selected place', { lat, lng });
    }
  }

  private invalidate(): void {
    this.needsRender = true;
  }

  private resize(): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.pipeline.setSize(w, h);
    this.stage.resize(w, h);
    this.globe.resize(w, h, this.pipeline.currentPixelRatio);
    this.invalidate();
  }

  private setMode(mode: Mode): void {
    this.mode = mode;
    this.stage.controls.enabled = mode === 'city';
    this.globe.controls.enabled = mode === 'globe';
    document.body.dataset.mode = mode;
    byId('globe-btn').hidden = mode === 'globe';
    if (mode === 'globe' && !this.globe.flying) byId('place-name').textContent = 'Earth — zoom in anywhere';
    this.invalidate();
  }

  // ---------------------------------------------------------------- frame loop
  private readonly frame = (now: number): void => {
    if (this.sketchy) {
      const seed = Math.floor((now / 1000) * SKETCHY_FPS);
      if (seed !== this.lastSeed) {
        this.lastSeed = seed;
        this.pipeline.setSeed((seed % 97) * 0.731);
        this.needsRender = true;
      }
    }

    if (this.mode === 'globe') {
      this.globe.setSun(this.sunAz, this.sunEl);
      if (this.globe.update(now)) this.needsRender = true;
      const alt = this.globe.altitudeKm;
      if (alt > ENTER_CITY_KM * 1.6) this.handoffBlocked = false;
      if (!this.globe.flying && alt < ENTER_CITY_KM && !this.abort && !this.handoffBlocked) {
        const c = this.globe.center();
        void this.enterCity({ name: this.pendingName ?? formatLatLng(c), center: c, heading: 0 }, alt * 1000);
        this.pendingName = null;
      }
      this.updateGlobeHud();
      if (this.needsRender) {
        this.needsRender = false;
        this.globe.render(this.pipeline.renderer);
      }
    } else {
      if (this.stage.tick(now)) this.needsRender = true;
      if (this.stage.distance > EXIT_CITY_M) this.exitToGlobe();
      if (this.needsRender) {
        this.needsRender = false;
        this.pipeline.render(this.stage.scene, this.stage.camera);
      }
    }
    requestAnimationFrame(this.frame);
  };

  private updateGlobeHud(): void {
    const alt = this.globe.altitudeKm;
    const c = this.globe.center();
    const z = zoomForAltitude(alt, c.lat, this.globe.camera.fov, this.canvas.clientHeight);
    const text = `Altitude ${alt >= 100 ? Math.round(alt).toLocaleString() : alt.toFixed(1)} km · map zoom ${z} · ${formatLatLng(c)} — zoom below ${ENTER_CITY_KM} km to sketch it in 3D`;
    if (text !== this.lastHud) {
      this.lastHud = text;
      byId('stats').textContent = text;
    }
  }

  // ---------------------------------------------------------------- navigation
  private flyTo(name: string, center: LatLng): void {
    this.cancelLoad();
    if (this.mode === 'city') this.exitToGlobe(false);
    this.handoffBlocked = false;
    this.pendingName = name;
    byId('place-name').textContent = `Flying to ${name}…`;
    this.globe.flyTo(center.lat, center.lng, FLY_ALTITUDE_KM);
  }

  private exitToGlobe(fromZoom = true): void {
    this.cancelLoad();
    if (this.projection && this.mode === 'city') {
      const t = this.stage.controls.target;
      const c = this.projection.unproject(t.x, -t.z);
      this.globe.lookAt(c.lat, c.lng, fromZoom ? ENTER_CITY_KM * 1.7 : ENTER_CITY_KM * 1.7);
    }
    this.handoffBlocked = true;
    this.setMode('globe');
  }

  /** Re-centre the city when the user has panned well away from the loaded area. */
  private maybeRecentre(): void {
    if (this.mode !== 'city' || !this.projection || this.abort) return;
    const t = this.stage.controls.target;
    const half = Math.sqrt(this.areaM2) / 2;
    if (Math.hypot(t.x, t.z) < half * 0.55) return;
    const c = this.projection.unproject(t.x, -t.z);
    void this.loadCity({ name: this.current?.name ?? formatLatLng(c), center: c, heading: 0 }, { shift: [t.x, t.z] });
  }

  private cancelLoad(): void {
    if (this.abort) {
      this.abort.abort();
      this.abort = null;
      this.progress.hide();
    }
  }

  private async enterCity(t: Target, altitudeM: number): Promise<void> {
    const ok = await this.loadCity(t, { fromAbove: altitudeM });
    if (!ok) this.handoffBlocked = true;
  }

  // ---------------------------------------------------------------- loading
  private async loadCity(t: Target, opts: { fromAbove?: number; shift?: [number, number] } = {}): Promise<boolean> {
    this.cancelLoad();
    const abort = new AbortController();
    this.abort = abort;
    const area = Math.min(MAX_AREA_M2, Math.max(MIN_AREA_M2, this.areaM2));
    const bbox = bboxAround(t.center, area);
    const proj = new LocalProjection(t.center);
    const half = Math.sqrt(area) / 2;
    try {
      this.progress.show('Opening the sketchbook…', 0.05);
      const { json, fromCache } = await fetchOsm(
        bbox,
        this.cache,
        (p) => {
          if (p.stage === 'network') {
            const frac = p.total ? 0.1 + (p.loaded / p.total) * 0.6 : 0.1 + Math.min(0.6, p.loaded / 12e6);
            this.progress.show(`Fetching OpenStreetMap data from ${p.host} · ${formatBytes(p.loaded)}`, frac);
          }
        },
        abort.signal,
      );
      if (abort.signal.aborted) return false;
      this.progress.show(fromCache ? 'Loaded from cache · reading features…' : 'Reading features…', 0.75);
      await nextFrame();
      const data: CityData = parseOsm(json, proj, { minX: -half, minY: -half, maxX: half, maxY: half });
      if (abort.signal.aborted) return false;
      this.progress.show(`Sketching ${data.stats.buildings.toLocaleString()} buildings…`, 0.88);
      await nextFrame();
      const meshes = buildCity(data);
      if (abort.signal.aborted) {
        meshes.dispose();
        return false;
      }
      this.replaceCity(meshes);
      this.projection = proj;
      this.current = t;
      byId('place-name').textContent = t.name;
      if (opts.shift) this.stage.shift(opts.shift[0], opts.shift[1]);
      else this.stage.frame(Math.sqrt(area), t.heading, opts.fromAbove);
      this.stage.setSun(this.sunAz, this.sunEl);
      this.setMode('city');
      this.updateStats(data, meshes);
      this.updateUrl(t);
      this.progress.hide();
      if (data.stats.buildings === 0) this.progress.toast('No buildings mapped here — zoom out and try somewhere more built-up.');
      return true;
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        this.progress.hide();
        return false;
      }
      console.error(err);
      this.progress.hide();
      this.progress.toast('Could not load map data (the free Overpass servers may be busy). Zoom out and in to retry.', 6000);
      return false;
    } finally {
      if (this.abort === abort) this.abort = null;
      this.invalidate();
    }
  }

  private replaceCity(meshes: CityMeshes): void {
    if (this.city) {
      this.stage.scene.remove(this.city.group);
      this.city.dispose();
    }
    this.city = meshes;
    this.stage.scene.add(meshes.group);
  }

  private updateStats(data: CityData, meshes: CityMeshes): void {
    const { buildings, measuredHeights, roads } = data.stats;
    const pct = buildings ? Math.round((Math.min(measuredHeights, buildings) / buildings) * 100) : 0;
    byId('stats').textContent = `${buildings.toLocaleString()} buildings (${pct}% with mapped heights) · ${roads.toLocaleString()} paths · ${Math.round(meshes.triangles / 1000)}k triangles. Pan to explore further; zoom out to return to the globe.`;
  }

  private updateUrl(t: Target): void {
    const p = new URLSearchParams({ lat: t.center.lat.toFixed(5), lng: t.center.lng.toFixed(5), name: t.name, style: this.style });
    history.replaceState(null, '', `?${p}`);
  }

  // ---------------------------------------------------------------- UI
  private bindUi(): void {
    const presets = byId('presets');
    for (const p of PRESETS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = p.name;
      b.addEventListener('click', () => this.flyTo(p.name, { lat: p.lat, lng: p.lng }));
      presets.append(b);
    }

    document.querySelectorAll<HTMLInputElement>('input[name="style"]').forEach((r) =>
      r.addEventListener('change', () => r.checked && this.applyStyle(r.value as StyleId)),
    );

    const az = byId<HTMLInputElement>('sun-az');
    const el = byId<HTMLInputElement>('sun-el');
    const updateSun = () => {
      this.sunAz = Number(az.value);
      this.sunEl = Number(el.value);
      byId<HTMLOutputElement>('sun-az-out').value = `${az.value}° ${compass(this.sunAz)}`;
      byId<HTMLOutputElement>('sun-el-out').value = `${el.value}°`;
      this.stage.setSun(this.sunAz, this.sunEl);
      this.invalidate();
    };
    az.addEventListener('input', updateSun);
    el.addEventListener('input', updateSun);
    updateSun();

    const area = byId<HTMLInputElement>('area');
    const areaOut = byId<HTMLOutputElement>('area-out');
    area.addEventListener('input', () => (areaOut.value = `${Number(area.value).toFixed(2)} km²`));
    area.addEventListener('change', () => {
      this.areaM2 = Number(area.value) * 1e6;
      if (this.mode === 'city' && this.current) void this.loadCity(this.current);
    });
    areaOut.value = `${(this.areaM2 / 1e6).toFixed(2)} km²`;
    area.value = String(this.areaM2 / 1e6);

    const sketchy = byId<HTMLInputElement>('sketchy');
    sketchy.addEventListener('change', () => {
      this.sketchy = sketchy.checked;
      if (!this.sketchy) this.pipeline.setSeed(0);
      this.invalidate();
    });

    const panel = byId('panel');
    const toggle = byId<HTMLButtonElement>('panel-toggle');
    toggle.addEventListener('click', () => {
      const collapsed = panel.classList.toggle('collapsed');
      toggle.setAttribute('aria-expanded', String(!collapsed));
    });
    if (innerWidth < 900) {
      panel.classList.add('collapsed');
      toggle.setAttribute('aria-expanded', 'false');
    }

    byId<HTMLButtonElement>('globe-btn').addEventListener('click', () => this.exitToGlobe(false));
    byId<HTMLButtonElement>('export').addEventListener('click', () => void this.exportPng());
    const about = byId<HTMLDialogElement>('about');
    byId<HTMLButtonElement>('about-open').addEventListener('click', () => about.showModal());
  }

  private selectStyle(id: StyleId): void {
    const radio = document.querySelector<HTMLInputElement>(`input[name="style"][value="${id}"]`);
    if (radio) radio.checked = true;
    this.applyStyle(id);
  }

  private applyStyle(id: StyleId): void {
    this.style = id;
    const s = STYLES[id];
    this.pipeline.setStyle(s);
    this.globe.setStyle(s);
    document.body.dataset.ui = s.ui;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', s.ui === 'paper' ? s.paper : s.ui === 'dark' ? '#1b1d22' : '#1d4f8f');
    if (this.current && this.mode === 'city') this.updateUrl(this.current);
    this.invalidate();
  }

  private async exportPng(): Promise<void> {
    const scale = Number(byId<HTMLSelectElement>('export-scale').value) || 3;
    const btn = byId<HTMLButtonElement>('export');
    btn.disabled = true;
    btn.textContent = 'Drawing…';
    try {
      await nextFrame();
      const w = this.canvas.clientWidth;
      const h = this.canvas.clientHeight;
      const blob = await exportView(this.pipeline.renderer, this.canvas, scale, STYLES[this.style], (ratio) => {
        this.pipeline.setSize(w, h, ratio);
        if (this.mode === 'city') this.pipeline.render(this.stage.scene, this.stage.camera);
        else {
          this.globe.resize(w, h, ratio);
          this.globe.render(this.pipeline.renderer);
        }
      });
      const name = this.mode === 'city' ? (this.current?.name ?? 'map') : 'earth';
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      await savePng(blob, `graphite-earth-${slug}-${this.style}.png`);
    } catch (err) {
      console.error(err);
      this.progress.toast('Export failed — try a smaller size.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Export PNG';
      this.resize();
    }
  }
}

function compass(deg: number): string {
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

function formatLatLng(c: LatLng): string {
  const lat = `${Math.abs(c.lat).toFixed(3)}°${c.lat >= 0 ? 'N' : 'S'}`;
  const lng = `${Math.abs(c.lng).toFixed(3)}°${c.lng >= 0 ? 'E' : 'W'}`;
  return `${lat} ${lng}`;
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
