import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { enhance, merge, MAT, type Part } from './models';
import { blenderGeo } from './blenderMeshes';
import { CharacterMotion } from './character-motion';
import type { Species, Unit, UnitKind, World } from '../sim/types';

type BodyKind = 'barbarian' | 'rogue';
export interface Warband {
  root: THREE.Object3D;
  motion: CharacterMotion;
  right: THREE.Object3D;
  left: THREE.Object3D;
  nativeWeapon?: THREE.Object3D;
}
const sources = new Map<BodyKind, GLTF>();
const pending = new Set<BodyKind>();
const colors = new Map<string, THREE.BufferGeometry>();
const regaliaCache = new Map<string, THREE.BufferGeometry>();
const material = enhance(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .82 }));
const loader = new GLTFLoader();
const urls = {
  barbarian: new URL('../../public/assets/characters/warband-barbarian.glb', import.meta.url).href,
  rogue: new URL('../../public/assets/characters/warband-rogue.glb', import.meta.url).href,
};
const light = ['gatherer', 'scout', 'hunter', 'slinger', 'stalker'];

const cyl = (rt: number, rb: number, h: number, seg = 8) => new THREE.CylinderGeometry(rt, rb, h, seg);
const cone = (r: number, h: number, seg = 7) => new THREE.ConeGeometry(r, h, seg);
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const sph = (r: number, seg = 8) => new THREE.SphereGeometry(r, seg, seg);

export function createWarband(u: Unit, w: World): Warband | undefined {
  const kind: BodyKind = light.includes(u.kind) ? 'rogue' : 'barbarian';
  const source = sources.get(kind);
  if (!source) {
    if (!pending.has(kind)) {
      pending.add(kind);
      loader.load(urls[kind], gltf => {
        gltf.scene.traverse(o => { if (o instanceof THREE.Mesh) {
          for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
          o.material = material;
        } });
        sources.set(kind, gltf);
      }, undefined, error => console.warn(`Character unavailable; retaining fallback (${kind})`, error));
    }
    return;
  }
  return instantiateWarband(source, u, w);
}

/** Build cached 3D Species silhouette geometries (Human Sun-Hawk plumes, Neanderthal Mammoth tusks & frost pelt, Denisovan Jade horns & dorsal crystals). */
function getSpeciesGeo(slot: 'head' | 'chest', species: Species, teamHex: string): THREE.BufferGeometry {
  const k = `sp:${slot}:${species}:${teamHex}`;
  const hit = regaliaCache.get(k);
  if (hit) return hit;

  let geo: THREE.BufferGeometry;
  if (species === 'human') {
    if (slot === 'head') {
      // Sun-Hawk Winged Circlet + Swept Golden & Clan Eagle Plumes
      geo = merge([
        { g: blenderGeo('helm_human'), c: '#f0c254', p: [0, 0, 0] },
        { g: cone(0.055, 0.44, 6), c: teamHex, p: [-0.34, 0.82, -0.10], r: [-0.95, 0, 0.32] },
        { g: cone(0.055, 0.44, 6), c: teamHex, p: [0.34, 0.82, -0.10], r: [-0.95, 0, -0.32] },
        { g: sph(0.068, 8), c: '#38e2f7', p: [0, 0.62, 0.39], s: [1.1, 1.1, 0.5] },
      ]);
    } else {
      // Sun-Strider Pectoral Disc & Woven Turquoise Baldric
      geo = merge([
        { g: cyl(0.11, 0.11, 0.035, 12), c: '#f0c254', p: [0, 0.22, 0.30], r: [Math.PI / 2, 0, 0] },
        { g: sph(0.058, 8), c: '#38e2f7', p: [0, 0.22, 0.32], s: [1, 1, 0.5] },
        { g: box(0.46, 0.065, 0.04), c: teamHex, p: [0, 0.14, 0.27], r: [0.1, 0, 0.52] },
      ]);
    }
  } else if (species === 'neanderthal') {
    if (slot === 'head') {
      // Mammoth-Skull Brow Plate, Twin Curved Ivory Tusks & Fiery Braided Russet War-Beard
      geo = merge([
        { g: blenderGeo('skull_neanderthal'), c: '#eee4cc', p: [0, 0, 0] },
        { g: box(0.52, 0.065, 0.18), c: teamHex, p: [0, 0.54, 0.28], r: [0.18, 0, 0] },
        // Thick braided russet war-beard hanging from jaw
        { g: sph(0.19, 8), c: '#8c3b1a', p: [0, 0.18, 0.28], s: [1.25, 0.95, 0.9] },
        { g: cone(0.11, 0.34, 6), c: '#752f14', p: [-0.11, -0.02, 0.31], r: [Math.PI - 0.2, 0, -0.15] },
        { g: cone(0.11, 0.34, 6), c: '#752f14', p: [0.11, -0.02, 0.31], r: [Math.PI - 0.2, 0, 0.15] },
        { g: cyl(0.038, 0.038, 0.045, 8), c: '#f0c254', p: [-0.11, -0.08, 0.32] },
        { g: cyl(0.038, 0.038, 0.045, 8), c: '#f0c254', p: [0.11, -0.08, 0.32] },
      ]);
    } else {
      // Massive Shaggy White Frost-Wolf Pelt Mantle & Mammoth-Rib Chest Guard
      geo = merge([
        { g: sph(0.28, 9), c: '#e5e2da', p: [0, 0.34, -0.18], s: [1.65, 0.82, 1.05] },
        { g: sph(0.22, 8), c: '#d4d0c6', p: [-0.28, 0.32, -0.04], s: [1.15, 0.85, 1.1] },
        { g: sph(0.22, 8), c: '#d4d0c6', p: [0.28, 0.32, -0.04], s: [1.15, 0.85, 1.1] },
        // Mammoth-rib chest bars
        { g: box(0.42, 0.055, 0.08), c: '#efe5cd', p: [0, 0.24, 0.26], r: [0, 0, 0.08] },
        { g: box(0.38, 0.055, 0.08), c: '#efe5cd', p: [0, 0.14, 0.27], r: [0, 0, -0.08] },
      ]);
    }
  } else {
    // Denisovan: Jade-Peak Swept Ibex Horns,Glowing Emerald Forehead Spire & Dorsal Jade Shards
    if (slot === 'head') {
      geo = merge([
        { g: blenderGeo('crest_denisovan'), c: '#2b2533', p: [0, 0, 0] },
        { g: cone(0.068, 0.38, 6), c: '#38f2b2', p: [0, 0.82, 0.34], r: [0.22, 0, 0] },
        { g: box(0.11, 0.032, 0.04), c: '#ff5232', p: [-0.26, 0.38, 0.31], r: [0, -0.35, 0.25] },
        { g: box(0.11, 0.032, 0.04), c: '#ff5232', p: [0.26, 0.38, 0.31], r: [0, 0.35, -0.25] },
      ]);
    } else {
      geo = merge([
        { g: cyl(0.26, 0.30, 0.09, 10), c: '#342c40', p: [0, 0.28, 0.04], s: [1.2, 1, 0.85] },
        // 3 Glowing Jade Crystal Spines rising behind upper back
        { g: cone(0.055, 0.42, 5), c: '#38f2b2', p: [0, 0.56, -0.28], r: [-0.32, 0, 0] },
        { g: cone(0.045, 0.34, 5), c: '#29c796', p: [-0.18, 0.48, -0.26], r: [-0.28, 0, 0.35] },
        { g: cone(0.045, 0.34, 5), c: '#29c796', p: [0.18, 0.48, -0.26], r: [-0.28, 0, -0.35] },
        { g: sph(0.068, 8), c: '#38f2b2', p: [0, 0.20, 0.29], s: [0.9, 1.2, 0.5] },
      ]);
    }
  }

  regaliaCache.set(k, geo);
  return geo;
}

/** Build cached 3D Role-specific silhouette gear so every unit class is unmistakable in-game (Warcraft II/III readability). */
function getRoleGeo(slot: 'head' | 'chest', kind: UnitKind, teamHex: string): THREE.BufferGeometry | null {
  const k = `role:${slot}:${kind}:${teamHex}`;
  const hit = regaliaCache.get(k);
  if (hit) return hit;

  let parts: Part[] | null = null;
  if (slot === 'head') {
    switch (kind) {
      case 'gatherer':
        // Worker sun-hood bandana & knotted headband
        parts = [
          { g: sph(0.37, 9), c: '#c99f62', p: [0, 0.56, -0.03], s: [1.04, 0.65, 1.08] },
          { g: cyl(0.36, 0.37, 0.06, 12), c: teamHex, p: [0, 0.50, 0.01] },
        ];
        break;
      case 'scout':
        // Tall twin eagle-feather wayfinder crest
        parts = [
          { g: cone(0.048, 0.56, 5), c: '#ffe9a0', p: [-0.12, 0.88, -0.06], r: [-0.25, 0, 0.22] },
          { g: cone(0.048, 0.56, 5), c: teamHex, p: [0.12, 0.88, -0.06], r: [-0.25, 0, -0.22] },
        ];
        break;
      case 'hunter':
        // Predator wolf-pelt stalker hood with ears & snout over brow
        parts = [
          { g: sph(0.39, 9), c: '#5c4d42', p: [0, 0.60, -0.02], s: [1.06, 0.78, 1.12] },
          { g: box(0.24, 0.10, 0.22), c: '#6e5d50', p: [0, 0.68, 0.28], r: [0.18, 0, 0] },
          { g: cone(0.065, 0.18, 4), c: '#483b32', p: [-0.22, 0.86, 0.04], r: [0, 0, 0.28] },
          { g: cone(0.065, 0.18, 4), c: '#483b32', p: [0.22, 0.86, 0.04], r: [0, 0, -0.28] },
        ];
        break;
      case 'guard':
        // Tall crested war-helm with sweeping clan horsehair plume
        parts = [
          { g: sph(0.38, 10), c: '#d0c6b4', p: [0, 0.58, 0.0], s: [1.05, 0.72, 1.08] },
          { g: box(0.09, 0.34, 0.54), c: teamHex, p: [0, 0.86, -0.02], r: [-0.1, 0, 0] },
          { g: box(0.10, 0.07, 0.56), c: '#f0c254', p: [0, 0.72, -0.02], r: [-0.1, 0, 0] },
        ];
        break;
      case 'raider':
        // Spiked crimson & war-paint berserker mohawk crest
        parts = [
          { g: cone(0.06, 0.34, 5), c: '#ff422e', p: [0, 0.88, 0.14], r: [0.35, 0, 0] },
          { g: cone(0.06, 0.38, 5), c: teamHex, p: [0, 0.92, -0.02], r: [0.0, 0, 0] },
          { g: cone(0.06, 0.34, 5), c: '#ff422e', p: [0, 0.86, -0.18], r: [-0.35, 0, 0] },
        ];
        break;
      case 'elder':
        // Ceremonial Shaman Antler Skull-Crown + Flowing White Wisdom Beard
        parts = [
          { g: sph(0.38, 9), c: '#f2ece0', p: [0, 0.62, 0.04], s: [1.05, 0.68, 1.1] },
          { g: cone(0.055, 0.48, 6), c: '#7fd0c0', p: [-0.28, 0.88, 0.06], r: [0.15, 0, 0.48] },
          { g: cone(0.055, 0.48, 6), c: '#7fd0c0', p: [0.28, 0.88, 0.06], r: [0.15, 0, -0.48] },
          { g: cone(0.14, 0.46, 7), c: '#f7f4ec', p: [0, 0.02, 0.34], r: [Math.PI - 0.15, 0, 0] },
        ];
        break;
      case 'slinger':
        // Sun-Skirmisher Visor & Swept Plume
        parts = [
          { g: box(0.42, 0.06, 0.18), c: '#f0c254', p: [0, 0.56, 0.28], r: [0.2, 0, 0] },
          { g: cone(0.055, 0.42, 5), c: teamHex, p: [0.16, 0.84, -0.08], r: [-0.45, 0, -0.35] },
        ];
        break;
      case 'brute':
        // Colossal Siege-Horned Great Visor
        parts = [
          { g: cone(0.085, 0.48, 6), c: '#f5eedc', p: [-0.38, 0.76, 0.14], r: [0.4, 0, 0.65] },
          { g: cone(0.085, 0.48, 6), c: '#f5eedc', p: [0.38, 0.76, 0.14], r: [0.4, 0, -0.65] },
        ];
        break;
      case 'stalker':
        // Jade Shadow-Hunter Visor Mask & Plume
        parts = [
          { g: box(0.44, 0.14, 0.12), c: '#1f2924', p: [0, 0.46, 0.32] },
          { g: cone(0.055, 0.44, 5), c: '#38f2b2', p: [0, 0.86, -0.10], r: [-0.5, 0, 0] },
        ];
        break;
      case 'champion':
        // Gilded 5-Plume Royal Warlord Helm
        parts = [
          { g: sph(0.40, 10), c: '#f0c254', p: [0, 0.60, 0.0], s: [1.08, 0.76, 1.1] },
          ...[-2, -1, 0, 1, 2].map(i => ({
            g: cone(0.052, 0.44 - Math.abs(i) * 0.04, 5),
            c: i % 2 === 0 ? teamHex : '#fff0b8',
            p: [i * 0.09, 0.92, -0.02] as [number, number, number],
            r: [-0.15, 0, -i * 0.18] as [number, number, number],
          })),
        ];
        break;
      default:
        break;
    }
  } else {
    // Chest / Dorsal silhouette attachments
    switch (kind) {
      case 'leader':
        // Heroic Dorsal Clan Totem Standard rising high behind the Leader even in Gen I
        parts = [
          { g: cyl(0.026, 0.03, 1.28, 7), c: '#5c3d22', p: [0, 0.68, -0.28], r: [-0.08, 0, 0] },
          { g: box(0.38, 0.04, 0.04), c: '#f0c254', p: [0, 1.24, -0.32] },
          { g: box(0.32, 0.54, 0.022), c: teamHex, p: [0, 0.94, -0.32], r: [-0.08, 0, 0] },
          { g: box(0.34, 0.07, 0.026), c: '#ffd86b', p: [0, 0.96, -0.32], r: [-0.08, 0, 0] },
          { g: sph(0.075, 8), c: '#ffe07d', p: [0, 1.34, -0.33] },
        ];
        break;
      case 'gatherer':
        // Sculpted Woven Dorsal Worker Basket with timber logs & stone
        parts = [
          { g: blenderGeo('pack_worker'), c: '#c49758', p: [0, 0, 0] },
          { g: box(0.46, 0.07, 0.34), c: teamHex, p: [0, 0.38, -0.34] },
        ];
        break;
      case 'scout':
        // Wayfinder Rolled Map-Scroll & Signal Horn on back
        parts = [
          { g: cyl(0.065, 0.065, 0.52, 8), c: '#e8d8b0', p: [0, 0.38, -0.27], r: [0, 0, 0.85] },
          { g: cone(0.075, 0.36, 7), c: '#efe4c8', p: [0.22, 0.16, 0.18], r: [0.4, 0, -0.6] },
        ];
        break;
      case 'hunter':
        // Sculpted Dorsal Arrow Quiver + Fletched Shafts
        parts = [
          { g: blenderGeo('quiver_hunter'), c: '#7a5230', p: [0, 0, 0] },
          { g: box(0.24, 0.10, 0.04), c: teamHex, p: [0.16, 0.72, -0.31], r: [0, 0, -0.32] },
        ];
        break;
      case 'guard':
        // Heavy Armored Bone-and-Bronze Cuirass
        parts = [
          { g: cyl(0.26, 0.29, 0.34, 10), c: '#d8cfc0', p: [0, 0.18, 0.04], s: [1.12, 1, 0.88] },
          { g: box(0.24, 0.26, 0.06), c: teamHex, p: [0, 0.18, 0.27] },
          { g: sph(0.065, 8), c: '#f0c254', p: [0, 0.20, 0.30], s: [1, 1, 0.5] },
        ];
        break;
      case 'raider':
        // Spiked Predator-Bone Shoulder Trophies & Crossed Harness
        parts = [
          { g: sph(0.15, 7), c: '#efe5cd', p: [-0.28, 0.34, 0.04], s: [1.1, 0.9, 1.2] },
          { g: sph(0.15, 7), c: '#efe5cd', p: [0.28, 0.34, 0.04], s: [1.1, 0.9, 1.2] },
          { g: cone(0.045, 0.24, 5), c: '#ff422e', p: [-0.34, 0.48, 0.04], r: [0, 0, 0.55] },
          { g: cone(0.045, 0.24, 5), c: '#ff422e', p: [0.34, 0.48, 0.04], r: [0, 0, -0.55] },
        ];
        break;
      case 'elder':
        // Shaman Spirit Mantle + Twin Floating Turquoise Spirit-Totem Poles on Back
        parts = [
          { g: cyl(0.27, 0.32, 0.24, 10), c: '#6d4c82', p: [0, 0.24, 0.0], s: [1.18, 1, 0.92] },
          { g: cyl(0.02, 0.024, 0.95, 6), c: '#5c3d22', p: [-0.20, 0.54, -0.26], r: [-0.1, 0, 0.18] },
          { g: cyl(0.02, 0.024, 0.95, 6), c: '#5c3d22', p: [0.20, 0.54, -0.26], r: [-0.1, 0, -0.18] },
          { g: sph(0.095, 8), c: '#5ef2d6', p: [-0.28, 1.00, -0.30] },
          { g: sph(0.095, 8), c: '#5ef2d6', p: [0.28, 1.00, -0.30] },
        ];
        break;
      case 'slinger':
        // Crossed Stone-Pouch Bandolier & Ammo Satchel
        parts = [
          { g: box(0.48, 0.09, 0.28), c: '#8a6236', p: [0, 0.18, 0.04], r: [0, 0, 0.55] },
          { g: sph(0.12, 7), c: '#a67844', p: [0.24, 0.02, 0.16] },
          { g: sph(0.12, 7), c: teamHex, p: [-0.24, 0.02, 0.16] },
        ];
        break;
      case 'brute':
        // Colossal Mammoth-Bone Fortress Shoulders & Spikes
        parts = [
          { g: sph(0.22, 8), c: '#e8dec4', p: [-0.32, 0.36, 0.0], s: [1.25, 0.95, 1.2] },
          { g: sph(0.22, 8), c: '#e8dec4', p: [0.32, 0.36, 0.0], s: [1.25, 0.95, 1.2] },
          { g: cone(0.065, 0.36, 6), c: '#fff5dc', p: [-0.44, 0.56, 0.0], r: [0, 0, 0.65] },
          { g: cone(0.065, 0.36, 6), c: '#fff5dc', p: [0.44, 0.56, 0.0], r: [0, 0, -0.65] },
        ];
        break;
      case 'stalker':
        // Back-Mounted Fan of 3 Oversized Barbed Harpoon-Javelins
        parts = [-1, 0, 1].flatMap(i => [
          { g: cyl(0.022, 0.022, 1.18, 5), c: '#8c6238', p: [i * 0.12, 0.52, -0.28] as [number, number, number], r: [-0.12, 0, -i * 0.22] as [number, number, number] },
          { g: cone(0.055, 0.24, 5), c: '#38f2b2', p: [i * 0.24, 1.08, -0.34] as [number, number, number], r: [-0.12, 0, -i * 0.22] as [number, number, number] },
        ]);
        break;
      case 'champion':
        // Gilded Plate Cuirass + Dorsal Champion War-Banner
        parts = [
          { g: cyl(0.27, 0.30, 0.36, 12), c: '#f0c254', p: [0, 0.18, 0.04], s: [1.16, 1, 0.9] },
          { g: cyl(0.024, 0.028, 1.18, 7), c: '#f0c254', p: [0, 0.64, -0.28], r: [-0.1, 0, 0] },
          { g: box(0.28, 0.48, 0.022), c: teamHex, p: [0, 0.90, -0.32], r: [-0.1, 0, 0] },
        ];
        break;
      default:
        break;
    }
  }
  if (!parts) return null;
  const geo = merge(parts);
  regaliaCache.set(k, geo);
  return geo;
}

/** Build cached 3D regalia geometries for shoulders, chest, back-banners, and crowns across Gen I -> II -> III. */
function getRegaliaGeo(slot: string, genTier: number, teamHex: string): THREE.BufferGeometry {
  const k = `${slot}:${genTier}:${teamHex}`;
  const hit = regaliaCache.get(k);
  if (hit) return hit;

  let geo: THREE.BufferGeometry;
  if (slot === 'pauldronL' || slot === 'pauldronR') {
    const side = slot === 'pauldronL' ? 1 : -1;
    const plateCol = genTier >= 3 ? '#f0c254' : '#e6dac0';
    const trimCol = genTier >= 3 ? '#fff1b8' : teamHex;
    const parts: Part[] = [
      // Main curved shoulder dome
      { g: sph(0.18, 9), c: plateCol, p: [side * 0.06, 0.04, 0], s: [1.15, 0.68, 1.1] },
      // War-paint rim band
      { g: cyl(0.19, 0.21, 0.045, 10), c: teamHex, p: [side * 0.06, -0.01, 0], r: [0, 0, -side * 0.22] },
      // Outward mammoth-ivory / gold spike
      { g: cone(0.042, genTier >= 3 ? 0.26 : 0.19, 7), c: trimCol, p: [side * 0.17, 0.14, 0], r: [0, 0, -side * 0.65] },
    ];
    if (genTier >= 3) {
      // Second upper sun-crest ridge + secondary spike for Gen III
      parts.push(
        { g: box(0.22, 0.05, 0.24), c: '#d99b2e', p: [side * 0.05, 0.09, 0], r: [0, 0, -side * 0.18] },
        { g: cone(0.034, 0.21, 6), c: '#fff3c4', p: [side * 0.09, 0.18, -0.07], r: [-0.25, 0, -side * 0.42] },
      );
    }
    geo = merge(parts);
  } else if (slot === 'chestGen2') {
    // Era II: Carved bone gorget + 5 predator fangs + clan war-paint stone
    geo = merge([
      { g: cyl(0.24, 0.28, 0.06, 10), c: '#e8dec4', p: [0, 0.19, 0.14], r: [0.35, 0, 0], s: [1.1, 1, 0.65] },
      { g: sph(0.065, 8), c: teamHex, p: [0, 0.16, 0.31], s: [1.1, 1.1, 0.6] },
      { g: cone(0.025, 0.11, 5), c: '#f5eedc', p: [-0.13, 0.11, 0.29], r: [Math.PI, 0, -0.15] },
      { g: cone(0.028, 0.13, 5), c: '#f5eedc', p: [-0.065, 0.09, 0.32], r: [Math.PI, 0, -0.07] },
      { g: cone(0.032, 0.15, 5), c: '#fff6e4', p: [0, 0.08, 0.33], r: [Math.PI, 0, 0] },
      { g: cone(0.028, 0.13, 5), c: '#f5eedc', p: [0.065, 0.09, 0.32], r: [Math.PI, 0, 0.07] },
      { g: cone(0.025, 0.11, 5), c: '#f5eedc', p: [0.13, 0.11, 0.29], r: [Math.PI, 0, 0.15] },
    ]);
  } else if (slot === 'chestGen3') {
    // Era III: Radiant Sun-Bronze Chest Medallion + Twin Ancestral Clan Back-Banners
    const parts: Part[] = [
      // Gilded gorget collar
      { g: cyl(0.26, 0.31, 0.08, 12), c: '#f0c254', p: [0, 0.2, 0.14], r: [0.32, 0, 0], s: [1.15, 1, 0.68] },
      // Sun-disc chest medallion
      { g: cyl(0.12, 0.12, 0.04, 12), c: '#ffd86b', p: [0, 0.12, 0.32], r: [Math.PI / 2, 0, 0] },
      { g: sph(0.065, 8), c: teamHex, p: [0, 0.12, 0.34], s: [1, 1, 0.55] },
      // Left & Right Back-Banner Poles rising behind shoulders
      { g: cyl(0.022, 0.026, 1.15, 7), c: '#5c3d22', p: [-0.22, 0.58, -0.26], r: [-0.1, 0, 0.14] },
      { g: cyl(0.022, 0.026, 1.15, 7), c: '#5c3d22', p: [0.22, 0.58, -0.26], r: [-0.1, 0, -0.14] },
      // Golden top crossbars
      { g: box(0.24, 0.032, 0.032), c: '#f0c254', p: [-0.29, 1.06, -0.31], r: [0, 0, 0.14] },
      { g: box(0.24, 0.032, 0.032), c: '#f0c254', p: [0.29, 1.06, -0.31], r: [0, 0, -0.14] },
      // Clan War-Paint Pennant Flags + Gold Trim
      { g: box(0.19, 0.48, 0.018), c: teamHex, p: [-0.27, 0.80, -0.31], r: [-0.1, 0, 0.14] },
      { g: box(0.19, 0.48, 0.018), c: teamHex, p: [0.27, 0.80, -0.31], r: [-0.1, 0, -0.14] },
      { g: box(0.21, 0.06, 0.022), c: '#ffd86b', p: [-0.27, 0.82, -0.31], r: [-0.1, 0, 0.14] },
      { g: box(0.21, 0.06, 0.022), c: '#ffd86b', p: [0.27, 0.82, -0.31], r: [-0.1, 0, -0.14] },
      // Sun-disc finials atop the banner poles
      { g: sph(0.055, 8), c: '#ffe07d', p: [-0.30, 1.15, -0.32] },
      { g: sph(0.055, 8), c: '#ffe07d', p: [0.30, 1.15, -0.32] },
    ];
    geo = merge(parts);
  } else if (slot === 'crownLeader') {
    const crownCol = genTier >= 3 ? '#ffd86b' : genTier === 2 ? '#f0e4c8' : '#dfd3b8';
    const parts: Part[] = [
      { g: blenderGeo('crown_leader'), c: crownCol, p: [0, 0.72, 0.02], s: [2.15, 2.25, 2.15] },
      { g: cyl(0.37, 0.38, 0.075, 14), c: teamHex, p: [0, 0.56, 0.02] },
      { g: sph(0.075, 8), c: genTier >= 3 ? '#ffd86b' : '#e8dec4', p: [0, 0.59, 0.38] },
    ];
    if (genTier >= 3) {
      // Central golden sun-spire for Gen III Leader
      parts.push(
        { g: cone(0.055, 0.32, 6), c: '#ffe388', p: [0, 0.88, 0.24], r: [0.18, 0, 0] },
      );
    }
    geo = merge(parts);
  } else {
    // Head crest for Gen II / Gen III non-leader units
    const crestCol = genTier >= 3 ? '#ffd86b' : '#e8dec4';
    const parts: Part[] = [
      { g: cyl(0.36, 0.37, 0.065, 14), c: teamHex, p: [0, 0.55, 0.02] },
      { g: cone(0.042, genTier >= 3 ? 0.28 : 0.20, 6), c: crestCol, p: [-0.28, 0.68, 0.14], r: [0.25, 0, 0.48] },
      { g: cone(0.042, genTier >= 3 ? 0.28 : 0.20, 6), c: crestCol, p: [0.28, 0.68, 0.14], r: [0.25, 0, -0.48] },
    ];
    if (genTier >= 3) {
      parts.push(
        { g: box(0.08, 0.24, 0.42), c: teamHex, p: [0, 0.82, -0.02] },
        { g: box(0.09, 0.06, 0.44), c: '#ffd86b', p: [0, 0.72, -0.02] },
      );
    }
    geo = merge(parts);
  }

  regaliaCache.set(k, geo);
  return geo;
}

/** Also used by offline verification so it exercises the runtime's exact model setup. */
export function instantiateWarband(source: GLTF, u: Unit, w: World): Warband {
  const kind: BodyKind = light.includes(u.kind) ? 'rogue' : 'barbarian';
  const root = clone(source.scene);
  const species = u.species ?? (u.owner === 0 ? w.species : w.rivalSpecies);
  const genTier = u.gen >= 3 ? 3 : u.gen >= 2 ? 2 : 1;
  const teamHex = u.owner === 0 ? (w.bannerColor || (genTier >= 3 ? '#e8bd63' : genTier >= 2 ? '#38d39c' : '#27b7c6')) : '#d84a36';
  const team = new THREE.Color(teamHex);
  const gold = new THREE.Color('#f0c254');
  const boneCol = new THREE.Color('#e6dac0');
  const jadeCol = new THREE.Color('#38e5ae');

  // Workers, scouts, and slingers do not wear heavy warrior capes so their silhouette is immediately distinct from fighters
  const wearCape = !['gatherer', 'scout', 'slinger'].includes(u.kind);

  root.traverse(o => {
    if (!(o instanceof THREE.Mesh)) return;
    o.castShadow = true; o.frustumCulled = false; o.material = material;
    // Native accessories are individually authored; remove simultaneous weapon variants.
    if (!(o instanceof THREE.SkinnedMesh)) {
      const showHat = o.name === 'Barbarian_Hat' && (['brute', 'champion'].includes(u.kind) || (u.kind === 'leader' && u.owner !== 0));
      const showShield = o.name === 'Barbarian_Round_Shield' && (['guard', 'champion'].includes(u.kind) || (u.kind === 'leader' && genTier >= 2));
      if (showShield) o.scale.setScalar(1.32); // Warcraft-scale bold shield readability
      o.visible = showShield || (o.name.endsWith('_Cape') && wearCape) || showHat;
    }
    const isHead = o.name.endsWith('_Head');
    // Keep Human adult head vertices unmodified so tests/characters.test.ts immutability assertion passes
    const headKeyPart = isHead && species === 'human' && u.kind !== 'elder' ? 'h-orig' : `${species}:${u.kind === 'elder' ? 'elder' : 'adult'}:g${isHead ? 1 : genTier}`;
    const key = `${kind}:${o.name}:${team.getHexString()}:${headKeyPart}`;
    let geometry = colors.get(key);
    if (!geometry) {
      const painted = o.geometry.clone() as THREE.BufferGeometry;
      const attribute = painted.getAttribute('color');
      for (let i = 0; i < attribute.count; i++) {
        const r = attribute.getX(i), g = attribute.getY(i), b = attribute.getZ(i);
        const cloth = o.name.endsWith('_Cape') || ((o.name.endsWith('_Body') || o.name.includes('_Arm')) && ((g > r * 1.3 && g > b * 1.1) || (b > r * 1.4 && b > g * 1.1)));
        if (cloth) {
          const value = Math.max(.36, Math.max(r, g, b));
          if (genTier >= 3 && o.name.endsWith('_Cape') && (i % 7 === 0)) {
            attribute.setXYZ(i, gold.r * value, gold.g * value, gold.b * value);
          } else {
            attribute.setXYZ(i, team.r * value, team.g * value, team.b * value);
          }
        } else if (!isHead && genTier >= 2 && r > 0.18 && r < 0.48 && g > 0.12 && g < 0.38 && b < 0.28) {
          // Upgrade leather straps, belt & bracers to carved bone/ochre (Gen II) or gleaming sun-bronze (Gen III)
          const c = genTier >= 3 ? gold : species === 'denisovan' ? jadeCol : boneCol;
          const v = Math.max(0.48, (r + g) * 0.85);
          attribute.setXYZ(i, c.r * v, c.g * v, c.b * v);
        } else if (isHead && species === 'human' && u.kind !== 'elder') {
          // Preserve exact source head colors for Human adult
        } else if (u.kind === 'elder' && isHead && r < 0.45 && g < 0.38) {
          // Silver-white wisdom hair & eyebrows for Elders
          attribute.setXYZ(i, 0.92, 0.90, 0.85);
        } else if (species === 'neanderthal') {
          if (r > g * 1.12 && g > b * 1.10) {
            // Frost-ruddy pale complexion for Ice-Kin Neanderthals
            attribute.setXYZ(i, Math.min(1, r * 1.08), Math.min(1, g * 0.96), Math.min(1, b * 0.94));
          } else if (r > 0.15 && r < 0.52 && g < 0.38) {
            // Fiery copper-russet hair/fur for Neanderthals
            attribute.setXYZ(i, Math.min(1, r * 1.35 + 0.08), g * 0.78, b * 0.55);
          }
        } else if (species === 'denisovan') {
          if (r > g * 1.12 && g > b * 1.10) {
            // Deep obsidian-ash & warm bronze skin for Jade-Peak Denisovans
            attribute.setXYZ(i, r * .72, g * .64, b * .60);
          } else if (r < 0.45 && g < 0.38) {
            // Deep raven-slate hair/leather with subtle violet-jade sheen
            attribute.setXYZ(i, r * 0.55, g * 0.65, Math.min(1, b * 0.95 + 0.06));
          }
        }
      }
      colors.set(key, painted); geometry = painted;
    }
    o.geometry = geometry;
  });

  // All six body sections share one bind space and material. Merge them for one body draw.
  const sections: THREE.SkinnedMesh[] = [];
  root.traverse(o => { if (o instanceof THREE.SkinnedMesh) sections.push(o); });
  const mergedKey = `merged:${kind}:${species}:${team.getHexString()}:g${genTier}:${u.kind === 'elder' ? 'elder' : 'adult'}`;
  let merged = colors.get(mergedKey);
  if (!merged) {
    merged = mergeGeometries(sections.map(o => o.geometry), false) ?? undefined;
    if (merged) colors.set(mergedKey, merged);
  }
  if (merged && sections.length) {
    const body = new THREE.SkinnedMesh(merged, material);
    body.name = 'WarbandBody'; body.frustumCulled = false; body.castShadow = true;
    body.bind(sections[0].skeleton, sections[0].bindMatrix);
    sections[0].parent!.add(body);
    for (const section of sections) section.removeFromParent();
  }

  // Attach 3D Species, Role & Generation Regalia directly to skeleton bones so they animate with the character
  const headBone = root.getObjectByName('head');
  const chestBone = root.getObjectByName('chest');
  const armL = root.getObjectByName('upperarml');
  const armR = root.getObjectByName('upperarmr');

  if (headBone) {
    // 1. Species-defining 3D cranial silhouette (Sun-Hawk plumes / Mammoth tusks & beard / Jade ibex horns)
    const spHead = new THREE.Mesh(getSpeciesGeo('head', species, teamHex), MAT.unit);
    spHead.name = 'RegaliaSpeciesHead';
    spHead.castShadow = true;
    headBone.add(spHead);

    // 2. Role-defining 3D headgear
    const roleHeadGeo = getRoleGeo('head', u.kind, teamHex);
    if (roleHeadGeo) {
      const roleHead = new THREE.Mesh(roleHeadGeo, MAT.unit);
      roleHead.name = 'RegaliaRoleHead';
      roleHead.castShadow = true;
      headBone.add(roleHead);
    }

    // 3. Leader Crown or Gen II/III evolutionary head crest
    if (u.kind === 'leader') {
      const crown = new THREE.Mesh(getRegaliaGeo('crownLeader', genTier, teamHex), MAT.unit);
      crown.name = 'RegaliaCrown';
      crown.castShadow = true;
      headBone.add(crown);
    } else if (genTier >= 2 && u.kind !== 'brute' && u.kind !== 'champion') {
      const crest = new THREE.Mesh(getRegaliaGeo('headCrest', genTier, teamHex), MAT.unit);
      crest.name = 'RegaliaCrest';
      crest.castShadow = true;
      headBone.add(crest);
    }
  }

  if (chestBone) {
    // 1. Species-defining 3D torso silhouette (Sun-disc baldric / Frost-wolf pelt mantle / Dorsal jade crystals)
    const spChest = new THREE.Mesh(getSpeciesGeo('chest', species, teamHex), MAT.unit);
    spChest.name = 'RegaliaSpeciesChest';
    spChest.castShadow = true;
    chestBone.add(spChest);

    // 2. Role-defining 3D dorsal/chest gear (Worker basket, Hunter quiver, Leader banner, Stalker javelin fan, etc.)
    const roleChestGeo = getRoleGeo('chest', u.kind, teamHex);
    if (roleChestGeo) {
      const roleChest = new THREE.Mesh(roleChestGeo, MAT.unit);
      roleChest.name = 'RegaliaRoleChest';
      roleChest.castShadow = true;
      chestBone.add(roleChest);
    }
  }

  if (genTier >= 2) {
    if (armL) {
      const pL = new THREE.Mesh(getRegaliaGeo('pauldronL', genTier, teamHex), MAT.unit);
      pL.name = 'RegaliaPauldronL';
      pL.castShadow = true;
      armL.add(pL);
    }
    if (armR) {
      const pR = new THREE.Mesh(getRegaliaGeo('pauldronR', genTier, teamHex), MAT.unit);
      pR.name = 'RegaliaPauldronR';
      pR.castShadow = true;
      armR.add(pR);
    }
    if (chestBone) {
      const chestReg = new THREE.Mesh(getRegaliaGeo(genTier >= 3 ? 'chestGen3' : 'chestGen2', genTier, teamHex), MAT.unit);
      chestReg.name = 'RegaliaChest';
      chestReg.castShadow = true;
      chestBone.add(chestReg);
    }
  }

  // Distinct Warcraft-style racial body proportions:
  // - Neanderthal: wide, barrel-chested brawler silhouette
  // - Denisovan: tall, lithe high-mountain stalker silhouette
  // - Human: balanced heroic proportions
  const sx = species === 'neanderthal' ? 1.24 : species === 'denisovan' ? 0.96 : 1.0;
  const sy = species === 'neanderthal' ? 0.94 : species === 'denisovan' ? 1.11 : 1.02;
  const sz = species === 'neanderthal' ? 1.22 : species === 'denisovan' ? 0.96 : 1.0;
  const genScale = genTier >= 3 ? 1.06 : genTier === 2 ? 1.03 : 1;
  root.scale.set(.62 * sx * genScale, .62 * sy * genScale, .62 * sz * genScale);
  if (u.kind === 'brute') root.scale.multiply(new THREE.Vector3(1.22, 1.08, 1.22));
  else if (u.kind === 'leader' || u.kind === 'champion') root.scale.multiply(new THREE.Vector3(1.08, 1.08, 1.08));
  const right = root.getObjectByName('handslotr')!;
  const left = root.getObjectByName('handslotl')!;
  const nativeWeapon = root.getObjectByName(u.kind === 'brute' ? '2H_Axe' : u.kind === 'raider' ? '1H_Axe' : 'none');
  if (nativeWeapon) nativeWeapon.visible = true;
  const motion = new CharacterMotion(root, source.animations);
  return { root, motion, right, left, nativeWeapon };
}


