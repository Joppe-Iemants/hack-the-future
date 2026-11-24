import {encodePath, decodePath} from './route-codec.mjs';

// Fixed sample routes in Ghent; no real user location or private reflection.
const sampleRoutes = ["v1.za,3ti;-a,-2i;a,0;bo,-32;k0,-4q;2i,-k;u,32;50,-1o;4g,-1e;a,-a;7s,-3w;28,-14;3c,-1y;k,0;1y,1y;2s,2s;3c,3m;1y,32;14,1o;k,u;4q,8m;14,1y;k,u;gy,i2;dm,eg;7i,82;1o,1e;u,u;3w,4g;1o,1y;2s,28;a,1e;k,28;k,28;0,3m;a,1o;0,28;-1o,1e;-k,1e;0,1e;a,1e;u,14;k,k;-14,28;-a,u;-k,3w;-k,2s;-u,50;-1o,6o;-1o,4g;-1o,4g;-a,k;-1o,32;-k,1o;-3w,82;-a,u;-1y,2s;-5a,4g;-64,5k;-28,1y;-1e,1e;-1e,1o;-3c,4g;-1o,1y;-28,1y;-1e,14;-2i,1o;-3m,1e;-1e,a;-a,0;-u,a;-4q,14;-14,0;-14,a;-6e,1e;-1e,14;-k,-1e;-a,-k;-k,-1e;-46,28;-1e,u;-1y,-28;-k,-k;-1y,u;-4q,1y;-a0,4q;-a,a;-a,a;-k,u;-2i,4q;-28,46;-u,-k;-2s,-1o;4q,-8m;k,-u;a,-a;-14,-k;-32,-28;-4q,-32;-3m,-2i;-6e,-4g;-46,-3c;-4g,-32;-3c,-2s;-2s,-28;-3c,-2s;-14,-u;-5u,-50;-k,-a;-u,-u;-k,-14;-k,-k;-a,-k;-k,-1e;-k,-1o;-a,-28;0,-u;0,-k;u,-8c;14,-8w;a,-1y;1y,-5u;a,-14;3c,-9g;1o,-46;0,-u;-a,-2s;-a,-1o;0,-k;1e,-k;14,-u;k,-k;u,-k;1e,-3w;1o,-3m;14,-28;a,-k;3m,-50;a,-k;k,-k;a,-k;1e,-28;k,-k;k,-u;0,-a;14,-1e;u,-1e;a,-1e;a,-1o;a,-1e;-a,-1y;-u,-1y;-1e,-2s;-u,-k;-u,-1o;-14,-1y;-u,-2s;-k,-1o;-k,-14;-1e,-7s;-a,-14;-14,-6y;-a,-6o;-a,-3c","v1.za,3ti;a,3c;a,6o;14,6y;a,14;1e,7s;k,14;k,1o;u,2s;14,1y;u,1o;u,k;1e,2s;u,1y;a,1y;a,0;3c,0;1y,1o;7i,9g;3w,5a;4g,6o;6o,a0;7i,9q;14,1e;-u,14;-a,u;a,u;k,14;3w,5k;-u,k;-4q,32;0,0;-1y,a;-4q,2s;u,1e;1e,32;2s,6o;1e,3w;1o,3m;1o,46;28,3w;3c,5u;4q,7i;0,a;1e,3c;0,2s;0,2s;0,3c;k,1e;a,k;k,1e;-14,14;-14,1y;-a,1o;u,2s;0,3c;0,1o;a,k;-a,1y;0,a;14,k;1o,u;1o,28;au,fa;by,g4;a,a;a,k;a,-a;bo,-7s;3c,a;3c,a;46,-a;32,-14;2s,-1y;5k,-7s;28,-1e;2s,-1o;82,-46;32,-u;1y,-1o;6e,-3c;aa,-5k;1y,-u;3c,-a;1e,0;qe,-64;ak,-2i;6e,-1e;go,-46;1y,-a;1y,-a;1y,0;fu,14;6e,-le;1e,14;-1e,-14;u,-28;5a,-oq;4g,-m8;k,-1o;-2i,-k;-64,-u;-by,-1e;-eg,-1y;-4g,-k;-4g,-k;-a,-5k;0,-2s;-3c,-a;-3c,-14;-2s,14;-14,1e;-3c,4q;-14,1e;-32,1e;-1o,a;-4g,k;-78,k;-be,1o;-ak,1e;-28,a;-8w,-1e;-5k,-1o;-82,-2i;-46,-1e;-2i,-k;0,-28;-u,-1o;-1o,-14;-1e,-32;-a,-u;-28,-3m;-k,-28;-k,-28;-a,-1e;-2s,-28;-1o,-1y;-3w,-4g;-u,-u;-1o,-1e;-7i,-82;-dm,-eg;-gy,-i2;-k,-u;-14,-1y;-4q,-8m;-k,-u;-14,-1o;-1y,-32;-3c,-3m;-2s,-2s;-1y,-1y;-k,0;-3c,1y;-28,14;-7s,3w;-a,a;-4g,1e;-50,1o;-u,-32;-2i,k;-k0,4q;-bo,32;-a,0;a,2i","v1.za,3ti;-a,-2i;-a,-4q;0,-5u;-k,0;-1y,-k;-28,0;-78,0;0,-1o;-2i,0;-28,0;0,-u;a,-1o;-k,0;-by,-a;-1y,-a;-k,0;-6y,-a;-28,-a;-46,-a;-5a,-u;-1e,-a;-14,-a;-3m,-u;-3w,-u;-u,a;-14,0;-2s,k;-u,u;-50,3m;-50,3m;-3c,32;-4q,5u;-u,14;-14,14;-1o,14;-1o,k;-1y,k;-8c,14;-28,a;-28,a;-4q,a;-dw,1o;-9g,u;-be,u;-2i,a;-3w,u;-2i,u;-4q,1o;-50,2i;-5a,3c;-3m,2i;-3c,32;-14,14;-1e,-k;-a,-a;-b4,-4q;-3c,14;-14,a;-32,u;-hi,46;-2i,u;-82,28;-6y,1o;-a0,k;-1o,0;-k,0;-28,ci;-a,14;-a,14;-k,u;-k,u;-3c,5u;-k,1y;-a,2i;-k,a;-u,u;1e,1e;2i,1e;2s,28;6y,4g;3m,2i;2i,1e;u,-1e;14,-u;fu,-be;2i,-28;1e,-14;28,k;u,a;1mm,3w;k,0;1y,a;k,0;u,-k;u,-a;u,-a;14,0;1o,0;4q,k;7s,a;u,0;au,u;1y,0;14,0;8m,k;78,a;4g,a;46,a;46,0;14,a;0,a;0,u;-28,96;0,k;0,2i;-46,cs;-a,u;k,k;5a,3w;fu,aa;k,u;0,u;3m,k;k,a;3m,2s;u,0;c8,64;28,14;46,28;1e,u;1e,u;u,a;iw,9g;2s,1o;k,a;14,14;dw,a0;46,2i;4q,2s;46,3c;6e,4g;3m,2i;4q,32;32,28;14,k;-a,a;-k,u;-4q,8m;2s,1o;u,k;k,a;3m,28;14,u;a,14;a,14;k,14;u,14;-14,1e;-u,u;-a,14;0,1o;-u,2i;-1e,28;u,32;0,14;-a,u;-a,u;a,u;k,u;a,u;a,u;-a,u;k,u;a,14;a,u;k,k;a,k;3w,u;1o,1o;6e,a;14,k;32,0;1o,0;0,-1e;14,-nw;-k,-32;a,-5k;a,-u;0,-a;a,-k;1e,-1o;1y,-28;k,-1o;a,-3m;a,-1o;14,-1y;14,-14;-k,-1e;-a,-k;-k,-1e;0,-3c;0,-2s;0,-2s;-1e,-3c;0,-a;-4q,-7i;-3c,-5u;-28,-3w;-1o,-46;-1o,-3m;-1e,-3w;-2s,-6o;-1e,-32;-u,-1e;4q,-2s;1y,-a;0,0;4q,-32;u,-k;-3w,-5k;-k,-14;-a,-u;a,-u;u,-14;-14,-1e;-7i,-9q;-6o,-a0;-4g,-6o;-3w,-5a;-7i,-9g;-1y,-1o;-3c,0;-a,0;-a,-1y;-u,-1y;-1e,-2s;-u,-k;-u,-1o;-14,-1y;-u,-2s;-k,-1o;-k,-14;-1e,-7s;-a,-14;-14,-6y;-a,-6o;-a,-3c"];

export function createDemoFriends(now = Date.now()) {
  const people = [
    ['demo-noor', 'Noor', 'noor.demo', 'accepted'],
    ['demo-milan', 'Milan', 'milan.demo', 'accepted'],
    ['demo-yara', 'Yara', 'yara.demo', 'pending'],
  ];
  return Object.fromEntries(people.map(([id, name, handle, status], index) => {
    const path = decodePath(sampleRoutes[index]);
    const meters = Math.round(path.slice(1).reduce((sum, point, i) => sum + Math.hypot(point[0] - path[i][0], point[1] - path[i][1]), 0));
    const parts = []; let part = [];
    for (const point of path) {
      if (Math.hypot(point[0] - path[0][0], point[1] - path[0][1]) < 350) {
        if (part.length > 1) parts.push(encodePath(part));
        part = [];
      } else part.push(point);
    }
    if (part.length > 1) parts.push(encodePath(part));
    const activities = [0, 1].map(offset => ({
      id: id + '-run-' + offset,
      mode: offset ? 'walk' : 'run',
      meters,
      elapsed: Math.round(meters * (offset ? 720 : 360)),
      points: 50 + Math.round(meters / 100),
      end: now - (index + offset + 1) * 3600000,
      // Encoded strings avoid unsupported nested arrays in Firestore.
      lines: parts,
    }));
    return [id, {id, name, handle, isDemo: true, status, activities}];
  }));
}
