// Elevation sampling from AWS terrarium tiles:
// elevation = R * 256 + G + B / 256 - 32768.
// Tiles are fetched once and cached as ImageData, so profile queries
// (hundreds of samples along a line) cost one canvas read each.
const TERRAIN_URL_TEMPLATE =
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const SAMPLE_ZOOM = 12;

const tileCache = new Map<string, Promise<ImageData | null>>();

function loadTile(z: number, x: number, y: number): Promise<ImageData | null> {
  const key = `${z}/${x}/${y}`;
  let cached = tileCache.get(key);
  if (!cached) {
    cached = new Promise(resolve => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d', {willReadFrequently: true});
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0);
        resolve(ctx.getImageData(0, 0, 256, 256));
      };
      img.onerror = () => resolve(null);
      img.src = TERRAIN_URL_TEMPLATE.replace('{z}', String(z))
        .replace('{x}', String(x))
        .replace('{y}', String(y));
    });
    tileCache.set(key, cached);
  }
  return cached;
}

export async function sampleElevation(
  longitude: number,
  latitude: number,
  z: number = SAMPLE_ZOOM
): Promise<number | null> {
  const n = 2 ** z;
  const xt = (((longitude + 180) / 360) % 1 + 1) % 1 * n;
  const latRad = (latitude * Math.PI) / 180;
  const yt = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  if (yt < 0 || yt >= n) return null;
  const x = Math.floor(xt);
  const y = Math.floor(yt);
  const px = Math.min(255, Math.floor((xt - x) * 256));
  const py = Math.min(255, Math.floor((yt - y) * 256));
  const data = await loadTile(z, x, y);
  if (!data) return null;
  const i = (py * 256 + px) * 4;
  const [r, g, b] = [data.data[i], data.data[i + 1], data.data[i + 2]];
  return r * 256 + g + b / 256 - 32768;
}

export async function fetchGroundElevation(
  longitude: number,
  latitude: number
): Promise<number> {
  return (await sampleElevation(longitude, latitude)) ?? 0;
}

// Elevation angle of the terrain skyline seen from the eye position, looking
// along `azimuthDeg`. Samples the height profile out to `maxDist` metres and
// returns the maximum apparent angle, corrected for Earth curvature (with a
// standard 0.13 refraction coefficient). Negative result = horizon below eye.
export async function horizonAngleDeg(
  longitude: number,
  latitude: number,
  eyeElevation: number,
  azimuthDeg: number,
  maxDist = 30000
): Promise<number> {
  const az = (azimuthDeg * Math.PI) / 180;
  const cosLat = Math.cos((latitude * Math.PI) / 180);
  const EFFECTIVE_R = 6371000 / (1 - 0.13);
  let maxAngle = -90;
  const step = (d: number) => (d < 3000 ? 100 : d < 10000 ? 250 : 600);
  for (let d = 100; d <= maxDist; d += step(d)) {
    const lng = longitude + (d * Math.sin(az)) / (111320 * cosLat);
    const lat = latitude + (d * Math.cos(az)) / 110574;
    const h = await sampleElevation(lng, lat);
    if (h == null) continue;
    const drop = (d * d) / (2 * EFFECTIVE_R);
    const angle = (Math.atan2(h - eyeElevation - drop, d) * 180) / Math.PI;
    if (angle > maxAngle) maxAngle = angle;
  }
  return maxAngle;
}
