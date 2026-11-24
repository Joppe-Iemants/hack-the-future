const palette = {
  b: ['#262439', null, 0], g: ['#193336', '#295047', 1], w: ['#243c58', '#375674', 1],
  r: [null, '#29435e', 8], p: [null, '#363346', .8], s: [null, '#484358', 2.4],
  a: [null, '#5a5066', 3.5], t: [null, '#444051', .7],
};
const districts = [
  ['PATERSHOL',3.7233,51.0588],['PRINSENHOF',3.7139,51.0586],['ELISABETBEGIJNHOF',3.71,51.0562],
  ['BINNENSTAD',3.726,51.0532],['SINT-MICHIELS',3.7168,51.0517],['PORTUS GANDA',3.7348,51.0548],
  ['SLUIZEKEN',3.726,51.0621],['RABOT',3.7101,51.0645],['ZUID',3.7301,51.0466],
  ['COUPURE',3.7094,51.0483],['HEILIG KERST',3.7299,51.0654],['SINT-PIETERS',3.7249,51.0405],
  ['CITADELPARK',3.7181,51.0354],['ROOIGEM',3.6936,51.0616],['BRUGSE POORT',3.6995,51.0564],
  ['MUIDE',3.7407,51.0754],['MACHARIUS',3.7393,51.0538],['BEGIJNHOF',3.7376,51.0481],
];

export class RouteMap {
  constructor(canvas, data) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.data = data;
    this.marker=document.querySelector('#start-marker');
    this.zoom = 1; this.center = [0,0]; this.points = []; this.base = 1;
    this.layers = {};
    for (const key of Object.keys(palette)) this.layers[key] = [];
    for (const [type,,name,ids] of data.ways) {
      const path = new Path2D();
      let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
      ids.forEach((id,i) => {
        const [x,y] = data.points[id];
        minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);
        if (i) path.lineTo(x,-y); else path.moveTo(x,-y);
      });
      this.layers[type]?.push({path, bounds:[minX,minY,maxX,maxY], name, ids});
    }
    const schedule = () => this.schedule();
    new ResizeObserver(() => {if(this.canvas.clientWidth) this.fit();}).observe(canvas);
    canvas.addEventListener('wheel', e => {e.preventDefault();this.zoomBy(e.deltaY<0?1.22:1/1.22);},{passive:false});
    let drag, down, moved;
    canvas.addEventListener('pointerdown', e=>{
      if(!e.isPrimary || e.button!==0)return;
      canvas.setPointerCapture(e.pointerId);down=drag=[e.clientX,e.clientY];moved=false;
    });
    canvas.addEventListener('pointermove', e=>{
      if (!e.isPrimary || !drag) return;
      if(!moved && Math.hypot(e.clientX-down[0],e.clientY-down[1])<5)return;
      moved=true;
      this.center[0]-=(e.clientX-drag[0])/this.scale;this.center[1]+=(e.clientY-drag[1])/this.scale;
      drag=[e.clientX,e.clientY];schedule();
    });
    canvas.addEventListener('pointerup',e=>{
      if(!e.isPrimary || !drag || moved || !this.onPick)return;
      const rect=canvas.getBoundingClientRect();
      this.onPick([this.center[0]+(e.clientX-rect.left-rect.width/2)/this.scale,
        this.center[1]-(e.clientY-rect.top-rect.height/2)/this.scale]);
    });
    canvas.addEventListener('lostpointercapture',()=>{drag=null;});
    canvas.addEventListener('keydown', e=>{
      if(e.key==='Enter' && this.onPick){e.preventDefault();this.onPick(this.center);return;}
      const keys={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,1],ArrowDown:[0,-1]};
      if(keys[e.key]) {e.preventDefault();const [x,y]=keys[e.key];this.center[0]+=x*65/this.scale;this.center[1]+=y*65/this.scale;schedule();}
      if(['+','=','-'].includes(e.key)) {e.preventDefault();this.zoomBy(e.key==='-'?.75:1.35);}
    });
    document.querySelector('#zoom-in').onclick=()=>this.zoomBy(1.4);
    document.querySelector('#zoom-out').onclick=()=>this.zoomBy(1/1.4);
    document.querySelector('#map-fit').onclick=()=>this.fit();
  }
  get scale(){return this.base*this.zoom;}
  zoomBy(factor){this.zoom=Math.max(.5,Math.min(12,this.zoom*factor));this.schedule();}
  setStart(point){
    this.start=point;
    const w=this.canvas.clientWidth,h=this.canvas.clientHeight;
    if(Math.abs(point[0]-this.center[0])*this.scale>w/2-40 ||
       Math.abs(point[1]-this.center[1])*this.scale>h/2-42)this.center=[...point];
    this.schedule();
  }
  setRoute(points){this.points=points;if(points.length)this.fit();else this.schedule();}
  fit() {
    if(!this.canvas.clientWidth)return;
    if(!this.points.length){if(this.start)this.center=[...this.start];this.schedule();return;}
    const xs=this.points.map(p=>p[0]),ys=this.points.map(p=>p[1]);
    const left=Math.min(...xs),right=Math.max(...xs),bottom=Math.min(...ys),top=Math.max(...ys);
    this.center=[(left+right)/2,(bottom+top)/2];this.zoom=1;
    this.base=Math.min((this.canvas.clientWidth-105)/Math.max(100,right-left),(this.canvas.clientHeight-78)/Math.max(100,top-bottom));
    this.schedule();
  }
  schedule(){if(!this.frame)this.frame=requestAnimationFrame(()=>{this.frame=0;this.draw();});}
  draw(){
    const {canvas,ctx:c,center,scale:s}=this,w=canvas.clientWidth,h=canvas.clientHeight;
    if(!w||!h)return;
    const dpr=Math.min(devicePixelRatio||1,2);
    if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}
    c.setTransform(dpr,0,0,dpr,0,0);c.fillStyle='#191926';c.fillRect(0,0,w,h);
    const screen=([x,y])=>[(x-center[0])*s+w/2,(center[1]-y)*s+h/2];
    const l=center[0]-w/(2*s),r=center[0]+w/(2*s),b=center[1]-h/(2*s),t=center[1]+h/(2*s);
    const labels=[];
    c.save();c.translate(w/2-center[0]*s,h/2+center[1]*s);c.scale(s,s);c.lineJoin='round';c.lineCap='round';
    for(const key of ['g','b','w','r','t','p','s','a']){
      const [fill,stroke,lw]=palette[key];if(fill)c.fillStyle=fill;if(stroke)c.strokeStyle=stroke;
      c.lineWidth=key==='r'?Math.max(5/s,14):lw/s;
      const merged=new Path2D();
      for(const way of this.layers[key]){
        const [x1,y1,x2,y2]=way.bounds;
        if(x2<l||x1>r||y2<b||y1>t)continue;
        if(key==='b' && Math.max(x2-x1,y2-y1)*s<2)continue;
        merged.addPath(way.path);
        if((key==='s'||key==='a')&&way.name&&Math.max(x2-x1,y2-y1)*s>45)labels.push(way);
      }
      if(fill)c.fill(merged);if(stroke)c.stroke(merged);
    }
    c.restore();
    const spots=[];
    const fits=(x,y,margin)=>x>12&&y>12&&x<w-15&&y<h-8&&!spots.some(p=>Math.abs(p[0]-x)<margin&&Math.abs(p[1]-y)<20);
    c.textAlign='center';c.textBaseline='middle';c.lineJoin='round';
    for(const [name,lon,lat] of districts){
      const [x,y]=screen([(lon-this.data.origin[0])*this.data.scale[0],(lat-this.data.origin[1])*this.data.scale[1]]);
      if(!fits(x,y,75))continue;spots.push([x,y]);
      c.font='bold 10px monospace';c.strokeStyle='#191926';c.lineWidth=3;c.strokeText(name,x,y);c.fillStyle='#aaa1b9';c.fillText(name,x,y);
    }
    const used=new Set();
    for(const way of labels){
      if(used.has(way.name))continue;
      const start=screen(this.data.points[way.ids[0]]),end=screen(this.data.points[way.ids.at(-1)]);
      const [x,y]=screen(this.data.points[way.ids[Math.floor(way.ids.length/2)]]);
      if(!fits(x,y,85))continue;spots.push([x,y]);used.add(way.name);
      let angle=Math.atan2(end[1]-start[1],end[0]-start[0]);if(Math.abs(angle)>Math.PI/2)angle+=Math.PI;
      c.save();c.translate(x,y);c.rotate(angle);c.font='10px Arial';c.fillStyle='#9b92a8';
      c.strokeStyle='#1c192b';c.lineWidth=2;c.strokeText(way.name,0,-3);c.fillText(way.name,0,-3);c.restore();
    }
    if(this.points.length){
      const path=new Path2D(),coords=this.points.map(screen);coords.forEach(([x,y],i)=>i?path.lineTo(x,y):path.moveTo(x,y));
      c.lineCap='round';c.lineJoin='round';
      for(const [color,width] of [['#ff4ca21c',13],['#ff4ca236',8],['#39162f',5.3],['#ff62b7',3.5]]){
        c.strokeStyle=color;c.lineWidth=width;c.stroke(path);
      }
      // Direction ticks follow the order of the route.
      let accumulated=0;
      for(let i=1;i<coords.length;i++){
        const [x,y]=coords[i], [px,py]=coords[i-1];accumulated+=Math.hypot(x-px,y-py);
        if(accumulated<85 || Math.hypot(x-px,y-py)<3)continue;
        accumulated=0;c.save();c.translate(x,y);c.rotate(Math.atan2(y-py,x-px));c.beginPath();c.moveTo(-4,-3);c.lineTo(0,0);c.lineTo(-4,3);c.strokeStyle='#ffe5f5';c.lineWidth=1.7;c.stroke();c.restore();
      }
    }
    if(this.start){
      const [x,y]=screen(this.start);
      this.marker.hidden=x<0||y<0||x>w||y>h;
      this.marker.style.left=x+'px';this.marker.style.top=y+'px';
      this.marker.classList.toggle('label-left',x>w-100);
      this.marker.querySelector('span').textContent=this.points.length?'Start / finish':'Startpunt';
    }
    if(this.position){
      const [x,y]=screen(this.position);c.beginPath();c.arc(x,y,6,0,2*Math.PI);c.fillStyle='#64f1ef';c.fill();c.lineWidth=2;c.strokeStyle='#fff';c.stroke();
    }
    const meters=[10,20,50,100,200,500,1000].findLast(n=>n*s<=80)||10;
    const el=document.querySelector('#scale');el.textContent=meters>=1000?'1 km':meters+' m';el.style.width=Math.round(meters*s)+'px';
  }
}
