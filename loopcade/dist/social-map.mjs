let city;
export function cityMap(){return city??=fetch('gent.json').then(r=>{if(!r.ok)throw Error('Kaart niet beschikbaar.');return r.json();}).catch(e=>{city=null;throw e;});}
export async function drawRouteMap(canvas,lines){
  const data=await cityMap();
  if(!canvas.isConnected)return;
  const w=canvas.width=860,h=canvas.height=410,c=canvas.getContext('2d');
  let left=Infinity,right=-Infinity,bottom=Infinity,top=-Infinity;
  for(const [x,y] of lines.flat()){left=Math.min(left,x);right=Math.max(right,x);top=Math.max(top,y);bottom=Math.min(bottom,y);}
  if(left===Infinity){left=bottom=-500;right=top=500;}
  const s=Math.min((w-80)/Math.max(650,right-left),(h-62)/Math.max(500,top-bottom));
  const cx=(left+right)/2,cy=(top+bottom)/2;
  c.fillStyle='#181725';c.fillRect(0,0,w,h);
  c.translate(w/2-cx*s,h/2+cy*s);c.scale(s,-s);
  for(const key of ['g','w','r','s','a']){
    c.beginPath();
    for(const [type,,,ids] of data.ways){
      if(type!==key)continue;
      ids.forEach((id,i)=>{const [x,y]=data.points[id];if(i)c.lineTo(x,y);else c.moveTo(x,y);});
    }
    if(key==='g'||key==='w'){c.fillStyle=key==='g'?'#1c3937':'#244562';c.fill();}
    else{c.lineWidth=key==='r'?14:key==='a'?3/s:1.3/s;c.strokeStyle={r:'#294c6b',a:'#63596d',s:'#454052'}[key];c.stroke();}
  }
  c.strokeStyle='#ff71c4';c.lineWidth=4/s;c.lineJoin='round';
  for(const line of lines){c.beginPath();line.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.stroke();}
}
