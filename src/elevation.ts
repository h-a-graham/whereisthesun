// Single-point ground elevation lookup by reading one pixel of an AWS
// terrarium tile: elevation = R * 256 + G + B / 256 - 32768.
const TERRAIN_URL_TEMPLATE =
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

export async function fetchGroundElevation(
  longitude: number,
  latitude: number
): Promise<number> {
  const z = 11;
  const n = 2 ** z;
  const xt = ((longitude + 180) / 360) * n;
  const latRad = (latitude * Math.PI) / 180;
  const yt = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  const x = Math.floor(xt);
  const y = Math.floor(yt);
  const px = Math.min(255, Math.floor((xt - x) * 256));
  const py = Math.min(255, Math.floor((yt - y) * 256));
  const url = TERRAIN_URL_TEMPLATE
    .replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{y}', String(y));

  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const loaded = new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('tile load failed'));
    });
    img.src = url;
    await loaded;
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (!ctx) return 0;
    ctx.drawImage(img, 0, 0);
    const [r, g, b] = ctx.getImageData(px, py, 1, 1).data;
    return r * 256 + g + b / 256 - 32768;
  } catch {
    return 0;
  }
}
