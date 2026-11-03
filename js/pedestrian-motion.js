// Always substep from the last accepted position, including after wall sliding.
export function movePedestrian(p,x,z,occupied,step=.1) {
  const dx=x-p.x,dz=z-p.z,n=Math.max(1,Math.ceil(Math.hypot(dx,dz)/step));
  const sx=dx/n,sz=dz/n;let reached=true;
  for(let i=0;i<n;i++) {
    const nx=p.x+sx,nz=p.z+sz;
    if(!occupied(nx,nz)){p.x=nx;p.z=nz;continue;}
    reached=false;
    if(sx && !occupied(nx,p.z))p.x=nx;
    else if(sz && !occupied(p.x,nz))p.z=nz;
    else break;
  }
  return reached;
}
