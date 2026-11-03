import test from 'node:test';import assert from 'node:assert/strict';import {Flight} from '../js/game/flight.js';import {Shift} from '../js/game/shift.js';
test('flight reserve expires, descends and recharges after landing',()=>{const f=new Flight();assert(f.toggle());for(let i=0;i<150;i++)f.update(.1,false);assert.equal(f.height,0);assert(!f.lifting);assert(f.charge>0);});
test('occupied landing holds safely until clear',()=>{const f=new Flight();f.toggle();for(let i=0;i<65;i++)f.update(.1,false);for(let i=0;i<40;i++)f.update(.1,true);assert(f.height>=4.6);assert(f.landingBlocked);for(let i=0;i<50;i++)f.update(.1,false);assert.equal(f.height,0);});
test('low reserve cannot lift off and flight can be cancelled',()=>{const f=new Flight();f.charge=10;assert(!f.toggle());f.charge=100;assert(f.toggle());f.update(.1,false);assert(f.toggle());assert(!f.lifting);});
test('Roadster boards one passenger, pays premium fare and cannot board in flight',()=>{const s=new Shift();s.start('roadster');for(let i=0;i<6;i++)s.tick(1,{distance:0,airborne:true});assert.equal(s.onboard,0);for(let i=0;i<4;i++)s.tick(1,{distance:0});assert.equal(s.onboard,1);for(let i=0;i<4;i++)s.tick(1,{distance:0});assert.equal(s.cash,14);assert.equal(s.delivered,1);});

test('takeoff accelerates gradually and touchdown settles without a hard drop',()=>{
 const f=new Flight();f.toggle();f.update(.016,false);assert(f.velocity>0&&f.velocity<1);assert(f.height<.02);
 for(let i=0;i<100;i++)f.update(.016,false);f.toggle();
 let nearSpeed=0;for(let i=0;i<1000&&f.height>0;i++){f.update(.016,false);if(f.height>0&&f.height<.1)nearSpeed=Math.abs(f.velocity);}
 assert.equal(f.height,0);assert(nearSpeed<1);assert(f.touchdown>0);
});
