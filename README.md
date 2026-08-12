# Where Is The Sun

**Totally vibe coded but hopefully usefu...**

Terrain and sun-position scout for choosing an eclipse viewing spot. Built with
MapLibre GL (globe spot-picking), deck.gl (3D terrain), AWS Terrain Tiles
(terrarium encoding), and SunCalc.

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
   Imagery), lit by a sun light matched to the selected date and time.
3. **Time slider** (bottom): scrub the UTC time of day. The slider track shows
   the computed day/twilight/night bands for the selected location. The gold
   disc is the sun's current position; the arc with hour labels is its
   path across the selected day; both are occluded by terrain, so if a ridge
   hides the disc, that ridge blocks your line of sight at that time.
4. **FACE THE SUN** turns the camera toward the sun's current azimuth.
   **BACK TO GLOBE** returns to the globe to pick a different spot.

Right-drag (or ctrl-drag) rotates the terrain camera; left-drag pans.

The panel readouts give position, ground elevation, sun altitude/azimuth, and
sunrise/sunset (UTC) for the selected day.

## Console helpers

- `__goto(lng, lat)` jumps straight to a location, e.g.
  `__goto(-4.85, 43.19)` for the Picos de Europa.
- `__face()` triggers face-the-sun; `__deck` is the Deck instance; `__globe`
  is the MapLibre map.

## Notes

- Terrain extent is limited to about ±1° around the chosen point and capped at
  zoom 12 to keep loading fast; click a new globe point to move further.
- Times are UTC (eclipse timings are usually published in UT); the label also
  shows the equivalent time in this machine's timezone.
