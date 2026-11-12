import supplyDrop from './supply-drop.js';
import heroEffects from './hero-effects.js';
import powers from './powers.js';
import heatVision from './heat-vision.js';
import powersHud from './powers-hud.js';
import chaos from './chaos.js';
import share from './share.js';
import photo from './photo.js';
import chaosReport from './chaos-report.js';
// js/features/index.js — optional feature modules, run in this order. Each owns its file; see main.js for ctx.
import playMenu from './play-menu.js';
import game from './game.js';
import shift from './shift.js';
import garage from './garage.js';
import map from './map.js';
import audio from './audio.js';
import suburbs from './suburbs.js';
import furniture from './furniture.js';
import monuments from './monuments.js';
import lighting from './lighting.js';
import shadows from './shadows.js';

export const features = [game, map, shift, garage, audio, suburbs, furniture, monuments, lighting, shadows, playMenu, heroEffects, supplyDrop, powers, heatVision, powersHud, chaos, chaosReport, share, photo];
