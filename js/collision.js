// Ground-plane shapes. Flat polygon arrays are [x,z,...]; boxes face +z at yaw 0.
import { pointInPoly, segDist } from './util.js';
export function boxPolygon(x, z, yaw, halfLength, halfWidth) {
  const s = Math.sin(yaw), c = Math.cos(yaw), p = [];
  for (const [w,l] of [[-1,-1],[1,-1],[1,1],[-1,1]]) p.push(x+c*w*halfWidth+s*l*halfLength,z-s*w*halfWidth+c*l*halfLength);
  return p;
}
export function circlePolygon(x,z,r,p) {
  if (pointInPoly(x,z,p)) return true;
  for(let i=0,j=p.length-2;i<p.length;j=i,i+=2) if(segDist(x,z,p[j],p[j+1],p[i],p[i+1])[0]<r-1e-6) return true;
  return false;
}
function crosses(ax,az,bx,bz,cx,cz,dx,dz) {
  const a=(bx-ax)*(cz-az)-(bz-az)*(cx-ax), b=(bx-ax)*(dz-az)-(bz-az)*(dx-ax);
  const c=(dx-cx)*(az-cz)-(dz-cz)*(ax-cx), d=(dx-cx)*(bz-cz)-(dz-cz)*(bx-cx);
  return a*b<0 && c*d<0;
}
export function polygonsOverlap(a,b) {
  for(let i=0;i<a.length;i+=2) if(pointInPoly(a[i],a[i+1],b)) return true;
  for(let i=0;i<b.length;i+=2) if(pointInPoly(b[i],b[i+1],a)) return true;
  for(let i=0,j=a.length-2;i<a.length;j=i,i+=2)
    for(let k=0,l=b.length-2;k<b.length;l=k,k+=2)
      if(crosses(a[j],a[j+1],a[i],a[i+1],b[l],b[l+1],b[k],b[k+1])) return true;
  return false;
}
export function circleBox(x,z,r,b) {
  const dx=x-b.x,dz=z-b.z,s=b.sin??Math.sin(b.yaw),c=b.cos??Math.cos(b.yaw);
  const lx=dx*c-dz*s,lz=dx*s+dz*c;
  const qx=Math.max(-b.hw,Math.min(b.hw,lx)),qz=Math.max(-b.hl,Math.min(b.hl,lz));
  return (lx-qx)**2+(lz-qz)**2 < r*r-1e-8;
}
export function boxesOverlap(a,b) {
  const as=a.sin??Math.sin(a.yaw),ac=a.cos??Math.cos(a.yaw),bs=b.sin??Math.sin(b.yaw),bc=b.cos??Math.cos(b.yaw);
  const dx=b.x-a.x,dz=b.z-a.z;
  for(const [x,z] of [[ac,-as],[as,ac],[bc,-bs],[bs,bc]]) {
    const ra=Math.abs(x*ac-z*as)*a.hw+Math.abs(x*as+z*ac)*a.hl;
    const rb=Math.abs(x*bc-z*bs)*b.hw+Math.abs(x*bs+z*bc)*b.hl;
    if(Math.abs(dx*x+dz*z)>=ra+rb-1e-5) return false;
  }
  return true;
}
// Substeps cover both translation and turning, preventing tunnelling on slower frames.
export function sweepPose(from,to,blocked,spacing=.16) {
  const turn=Math.atan2(Math.sin(to.yaw-from.yaw),Math.cos(to.yaw-from.yaw));
  const n=Math.max(1,Math.ceil((Math.hypot(to.x-from.x,to.z-from.z)+Math.abs(turn)*3)/spacing));
  let last={...from};
  for(let i=1;i<=n;i++) {
    const t=i/n,next={x:from.x+(to.x-from.x)*t,z:from.z+(to.z-from.z)*t,yaw:from.yaw+turn*t};
    if(blocked(next)) return {...last,hit:true};
    last=next;
  }
  return {...last,hit:false};
}
