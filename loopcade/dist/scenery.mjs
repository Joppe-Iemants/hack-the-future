export const preferences = [
  {key:'nature', label:'Natuur'},
  {key:'river', label:'Rivier'},
  {key:'canal', label:'Vaart'},
  {key:'major', label:'Grote wegen'},
  {key:'minor', label:'Kleine wegen'},
  {key:'architecture', label:'Architectuur'},
];

// Entrance and visitor map points from visit.gent.be/nl/zien-doen.
const sights = [
  ['Gravensteen', 3.721080, 51.056971], ['Belfort', 3.724884, 51.053546],
  ['Sint-Niklaaskerk', 3.722729, 51.053742], ['Sint-Baafskathedraal', 3.726484, 51.053101],
  ['Boekentoren', 3.725272, 51.045017], ['De Krook', 3.728671, 51.048654],
  ['Sint-Pietersabdij', 3.727039, 51.041933], ['Sint-Michielskerk', 3.718971, 51.053461],
  ['Stadshal', 3.724381, 51.054009],
];
const cellSize = 100;
const cell = coordinate => Math.floor(coordinate / cellSize);

function nearSegment(x,y,a,b,radius) {
  const dx=b[0]-a[0], dy=b[1]-a[1], square=dx*dx+dy*dy;
  const fraction=square ? Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/square)) : 0;
  return (x-a[0]-fraction*dx)**2 + (y-a[1]-fraction*dy)**2 <= radius*radius;
}

function inPark(x,y,ring) {
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const a=ring[j],b=ring[i];
    if(nearSegment(x,y,a,b,15))return true;
    if((a[1]>y)!==(b[1]>y) && x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }
  return inside;
}

function featureIndex(data) {
  const cells = new Map();
  function add(feature, points, radius) {
    const xs=points.map(p=>p[0]), ys=points.map(p=>p[1]);
    const left=cell(Math.min(...xs)-radius),right=cell(Math.max(...xs)+radius);
    const bottom=cell(Math.min(...ys)-radius),top=cell(Math.max(...ys)+radius);
    for(let x=left;x<=right;x++)for(let y=bottom;y<=top;y++){
      const key=x+','+y;
      if(!cells.has(key))cells.set(key,[]);
      cells.get(key).push(feature);
    }
  }
  for(const [type,,name,ids] of data.ways){
    if(type==='g' && ids[0]===ids.at(-1) && /park|tuin|bos|arboretum|baudelohof|blaarmeersen|hof ten walle/i.test(name)){
      const ring=ids.map(id=>data.points[id]);
      add({kind:'nature',ring},ring,15);
      continue;
    }
    let kind, radius;
    if(type==='a'){kind='major';radius=16;}
    else if(type==='r' && /leie|schelde/i.test(name)){kind='river';radius=40;}
    else if(type==='r' && /kanaal|vaart|coupure|lieve/i.test(name)){kind='canal';radius=40;}
    else continue;
    for(let i=1;i<ids.length;i++){
      const a=data.points[ids[i-1]],b=data.points[ids[i]];
      if(a[0]===b[0]&&a[1]===b[1])continue;
      add({kind,a,b,radius},[a,b],radius);
    }
  }
  for(const [name,lon,lat] of sights){
    const p=[(lon-data.origin[0])*data.scale[0],(lat-data.origin[1])*data.scale[1]];
    add({kind:'architecture',p,name},[p],55);
  }
  return cells;
}

export function profileEdges(data,edges) {
  const cells=featureIndex(data);
  return edges.map(({a,b,type,length})=>{
    const start=data.points[a],end=data.points[b],dx=end[0]-start[0],dy=end[1]-start[1];
    const steps=Math.max(1,Math.ceil(length/20)), section=length/steps;
    const meters={nature:0,river:0,canal:0,major:0,minor:0,architecture:0}, landmarks=new Set();
    for(let i=0;i<steps;i++){
      const t=(i+.5)/steps,x=start[0]+dx*t,y=start[1]+dy*t;
      const hits=new Set();
      if(type==='a')hits.add('major');
      for(const f of cells.get(cell(x)+','+cell(y))||[]){
        if(f.kind==='architecture'){
          if(Math.hypot(x-f.p[0],y-f.p[1])<=55){hits.add(f.kind);landmarks.add(f.name);}
        }else if(!hits.has(f.kind)){
          if(f.kind==='nature'){
            if(inPark(x,y,f.ring))hits.add(f.kind);
          }else{
            const fx=f.b[0]-f.a[0],fy=f.b[1]-f.a[1];
            // An adjacent sidewalk counts. Merely crossing a road or river doesn't.
            if(Math.abs(dx*fx+dy*fy)>=.65*length*Math.hypot(fx,fy) && nearSegment(x,y,f.a,f.b,f.radius))hits.add(f.kind);
          }
        }
      }
      if(!hits.has('major') && (type==='s'||type==='p'))hits.add('minor');
      for(const key of hits)meters[key]+=section;
    }
    return {meters,landmarks:[...landmarks]};
  });
}

export function assessRoute(profiles,edgeIds,requested,target){
  const matches=requested.map(key=>({key,meters:0,met:false}));
  const names=new Set();
  for(const index of edgeIds){
    const p=profiles[index];
    for(const match of matches)match.meters+=p.meters[match.key];
    if(requested.includes('architecture'))for(const name of p.landmarks)names.add(name);
  }
  let count=0, exposure=0;
  for(const m of matches){
    m.meters=Math.round(m.meters);
    if(m.key==='architecture'){m.names=[...names];m.met=m.names.length>0;}
    else m.met=m.meters>=Math.max(60,Math.min(150,target*.05));
    if(m.met)count++;
    // Each request has equal weight, even when small streets cover most of the city.
    exposure+=m.key==='architecture'?Math.min(1,names.size/3):Math.min(1,m.meters/(target*.45));
  }
  return {matches,count,exposure:exposure/requested.length};
}
