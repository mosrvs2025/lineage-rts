/** Creates and animates unit rigs: skinned people, plus simple articulated deer and wolves. */
import * as THREE from 'three';
import { UNITS } from '../data/units';
import { hasDisc } from '../sim/rules';
import type { Unit, World } from '../sim/types';
import type { AnimalGeo } from './models';
import { MAT, blobGeo, blobMat, animalGeo, makeSkeleton, personGeo } from './models';

export interface Rig {
  root: THREE.Group; kind: 'person' | 'deer' | 'wolf'; unitKind: string;
  mesh: THREE.Mesh;                                  // body (SkinnedMesh for people)
  b: Record<string, THREE.Bone>;                     // bones by name (people)
  legA?: THREE.Mesh; legB?: THREE.Mesh;              // animal leg pairs
  pack?: THREE.Mesh; axe?: THREE.Mesh; pick?: THREE.Mesh; hammer?: THREE.Mesh; spear?: THREE.Mesh; bow?: THREE.Mesh; torch?: THREE.Group; flame?: THREE.Object3D;
  sel: THREE.Mesh; buff: THREE.Mesh;
  ang: number; phase: number; seed: number; born: number; atk: number; stride: number;
}

const ringGeo = new THREE.RingGeometry(0.4, 0.5, 28).rotateX(-Math.PI / 2);
const ease = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function createRig(u: Unit, w: World, time: number): Rig {
  const root = new THREE.Group(); root.rotation.order = 'YXZ';
  const sel = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xfff6a0, transparent: true, opacity: 0.95, depthWrite: false })); sel.position.y = 0.06; sel.renderOrder = 5; sel.visible = false; sel.scale.setScalar(1.15); root.add(sel);
  const buff = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffd54a, transparent: true, opacity: 0.8, depthWrite: false })); buff.position.y = 0.07; buff.scale.setScalar(1.6); buff.visible = false; root.add(buff);
  const sh = new THREE.Mesh(blobGeo, blobMat); sh.scale.set(1.15, 1, 1.15); sh.position.y = 0.03; sh.renderOrder = 2; root.add(sh);
  const base = { sel, buff, ang: 0, phase: Math.random() * 6, seed: Math.random() * 100, born: time, atk: 0, stride: 0 };
  if (u.kind === 'deer' || u.kind === 'wolf') {
    const ag: AnimalGeo = animalGeo(u.kind, u.id % 2);
    const mesh = new THREE.Mesh(ag.body, MAT.unit); mesh.castShadow = true;
    const legA = new THREE.Mesh(ag.legF, MAT.unit), legB = new THREE.Mesh(ag.legB, MAT.unit);
    const hip = u.kind === 'deer' ? 0.6 : 0.5; legA.position.y = hip; legB.position.y = hip;
    root.add(mesh, legA, legB); root.scale.setScalar(u.kind === 'deer' ? 1.3 : 1.2);
    return { root, kind: u.kind, unitKind: u.kind, mesh, b: {}, legA, legB, ...base };
  }
  const sp = u.owner === 0 ? w.species : w.rivalSpecies;
  const pg = personGeo(u.kind, sp, u.owner === 0 ? 0 : 1, u.gen, u.id);
  const { bones, skeleton } = makeSkeleton();
  const b: Record<string, THREE.Bone> = {}; bones.forEach((bn) => { b[bn.name] = bn; });
  const mesh = new THREE.SkinnedMesh(pg.body, MAT.unit); mesh.add(bones[0]); mesh.bind(skeleton); mesh.frustumCulled = false; mesh.castShadow = true;
  const mk = (g: THREE.BufferGeometry) => { const m = new THREE.Mesh(g, MAT.unit); m.visible = false; m.castShadow = false; return m; };
  const axe = mk(pg.toolAxe), pick = mk(pg.toolPick), hammer = mk(pg.toolHammer);
  b.handR.add(axe, pick, hammer);
  const hasSpear = ARMED.includes(u.kind);
  const spear = mk(pg.spear); spear.visible = hasSpear; b.handR.add(spear);
  const bow = mk(pg.bow); bow.visible = u.kind === 'hunter'; b.handL.add(bow);
  const torch = new THREE.Group(); torch.visible = false; const tm = new THREE.Mesh(pg.torch, MAT.unit); torch.add(tm);
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.34, 6), MAT.flame); flame.position.y = 0.45; torch.add(flame); torch.position.set(0, -0.05, 0.06); b.handL.add(torch);
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.3, 0.16), MAT.pack.food); pack.position.set(0, 0.12, -0.24); pack.visible = false; pack.castShadow = true; b.spine.add(pack);
  root.add(mesh);
  root.scale.setScalar((sp === 'neanderthal' ? 1.42 : 1.35) * (SCALE[u.kind] ?? 1));
  return { root, kind: 'person', unitKind: u.kind, mesh, b, pack, axe, pick, hammer, spear, bow, torch, flame, ...base };
}

const ARMED = ['guard', 'leader', 'raider', 'scout', 'elder', 'brute', 'champion', 'slinger'];
const SCALE: Record<string, number> = { brute: 1.18, champion: 1.08, elder: 0.96 };

export interface AnimCtx { time: number; dt: number; w: World; alpha: number; selected: boolean }

function rot(b: THREE.Bone, x = 0, y = 0, z = 0) { b.rotation.set(x, y, z); }

/** Drive a rig for one frame. Returns whether the unit counts as moving. */
export function animateRig(r: Rig, u: Unit, c: AnimCtx): boolean {
  const { time, dt, w } = c, def = UNITS[u.kind];
  const mvx = u.x - u.ox, mvy = u.y - u.oy, speed = Math.hypot(mvx, mvy) / 0.05; // tiles per second
  const moving = speed > 0.2;
  r.stride += (moving ? 1 : -1) * dt * 6; r.stride = clamp01(r.stride);        // smooth idle<->walk blend weight
  if (moving) r.phase += dt * (r.kind === 'wolf' ? 12 + speed * 1.5 : 5.2 + speed * 1.5);
  const run = speed > 3.3, w8 = r.stride;
  // facing
  let want = r.ang;
  if (moving) want = Math.atan2(mvx, mvy);
  else if (u.order.t === 'attack') { const t = w._u?.get(u.order.target) ?? w._b?.get(u.order.target); if (t) { const tx = 'progress' in t ? t.x + t.w / 2 : t.x, ty = 'progress' in t ? t.y + t.h / 2 : t.y; want = Math.atan2(tx - u.x, ty - u.y); } }
  else if (u.order.t === 'gather') { const n = w._n?.get(u.order.node); if (n) want = Math.atan2(n.x + 0.5 - u.x, n.y + 0.5 - u.y); }
  else if (u.order.t === 'build') { const bd = w._b?.get(u.order.b); if (bd) want = Math.atan2(bd.x + bd.w / 2 - u.x, bd.y + bd.h / 2 - u.y); }
  let d = want - r.ang; d = Math.atan2(Math.sin(d), Math.cos(d)); r.ang += d * Math.min(1, dt * 12);
  r.root.rotation.y = r.ang;
  // spawn pop
  const age = time - r.born, pop = age < 0.4 ? 1 + 0.25 * Math.sin((age / 0.4) * Math.PI) * (1 - age / 0.4) - (1 - ease(age / 0.4)) * 0.8 : 1;
  const base = r.kind === 'person' ? (u.owner === 0 ? 1 : 1) : 1; void base;
  r.root.scale.setScalar((r.kind === 'person' ? (r.root.userData.s ??= r.root.scale.x) : (r.root.userData.s ??= r.root.scale.x)) * Math.max(0.05, pop));

  if (r.kind !== 'person') {
    const flee = u.order.t === 'flee' ? 1.5 : 1, sw = Math.sin(r.phase) * 0.7 * flee * w8;
    r.legA!.rotation.x = sw; r.legB!.rotation.x = -sw;
    r.mesh.position.y = moving ? Math.abs(Math.sin(r.phase)) * 0.05 * flee : 0;
    r.mesh.rotation.x = r.kind === 'wolf' && u.order.t === 'attack' && u.cd > def.cd - 0.3 ? -0.18 : Math.sin(r.phase) * 0.03 * w8;
    r.mesh.rotation.z = Math.sin(r.phase * 0.5) * 0.03 * w8;
    return moving;
  }

  // ------------------------------------------------------------ people
  const B = r.b, t = time + r.seed, o = u.order;
  // neutral pose
  for (const n of Object.keys(B)) if (n !== 'root') rot(B[n]);
  B.hips.position.y = 0.46;
  const p = r.phase;
  const swing = (amp: number, lean: number) => {
    const s = Math.sin(p);
    B.hipL.rotation.x = -s * amp * w8; B.hipR.rotation.x = s * amp * w8;
    B.kneeL.rotation.x = Math.max(0, Math.cos(p)) * amp * 1.25 * w8; B.kneeR.rotation.x = Math.max(0, -Math.cos(p)) * amp * 1.25 * w8;
    B.shL.rotation.x += s * amp * 0.85 * w8; B.shR.rotation.x += -s * amp * 0.85 * w8;
    B.elL.rotation.x += -(0.25 + 0.3 * Math.max(0, -s)) * w8; B.elR.rotation.x += -(0.25 + 0.3 * Math.max(0, s)) * w8;
    B.hips.rotation.y = s * 0.13 * w8; B.spine.rotation.y = -s * 0.15 * w8; B.spine.rotation.x += lean * w8;
    B.hips.position.y += -Math.abs(Math.cos(p)) * 0.045 * w8 * (run ? 1.6 : 1) + 0.02 * w8;
  };
  // idle breathing, weight shift and gentle look-around
  B.spine.rotation.x = 0.02 + Math.sin(t * 1.9) * 0.014; B.spine.rotation.y = Math.sin(t * 0.6) * 0.04 * (1 - w8);
  B.head.rotation.y = Math.sin(t * 0.45) * 0.4 * (1 - w8) * (Math.sin(t * 0.13) > 0.2 ? 1 : 0.25); B.head.rotation.x = Math.sin(t * 0.7) * 0.05;
  B.hips.rotation.z = Math.sin(t * 0.5) * 0.025 * (1 - w8);
  B.shL.rotation.z = 0.06; B.shR.rotation.z = -0.06; B.elL.rotation.x = -0.12; B.elR.rotation.x = -0.12;
  const armed = ARMED.includes(u.kind);
  if (armed) { B.handR.rotation.x = Math.PI; B.shR.rotation.x = -0.12; B.elR.rotation.x = -0.55; }
  if (u.kind === 'hunter') { B.shL.rotation.x = -0.2; B.elL.rotation.x = -0.4; }

  const showTools = { axe: false, pick: false, hammer: false };
  let busy = false;
  const phase = 1 - Math.max(0, Math.min(1, u.cd / def.cd)); // 0 right after a strike -> 1 ready
  const fighting = def.dmg > 0 && u.owner !== undefined && (o.t === 'attack' || (o.t === 'amove' && u.tgt >= 0)) && !moving;
  const node = o.t === 'gather' ? w._n?.get(o.node) : undefined;
  const working = !!node && !moving && Math.hypot(u.x - (node.x + 0.5), u.y - (node.y + 0.5)) < 1.9 && u.carry.n < def.carry;
  const building = o.t === 'build' && !moving;

  if (fighting && (u.kind === 'guard' || u.kind === 'leader' || u.kind === 'champion')) {
    // spear: draw back then thrust
    const windup = phase > 0.55 ? ease((phase - 0.55) / 0.45) : 0, thrust = phase < 0.22 ? 1 - phase / 0.22 : 0;
    B.handR.rotation.x = Math.PI * (1 - Math.min(1, r.atk)); r.atk += (1 - r.atk) * Math.min(1, dt * 14);
    B.shR.rotation.x = -0.35 - 1.1 * thrust + 0.5 * windup; B.elR.rotation.x = -0.4 + 0.3 * thrust - 0.5 * windup; B.shL.rotation.x = -0.7 * (0.4 + thrust); B.elL.rotation.x = -0.6;
    B.spine.rotation.x = 0.1 + 0.18 * thrust - 0.12 * windup; B.spine.rotation.y = -0.3 * windup + 0.4 * thrust; B.hips.rotation.y = 0.15 * windup - 0.15 * thrust;
    B.hipL.rotation.x = -0.35; B.hipR.rotation.x = 0.35; B.kneeL.rotation.x = 0.25; B.kneeR.rotation.x = 0.15; busy = true;
  } else if (fighting && u.kind === 'slinger') {
    const spin = t * 14 + phase * 6;
    B.handR.rotation.x = 0; B.shR.rotation.x = -2.1 + Math.sin(spin) * 0.5; B.shR.rotation.z = -0.3 + Math.cos(spin) * 0.5; B.elR.rotation.x = -0.4; B.shL.rotation.x = -0.6; B.elL.rotation.x = -0.5;
    B.spine.rotation.y = Math.sin(spin) * 0.15; B.spine.rotation.x = 0.05; B.hipL.rotation.x = -0.3; B.hipR.rotation.x = 0.3; B.kneeL.rotation.x = 0.2; busy = true;
  } else if (fighting && (u.kind === 'raider' || u.kind === 'brute')) {
    const windup = phase > 0.5 ? ease((phase - 0.5) / 0.5) : 0, strike = phase < 0.25 ? 1 - phase / 0.25 : 0;
    B.handR.rotation.x = 0; B.shR.rotation.x = -0.4 - 2.0 * windup + 1.7 * strike * 0 - 0.6 * strike; B.elR.rotation.x = -0.5 - 0.6 * windup; B.shL.rotation.x = -0.5; B.elL.rotation.x = -0.6;
    B.spine.rotation.x = 0.1 - 0.15 * windup + 0.4 * strike; B.hipL.rotation.x = -0.4; B.hipR.rotation.x = 0.4; B.kneeL.rotation.x = 0.3; busy = true;
  } else if (fighting && u.kind === 'hunter') {
    const draw = phase > 0.35 ? ease((phase - 0.35) / 0.65) : 0;
    B.shL.rotation.x = -1.5; B.elL.rotation.x = -0.05; B.handL.rotation.x = 1.5;
    B.shR.rotation.x = -1.35; B.elR.rotation.x = -0.15 - 1.5 * draw; B.shR.rotation.y = -0.35; B.spine.rotation.y = 0.55; B.head.rotation.y = -0.5; B.hips.rotation.y = 0.2;
    B.hipL.rotation.x = -0.2; B.hipR.rotation.x = 0.2; busy = true;
  } else if (fighting) { B.shR.rotation.x = -1.2 * (phase < 0.25 ? 1 - phase / 0.25 : 0.2); B.elR.rotation.x = -0.6; B.spine.rotation.x = 0.2; busy = true; }
  else if (working) {
    const res = node!.res, carcass = node!.kind === 'carcass';
    if (res === 'wood' || res === 'stone') {
      const sp = res === 'wood' ? 0.95 : 0.75, s = (t * sp) % 1, tool = res === 'wood' ? 'axe' : 'pick';
      showTools[tool] = true; B.handR.rotation.x = 0;
      const raise = s < 0.55 ? ease(s / 0.55) : s < 0.68 ? 1 : 1 - ease((s - 0.68) / 0.32), hit = s >= 0.55 && s < 0.68 ? (s - 0.55) / 0.13 : 0;
      const arm = -0.35 - 2.15 * raise + 2.3 * ease(hit) * (raise > 0.95 ? 1 : 0);
      B.shR.rotation.x = arm; B.elR.rotation.x = -0.35 - 0.7 * raise * (1 - hit); B.shL.rotation.x = arm * 0.85; B.elL.rotation.x = -0.35 - 0.6 * raise * (1 - hit);
      B.shL.rotation.z = 0.25; B.shR.rotation.z = -0.25; B.spine.rotation.x = 0.1 - 0.22 * raise + 0.65 * ease(hit); B.hipL.rotation.x = -0.25; B.hipR.rotation.x = 0.18; B.kneeL.rotation.x = 0.25; B.kneeR.rotation.x = 0.1;
    } else {
      const sq = carcass ? 0.55 : 0.8; // squat to pick berries / butcher
      B.hips.position.y = 0.46 - 0.17 * sq; B.hipL.rotation.x = -1.15 * sq; B.hipR.rotation.x = -1.05 * sq; B.kneeL.rotation.x = 1.5 * sq; B.kneeR.rotation.x = 1.45 * sq;
      B.spine.rotation.x = 0.55 * sq; B.head.rotation.x = -0.3; B.shR.rotation.x = -1.0 + Math.sin(t * 6) * 0.3; B.elR.rotation.x = -0.6; B.shL.rotation.x = -0.9 + Math.sin(t * 6 + 2) * 0.25; B.elL.rotation.x = -0.6;
    }
    busy = true;
  } else if (building) {
    showTools.hammer = true; const s = (t * 1.5) % 1, k = Math.max(0, Math.sin(s * Math.PI * 2));
    B.handR.rotation.x = 0; B.shR.rotation.x = -1.0 - 1.0 * k; B.elR.rotation.x = -0.9; B.shL.rotation.x = -0.5; B.elL.rotation.x = -0.7; B.spine.rotation.x = 0.28 + 0.12 * k;
    B.hipL.rotation.x = -0.5; B.hipR.rotation.x = -0.3; B.kneeL.rotation.x = 0.6; B.kneeR.rotation.x = 0.5; B.hips.position.y = 0.4; busy = true;
  } else if (o.t === 'research' && !moving) { B.head.rotation.x = -0.25; B.shR.rotation.x = -1.2; B.elR.rotation.x = -1.3; B.spine.rotation.x = 0.05; busy = true; }
  r.atk += (0 - r.atk) * Math.min(1, dt * 8) * (fighting ? 0 : 1);

  if (!busy || moving) swing(run ? 1.0 : 0.72, run ? 0.28 : 0.06);
  if (moving && armed && !fighting) { B.handR.rotation.x = Math.PI; B.shR.rotation.x = -0.3; B.elR.rotation.x = -0.5; }
  if (moving && u.carry.n > 0) { B.shL.rotation.x = -0.5; B.elL.rotation.x = -0.9; B.shR.rotation.x = -0.35; B.elR.rotation.x = -0.9; B.spine.rotation.x += 0.1; }

  r.axe!.visible = showTools.axe; r.pick!.visible = showTools.pick; r.hammer!.visible = showTools.hammer;
  if (u.kind === 'gatherer') { r.spear!.visible = false; }
  r.spear!.visible = armed && !showTools.axe && !showTools.pick && !showTools.hammer;
  const carry = u.carry.n > 0 && u.carry.res;
  r.pack!.visible = !!carry; if (carry) r.pack!.material = MAT.pack[u.carry.res!];
  const torch = u.owner === 0 && hasDisc(w, 'portable') && (u.kind === 'hunter' || u.kind === 'guard' || u.kind === 'leader');
  r.torch!.visible = torch; if (torch) r.flame!.scale.set(1, 0.8 + 0.3 * Math.sin(time * 13 + u.id), 1);
  return moving;
}
