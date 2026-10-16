/** CPU-review geometry from the runtime factory and actual animation clips. No WebGL required. */
import * as THREE from 'three';
import { readFileSync, writeFileSync } from 'node:fs';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Unit, World } from '../src/sim/types';
// The fallback material module creates a tiny canvas shadow; it is not used by this CPU render.
Object.assign(globalThis, { document: { createElement: () => ({ width: 64, height: 64, getContext: () => ({ createRadialGradient: () => ({ addColorStop() {} }), fillRect() {} }) }) } });
const { instantiateWarband } = await import('../src/render/warband');
const { personGeo } = await import('../src/render/models');
const { Camera } = await import('../src/render/camera');
const rows: object[] = [];
for (const [index, kind] of ['leader', 'guard', 'hunter', 'gatherer', 'brute', 'scout'].entries()) {
  const body = ['hunter', 'gatherer', 'scout'].includes(kind) ? 'rogue' : 'barbarian';
  const b = readFileSync(`public/assets/characters/warband-${body}.glb`);
  const gltf = await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '');
  const u = { kind, owner: index === 4 ? 1 : 0, gen: 1 } as Unit;
  const w = { species: 'human', rivalSpecies: 'neanderthal' } as World;
  const visual = instantiateWarband(gltf, u, w);
  const sp = u.owner === 0 ? w.species : w.rivalSpecies;
  const geo = personGeo(u.kind, sp, u.owner === 0 ? 0 : 1, 1, 0);
  if (!visual.nativeWeapon && ['leader', 'guard'].includes(kind)) {
    const weapon = new THREE.Mesh(geo.spear, new THREE.MeshStandardMaterial({vertexColors:true}));
    weapon.scale.setScalar(1 / .62); weapon.rotation.z = -Math.PI / 2; visual.right.add(weapon);
  }
  if (kind === 'hunter') {
    const bow = new THREE.Mesh(geo.bow, new THREE.MeshStandardMaterial({vertexColors:true}));bow.scale.setScalar(1/.62);bow.rotation.z=Math.PI;visual.left.add(bow);
  }
  if (kind === 'gatherer') {
    const axe = new THREE.Mesh(geo.toolAxe, new THREE.MeshStandardMaterial({vertexColors:true}));axe.scale.setScalar(1/.62);axe.rotation.z=-Math.PI/2;visual.right.add(axe);
  }
  visual.root.scale.multiplyScalar(1.35);visual.root.rotation.y = -.35;
  const clip = kind === 'brute' ? '2H_Melee_Idle' : kind === 'scout' ? 'Running_A' : 'Idle';
  visual.motion.play(clip, 1, 0);visual.motion.mixer.update(.35);visual.root.updateMatrixWorld(true);
  const meshes: object[] = [];
  visual.root.traverseVisible(o => {
    if (!(o instanceof THREE.Mesh)) return;
    if (o instanceof THREE.SkinnedMesh) o.skeleton.update();
    const geo = o.geometry, pos = geo.getAttribute('position'), norm = geo.getAttribute('normal'), color = geo.getAttribute('color');
    const positions: number[] = [], normals: number[] = [], colors: number[] = [];
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(o.matrixWorld);
    for (let i = 0; i < pos.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(pos, i);
      if (o instanceof THREE.SkinnedMesh) o.applyBoneTransform(i, v);
      v.applyMatrix4(o.matrixWorld);positions.push(v.x,v.y,v.z);
      const n = new THREE.Vector3().fromBufferAttribute(norm, i).applyMatrix3(normalMatrix).normalize();normals.push(n.x,n.y,n.z);
      colors.push(...(color ? [color.getX(i),color.getY(i),color.getZ(i)] : [.5,.5,.5]));
    }
    meshes.push({positions,normals,colors,indices: geo.index ? Array.from(geo.index.array) : Array.from({length:pos.count},(_,i)=>i)});
  });
  rows.push({kind,meshes});
}
const camera = new Camera();camera.vw=1440;camera.vh=900;camera.x=12;camera.y=24;camera.zoom=80;camera.update();
writeFileSync('/tmp/lineage-warband-snapshot.json',JSON.stringify({rows,camera:camera.three.matrixWorldInverse.toArray()}));
