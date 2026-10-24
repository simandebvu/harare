// js/ao-hooks.js — extra draws for the AO normal pass. GTAO renders every mesh with one override material, so
// anything posed in its vertex shader (the people) registers a hook here that draws itself posed into that buffer.
export const aoHooks = [];
