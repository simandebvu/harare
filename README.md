# Slop Harare

A procedural Harare CBD in [three.js](https://threejs.org/), built from OpenStreetMap. Inspired by mrdoob's
[Slop New York](https://github.com/mrdoob/slop-newyork) (no code reused).

Fly over the city, walk the pavements past vendors, or drive a kombi (on the left). Jacarandas are in bloom, the robots
cycle, kombis pull over wherever passengers wave, and the windows light up after dark.

## Run

Any static server works (ES modules need http, not file://):

```sh
python3 -m http.server 8765   # → http://localhost:8765
```

Keys: `1` fly · `2` walk · `3` kombi · `T` advance time · `L` toggle labels.

## Layout

| File | What |
|---|---|
| `tools/data/q_cbd.overpassql` | Overpass query for the CBD bbox (-17.842, 31.028 → -17.813, 31.065) |
| `tools/build-data.mjs` | OSM → `js/harare-data.js` (metres, x = east, z = south, origin Africa Unity Square) |
| `js/world.js` | Ground, the Kopje, parks, roads + paint, railway, street lights |
| `js/buildings.js` | Extruded footprints, landmark looks, shader windows lit at night |
| `js/trees.js` | Jacarandas, flamboyants, msasas, gums |
| `js/traffic.js` / `js/vehicles.js` | Left-hand traffic on the road graph, robots, Fits, Hiluxes, kombis, ZUPCO buses |
| `js/people.js` | Pedestrians and street vendors |
| `js/controls.js` | Fly / walk / drive |
| `js/main.js` | Renderer, sky, sun for Harare's latitude, HUD |

## Refresh the map data

```sh
curl -sS --data-urlencode "data@tools/data/q_cbd.overpassql" https://overpass-api.de/api/interpreter -o tools/data/osm_cbd.json
node tools/build-data.mjs
```

Heights come from OSM `height` / `building:levels` where tagged, from `LANDMARK_HEIGHTS` in `tools/build-data.mjs`
for known towers, and are otherwise procedural (taller toward the core).

## License and data

Code: MIT. Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) (ODbL).
