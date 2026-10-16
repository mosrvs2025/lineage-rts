import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { enhance } from './models';
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

/** Also used by offline verification so it exercises the runtime's exact model setup. */
export function instantiateWarband(source: GLTF, u: Unit, w: World): Warband {
  const kind: BodyKind = light.includes(u.kind) ? 'rogue' : 'barbarian';
  const root = clone(source.scene);
  const species = u.owner === 0 ? w.species : w.rivalSpecies;
  const team = new THREE.Color(u.owner === 0 ? (w.bannerColor || (u.gen >= 3 ? '#e8bd63' : u.gen >= 2 ? '#38d39c' : '#27b7c6')) : '#d84a36');
  root.traverse(o => {
    if (!(o instanceof THREE.Mesh)) return;
    o.castShadow = true; o.frustumCulled = false; o.material = material;
    // Native accessories are individually authored; remove simultaneous weapon variants.
    if (!(o instanceof THREE.SkinnedMesh)) {
      o.visible = (o.name === 'Barbarian_Round_Shield' && ['guard', 'champion'].includes(u.kind)) || o.name.endsWith('_Cape') || (o.name === 'Barbarian_Hat' && ['leader', 'brute', 'champion'].includes(u.kind));
    }
    const key = `${kind}:${o.name}:${team.getHexString()}:${species}:${u.kind === 'elder' ? 'elder' : 'adult'}`;
    let geometry = colors.get(key);
    if (!geometry) {
      const painted = o.geometry.clone() as THREE.BufferGeometry;
      const attribute = painted.getAttribute('color');
      for (let i = 0; i < attribute.count; i++) {
        const r = attribute.getX(i), g = attribute.getY(i), b = attribute.getZ(i);
        const cloth = o.name.endsWith('_Cape') || ((o.name.endsWith('_Body') || o.name.includes('_Arm')) && ((g > r * 1.3 && g > b * 1.1) || (b > r * 1.4 && b > g * 1.1)));
        if (cloth) {
          const value = Math.max(.3, Math.max(r, g, b));
          attribute.setXYZ(i, team.r * value, team.g * value, team.b * value);
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
  const mergedKey = `merged:${kind}:${species}:${team.getHexString()}`;
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
  // Preserve game-unit footprint: source characters are ~2m tall; original units ~1.1m.
  const bulk = species === 'neanderthal' ? 1.11 : species === 'denisovan' ? 1.04 : 1;
  root.scale.set(.62 * bulk, .62, .62 * bulk);
  if (u.kind === 'brute') root.scale.multiply(new THREE.Vector3(1.2, 1.06, 1.2));
  const right = root.getObjectByName('handslotr')!;
  const left = root.getObjectByName('handslotl')!;
  const nativeWeapon = root.getObjectByName(u.kind === 'brute' ? '2H_Axe' : u.kind === 'raider' ? '1H_Axe' : 'none');
  if (nativeWeapon) nativeWeapon.visible = true;
  const motion = new CharacterMotion(root, source.animations);
  return { root, motion, right, left, nativeWeapon };
}
