import {profileEdges,assessRoute} from './scenery.mjs';
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const reward = meters => 50 + Math.round(meters / 100);

// Binary min-heap for the shortest-path searches.
class MinHeap {
  items = [];
  add(node, cost) {
    const item = [node, cost];
    let i = this.items.length;
    this.items.push(item);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.items[parent][1] <= cost) break;
      this.items[i] = this.items[parent];
      i = parent;
    }
    this.items[i] = item;
  }
  take() {
    const list = this.items, first = list[0], last = list.pop();
    if (!list.length) return first;
    let i = 0;
    while (i * 2 + 1 < list.length) {
      let child = i * 2 + 1;
      if (child + 1 < list.length && list[child + 1][1] < list[child][1]) child++;
      if (last[1] <= list[child][1]) break;
      list[i] = list[child];
      i = child;
    }
    list[i] = last;
    return first;
  }
}

export function createNetwork(data) {
  const graph = new Map(), names = new Map(), edges=[], edgeByPair=new Map();
  const pair = (a,b) => Math.min(a,b)*data.points.length+Math.max(a,b);
  const connect = (a, b, length, index) => {
    if (!graph.has(a)) graph.set(a, []);
    graph.get(a).push([b, length, index]);
  };
  for (const [type, walk, name, ids] of data.ways) {
    if (!walk) continue;
    for (let i = 1; i < ids.length; i++) {
      const a = ids[i - 1], b = ids[i];
      if (a === b) continue;
      const length = Math.max(.1, distance(data.points[a], data.points[b]));
      const key=pair(a,b);
      if(edgeByPair.has(key)){
        if(type==='a')edges[edgeByPair.get(key)].type='a';
        continue;
      }
      const index=edges.length;
      edges.push({a,b,type,length});edgeByPair.set(key,index);
      connect(a, b, length, index);
      connect(b, a, length, index);
    }
    if (name && !names.has(name)) names.set(name, ids[Math.floor(ids.length / 2)]);
  }
  const visited = new Set();
  let connected = [];
  for (const node of graph.keys()) {
    if (visited.has(node)) continue;
    const component = [node];
    visited.add(node);
    for (let i = 0; i < component.length; i++)
      for (const [next] of graph.get(component[i])) {
        if (visited.has(next)) continue;
        visited.add(next);
        component.push(next);
      }
    if (component.length > connected.length) connected = component;
  }
  const main = new Set(connected);
  for (const [name, id] of names) if (!main.has(id)) names.delete(name);
  const nearest = point => {
    let best, gap = Infinity;
    for (const id of connected) {
      const d = distance(point, data.points[id]);
      if (d < gap) { best = id; gap = d; }
    }
    return {id: best, gap};
  };
  return {data,points: data.points, graph, connected, nearest, names,edges,edgeByPair,pair};
}

function shortest(network, start, limit, weights) {
  const cost = new Map([[start, 0]]), lengths=weights?new Map([[start,0]]):cost, prev = new Map(), heap = new MinHeap();
  heap.add(start, 0);
  while (heap.items.length) {
    const [node, current] = heap.take();
    if (current !== cost.get(node)) continue;
    const traveled=lengths.get(node);
    for (const [next, length, index] of network.graph.get(node)) {
      const meters=traveled+length, alt=weights?current+weights[index]:meters;
      if (meters > limit || alt >= (cost.get(next) ?? Infinity)) continue;
      cost.set(next, alt);
      if(weights)lengths.set(next,meters);
      prev.set(next, node);
      heap.add(next, alt);
    }
  }
  return {lengths, prev};
}

function path(prev, end) {
  const list = [end];
  while (prev.has(end)) { end = prev.get(end); list.push(end); }
  return list.reverse();
}

export function makeRoutes(network, start, target, random = Math.random, requested=[]) {
  const {points} = network;
  let weights;
  if(requested.length){
    network.profiles??=profileEdges(network.data,network.edges);
    weights=network.edges.map((edge,i)=>{
      const meters=network.profiles[i].meters;
      const preferred=Math.max(...requested.map(key=>meters[key]));
      return edge.length-.35*preferred;
    });
  }
  const root = shortest(network, start, target * .74, weights);
  const bearings = new Map(), pool = [];
  for (const [node, length] of root.lengths) {
    if (length < target * .14 || length > target * .55) continue;
    bearings.set(node, Math.atan2(points[node][1] - points[start][1], points[node][0] - points[start][0]));
    pool.push(node);
  }
  if (!pool.length) return [];
  const angle = random() * 2 * Math.PI, results = [];
  const delta = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  for (let i = 0; i < 9; i++) {
    const bearing = angle + i * 2.39996, radius = target * (.27 + random() * .12);
    let anchor, score = Infinity;
    for (const id of pool) {
      const diff = delta(bearing, bearings.get(id)) + Math.abs(root.lengths.get(id) - radius) / radius;
      if (diff < score) {score = diff; anchor = id;}
    }
    const middle = shortest(network, anchor, target * .62, weights);
    const choices = [];
    for (const id of pool) {
      const d = middle.lengths.get(id), turn = delta(bearings.get(id), bearings.get(anchor));
      if (!d || turn < .65 || turn > 2.65) continue;
      const meters = root.lengths.get(anchor) + d + root.lengths.get(id);
      choices.push({id, meters, diff: Math.abs(meters - target)});
    }
    choices.sort((a, b) => a.diff - b.diff);
    const fromStart = path(root.prev, anchor);
    for (const candidate of choices.slice(0, 32)) {
      const ids = [...fromStart, ...path(middle.prev, candidate.id).slice(1), ...path(root.prev, candidate.id).reverse().slice(1)];
      const seen = new Set();
      let repeated = 0;
      for (let j = 1; j < ids.length; j++) {
        const a = ids[j-1], b = ids[j], index=network.edgeByPair.get(network.pair(a,b));
        if (seen.has(index)) repeated += network.edges[index].length;
        seen.add(index);
      }
      if (repeated / candidate.meters > .14) continue;
      const fit=weights?assessRoute(network.profiles,seen,requested,target):{count:0,exposure:0,matches:[]};
      results.push({ids,meters:candidate.meters,matches:fit.matches,count:fit.count,
        score:candidate.diff+repeated*.55-target*.12*fit.exposure});
    }
  }
  results.sort((a,b)=>b.count-a.count || a.score-b.score);
  const tolerance = Math.max(100, target * .05);
  const close = results.find(r => Math.abs(r.meters - target) <= tolerance);
  if (close) return [close];
  return [results.find(r => r.meters < target), results.find(r => r.meters >= target)].filter(Boolean);
}

export function climb(points, grid) {
  if (!grid) return null;
  const {width, height, step, x0, y0, samples} = grid;
  function elevation([x, y]) {
    const col = Math.max(0, Math.min(width - 1.001, (x - x0)/step));
    const row = Math.max(0, Math.min(height - 1.001, (y - y0)/step));
    const base = Math.floor(row) * width + Math.floor(col), dx = col % 1, dy = row % 1;
    return (samples[base] * (1-dx) + samples[base+1]*dx) * (1-dy)
      + (samples[base+width] * (1-dx) + samples[base+width+1]*dx) * dy;
  }
  let last = elevation(points[0]), gain = 0;
  for (const point of points.slice(1)) {
    const alt = elevation(point);
    if (Math.abs(alt - last) < 1) continue;
    gain += Math.max(0, alt - last);
    last = alt;
  }
  return Math.round(gain);
}
