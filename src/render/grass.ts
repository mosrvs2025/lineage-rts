/** Wind-swayed instanced grass around the camera focus: the single biggest lift to ground realism. */
import * as THREE from 'three';
import type { World } from '../sim/types';
import { hash2 } from './art';
import { MAT, enhance } from './models';

function bladeGeo() {
  // tapered 3-triangle blade, dark root -> bright tip, normals tilted up for soft lighting
  const pos = [-0.035, 0, 0, 0.035, 0, 0, -0.026, 0.22, 0.012, 0.035, 0, 0, 0.026, 0.22, 0.012, -0.026, 0.22, 0.012, -0.026, 0.22, 0.012, 0.026, 0.22, 0.012, 0, 0.44, 0.04];
  const cols = [0.17, 0.33, 0.12, 0.17, 0.33, 0.12, 0.31, 0.54, 0.18, 0.17, 0.33, 0.12, 0.31, 0.54, 0.18, 0.31, 0.54, 0.18, 0.31, 0.54, 0.18, 0.31, 0.54, 0.18, 0.62, 0.8, 0.3].map((v) => Math.pow(v, 2.2));
  const nrm = new Array(9).fill(0).flatMap(() => [0, 0.92, 0.38]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return g;
}

export class Grass {
  readonly mesh: THREE.InstancedMesh;
  private cx = -999; private cz = -999; private sig = ''; private cap: number;
  private mat: THREE.MeshStandardMaterial;
  private dummy = new THREE.Object3D();
  private tints = [new THREE.Color(1, 1, 1), new THREE.Color(1.15, 1.05, 0.7), new THREE.Color(0.8, 1, 0.82), new THREE.Color(1.05, 0.95, 0.6), new THREE.Color(0.9, 1.1, 0.9)];
  spacing = 0.2; radius = 21; autumn = 0.35;

  constructor(cap = 42000) {
    this.cap = cap;
    this.mat = enhance(new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 1, metalness: 0 }), { sway: 22, snow: 0 });
    this.mesh = new THREE.InstancedMesh(bladeGeo(), this.mat, cap); this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.castShadow = false; this.mesh.receiveShadow = false;
    this.mesh.renderOrder = 0;
    void MAT;
  }

  /** Re-scatter blades when the camera moved far enough or the world's blocked tiles changed. */
  update(focusX: number, focusZ: number, w: World, heightAt: (x: number, z: number) => number, winter: number, force = false) {
    const sig = `${w.buildings.length}|${w.nodes.length}|${this.spacing}|${this.radius}`;
    if (force || sig !== this.sig || Math.hypot(focusX - this.cx, focusZ - this.cz) > 5) {
      this.sig = sig; this.cx = focusX; this.cz = focusZ;
      const R = this.radius, sp = this.spacing, x0 = Math.floor((focusX - R) / sp), x1 = Math.ceil((focusX + R) / sp), z0 = Math.floor((focusZ - R) / sp), z1 = Math.ceil((focusZ + R) / sp);
      let n = 0;
      for (let gz = z0; gz <= z1 && n < this.cap; gz++) for (let gx = x0; gx <= x1 && n < this.cap; gx++) {
        const jx = hash2(gx, gz, 1), jz = hash2(gx, gz, 2), x = (gx + jx) * sp, z = (gz + jz) * sp;
        const d = Math.hypot(x - focusX, z - focusZ); if (d > R) continue;
        const tx = Math.floor(x), tz = Math.floor(z);
        if (tx < 1 || tz < 1 || tx >= w.W - 1 || tz >= w.H - 1 || w.terrain[tz][tx] !== '.') continue;
        if (w._blocked && w._blocked[tz * w.W + tx]) continue;
        const h = heightAt(x, z);
        if (h < -0.05 || h > 0.6) continue;
        const fall = Math.min(1, (R - d) / 5), s = (0.7 + hash2(gx, gz, 3) * 0.8) * fall;
        if (s < 0.08) continue;
        this.dummy.position.set(x, h - 0.01, z); this.dummy.rotation.set(0, hash2(gx, gz, 4) * 6.283, (hash2(gx, gz, 5) - 0.5) * 0.3); this.dummy.scale.set(s, s * (0.8 + hash2(gx, gz, 6) * 0.7), s); this.dummy.updateMatrix();
        this.mesh.setMatrixAt(n, this.dummy.matrix);
        const tint = this.tints[Math.floor(hash2(gx, gz, 7) * (this.tints.length - 0.01))];
        this.mesh.setColorAt(n, tint); n++;
      }
      this.mesh.count = n; this.mesh.instanceMatrix.needsUpdate = true; if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
    // winter: blades are buried and frosted
    this.mesh.scale.y = 1 - 0.7 * winter; this.mat.color.setRGB(1 - 0.05 * winter, 1 - 0.0 * winter, 1 + 0.1 * winter).lerp(new THREE.Color(1.7, 1.8, 2), winter * 0.85);
  }
}
