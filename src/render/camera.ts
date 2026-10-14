import * as THREE from 'three';

/** Tilted perspective RTS camera. `zoom` keeps its old meaning: screen pixels per tile (horizontally) at the focus point. */
export class Camera {
  x = 12; y = 24;          // ground focus point, in tiles
  zoom = 30;
  vw = 800; vh = 600;      // viewport CSS pixels
  yaw = 0;                 // orbit angle (only used by the title-screen showcase)
  insetT = 0; insetB = 0;  // pixels covered by the HUD at the top / bottom
  worldW = 72; worldH = 48;
  readonly three = new THREE.PerspectiveCamera(30, 1, 1, 300);
  /** terrain height lookup, supplied by the renderer */
  heightAt: (x: number, y: number) => number = () => 0;
  static readonly PITCH = (58 * Math.PI) / 180;
  private key = '';
  private ray = new THREE.Raycaster();
  private v = new THREE.Vector3();

  private sync() {
    const k = `${this.x}|${this.y}|${this.zoom}|${this.vw}|${this.vh}|${this.insetT}|${this.insetB}|${this.yaw}`;
    if (k === this.key) return;
    this.key = k;
    const c = this.three, fov = (c.fov * Math.PI) / 180;
    const dist = this.vh / (2 * Math.tan(fov / 2) * this.zoom);
    const P = Camera.PITCH;
    const hd = Math.cos(P) * dist;
    c.position.set(this.x + Math.sin(this.yaw) * hd, Math.sin(P) * dist, this.y + Math.cos(this.yaw) * hd);
    c.lookAt(this.x, 0, this.y);
    c.aspect = this.vw / this.vh;
    const shift = (this.insetT - this.insetB) / 2;
    c.setViewOffset(this.vw, this.vh, 0, -shift, this.vw, this.vh);
    c.updateProjectionMatrix(); c.updateMatrixWorld(true);
  }
  update() { this.sync(); }

  toScreen(wx: number, wy: number, h = 0) {
    this.sync();
    this.v.set(wx, h, wy).project(this.three);
    return { x: ((this.v.x + 1) / 2) * this.vw, y: ((1 - this.v.y) / 2) * this.vh };
  }
  toWorld(sx: number, sy: number) {
    this.sync();
    this.ray.setFromCamera({ x: (sx / this.vw) * 2 - 1, y: -(sy / this.vh) * 2 + 1 } as THREE.Vector2, this.three);
    const o = this.ray.ray.origin, d = this.ray.ray.direction;
    let hgt = 0, px = this.x, pz = this.y;
    for (let i = 0; i < 3; i++) {
      const t = (hgt - o.y) / (d.y || -1e-6);
      px = o.x + d.x * t; pz = o.z + d.z * t;
      hgt = Math.max(-0.5, Math.min(0.6, this.heightAt(px, pz)));
    }
    return { x: px, y: pz };
  }

  minZoom() { return Math.max(11, this.vw / (this.worldW * 1.15)); }
  setSize(w: number, h: number) { this.vw = w; this.vh = h; this.clamp(); }
  setInsets(top: number, bottom: number) { this.insetT = top; this.insetB = bottom; this.clamp(); }
  zoomAt(factor: number, sx: number, sy: number) {
    const before = this.toWorld(sx, sy);
    this.zoom = Math.max(this.minZoom(), Math.min(80, this.zoom * factor));
    const after = this.toWorld(sx, sy);
    this.x += before.x - after.x; this.y += before.y - after.y;
    this.clamp();
  }
  pan(dxPx: number, dyPx: number) {
    this.x -= dxPx / this.zoom;
    this.y -= dyPx / (this.zoom * Math.sin(Camera.PITCH));
    this.clamp();
  }
  centerOn(x: number, y: number) { this.x = x; this.y = y; this.clamp(); }
  clamp() {
    this.zoom = Math.max(this.minZoom(), Math.min(80, this.zoom));
    this.x = Math.max(1, Math.min(this.worldW - 1, this.x));
    this.y = Math.max(1, Math.min(this.worldH - 1, this.y));
  }
}
