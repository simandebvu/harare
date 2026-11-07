import test from 'node:test';
import assert from 'node:assert/strict';
import {boxPolygon,circlePolygon,polygonsOverlap,circleBox,boxesOverlap,sweepPose} from '../js/collision.js';

test('full car body catches a thin wall between its corners',()=>{
 const car=boxPolygon(0,0,0,2.45,.95),wall=[-.1,-8,.1,-8,.1,8,-.1,8];
 assert(polygonsOverlap(car,wall));
});
test('circle respects wall clearance and allows a concave courtyard',()=>{
 const p=[0,0,4,0,4,1,1,1,1,4,0,4];
 assert(circlePolygon(-.2,2,.3,p));assert(!circlePolygon(-.4,2,.3,p));assert(!circlePolygon(2,2,.3,p));
});
test('rotated vehicle bodies and corner clearance',()=>{
 const a={x:0,z:0,yaw:Math.PI/4,hl:2.45,hw:.95};
 assert(circleBox(0,0,.3,a));assert(!circleBox(5,5,.3,a));
 assert(boxesOverlap(a,{...a,x:1,z:1,yaw:-Math.PI/4}));assert(!boxesOverlap(a,{...a,x:9}));
});
test('high speed movement cannot tunnel through a thin building',()=>{
 const wall=[-.08,-8,.08,-8,.08,8,-.08,8];
 const p=sweepPose({x:-5,z:0,yaw:0},{x:5,z:0,yaw:0},p=>polygonsOverlap(boxPolygon(p.x,p.z,p.yaw,2.45,.95),wall));
 assert(p.hit);assert(p.x<-.95);
});
test('turning is swept so a rear corner cannot rotate through a wall',()=>{
 const wall=[1.4,-4,1.6,-4,1.6,4,1.4,4];
 const p=sweepPose({x:0,z:0,yaw:0},{x:0,z:0,yaw:Math.PI/2},p=>polygonsOverlap(boxPolygon(p.x,p.z,p.yaw,2.45,.95),wall));
 assert(p.hit);assert(p.yaw>0&&p.yaw<Math.PI/2);
});

const {createCollisionWorld}=await import('../js/collision-world.js');
function fixture() {
 const car={x:0,z:0,yaw:0},npc={x:5,z:0,h:0,len:4.6,type:'sedan',init:true};
 const people={walkers:[],loiter:[],hawkerList:[]};
 const controls={car,kombi:{visible:true},mode:'drive',walk:{x:0,z:9}};
 const world=createCollisionWorld({cars:[npc],parkedCars:[]},people,controls);world.refresh();
 return {world,car,npc,people,controls};
}
test('walker cannot pass through traffic or the player van',()=>{
 const {world}=fixture();assert(world.personBlocked(5,0,.3,null));assert(world.personBlocked(0,0,.3,null));assert(!world.personBlocked(2.5,0,.3,null));
});
test('traffic yields to the player and pedestrians, but ignores its own collider',()=>{
 const {world,npc,people}=fixture();npc.x=0;npc.z=-10;world.refresh();
 assert(world.trafficGap(npc,15)<6);assert(!world.carBlocked(0,-10,0,2.3,.9,npc));
 people.walkers.push({x:0,z:-6});world.refresh();assert(world.trafficGap(npc,10)<2);
});
test('collision positions follow actors moved since the grid refresh',()=>{
 const {world,car,npc}=fixture();car.x=2;
 assert(world.carBlocked(2,0,0,2.3,.9,npc));
});
test('overlapping spawns can move apart instead of becoming permanently trapped',()=>{
 const {world,people}=fixture(),p={x:10,z:0},q={x:10.2,z:0};people.walkers.push(p,q);world.refresh();
 assert(!world.personBlocked(9.95,0,.26,p));assert(world.personBlocked(10.05,0,.26,p));
});

import {movePedestrian} from '../js/pedestrian-motion.js';
test('diagonal wall sliding never jumps across the wall on later substeps',()=>{
 const wall=[.5,-10,1,-10,1,10,.5,10],p={x:0,z:0};
 const blocked=(x,z)=>circlePolygon(x,z,.42,wall);
 assert.equal(movePedestrian(p,3,3,blocked),false);
 assert(p.x<.1);assert(p.z>0);assert(!blocked(p.x,p.z));
});
test('sliding follows a clear wall edge without losing movement',()=>{
 const p={x:0,z:0};movePedestrian(p,1,2,(x,z)=>x>.2);
 assert(p.x<=.2);assert(p.z>1.5);
});

test('street kiosk blocks swept cars and pedestrians at its rotated footprint',()=>{
 const {world,car}=fixture();world.addStaticBox(20,0,Math.PI/4,1.2,1.05,2.5);
 const p=sweepPose({x:14,z:0,yaw:Math.PI/2},{x:26,z:0,yaw:Math.PI/2},p=>world.carBlocked(p.x,p.z,p.yaw,2.15,.95,car));
 assert(p.hit);assert(p.x<18);
 assert(world.personBlocked(20,0,.3,null));assert(!world.personBlocked(23,0,.3,null));
 world.refresh();assert(world.carBlocked(20,0,0,2.15,.95,car));
 assert(!world.personBlocked(20,0,.3,null,3));
});

test('a pedestrian walking head-on into a bin steps around it instead of stopping',()=>{
 const bin=[-.25,1.75,.25,1.75,.25,2.25,-.25,2.25],p={x:0,z:0};
 const blocked=(x,z)=>circlePolygon(x,z,.32,bin);
 for(let i=0;i<40&&p.z<4;i++)movePedestrian(p,p.x+(0-p.x)*.2,p.z+.3,blocked);
 assert(p.z>3,'got past the bin');assert(!blocked(p.x,p.z));
});

test('a car that starts overlapping a static post can still drive away from it',()=>{
 const {world,car}=fixture();world.addStaticBox(car.x+.8,car.z,0,.09,.09,3.7);
 assert(world.carBlocked(car.x,car.z,car.h??car.yaw,2.15,.95,car,false),'overlaps the post now');
 const away=car.x-.6;assert(!world.carBlocked(away,car.z,car.h??car.yaw,2.15,.95,car,false),'backing away is allowed');
 assert(world.carBlocked(car.x+.3,car.z,car.h??car.yaw,2.15,.95,car,false),'pushing further in is not');
});
