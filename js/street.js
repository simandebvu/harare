// js/street.js — shared street state: traffic publishes its robots and lane layout here so people.js can make
// pedestrians wait at the kerb and send hawkers out between the cars at red lights.
export const STREET = {
  time: 0, // traffic clock (s)
  CYCLE: 40,
  lights: null, // Map node -> {offset, x, z, w}
  edges: null, // traffic edges with lane layout {laneW, lanesDir, ...}
  // 0 green, 1 amber, 2 red for an approach axis (0 = east-west, 1 = north-south)
  signal: () => 0,
  // Seconds into the 40 s cycle for that axis: 0-17 green, 17-20 amber, 20-40 red
  axisPhase: () => 0,
};
