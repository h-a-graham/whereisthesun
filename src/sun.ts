import SunCalc from 'suncalc';

const METERS_PER_DEG_LAT = 110574;
const METERS_PER_DEG_LNG_EQ = 111320;

export interface SunSample {
  position: [number, number, number];
  altitudeDeg: number;
  azimuthDeg: number; // degrees clockwise from north
  date: Date;
}

// Position of a sun marker placed `distance` metres from the viewpoint,
// in the sun's actual direction. SunCalc azimuth is measured from south,
// positive towards west; convert to a from-north bearing first.
export function sunSample(
  date: Date,
  latitude: number,
  longitude: number,
  distance: number,
  baseElevation: number
): SunSample {
  const {altitude, azimuth} = SunCalc.getPosition(date, latitude, longitude);
  const bearing = azimuth + Math.PI;
  const east = distance * Math.cos(altitude) * Math.sin(bearing);
  const north = distance * Math.cos(altitude) * Math.cos(bearing);
  const up = distance * Math.sin(altitude);
  const dLat = north / METERS_PER_DEG_LAT;
  const dLng = east / (METERS_PER_DEG_LNG_EQ * Math.cos((latitude * Math.PI) / 180));
  return {
    position: [longitude + dLng, latitude + dLat, baseElevation + up],
    altitudeDeg: (altitude * 180) / Math.PI,
    azimuthDeg: (((bearing * 180) / Math.PI) + 360) % 360,
    date,
  };
}

// Above-horizon arc(s) of the sun across one UTC day, split into contiguous
// segments so the path never chords through the ground.
export function sunArcSegments(
  dayStartUTC: Date,
  latitude: number,
  longitude: number,
  distance: number,
  baseElevation: number
): [number, number, number][][] {
  const segments: [number, number, number][][] = [];
  let current: [number, number, number][] = [];
  for (let m = 0; m <= 1440; m += 10) {
    const s = sunSample(
      new Date(dayStartUTC.getTime() + m * 60000),
      latitude,
      longitude,
      distance,
      baseElevation
    );
    if (s.altitudeDeg > -1.5) {
      current.push(s.position);
    } else if (current.length) {
      segments.push(current);
      current = [];
    }
  }
  if (current.length) segments.push(current);
  return segments;
}

// Hourly samples for tick markers / labels along the arc.
export function sunHourMarks(
  dayStartUTC: Date,
  latitude: number,
  longitude: number,
  distance: number,
  baseElevation: number
): SunSample[] {
  const marks: SunSample[] = [];
  for (let h = 0; h < 24; h++) {
    const s = sunSample(
      new Date(dayStartUTC.getTime() + h * 3600000),
      latitude,
      longitude,
      distance,
      baseElevation
    );
    if (s.altitudeDeg > 0) marks.push(s);
  }
  return marks;
}

export function azimuthToCompass(deg: number): string {
  const points = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return points[Math.round(deg / 22.5) % 16];
}
