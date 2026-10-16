/** Imported character assets share the original rest skeleton, tools and animation states. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { enhance } from './models';
import type { Species } from '../sim/types';

export const leaderMaterial = enhance(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .86, metalness: 0 }));

const source = new Map<Species, THREE.BufferGeometry>();
const pending = new Set<Species>();
const variants = new Map<string, THREE.BufferGeometry>();
const loader = new GLTFLoader();
const urls: Record<Species, string> = {
  human: new URL('../../public/assets/characters/leader-human.glb', import.meta.url).href,
  neanderthal: new URL('../../public/assets/characters/leader-neanderthal.glb', import.meta.url).href,
  denisovan: new URL('../../public/assets/characters/leader-denisovan.glb', import.meta.url).href,
};

export function leaderGeometry(species: Species, owner: number, generation: number): THREE.BufferGeometry | undefined {
  const body = source.get(species);
  if (!body) {
    if (!pending.has(species)) {
      pending.add(species);
      loader.load(urls[species], gltf => {
        let geometry: THREE.BufferGeometry | undefined;
        gltf.scene.traverse(object => {
          if (object instanceof THREE.SkinnedMesh && object.name === 'Lineage_ClanLeader') geometry = object.geometry;
        });
        if (geometry) source.set(species, geometry);
        else console.warn(`Leader asset has no skinned body: ${species}`);
        // Materials and skeletons from the file are unused: the game owns both.
        gltf.scene.traverse(object => {
          if (object instanceof THREE.Mesh) {
            for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose();
            if (object.geometry !== geometry) object.geometry.dispose();
          }
          if (object instanceof THREE.SkinnedMesh) object.skeleton.dispose();
        });
      }, undefined, error => console.warn(`Using fallback leader for ${species}`, error));
    }
    return undefined;
  }
  const key = `${species}:${owner === 0 ? generation >= 2 ? 'heir' : 'player' : 'rival'}`;
  let geometry = variants.get(key);
  if (!geometry) {
    geometry = body.clone();
    const colors = geometry.getAttribute('color');
    const original = new THREE.Color('#27b7c6');
    const team = new THREE.Color(owner === 0 ? generation >= 2 ? '#38d39c' : '#27b7c6' : '#d84a36');
    for (let i = 0; i < colors.count; i++) {
      if (Math.abs(colors.getX(i) - original.r) < .005 && Math.abs(colors.getY(i) - original.g) < .005 && Math.abs(colors.getZ(i) - original.b) < .005) colors.setXYZ(i, team.r, team.g, team.b);
    }
    variants.set(key, geometry);
  }
  return geometry;
}
