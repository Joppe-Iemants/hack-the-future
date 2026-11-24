// Kaart met verzameld terrein: de Gentse basiskaart met per speler gekleurde rastercellen.
import {cellBounds, parseCellId, LON_STEP} from './play-grid.mjs';

export const PLAYER_COLORS = ['#63f4df', '#ff63bf', '#ffcf75', '#b6a0fd', '#8be28b', '#ff9a62', '#6fb7ff', '#e68aff', '#eded6b', '#ff7d7d', '#7de3c4', '#c9c4d6'];

const base = {
  g: {fill: '#1b3a36'}, w: {fill: '#243f5e'},
  r: {stroke: '#2c4863', width: 7}, p: {stroke: '#34314a', width: .8}, s: {stroke: '#46415a', width: 1.6}, a: {stroke: '#5b5169', width: 2.6},
};

export class TerritoryMap {
  constructor(canvas, data) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.data = data;
    this.center = [0, 0]; this.zoom = 1; this.baseScale = .1; this.players = []; this.start = null; this.version = 0;
    this.layers = {};
    for (const key of Object.keys(base)) this.layers[key] = new Path2D();
    for (const [type, , , ids] of data.ways) {
      const layer = this.layers[type];
      if (!layer) continue;
      ids.forEach((id, i) => { const [x, y] = data.points[id]; if (i) layer.lineTo(x, -y); else layer.moveTo(x, -y); });
    }
    new ResizeObserver(() => { if (canvas.clientWidth) this.schedule(); }).observe(canvas);
    canvas.addEventListener('wheel', event => { event.preventDefault(); this.zoomBy(event.deltaY < 0 ? 1.25 : 1 / 1.25); }, {passive: false});
    let drag = null;
    canvas.addEventListener('pointerdown', event => { if (event.isPrimary && event.button === 0) { canvas.setPointerCapture(event.pointerId); drag = [event.clientX, event.clientY]; } });
    canvas.addEventListener('pointermove', event => {
      if (!drag || !event.isPrimary) return;
      this.center[0] -= (event.clientX - drag[0]) / this.scale; this.center[1] += (event.clientY - drag[1]) / this.scale;
      drag = [event.clientX, event.clientY]; this.schedule();
    });
    canvas.addEventListener('pointerup', () => { drag = null; });
    canvas.addEventListener('lostpointercapture', () => { drag = null; });
    canvas.addEventListener('keydown', event => {
      const keys = {ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1]};
      if (keys[event.key]) { event.preventDefault(); this.center[0] += keys[event.key][0] * 80 / this.scale; this.center[1] += keys[event.key][1] * 80 / this.scale; this.schedule(); }
      if (['+', '=', '-'].includes(event.key)) { event.preventDefault(); this.zoomBy(event.key === '-' ? .8 : 1.25); }
    });
  }

  get scale() { return this.baseScale * this.zoom; }
  local(lon, lat) { return [(lon - this.data.origin[0]) * this.data.scale[0], (lat - this.data.origin[1]) * this.data.scale[1]]; }
  zoomBy(factor) { this.zoom = Math.max(.35, Math.min(14, this.zoom * factor)); this.schedule(); }

  // players: [{uid, color, cells: Iterable<id>}]; visible: Set<uid>
  setData({start, players, visible, meUid}) {
    this.start = start ? this.local(start.lon, start.lat) : null;
    this.players = players.map(player => {
      const path = new Path2D();
      for (const id of player.cells) {
        const cell = parseCellId(id);
        if (!cell) continue;
        const {west, south, east, north} = cellBounds(cell);
        const [x0, y0] = this.local(west, south), [x1, y1] = this.local(east, north);
        path.rect(x0, -y1, x1 - x0, y1 - y0);
      }
      return {uid: player.uid, color: player.color, path, mine: player.uid === meUid};
    });
    this.visible = visible;
    this.schedule();
  }

  // Past het beeld aan op het gezamenlijke startpunt met ruimte voor ongeveer `meters` rondom.
  fit(meters = 1500) {
    const width = this.canvas.clientWidth, height = this.canvas.clientHeight;
    if (!width || !height) return;
    if (this.start) this.center = [...this.start];
    this.zoom = 1; this.baseScale = Math.min(width, height) / (2 * meters);
    this.schedule();
  }

  schedule() { if (!this.frame) this.frame = requestAnimationFrame(() => { this.frame = 0; this.draw(); }); }

  draw() {
    const {canvas, ctx: c, center, scale: s} = this, w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    c.setTransform(dpr, 0, 0, dpr, 0, 0); c.fillStyle = '#171726'; c.fillRect(0, 0, w, h);
    c.save(); c.translate(w / 2 - center[0] * s, h / 2 + center[1] * s); c.scale(s, s); c.lineJoin = 'round'; c.lineCap = 'round';
    for (const key of ['g', 'w', 'r', 'p', 's', 'a']) {
      const style = base[key];
      if (style.fill) { c.fillStyle = style.fill; c.fill(this.layers[key]); }
      else { c.strokeStyle = style.stroke; c.lineWidth = Math.max(style.width, 1.1 / s); c.stroke(this.layers[key]); }
    }
    // Raster: alleen zichtbaar als een cel groot genoeg is op het scherm.
    const cellPixels = 100 * s;
    if (cellPixels >= 12) this.drawGrid(c, w, h, s);
    // Verzameld terrein: halftransparante vulling per speler, zodat gedeelde cellen zichtbaar zijn.
    for (const player of this.players) {
      if (this.visible && !this.visible.has(player.uid)) continue;
      c.globalAlpha = .38; c.fillStyle = player.color; c.fill(player.path);
      c.globalAlpha = .9; c.strokeStyle = player.color; c.lineWidth = Math.max(player.mine ? 1.6 : .8, .8 / s); if (cellPixels >= 6) c.stroke(player.path);
      c.globalAlpha = 1;
    }
    // Speelgebied en startpunt.
    if (this.start) {
      const [sx, sy] = this.start;
      c.setLineDash([12 / s, 9 / s]); c.strokeStyle = '#ffffff55'; c.lineWidth = 1.2 / s; c.beginPath(); c.arc(sx, -sy, 5000, 0, Math.PI * 2); c.stroke(); c.setLineDash([]);
      c.beginPath(); c.arc(sx, -sy, 9 / s, 0, Math.PI * 2); c.fillStyle = '#ffffff'; c.fill(); c.lineWidth = 3 / s; c.strokeStyle = '#0c0c18'; c.stroke();
    }
    c.restore();
    if (this.start) {
      const x = (this.start[0] - center[0]) * s + w / 2, y = (center[1] - this.start[1]) * s + h / 2;
      if (x > 0 && y > 0 && x < w && y < h) {
        c.font = 'bold 11px monospace'; c.textBaseline = 'middle'; c.lineWidth = 3; c.strokeStyle = '#0c0c18'; c.strokeText('START', x + 12, y); c.fillStyle = '#fff'; c.fillText('START', x + 12, y);
      }
    }
  }

  drawGrid(c, w, h, s) {
    const [cx, cy] = this.center, left = cx - w / (2 * s), right = cx + w / (2 * s), bottom = cy - h / (2 * s), top = cy + h / (2 * s);
    const [ox, oy] = this.local(0, 0), stepX = LON_STEP * this.data.scale[0], stepY = stepX; // cellen zijn ~vierkant
    c.beginPath(); c.strokeStyle = '#ffffff14'; c.lineWidth = 1 / s;
    const gx = (Math.floor((left - ox) / stepX)) * stepX + ox, gy = (Math.floor((bottom - oy) / stepY)) * stepY + oy;
    for (let x = gx; x <= right; x += stepX) { c.moveTo(x, -bottom); c.lineTo(x, -top); }
    for (let y = gy; y <= top; y += stepY) { c.moveTo(left, -y); c.lineTo(right, -y); }
    c.stroke();
  }
}
