// Always substep from the last accepted position, including after wall sliding.
export function movePedestrian(p,x,z,occupied,step=.1) {
  const dx=x-p.x,dz=z-p.z,n=Math.max(1,Math.ceil(Math.hypot(dx,dz)/step));
  const sx=dx/n,sz=dz/n;let reached=true;
  for(let i=0;i<n;i++) {
    // A detour keeps going sideways for a few substeps so the walker clears the obstacle instead of being pulled
    // straight back into it by its waypoint
    if(p.dodge>0){p.dodge--;if(!occupied(p.x+p.dodgeX,p.z+p.dodgeZ)){p.x+=p.dodgeX;p.z+=p.dodgeZ;}else p.dodge=0;}
    const nx=p.x+sx,nz=p.z+sz;
    if(!occupied(nx,nz)){p.x=nx;p.z=nz;continue;}
    reached=false;
    if(sx && !occupied(nx,p.z))p.x=nx;
    else if(sz && !occupied(p.x,nz))p.z=nz;
    // Head-on into something small (a bin, a shelter post): step to the left of the way we're going, else the right
    else if(!occupied(p.x-sz,p.z+sx)){p.x-=sz;p.z+=sx;p.dodge=6;p.dodgeX=-sz;p.dodgeZ=sx;}
    else if(!occupied(p.x+sz,p.z-sx)){p.x+=sz;p.z-=sx;p.dodge=6;p.dodgeX=sz;p.dodgeZ=-sx;}
    else break;
  }
  return reached;
}
