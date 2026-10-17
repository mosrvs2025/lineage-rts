import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { enhance, merge, MAT, type Part } from './models';
import { blenderGeo } from './blenderMeshes';
import { CharacterMotion } from './character-motion';
import type { Unit, World } from '../sim/types';

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

/** Build cached 3D regalia geometries for shoulders, chest, back-banners, and crowns across Gen I -> II -> III. */
function getRegaliaGeo(slot: string, genTier: number, teamHex: string): THREE.BufferGeometry {
  const k = `${slot}:${genTier}:${teamHex}`;
  const hit = regaliaCache.get(k);
  if (hit) return hit;

  const cyl = (rt: number, rb: number, h: number, seg = 8) => new THREE.CylinderGeometry(rt, rb, h, seg);
  const cone = (r: number, h: number, seg = 7) => new THREE.ConeGeometry(r, h, seg);
  const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
  const sph = (r: number, seg = 8) => new THREE.SphereGeometry(r, seg, seg);

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
  const species = u.owner === 0 ? w.species : w.rivalSpecies;
  const genTier = u.gen >= 3 ? 3 : u.gen >= 2 ? 2 : 1;
  const teamHex = u.owner === 0 ? (w.bannerColor || (genTier >= 3 ? '#e8bd63' : genTier >= 2 ? '#38d39c' : '#27b7c6')) : '#d84a36';
  const team = new THREE.Color(teamHex);
  const gold = new THREE.Color('#f0c254');
  const boneCol = new THREE.Color('#e6dac0');

  root.traverse(o => {
    if (!(o instanceof THREE.Mesh)) return;
    o.castShadow = true; o.frustumCulled = false; o.material = material;
    // Native accessories are individually authored; remove simultaneous weapon variants.
    if (!(o instanceof THREE.SkinnedMesh)) {
      const showHat = o.name === 'Barbarian_Hat' && (['brute', 'champion'].includes(u.kind) || (u.kind === 'leader' && u.owner !== 0));
      const showShield = o.name === 'Barbarian_Round_Shield' && (['guard', 'champion'].includes(u.kind) || (u.kind === 'leader' && genTier >= 2));
      o.visible = showShield || o.name.endsWith('_Cape') || showHat;
    }
    const isHead = o.name.endsWith('_Head');
    const key = `${kind}:${o.name}:${team.getHexString()}:g${isHead ? 1 : genTier}:${species}:${u.kind === 'elder' ? 'elder' : 'adult'}`;
    let geometry = colors.get(key);
    if (!geometry) {
      const painted = o.geometry.clone() as THREE.BufferGeometry;
      const attribute = painted.getAttribute('color');
      for (let i = 0; i < attribute.count; i++) {
        const r = attribute.getX(i), g = attribute.getY(i), b = attribute.getZ(i);
        const cloth = o.name.endsWith('_Cape') || ((o.name.endsWith('_Body') || o.name.includes('_Arm')) && ((g > r * 1.3 && g > b * 1.1) || (b > r * 1.4 && b > g * 1.1)));
        if (cloth) {
          const value = Math.max(.32, Math.max(r, g, b));
          if (genTier >= 3 && o.name.endsWith('_Cape') && (i % 7 === 0)) {
            attribute.setXYZ(i, gold.r * value, gold.g * value, gold.b * value);
          } else {
            attribute.setXYZ(i, team.r * value, team.g * value, team.b * value);
          }
        } else if (!isHead && genTier >= 2 && r > 0.18 && r < 0.48 && g > 0.12 && g < 0.38 && b < 0.28) {
          // Upgrade leather straps, belt & bracers to carved bone/ochre (Gen II) or gleaming sun-bronze (Gen III)
          const c = genTier >= 3 ? gold : boneCol;
          const v = Math.max(0.45, (r + g) * 0.85);
          attribute.setXYZ(i, c.r * v, c.g * v, c.b * v);
        } else if (species === 'denisovan' && r > g * 1.15 && g > b * 1.15) {
          attribute.setXYZ(i, r * .78, g * .72, b * .68);
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

  // Attach 3D Generation & Role Regalia directly to skeleton bones so they animate with the character
  const headBone = root.getObjectByName('head');
  const chestBone = root.getObjectByName('chest');
  const armL = root.getObjectByName('upperarml');
  const armR = root.getObjectByName('upperarmr');

  if (headBone) {
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

  // Preserve game-unit footprint: source characters are ~2m tall; original units ~1.1m.
  const bulk = species === 'neanderthal' ? 1.11 : species === 'denisovan' ? 1.04 : 1;
  const genScale = genTier >= 3 ? 1.05 : genTier === 2 ? 1.02 : 1;
  root.scale.set(.62 * bulk * genScale, .62 * genScale, .62 * bulk * genScale);
  if (u.kind === 'brute') root.scale.multiply(new THREE.Vector3(1.2, 1.06, 1.2));
  const right = root.getObjectByName('handslotr')!;
  const left = root.getObjectByName('handslotl')!;
  const nativeWeapon = root.getObjectByName(u.kind === 'brute' ? '2H_Axe' : u.kind === 'raider' ? '1H_Axe' : 'none');
  if (nativeWeapon) nativeWeapon.visible = true;
  const motion = new CharacterMotion(root, source.animations);
  return { root, motion, right, left, nativeWeapon };
}

