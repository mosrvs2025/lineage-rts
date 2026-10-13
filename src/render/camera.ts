export class Camera {
  x = 12; y = 24;          // world point shown at the centre of the free (un-covered) area, in tiles
  zoom = 30;               // pixels per tile
  vw = 800; vh = 600;      // viewport CSS pixels
  insetT = 0; insetB = 0;  // pixels covered by the HUD at the top / bottom
  worldW = 72; worldH = 48;

  private get cy() { return (this.vh + this.insetT - this.insetB) / 2; }
  toScreen(wx: number, wy: number) { return { x: (wx - this.x) * this.zoom + this.vw / 2, y: (wy - this.y) * this.zoom + this.cy }; }
  toWorld(sx: number, sy: number) { return { x: (sx - this.vw / 2) / this.zoom + this.x, y: (sy - this.cy) / this.zoom + this.y }; }

  minZoom() { return Math.max(10, Math.min(this.vw / this.worldW, (this.vh - this.insetT - this.insetB) / this.worldH) * 0.95); }
  setSize(w: number, h: number) { this.vw = w; this.vh = h; this.clamp(); }
  setInsets(top: number, bottom: number) { this.insetT = top; this.insetB = bottom; this.clamp(); }
  zoomAt(factor: number, sx: number, sy: number) {
    const before = this.toWorld(sx, sy);
    this.zoom = Math.max(this.minZoom(), Math.min(64, this.zoom * factor));
    const after = this.toWorld(sx, sy);
    this.x += before.x - after.x; this.y += before.y - after.y;
    this.clamp();
  }
  pan(dxPx: number, dyPx: number) { this.x -= dxPx / this.zoom; this.y -= dyPx / this.zoom; this.clamp(); }
  centerOn(x: number, y: number) { this.x = x; this.y = y; this.clamp(); }
  clamp() {
    this.zoom = Math.max(this.minZoom(), Math.min(64, this.zoom));
    const z = this.zoom, cy = this.cy;
    // keep the world edges from drifting past the free area; centre the world when it fits
    const xlo = this.vw / 2 / z, xhi = this.worldW - this.vw / 2 / z;
    this.x = xlo >= xhi ? this.worldW / 2 : Math.max(xlo, Math.min(xhi, this.x));
    const ylo = (cy - this.insetT) / z, yhi = this.worldH - (this.vh - this.insetB - cy) / z;
    this.y = ylo >= yhi ? this.worldH / 2 : Math.max(ylo, Math.min(yhi, this.y));
  }
}
