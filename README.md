# Where Is The Sun

Terrain and sun-position explorer. Pick anywhere on Earth, set a date and
time, and see where the sun sits relative to the landscape: rise and set
directions, the day's arc across the sky, terrain shading, and whether a
ridgeline blocks the sun from your spot. Built with MapLibre GL (globe
spot-picking), deck.gl (3D terrain), AWS Terrain Tiles (terrarium encoding),
and SunCalc.

Live at <https://h-a-graham.github.io/whereisthesun/>

## Run

```bash
npm install
npm run dev        # http://localhost:5183 (or vite's default port)
```

## Use

1. **Globe view** (MapLibre, globe projection): drag to rotate, scroll to zoom
   — all the way in to street level if you want; the projection morphs to
   Mercator as you approach, so picking stays precise. Click your exact spot.
2. The view drops into a 3D terrain scene at the clicked point (elevation from
   the AWS `elevation-tiles-prod` terrarium tile set, imagery from Esri World
   Imagery), lit by a sun light matched to the selected date and time. Terrain
   resolution refines as you zoom, up to the tile set's z15 ceiling.
3. **Time slider** (bottom): scrub the UTC time of day; the date picker sets
   the day. Both default to now. The slider track shows the computed
   day/twilight/night bands for the selected location. The sun is an emissive
   3D sphere on a shell 150 km out (beyond the terrain extent, so it has no
   parallax against the landscape), joined to the viewpoint by a bearing ray;
   the arc with hour labels is its path across the selected day. All of it is
   depth-tested, so if a ridge hides the sphere, that ridge blocks direct sun
   at that time.
4. **Terrain-aware readouts**: "Terrain horizon there" is the skyline's
   elevation angle along the sun's current azimuth, from a 30 km elevation
   profile with curvature and refraction applied; "Sun vs skyline" is sun
   altitude minus that angle — gold "+X° clear" or coral "−X° blocked". It
   checks the ray to the sun's centre: treat clearances under ~0.5° as
   marginal (the solar disc spans ±0.25°, and the DEM is ~25–30 m resolution).
   "Direct sun today" sweeps the selected day in 10-minute steps and reports
   how many hours the spot gets direct sun versus its total daylight — the
   difference is what terrain steals. Handy for gardens, campsites, and
   solar panels.
5. **FACE THE SUN** turns the camera toward the sun's current azimuth.
   **BACK TO GLOBE** returns to the globe to pick a different spot.

Right-drag (or ctrl-drag) rotates the terrain camera; left-drag pans.

The panel readouts give position, ground elevation, sun altitude/azimuth, and
sunrise/sunset (UTC) for the selected day. Panels collapse via the corner
chevrons (collapsed by default on phones).

## Console helpers

- `__goto(lng, lat)` jumps straight to a location, e.g.
  `__goto(-4.85, 43.19)` for the Picos de Europa.
- `__face()` triggers face-the-sun; `__cam({zoom, pitch, bearing})` moves the
  terrain camera; `__deck` is the Deck instance; `__globe` is the MapLibre map.

## Notes

- Terrain loads inside a ~2° window that recenters as you pan, so tiles load
  wherever you roam without fetching distant off-screen geometry; zoom is
  capped at 15, the tile set's ceiling. Source DEM resolution is ~10 m
  (US), ~25–30 m (Europe and most of the world), so fine detail beyond ~z13
  is interpolation. The mesh is simplified to a 2 m max error
  (`meshMaxError`); lower it for a denser TIN at some GPU cost.
- The AWS terrain tiles are free and keyless; if you have a Mapbox or
  MapTiler key, their terrain-RGB tiles are smoother (hydro-flattened and
  denoised) — swap `elevationData` and `elevationDecoder` accordingly.
- Times are UTC; the label also shows the equivalent time in this machine's
  timezone.
