# Slop Harare

A procedural Harare CBD in [three.js](https://threejs.org/), built from OpenStreetMap. Inspired by mrdoob's
[Slop New York](https://github.com/mrdoob/slop-newyork) (no code reused).

Walk the pavements past vendors and touts, drive a kombi (on the left) and pick up fares, or take to the sky as
Skyweaver, a flying hero, and drop supplies on rooftops — or fly out to Domboshava. Jacarandas
are in bloom, the robots cycle, kombis pull over wherever passengers wave, and after dark the street lamps come on —
except where ZESA has cut the power.

## Run

Any static server works (ES modules need http, not file://):

```sh
npm run serve   # python3 -m http.server 8765 → http://localhost:8765
```

You start on foot on Jason Moyo Avenue, next to your kombi. Keys: `1` fly · `2` walk · `3` drive · `R` context action
(enter/exit the kombi, take off, land) · `V` cycle cameras · `H` hooter · `Shift` run/boost · `M` street atlas · `L`
labels · `U` hide UI · `N` mute · `P` quality · `T` advance time. Gamepad and touch work too.

Two missions sit top-left: a **taxi shift** (pick up and drop off passengers for fares, in the HiAce or the Vela X1
roadster from *Choose your ride*) and a **supply drop** (fly a package to a rooftop target). **Character & options**
switches the hero between male and female.

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
| `tools/compress-models.sh` | WebP textures + meshopt geometry for `assets/models/*.glb` (run after any `tools/prepare-*.py` export) |
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

The player HiAce uses Alvin.Woodly’s CC BY 4.0 model; the playable character and animations use Quaternius CC0 assets. See [model credits](assets/credits.html) for sources, licenses, and adaptations. Nearby compact cars, sedans, police cars and kombis use imported models. Nearby adult pedestrians use animated male/female models with clothing variations; distant actors and specialised figures keep the lightweight procedural models. Pickups and buses retain their existing models. Imported assets are served locally; if either fails to load, that hero uses the procedural fallback.

To rebuild the hero assets, download and unzip the credited standard packs, then run Blender 5.2 with `tools/prepare-models.py`. Pass `--hiace` the original HiAce GLB, `--characters` the base pack's `Superhero_Male_FullBody.gltf` (Godot - UE), and `--animations` the animation pack's `UAL1_Standard.glb` (Unreal-Godot):

```sh
blender -b --python tools/prepare-models.py -- --hiace /path/hiace.glb --characters /path/Superhero_Male_FullBody.gltf --animations /path/UAL1_Standard.glb
```

## Collisions

Walkers check circular clearance against full building footprints, slide along walls, try a clear pavement line, and avoid nearby cars and people. Driving sweeps the van’s complete rotated footprint in small steps. Traffic yields to pedestrians and the player, and checks vehicle overlap while moving. Parked kombis participate in collision checks. This is kinematic collision/avoidance, not a rigid-body crash simulation.

Run the focused regression checks with `npm test`. Asset credits and source links are available from the in-game Model credits link.

### Atmosphere and sound

Sun shadows use a tighter street-level map snapped in light space to reduce shimmer. Roads have separate colour, fine bump and roughness textures. Chase cameras ease position and aim, recheck wall clearance after smoothing, and the scenic drone blends between its shots.

The synthesized soundscape now follows nearby crowd density and street enclosure. The driver’s-eye camera muffles exterior traffic, while Unity Square’s fountain has a spatial water sound. Click or press a game key to enable audio; `N` mutes/unmutes. No new external audio assets are required.

### First playable kombi shift

Choose **Start 10-minute shift** to run the Fourth Street–Charge Office route, or **Free roam** to explore. Follow the minimap GPS to the yellow stop ring and remain nearly stationary for four seconds. Eight passengers board, then pay $1.50 each on arrival; comfortable trips earn a $2 tip. Stay stopped to board the return load. Aim for $24 before the timer ends. Fuel, $8 owner’s takings and collision repairs determine the result. Values are fictional game balancing.

Walking/flying and background tabs pause the shift. Fast travel ends it. End a shift early or retry from the result card. This prototype counts passengers through the stop interaction; animated boarding, saved earnings and vehicle upgrades are not yet implemented.

### Selectable Vela X1 flight taxi

Use **Choose your ride** while stopped and outside an active shift. The HiAce carries eight passengers at $1.50 each; the original Vela X1 concept carries one premium passenger at $12. Both use the same route and smooth-driving bonus. This is a fictional game vehicle with original bodywork and arcade flight.

`F` or the **Lift off** button starts a short traffic hop; press again to descend early. Thrust lasts about six seconds, height is capped at 12 m, and reserve recharges only on the ground. Building footprints remain solid even in flight. Descent pauses above occupied road until the driver moves clear. Vehicle/mode changes and teleporting are blocked while airborne, and boarding requires a ground stop. Vela X1 uses chase/action/scenic cameras; the HiAce cockpit is not reused. Its motor and thrust audio are synthesized. No third-party car model was downloaded for this feature.

### Skyweaver hero
The player is Skyweaver, an original fictional persona using the existing CC0 Quaternius character and animations. Midnight-blue clothing, gold footwear and luminous wrist rings distinguish the hero. Walk/run loops share a normalized stride phase to avoid opposite-leg blending.

**1 / Superflight** lifts the visible hero into a third-person flight view; WASD moves, Space/E rises, C/Q descends, Shift boosts, and **2 / Hero** returns to a clear ground position. Flight movement sweeps a character-sized collider through buildings and checks street props near ground level. Map view remains available as a camera option. This first pass uses an upright hover pose; it does not include combat or a bespoke flight animation clip.

Skyweaver now loads `assets/models/skyweaver.glb`, rebuilt from the intact source mesh rather than the previously bisected clothing mesh. The crowd still uses its existing assets. `tools/prepare-skyweaver.py` takes the existing player GLB (animations), source character glTF, source rigged buzz-cut glTF and output path. Fabric boundaries and roughness are applied in rest-pose shader coordinates without cutting the skinned mesh.
