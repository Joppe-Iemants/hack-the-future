// Draw the masthead at a low native resolution to keep its arcade pixels sharp.
(() => {
  const canvas = document.getElementById('skyline');
  const w = canvas.width = 720, h = canvas.height = 142;
  const c = canvas.getContext('2d');
  let seed = 80;
  const random = () => ((seed = (Math.imul(1664525, seed) + 1013904223) >>> 0) / 4294967296);
  function gradient(x, y, x2, y2, stops) {
    const g = c.createLinearGradient(x,y,x2,y2);
    stops.forEach(([pos,color])=>g.addColorStop(pos,color));
    return g;
  }
  function pixelLine(x1,y1,x2,y2,color,width=1) {
    const n = Math.max(1,Math.ceil(Math.max(Math.abs(x2-x1),Math.abs(y2-y1))));
    c.fillStyle = color;
    for(let i=0;i<=n;i++) c.fillRect(Math.round(x1+(x2-x1)*i/n),Math.round(y1+(y2-y1)*i/n),width,1);
  }
  function poly(points, color) {
    c.fillStyle=color; c.beginPath(); c.moveTo(...points[0]);
    points.slice(1).forEach(p=>c.lineTo(...p)); c.closePath(); c.fill();
  }
  c.fillStyle = gradient(0,0,0,h,[[0,'#100d29'],[.42,'#251237'],[.72,'#502045'],[1,'#100e26']]);
  c.fillRect(0,0,w,h);
  const glow = c.createRadialGradient(530,66,4,530,66,155);
  glow.addColorStop(0,'#ee47625c'); glow.addColorStop(.55,'#ae30622e'); glow.addColorStop(1,'#a8355800');
  c.fillStyle=glow; c.fillRect(0,0,w,h);
  for(let i=0;i<155;i++){
    const x=Math.floor(random()*w), y=Math.floor(random()*90);
    c.fillStyle=['#b8adca','#76779a','#ff99ca','#675582'][i%4];
    c.fillRect(x,y,1,1);
    if(i%35===0){ c.fillRect(x-2,y,5,1); c.fillRect(x,y-2,1,5); }
  }
  const sx=535, sy=68, r=48;
  c.fillStyle=gradient(0,sy-r,0,sy+r,[[0,'#ffdd86'],[.29,'#ffb66e'],[.60,'#ff7d7e'],[1,'#eb3b9a']]);
  for(let y=-r;y<=r;y++){
    const band=y+r;
    if(band>44 && ((band-44)%9 < Math.min(6,1+Math.floor((band-44)/9)))) continue;
    const half=Math.floor(Math.sqrt(r*r-y*y));
    c.fillRect(sx-half,sy+y,half*2,1);
  }
  function clouds(cx, cy, span) {
    for(let i=0;i<22;i++){
      const x=Math.floor(cx+(random()-.5)*span), y=Math.floor(cy+random()*5);
      c.fillStyle=['#4f2344','#73324e','#68314f','#95455a'][i%4];
      c.fillRect(x,y,Math.floor(random()*20+5),1);
    }
  }
  clouds(451,57,64);clouds(603,69,70);clouds(381,76,52);
  // Distant city, with individual windows and antennae.
  for(let x=212;x<w;x+=4+Math.floor(random()*6)){
    const bh=5+Math.floor(random()*14),bw=3+Math.floor(random()*7),y=103-bh;
    c.fillStyle='#30203e';c.fillRect(x,y,bw,bh);c.fillStyle='#76405b';c.fillRect(x,y,bw,1);
    if(random()>.8)pixelLine(x+2,y,x+2,y-4,'#693855');
    for(let j=2;j<bh-2;j+=3)if(random()>.5){c.fillStyle='#ba6470';c.fillRect(x+1,y+j,1,1);}
  }
  // Triangulated mountain ridges. Highlights follow a stepped pixel silhouette.
  function ridge(peaks, base, fill, edge, wire) {
    poly([[peaks[0][0],base],...peaks,[peaks.at(-1)[0],base]],fill);
    for(let i=0;i<peaks.length-1;i++) {
      const [x,y]=peaks[i], [nx,ny]=peaks[i+1];
      pixelLine(x,y,nx,ny,edge);
      const split=(x+nx)/2+(random()-.5)*9, floor=base-1-random()*6;
      pixelLine(x,y,split,floor,wire);pixelLine(split,floor,nx,ny,wire);
      pixelLine(x+(split-x)*.53,y+(floor-y)*.53,nx+(split-nx)*.42,ny+(floor-ny)*.42,wire);
    }
  }
  ridge([[214,100],[259,89],[284,94],[331,72],[350,76],[372,62],[394,78],[407,73],[437,94],[459,89],[484,101],[558,101],[600,80],[617,85],[639,65],[660,77],[690,56],[720,79]],109,'#3b214e','#965179','#743861');
  ridge([[150,106],[209,98],[231,101],[268,83],[278,86],[305,66],[317,70],[337,51],[351,61],[369,80],[383,74],[406,88],[444,105],[480,106],[531,107],[583,104],[621,92],[640,81],[654,82],[682,59],[693,67],[704,60],[720,78]],113,'#251a40','#db6998','#713962');
  ridge([[129,111],[187,104],[226,106],[259,96],[276,100],[309,80],[324,86],[344,71],[363,90],[378,86],[410,104],[444,110],[571,110],[610,97],[625,100],[661,79],[674,83],[693,70],[720,94]],115,'#15162d','#796597','#454263');
  c.fillStyle=gradient(0,111,0,h,[[0,'#342042'],[.4,'#20152f'],[1,'#131025']]);c.fillRect(0,112,w,h-112);
  for (let x=-900;x<1700;x+=78)pixelLine(520+(x-520)*.03,112,x,150,'#713363');
  [113,115,118,123,130,140].forEach((y,i)=>pixelLine(0,y,w,y,i<3?'#8c4472':'#593054'));
  // Pixel palms at the right frame the sunset, leaving the route title clear.
  function palm(x,y,size,lean,shade){
    const topX=x+lean, topY=y-size;
    for(let i=0;i<size;i++){
      const t=i/size, px=x+lean*t*t;
      c.fillStyle=shade;c.fillRect(Math.round(px),y-i,Math.max(1,Math.round((1-t)*2+size/24)),2);
      if(i%5===0){c.fillStyle='#633854';c.fillRect(Math.round(px),y-i,1,1);}
    }
    for(const [reach,lift,tip] of [[-.54,.29,.19],[-.47,.11,.29],[-.36,.39,-.06],[-.14,.32,-.13],[.12,.35,-.11],[.41,.32,.03],[.55,.17,.15],[.44,.06,.29],[-.27,.04,.37]]){
      let last=[topX,topY];
      for(let n=1;n<=15;n++){
        const t=n/15, xx=topX+size*reach*t, yy=topY+size*(-lift*Math.sin(t*Math.PI)+tip*t);
        pixelLine(...last,xx,yy,shade,2);
        const len=(Math.sin(t*Math.PI)*.12+.025)*size;
        pixelLine(xx,yy,xx+Math.sign(reach)*len*.29,yy+len,shade,2);
        last=[xx,yy];
      }
    }
  }
  palm(669,115,37,-3,'#191427');palm(689,122,62,3,'#100f22');palm(713,122,39,-3,'#151123');
  poly([[626,124],[647,119],[671,118],[683,114],[705,116],[720,113],[720,131],[626,125]],'#161023');
  const fade=gradient(0,0,420,0,[[0,'#10101dfd'],[.37,'#10101df4'],[.61,'#10101dd5'],[.83,'#10101d77'],[1,'#10101d00']]);
  c.fillStyle=fade;c.fillRect(0,0,420,h);
})();
