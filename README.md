# Slop Harare

A procedural Harare CBD in [three.js](https://threejs.org/), built from OpenStreetMap. Inspired by mrdoob's
[Slop New York](https://github.com/mrdoob/slop-newyork) (no code reused).

Drive a kombi (on the left), walk the pavements past vendors and touts, or fly a helicopter out to Domboshava. Jacarandas
are in bloom, the robots cycle, kombis pull over wherever passengers wave, and after dark the street lamps come on —
except where ZESA has cut the power.

## Run

Any static server works (ES modules need http, not file://):

```sh
npm run serve   # python3 -m http.server 8765 → http://localhost:8765
```

You start in a kombi on Jason Moyo Avenue. Keys: `1` fly · `2` walk · `3` kombi · `V` cycle cameras · `H` hooter ·
`Shift` boost · `M` street atlas · `L` labels · `U` hide UI · `N` mute · `P` quality · `T` advance time. Gamepad and
touch work too.

## Layout

| File | What |
|---|---|
| `tools/build-data.mjs` | CBD OSM → `js/harare-data.js` (metres, x = east, z = south, origin Africa Unity Square) |
| `tools/build-suburbs.mjs` | ~25 km of greater Harare → `js/suburbs-data.js` |
| `js/main.js` | Renderer, sky, sun for Harare's latitude, time of day, feature-module host |
| `js/world.js` · `js/textures.js` | Ground, Kopje, parks, roads, kerbs, zebras, rail, street lamps |
| `js/buildings.js` · `js/building-textures.js` · `js/signs.js` | Era typologies, parallax interiors, wall materials, signage |
| `js/trees.js` | Jacarandas, flamboyants, msasas, gums |
| `js/traffic.js` · `js/vehicles.js` · `js/vehicle-render.js` | Left-hand traffic, robots, kombis, ZUPCO, ZRP, lights |
| `js/people.js` · `js/figures.js` · `js/ranks.js` | Pedestrians, vendors, hawkers, kombi ranks |
| `js/controls.js` · `js/cameras.js` · `js/player.js` | Drive / walk / helicopter, camera rig, player character |
| `js/post.js` · `js/clouds.js` | GTAO, bloom, colour grade, clouds |
| `js/features/*` | Plug-ins with `init(ctx)` / `update(dt, ctx)`: game HUD, map + atlas (`js/hud/`), audio (`js/audio/`), suburbs, furniture, lamp lighting |
| `tools/shot.mjs` | Headed-Chromium screenshots for checking changes (`npm run shot -- name shot`) |

## Refresh the map data

```sh
curl -sS --data-urlencode "data@tools/data/q_cbd.overpassql" https://overpass-api.de/api/interpreter -o tools/data/osm_cbd.json
node tools/build-data.mjs
```

Suburbs (the Overpass server wants a User-Agent):

```sh
curl -sS -A "slop-harare/0.1" --data-urlencode "data@tools/data/q_suburbs.overpassql" https://overpass-api.de/api/interpreter -o tools/data/osm_suburbs.json
node tools/build-suburbs.mjs
```

Heights come from OSM `height` / `building:levels` where tagged, from `LANDMARK_HEIGHTS` in `tools/build-data.mjs`
for known towers, and are otherwise procedural (taller toward the core).

## License and data

Code: MIT. Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) (ODbL).
