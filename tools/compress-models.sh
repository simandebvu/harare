#!/bin/bash
# Compress the hero/crowd/traffic GLBs: WebP textures + meshopt geometry/animation (keeps every node, material and clip name).
# usage: tools/compress-models.sh [out-dir] [src-dir]   — run on the uncompressed exports from tools/prepare-*.py

set -u
O=${1:-assets/models}; SRC=${2:-assets/models}; mkdir -p "$O"
G() { npx -y @gltf-transform/cli@4.2.1 "$@"; }
for n in african-female african-male fit hiace pedestrian-female player police sedan; do
  G webp "$SRC/$n.glb" "$O/$n.w.glb" --quality 88 >/dev/null 2>"$O/$n.err" || { tail -2 "$O/$n.err"; cp "$SRC/$n.glb" "$O/$n.w.glb"; }
  G meshopt "$O/$n.w.glb" "$O/$n.glb" --level medium >/dev/null 2>"$O/$n.err" || tail -2 "$O/$n.err"
  rm -f "$O/$n.w.glb"
  a=$(stat -f%z "$SRC/$n.glb"); b=$(stat -f%z "$O/$n.glb" 2>/dev/null || echo 0)
  awk -v n=$n -v a=$a -v b=$b 'BEGIN{printf "%-20s %6.2f -> %5.2f MB\n", n, a/1e6, b/1e6}'
done
