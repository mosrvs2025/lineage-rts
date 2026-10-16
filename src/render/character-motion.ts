import * as THREE from 'three';
import { UNITS } from '../data/units';
import type { Unit } from '../sim/types';

export function characterClip(u: Unit, moving: boolean, resource?: string): string {
  if (moving) return u.kind === 'scout' || u.kind === 'raider' || u.kind === 'stalker' ? 'Running_A' : 'Walking_A';
  const order = u.order;
  if (order.t === 'attack' || (order.t === 'amove' && u.tgt >= 0)) {
    if (['slinger', 'stalker'].includes(u.kind)) return 'Throw';
    if (u.kind === 'hunter') return '2H_Ranged_Shoot';
    if (['leader', 'guard', 'champion'].includes(u.kind)) return '1H_Melee_Attack_Stab';
    return u.kind === 'brute' ? '2H_Melee_Attack_Chop' : '1H_Melee_Attack_Chop';
  }
  if (order.t === 'build' || (order.t === 'gather' && ['wood', 'stone'].includes(resource ?? ''))) return '1H_Melee_Attack_Chop';
  if (order.t === 'gather') return 'PickUp';
  if (order.t === 'research') return 'Interact';
  return u.kind === 'brute' ? '2H_Melee_Idle' : 'Idle';
}

/** Independent native rig, never driven by the placeholder skeleton's Euler rotations. */
export class CharacterMotion {
  readonly mixer: THREE.AnimationMixer;
  readonly actions = new Map<string, THREE.AnimationAction>();
  current = '';
  dead = false;
  private active?: THREE.AnimationAction;
  constructor(root: THREE.Object3D, clips: THREE.AnimationClip[]) {
    this.mixer = new THREE.AnimationMixer(root);
    for (const clip of clips) this.actions.set(clip.name, this.mixer.clipAction(clip));
    this.play('Idle', 1, 0);
  }
  play(name: string, speed = 1, fade = .16, once = false) {
    const action = this.actions.get(name) ?? this.actions.get('Idle');
    if (!action) return;
    if (this.current !== name) {
      const previous = this.active;
      action.reset().setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
      action.clampWhenFinished = once;
      action.enabled = true; action.setEffectiveWeight(1).play();
      if (previous) previous.fadeOut(fade);
      action.fadeIn(fade); this.active = action; this.current = name;
    }
    action.setEffectiveTimeScale(speed);
  }
  update(dt: number, u: Unit, moving: boolean, resource?: string) {
    if (!this.dead) {
      const clip = characterClip(u, moving, resource);
      const action = this.actions.get(clip);
      const attacking = clip.includes('Attack') || clip === 'Throw' || clip.includes('Shoot');
      const speed = attacking && u.cd > 0 ? (action?.getClip().duration ?? 1) / Math.max(.3, UNITS[u.kind].cd) : 1;
      this.play(clip, speed);
    }
    this.mixer.update(Math.min(dt, .1));
  }
  die() { if (!this.dead) { this.dead = true; this.play('Death_A', 1, .1, true); } }
  dispose() { this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.mixer.getRoot()); }
}
