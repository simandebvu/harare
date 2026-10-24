// js/features/index.js — optional feature modules, run in this order. Each owns its file; see main.js for ctx.
import game from './game.js';
import map from './map.js';
import audio from './audio.js';
import suburbs from './suburbs.js';
import furniture from './furniture.js';
import lighting from './lighting.js';

export const features = [game, map, audio, suburbs, furniture, lighting];
