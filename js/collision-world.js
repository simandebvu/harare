import { Grid } from './util.js';
import { circleBox, boxesOverlap } from './collision.js';

// Visit nearby buckets without allocating a candidate array/Set for every actor.
function anyNear(grid,x,z,r,visit) {
  const cell=grid.cell;
  for(let i=Math.floor((x-r)/cell);i<=Math.floor((x+r)/cell);i++)
    for(let j=Math.floor((z-r)/cell);j<=Math.floor((z+r)/cell);j++) {
      const bucket=grid.map.get(grid.key(i,j));
      if(bucket)for(const body of bucket)if(visit(body))return true;
    }
  return false;
}
function syncBody(b) {
  b.x=b.owner.x;b.z=b.owner.z;b.yaw=b.owner.h??b.owner.yaw;
  b.sin=Math.sin(b.yaw);b.cos=Math.cos(b.yaw);return b;
}
const scratchA={x:0,z:0,yaw:0,hl:0,hw:0,sin:0,cos:0};
const scratchB={x:0,z:0,yaw:0,sin:0,cos:0,hl:0,hw:0,owner:null};
const scratchCur={x:0,z:0,yaw:0,sin:0,cos:0,hl:0,hw:0,owner:null};
function setBox(a,x,z,yaw,hl,hw) {
  a.x=x;a.z=z;a.yaw=yaw;a.hl=hl;a.hw=hw;a.sin=Math.sin(yaw);a.cos=Math.cos(yaw);return a;
}
function fillBody(o,car) {
  const yaw=car.h??car.yaw;
  o.x=car.x;o.z=car.z;o.yaw=yaw;o.sin=Math.sin(yaw);o.cos=Math.cos(yaw);
  o.hl=(car.len||4.9)/2;o.hw=(car.width||1.9)/2;o.owner=car;return o;
}
// One collision body per car, refreshed in place each frame (a new object per car per frame fed the garbage collector)
const bodies=new WeakMap();
function body(car) {
  let b=bodies.get(car);
  if(!b)bodies.set(car,(b={x:0,z:0,yaw:0,sin:0,cos:0,hl:0,hw:0,owner:car}));
  return fillBody(b,car);
}
// A grid rebuilt every frame: remembers which cells it filled and empties only those (clearing every cell the city's
// thousands of walkers had ever stepped in cost more than all the inserts)
class FrameGrid {
  constructor(cell){this.cell=cell;this.map=new Map();this.used=[];}
  key(i,j){return i*100003+j;}
  clear(){for(const b of this.used)b.length=0;this.used.length=0;}
  insert(item,x0,z0,x1,z1){
    const c=this.cell;
    for(let i=Math.floor(x0/c);i<=Math.floor(x1/c);i++)for(let j=Math.floor(z0/c);j<=Math.floor(z1/c);j++){
      const k=i*100003+j;let b=this.map.get(k);
      if(!b)this.map.set(k,(b=[]));
      if(!b.length)this.used.push(b);
      b.push(item);
    }
  }
}
export function createCollisionWorld(traffic, people, controls) {
  // statics: thousands of posts, fins and lot walls line the pavements, so small cells keep each query to a few boxes
  const vehicles=new FrameGrid(8),pedestrians=new FrameGrid(4),statics=new Grid(2);
  function insertVehicle(car) {
    const b=body(car),r=Math.hypot(b.hl,b.hw)+4;
    vehicles.insert(b,b.x-r,b.z-r,b.x+r,b.z+r);
  }
  return {
    // camera position, so far-off actors can skip collision sweeps
    viewPos:()=>controls.camera?.position,
    addStaticBox(x,z,yaw,hw,hl,height=3) {
      const b={x,z,yaw,hw,hl,height,sin:Math.sin(yaw),cos:Math.cos(yaw)};
      // exact axis-aligned bounds of the rotated box (a long diagonal wall would otherwise fill a huge square)
      const ex=Math.abs(b.cos)*hw+Math.abs(b.sin)*hl,ez=Math.abs(b.sin)*hw+Math.abs(b.cos)*hl;
      statics.insert(b,x-ex,z-ez,x+ex,z+ez);
    },
    refresh() {
      vehicles.clear();
      pedestrians.clear();
      for(const car of traffic.cars)if(car.init&&!(car.away>0))insertVehicle(car);
      for(const car of traffic.parkedCars)if(!(car.away>0))insertVehicle(car);
      if(controls.kombi.visible && !(controls.car.alt>=4.6))insertVehicle(controls.car);
      // People more than 400 m from the camera stay out of the grid: out there nobody can see a walker brush past
      // another or a car not wait for one, and they are most of the city's crowd
      const v=controls.camera?.position,vx=v?.x??0,vz=v?.z??0,far2=v?400*400:Infinity;
      for(const list of [people.walkers,people.loiter,people.hawkerList])for(const p of list) {
        if(Number.isFinite(p.x)&&!p.hidden&&(p.x-vx)**2+(p.z-vz)**2<far2)pedestrians.insert(p,p.x-.28,p.z-.28,p.x+.28,p.z+.28);
      }
      if(controls.mode==='walk') {
        const p=controls.walk;pedestrians.insert(p,p.x-.3,p.z-.3,p.x+.3,p.z+.3);
      }
    },
    // withStatics=false skips posts, walls and furniture (far-off pedestrians: nobody can see them clip a bin)
    personBlocked(x,z,r,owner,feet=0,withStatics=true,withVehicles=true,withPeople=true) {
      if(withStatics&&anyNear(statics,x,z,r,b=>feet<b.height&&circleBox(x,z,r,b)&&!(owner&&circleBox(owner.x,owner.z,r,b)&&(x-b.x)**2+(z-b.z)**2>(owner.x-b.x)**2+(owner.z-b.z)**2+1e-6)))return true;
      if(withVehicles&&feet<1.8&&anyNear(vehicles,x,z,r,b=>{
        syncBody(b);
        if(b.owner===owner||!circleBox(x,z,r,b))return false;
        // Already inside a car body (it drove through you while far from the camera): walk out any way you like.
        // Only stepping away from the car's centre used to be allowed, which pinned walkers in stopped cars for good
        return !(owner&&circleBox(owner.x,owner.z,r,b));
      }))return true;
      return withPeople&&feet<1.6&&anyNear(pedestrians,x,z,r+.24,p=>{
        if(p===owner)return false;
        const d=(x-p.x)**2+(z-p.z)**2;
        return d<(r+.24)**2&&!(owner&&d>(owner.x-p.x)**2+(owner.z-p.z)**2+1e-6);
      });
    },
    buildingBlocked:(x,z,yaw,hl,hw)=>controls.blocked?.box?.(x,z,yaw,hl,hw)||false,
    carBlocked(x,z,yaw,hl,hw,owner,withPeople=true) {
      if(owner!==controls.car&&controls.blocked?.box?.(x,z,yaw,hl,hw))return true;
      const a=setBox(scratchA,x,z,yaw,hl,hw),r=Math.hypot(hl,hw);
      let cached=null;
      const cur=()=>cached??=(owner?fillBody(scratchCur,owner):false);
      // Already touching a post or wall (spawned against it): any move that backs away from it stays allowed
      if(anyNear(statics,x,z,r,b=>{
        if(!boxesOverlap(a,b))return false;
        const now=cur();
        return !(now&&boxesOverlap(now,b)&&(x-b.x)**2+(z-b.z)**2>(owner.x-b.x)**2+(owner.z-b.z)**2+1e-6);
      }))return true;
      if(anyNear(vehicles,x,z,r,b=>{
        syncBody(b);
        if(b.owner===owner||!boxesOverlap(a,b))return false;
        const current=cur();
        return !(current&&boxesOverlap(current,b)&&(x-b.x)**2+(z-b.z)**2>(owner.x-b.x)**2+(owner.z-b.z)**2+1e-6);
      }))return true;
      return withPeople&&anyNear(pedestrians,x,z,r+.3,p=>p!==owner&&circleBox(p.x,p.z,.28,a));
    },
    // a pedestrian inside this car pose (cars easing out of a wedge still never drive through people)
    hitsPerson(x,z,yaw,hl,hw,owner) {
      const a=setBox(scratchA,x,z,yaw,hl,hw);
      return anyNear(pedestrians,x,z,Math.hypot(hl,hw)+.3,p=>p!==owner&&circleBox(p.x,p.z,.28,a));
    },
    trafficGap(car,look) {
      const b=fillBody(scratchB,car);
      const a=setBox(scratchA,b.x+b.sin*look/2,b.z+b.cos*look/2,b.yaw,b.hl+look/2,b.hw);
      let gap=Infinity;car.heldByParked=false;car.heldByPed=false;
      const r=Math.hypot(a.hl,a.hw);
      anyNear(vehicles,a.x,a.z,r,o=>{
        syncBody(o);
        if(o.owner===car||!boxesOverlap(a,o))return false;
        // oncoming traffic keeps to its own side: lanes and junction rights of way separate us, and stopping for it
        // only left both cars facing each other forever
        if(o.owner?.bucket!==undefined&&b.sin*o.sin+b.cos*o.cos<-.3)return false;
        const along=(o.x-b.x)*b.sin+(o.z-b.z)*b.cos;
        if(along<=0)return false;
        const extent=Math.abs(b.sin*o.sin+b.cos*o.cos)*o.hl+Math.abs(b.sin*o.cos-b.cos*o.sin)*o.hw;
        const g=Math.max(0,along-b.hl-extent);
        if(g<gap){gap=g;car.heldByPed=false;car.heldByParked=o.owner===controls.car&&controls.mode!=='drive';}
        return false;
      });
      anyNear(pedestrians,a.x,a.z,r+.3,p=>{
        if(circleBox(p.x,p.z,.3,a)) {
          const along=(p.x-b.x)*b.sin+(p.z-b.z)*b.cos;
          if(along>0&&Math.max(0,along-b.hl-.3)<gap)gap=Math.max(0,along-b.hl-.3),car.heldByPed=true;
        }
        return false;
      });
      return gap;
    },
  };
}
