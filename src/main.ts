import {
  Deck,
  MapView,
  LightingEffect,
  AmbientLight,
  TerrainLayer,
  PathLayer,
  LineLayer,
  ScatterplotLayer,
  TextLayer,
  SimpleMeshLayer,
  type Layer,
} from 'deck.gl';
import {_SunLight as SunLight, TerrainController} from '@deck.gl/core';
import {SphereGeometry} from '@luma.gl/engine';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import SunCalc from 'suncalc';
import {sunSample, sunArcSegments, sunHourMarks, azimuthToCompass} from './sun';
import {fetchGroundElevation, horizonAngleDeg} from './elevation';

const TERRAIN_URL =
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const IMAGERY_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
// Terrarium encoding: elevation = R * 256 + G + B / 256 - 32768
const ELEVATION_DECODER = {rScaler: 256, gScaler: 1, bScaler: 1 / 256, offset: -32768};
// The sun shell sits beyond the terrain tile extent (~±100 km), so it has no
// parallax against the landscape and reads as celestial, not scenery.
const SUN_DISTANCE = 150000;
// The day-arc and its hour labels stay on a near shell so they frame the
// landscape instead of shrinking into the sky.
const ARC_DISTANCE = 18000;
// Sphere subtending ~2 degrees at SUN_DISTANCE: larger than life, unmistakably
// the sun. (Astronomically true would be ~700 m, invisible at this distance.)
const SUN_RADIUS = 2600;
const SUN_MESH = new SphereGeometry({radius: 1, nlat: 24, nlong: 32});

// ---- DOM ----
const panel = document.getElementById('panel') as HTMLElement;
const dateInput = document.getElementById('date-input') as HTMLInputElement;
const slider = document.getElementById('time-slider') as HTMLInputElement;
const timeLabel = document.getElementById('time-label') as HTMLElement;
const timeSub = document.getElementById('time-sub') as HTMLElement;
const trackGradient = document.getElementById('track-gradient') as HTMLElement;
const btnFace = document.getElementById('btn-face') as HTMLButtonElement;
const btnGlobe = document.getElementById('btn-globe') as HTMLButtonElement;
const ro = {
  pos: document.getElementById('ro-pos') as HTMLElement,
  elev: document.getElementById('ro-elev') as HTMLElement,
  alt: document.getElementById('ro-alt') as HTMLElement,
  az: document.getElementById('ro-az') as HTMLElement,
  rise: document.getElementById('ro-rise') as HTMLElement,
  set: document.getElementById('ro-set') as HTMLElement,
  horizon: document.getElementById('ro-horizon') as HTMLElement,
  clear: document.getElementById('ro-clear') as HTMLElement,
};

// ---- State ----
let mode: 'globe' | 'terrain' = 'globe';
let location = {longitude: -4.0, latitude: 43.2};
let groundElevation = 0;
let terrainLayer: TerrainLayer | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let currentViewState: any = null;
let viewEpoch = 0;

// Terrain-aware controller: pans track the terrain surface height instead
// of sea level, so the ground doesn't slide under the cursor.
function makeTerrainView(id: string): MapView {
  return new MapView({id, controller: {type: TerrainController, inertia: 250}});
}

// Programmatic camera moves: remount the view under a fresh id so the
// ViewManager discards the controller's state and re-seeds from
// initialViewState (deck.gl's documented "reset camera" pattern).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyCamera(viewState: any): void {
  currentViewState = viewState;
  viewEpoch += 1;
  deck.setProps({views: makeTerrainView(`view-${viewEpoch}`), initialViewState: viewState});
}

function selectedDayStartUTC(): Date {
  const [y, m, d] = dateInput.value.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function selectedDate(): Date {
  return new Date(selectedDayStartUTC().getTime() + Number(slider.value) * 60000);
}

function fmtUTC(date: Date): string {
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
}

// ---- Layers ----
function makeTerrainLayer(): TerrainLayer {
  const {longitude, latitude} = location;
  const dLng = 1.0 / Math.max(0.2, Math.cos((latitude * Math.PI) / 180));
  const dLat = 0.7;
  return new TerrainLayer({
    id: `terrain-${longitude.toFixed(3)}-${latitude.toFixed(3)}`,
    elevationData: TERRAIN_URL,
    texture: IMAGERY_URL,
    elevationDecoder: ELEVATION_DECODER,
    extent: [longitude - dLng, latitude - dLat, longitude + dLng, latitude + dLat],
    // Terrarium tiles top out at z15 (~5 m/px). Resolution is dynamic: the
    // tile pyramid loads finer elevation + imagery as the camera zooms in,
    // while the opening view still only fetches coarse tiles.
    maxZoom: 15,
    operation: 'terrain+draw',
  });
}

function sunLayers(date: Date): Layer[] {
  const {longitude, latitude} = location;
  const dayStart = selectedDayStartUTC();
  const now = sunSample(date, latitude, longitude, SUN_DISTANCE, groundElevation);
  const arcs = sunArcSegments(dayStart, latitude, longitude, ARC_DISTANCE, groundElevation);
  const marks = sunHourMarks(dayStart, latitude, longitude, ARC_DISTANCE, groundElevation);
  const up = now.altitudeDeg > 0;

  return [
    new PathLayer({
      id: 'sun-arc',
      data: arcs.map(path => ({path})),
      getPath: d => d.path,
      getColor: [242, 181, 69, 110],
      getWidth: 2,
      widthUnits: 'pixels',
    }),
    new ScatterplotLayer({
      id: 'sun-hour-marks',
      data: marks,
      getPosition: d => d.position,
      getRadius: 4,
      radiusUnits: 'pixels',
      getFillColor: [242, 181, 69, 180],
    }),
    new TextLayer({
      id: 'sun-hour-labels',
      data: marks.filter(m => m.date.getUTCHours() % 2 === 0),
      getPosition: d => d.position,
      getText: d => `${String(d.date.getUTCHours()).padStart(2, '0')}:00`,
      getSize: 13,
      getColor: [233, 228, 214, 200],
      getPixelOffset: [0, -16],
      fontFamily: 'Menlo, Consolas, monospace',
    }),
    new LineLayer({
      id: 'sun-ray',
      // Extends far beyond the sun sphere so it reads as an infinite bearing
      // line from the viewpoint toward the sun.
      data: [
        {
          from: [longitude, latitude, groundElevation],
          to: sunSample(date, latitude, longitude, 450000, groundElevation).position,
        },
      ],
      getSourcePosition: d => d.from,
      getTargetPosition: d => d.to,
      getColor: up ? [242, 181, 69, 160] : [139, 147, 167, 90],
      getWidth: 1.5,
      widthUnits: 'pixels',
    }),
    new ScatterplotLayer({
      id: 'viewpoint',
      data: [{position: [longitude, latitude, groundElevation + 4]}],
      getPosition: d => d.position,
      getRadius: 6,
      radiusUnits: 'pixels',
      getFillColor: [231, 111, 81, 230],
      stroked: true,
      getLineColor: [14, 18, 25, 255],
      getLineWidth: 1.5,
      lineWidthUnits: 'pixels',
    }),
    new ScatterplotLayer({
      id: 'sun-halo-outer',
      data: [now],
      getPosition: d => d.position,
      getRadius: up ? 110 : 0,
      radiusUnits: 'pixels',
      getFillColor: [252, 210, 96, 30],
    }),
    new ScatterplotLayer({
      id: 'sun-halo',
      data: [now],
      getPosition: d => d.position,
      getRadius: up ? 60 : 0,
      radiusUnits: 'pixels',
      getFillColor: [255, 224, 120, 70],
    }),
    new SimpleMeshLayer({
      id: 'sun-sphere',
      data: [now],
      mesh: SUN_MESH,
      getPosition: d => d.position,
      getColor: up ? [255, 248, 210, 255] : [120, 128, 148, 200],
      sizeScale: up ? SUN_RADIUS : SUN_RADIUS * 0.5,
      // Emissive: high ambient, no diffuse/specular, so the sphere stays at
      // full brightness regardless of scene lighting (the sun emits light).
      material: {ambient: 3.0, diffuse: 0, shininess: 1, specularColor: [0, 0, 0]},
    }),
  ];
}

function makeEffects(date: Date): LightingEffect[] {
  const alt = SunCalc.getPosition(date, location.latitude, location.longitude).altitude;
  const daylight = Math.max(0, Math.min(1, (alt + 0.05) / 0.25));
  const ambient = new AmbientLight({
    color: [255, 255, 255],
    intensity: 0.35 + 0.55 * daylight,
  });
  const sun = new SunLight({
    timestamp: date.getTime(),
    color: [255, 240, 215],
    intensity: 0.8 + 1.6 * daylight,
  });
  return [new LightingEffect({ambient, sun})];
}

// ---- UI updates ----
function altColor(altDeg: number): [number, number, number] {
  const lerp = (a: [number, number, number], b: [number, number, number], t: number) =>
    a.map((v, i) => Math.round(v + (b[i] - v) * t)) as [number, number, number];
  const night: [number, number, number] = [13, 17, 26];
  const dusk: [number, number, number] = [122, 74, 58];
  const day: [number, number, number] = [232, 196, 106];
  if (altDeg <= -12) return night;
  if (altDeg <= 0) return lerp(night, dusk, (altDeg + 12) / 12);
  if (altDeg <= 15) return lerp(dusk, day, altDeg / 15);
  return day;
}

function updateTrackGradient(): void {
  const dayStart = selectedDayStartUTC();
  const stops: string[] = [];
  for (let m = 0; m <= 1440; m += 30) {
    const t = new Date(dayStart.getTime() + m * 60000);
    const alt =
      (SunCalc.getPosition(t, location.latitude, location.longitude).altitude * 180) / Math.PI;
    const [r, g, b] = altColor(alt);
    stops.push(`rgb(${r},${g},${b}) ${((m / 1440) * 100).toFixed(1)}%`);
  }
  trackGradient.style.background = `linear-gradient(90deg, ${stops.join(', ')})`;
}

function updateReadouts(date: Date): void {
  const {longitude, latitude} = location;
  const s = sunSample(date, latitude, longitude, SUN_DISTANCE, groundElevation);
  timeLabel.textContent = `${fmtUTC(date)} UT`;
  timeSub.textContent = `local ${date.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}`;
  if (mode !== 'terrain') return;
  const times = SunCalc.getTimes(
    new Date(selectedDayStartUTC().getTime() + 12 * 3600000),
    latitude,
    longitude
  );
  ro.pos.textContent = `${latitude.toFixed(4)}°, ${longitude.toFixed(4)}°`;
  ro.elev.textContent = `${Math.round(groundElevation)} m`;
  ro.alt.textContent = `${s.altitudeDeg >= 0 ? '+' : ''}${s.altitudeDeg.toFixed(1)}°${s.altitudeDeg <= 0 ? ' (below horizon)' : ''}`;
  ro.az.textContent = `${s.azimuthDeg.toFixed(0)}° ${azimuthToCompass(s.azimuthDeg)}`;
  ro.rise.textContent = isNaN(times.sunrise?.getTime()) ? '—' : `${fmtUTC(times.sunrise)} UT`;
  ro.set.textContent = isNaN(times.sunset?.getTime()) ? '—' : `${fmtUTC(times.sunset)} UT`;
  updateHorizonReadout(s.azimuthDeg, s.altitudeDeg);
}

// Terrain-aware sun visibility: skyline angle along the sun's azimuth vs the
// sun's altitude. Async (tile-backed); a token discards stale results when
// the slider moves faster than tiles load.
let horizonToken = 0;
function updateHorizonReadout(azimuthDeg: number, sunAltitudeDeg: number): void {
  const token = ++horizonToken;
  const {longitude, latitude} = location;
  void horizonAngleDeg(longitude, latitude, groundElevation + 2, azimuthDeg).then(horizon => {
    if (token !== horizonToken || mode !== 'terrain') return;
    ro.horizon.textContent = `${horizon >= 0 ? '+' : ''}${horizon.toFixed(1)}°`;
    const clearance = sunAltitudeDeg - horizon;
    const clear = clearance >= 0;
    ro.clear.textContent = clear
      ? `+${clearance.toFixed(1)}° clear`
      : `${clearance.toFixed(1)}° blocked`;
    ro.clear.className = `v ${clear ? 'clear' : 'blocked'}`;
  });
}

// Camera moves must push a layer update pass, otherwise the terrain tileset
// keeps evaluating against the viewport it was created with and never loads
// finer tiles as the user zooms in. Throttled to one redraw per frame.
let redrawQueued = false;
function queueRedraw(): void {
  if (redrawQueued) return;
  redrawQueued = true;
  requestAnimationFrame(() => {
    redrawQueued = false;
    redraw();
  });
}

function redraw(): void {
  const date = selectedDate();
  if (mode === 'terrain') {
    deck.setProps({
      layers: [terrainLayer as TerrainLayer, ...sunLayers(date)],
      effects: makeEffects(date),
    });
  }
  updateReadouts(date);
}

// ---- Mode switching ----
function enterTerrain(longitude: number, latitude: number): void {
  mode = 'terrain';
  location = {longitude, latitude};
  groundElevation = 0;
  terrainLayer = makeTerrainLayer();
  panel.classList.add('located');
  globeContainer.classList.add('invisible');
  deckContainer.classList.remove('invisible');
  applyCamera({
    longitude,
    latitude,
    zoom: 11.4,
    pitch: 66,
    bearing: 0,
    maxPitch: 88,
    minZoom: 8,
    // Camera may zoom past tile z15 (the dataset ceiling); tiles overscale.
    maxZoom: 18,
  });
  updateTrackGradient();
  redraw();
  void fetchGroundElevation(longitude, latitude).then(elev => {
    groundElevation = elev;
    if (mode === 'terrain') redraw();
  });
}

function backToGlobe(): void {
  mode = 'globe';
  panel.classList.remove('located');
  deckContainer.classList.add('invisible');
  globeContainer.classList.remove('invisible');
  globeMap.jumpTo({center: [location.longitude, location.latitude]});
  updateReadouts(selectedDate());
}

function faceTheSun(): void {
  if (mode !== 'terrain') return;
  const s = sunSample(
    selectedDate(),
    location.latitude,
    location.longitude,
    SUN_DISTANCE,
    groundElevation
  );
  const pitch = Math.max(45, Math.min(87, 87 - s.altitudeDeg * 0.8));
  applyCamera({
    ...currentViewState,
    longitude: location.longitude,
    latitude: location.latitude,
    bearing: s.azimuthDeg,
    pitch,
  });
}

// ---- Globe (MapLibre) and terrain (deck.gl) stages ----
const globeContainer = document.getElementById('globe-container') as HTMLDivElement;
const deckContainer = document.getElementById('deck-container') as HTMLDivElement;

const globeMap = new maplibregl.Map({
  container: globeContainer,
  style: {
    version: 8,
    projection: {type: 'globe'},
    sources: {
      esri: {
        type: 'raster',
        tiles: [IMAGERY_URL],
        tileSize: 256,
        maxzoom: 19,
        attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics',
      },
    },
    layers: [{id: 'esri', type: 'raster', source: 'esri'}],
  },
  center: [-10, 45],
  zoom: 1.4,
});
globeMap.on('click', (e: maplibregl.MapMouseEvent) => {
  if (mode === 'globe') enterTerrain(e.lngLat.lng, e.lngLat.lat);
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const deck = new Deck<any>({
  parent: deckContainer,
  views: makeTerrainView('view-0'),
  initialViewState: {longitude: 0, latitude: 0, zoom: 2},
  layers: [],
  getCursor: ({isDragging}) => (isDragging ? 'grabbing' : 'grab'),
  onViewStateChange: ({viewState}) => {
    currentViewState = viewState;
    if (mode === 'terrain') queueRedraw();
  },
});

// Watchdog: an exception inside a render frame kills luma's AnimationLoop
// permanently (no try/catch around its rAF callback), which intermittently
// freezes deck right after page load. Detect a stalled loop by watching the
// frame counter; if it stops advancing, log the offending error and revive
// the rAF chain. No-op while the loop is healthy.
let lastFrameCount = -1;
setInterval(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d: any = deck;
  const al = d.animationLoop;
  if (!al || !al._running) return;
  const frames = d._metricsCounter ?? 0;
  if (frames !== lastFrameCount) {
    lastFrameCount = frames;
    return;
  }
  try {
    al.redraw();
  } catch (err) {
    console.warn('deck render frame threw; retrying', err);
  }
  al._cancelAnimationFrame?.();
  al._requestAnimationFrame?.();
}, 400);

// ---- Collapsible boxes ----
function wireCollapse(box: HTMLElement, btn: HTMLButtonElement, label: string): void {
  const update = () => {
    const collapsed = box.classList.contains('collapsed');
    btn.innerHTML = collapsed ? '&#9656;' : '&#9662;';
    btn.setAttribute('aria-expanded', String(!collapsed));
    btn.setAttribute('aria-label', `${collapsed ? 'Expand' : 'Collapse'} ${label}`);
  };
  btn.addEventListener('click', () => {
    box.classList.toggle('collapsed');
    update();
  });
  // Phones: start collapsed so the map has room.
  if (window.matchMedia('(max-width: 640px)').matches) {
    box.classList.add('collapsed');
  }
  update();
}
wireCollapse(panel, document.getElementById('panel-toggle') as HTMLButtonElement, 'info panel');
wireCollapse(
  document.getElementById('timebar') as HTMLElement,
  document.getElementById('timebar-toggle') as HTMLButtonElement,
  'time controls'
);

// ---- Events ----
slider.addEventListener('input', redraw);
dateInput.addEventListener('change', () => {
  updateTrackGradient();
  redraw();
});
btnFace.addEventListener('click', faceTheSun);
btnGlobe.addEventListener('click', backToGlobe);

// Default the controls to now (UTC), rounded to the slider's 5-minute step.
{
  const bootNow = new Date();
  dateInput.value = bootNow.toISOString().slice(0, 10);
  const minutes = bootNow.getUTCHours() * 60 + bootNow.getUTCMinutes();
  slider.value = String(Math.min(1435, Math.round(minutes / 5) * 5));
}

updateTrackGradient();
updateReadouts(selectedDate());

// Console/dev hook: jump straight to a lon/lat without clicking the globe.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).__goto = (lng: number, lat: number) => enterTerrain(lng, lat);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).__deck = deck;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).__globe = globeMap;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).__face = faceTheSun;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).__cam = (vs: any) => applyCamera({...currentViewState, ...vs});
