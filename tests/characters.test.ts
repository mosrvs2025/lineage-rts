import { readFileSync } from 'node:fs';
import { describe, it, expect, vi } from 'vitest';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SkinnedMesh, Vector3 } from 'three';
import { CharacterMotion, characterClip } from '../src/render/character-motion';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import type { Unit, World } from '../src/sim/types';

const unit = (kind: Unit['kind'], order: Unit['order']): Unit => ({ kind, order, tgt: -1, cd: .8 } as Unit);
describe('authored warband assets and animation', () => {
  for (const kind of ['barbarian', 'rogue']) {
    it(`${kind}: native clips deform the actual skin and cloned units animate independently`, async () => {
      const data = readFileSync(`public/assets/characters/warband-${kind}.glb`);
      const asset = await new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), '');
      expect(asset.animations).toHaveLength(16);
      const a = clone(asset.scene), b = clone(asset.scene);
      const first = new CharacterMotion(a, asset.animations), second = new CharacterMotion(b, asset.animations);
      expect(a.getObjectByName('handslotr')).toBeDefined();
      expect(a.getObjectByName('handslotl')).toBeDefined();
      const boneA = a.getObjectByName('lowerlegl')!, boneB = b.getObjectByName('lowerlegl')!;
      first.play('Walking_A', 1, 0); second.play('Idle', 1, 0);
      first.mixer.update(.25); second.mixer.update(.25);
      expect(boneA.quaternion.angleTo(boneB.quaternion)).toBeGreaterThan(.01);
      a.updateMatrixWorld(true);
      let bodies = 0;
      a.traverse(o => {
        if (!(o instanceof SkinnedMesh)) return;
        bodies++; o.skeleton.update();
        const pos = o.geometry.getAttribute('position'), index = o.geometry.getAttribute('skinIndex'), weights = o.geometry.getAttribute('skinWeight');
        expect(o.geometry.getAttribute('color')).toBeDefined();
        for (let i = 0; i < weights.count; i++) {
          expect(weights.getX(i)+weights.getY(i)+weights.getZ(i)+weights.getW(i)).toBeCloseTo(1, 3);
          expect(index.getX(i)).toBeLessThan(o.skeleton.bones.length);
        }
        const p = new Vector3().fromBufferAttribute(pos, 0); o.applyBoneTransform(0, p);
        expect([p.x,p.y,p.z].every(Number.isFinite)).toBe(true);
      });
      expect(bodies).toBe(6);
      first.die(); first.update(.1, unit('leader', { t: 'idle' }), true);
      expect(first.current).toBe('Death_A');
      expect(first.dead).toBe(true);
      expect(second.dead).toBe(false);
      expect(data.byteLength).toBeLessThan(1_100_000);
      first.dispose(); second.dispose();
    });
  }
  it('runtime factory merges body draws, keeps faces neutral, and gives clones separate bones', async () => {
    vi.stubGlobal('document', { createElement: () => ({ width:64, height:64, getContext: () => ({ createRadialGradient: () => ({ addColorStop() {} }), fillRect() {} }) }) });
    const { instantiateWarband } = await import('../src/render/warband');
    const bytes = readFileSync('public/assets/characters/warband-barbarian.glb');
    const source = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength), '');
    const w = { species:'human', rivalSpecies:'neanderthal' } as World;
    const player = instantiateWarband(source, {...unit('guard',{t:'idle'}), owner:0, gen:1}, w);
    const rival = instantiateWarband(source, {...unit('brute',{t:'idle'}), owner:1, gen:1}, w);
    const bodies: SkinnedMesh[] = []; player.root.traverse(o => { if(o instanceof SkinnedMesh) bodies.push(o); });
    expect(bodies).toHaveLength(1);
    expect(player.right).toBeDefined(); expect(player.left).toBeDefined();
    expect(player.root.getObjectByName('Barbarian_Round_Shield')!.visible).toBe(true);
    expect(rival.nativeWeapon!.name).toBe('2H_Axe');
    expect(player.root.getObjectByName('head')).not.toBe(rival.root.getObjectByName('head'));
    player.motion.play('Walking_A',1,0); player.motion.mixer.update(.3);
    rival.motion.play('Death_A',1,0); rival.motion.mixer.update(.3);
    player.root.updateMatrixWorld(true); bodies[0].skeleton.update();
    const p = new Vector3().fromBufferAttribute(bodies[0].geometry.getAttribute('position'),10);
    bodies[0].applyBoneTransform(10,p);
    expect([p.x,p.y,p.z].every(Number.isFinite)).toBe(true);
    const originalHead = source.scene.getObjectByName('Barbarian_Head') as SkinnedMesh;
    const originalColors = originalHead.geometry.getAttribute('color');
    // The source stays immutable so player/rival recolors cannot leak across clones.
    expect(originalColors.count).toBeGreaterThan(0);
    const sourceSections: SkinnedMesh[] = []; source.scene.traverse(o => { if(o instanceof SkinnedMesh) sourceSections.push(o); });
    const headOffset = sourceSections.slice(0,sourceSections.indexOf(originalHead)).reduce((sum,o)=>sum+o.geometry.getAttribute('position').count,0);
    const mergedColors = bodies[0].geometry.getAttribute('color');
    for(let i=0;i<originalColors.count;i++) {
      expect(mergedColors.getX(headOffset+i)).toBeCloseTo(originalColors.getX(i));
      expect(mergedColors.getY(headOffset+i)).toBeCloseTo(originalColors.getY(i));
      expect(mergedColors.getZ(headOffset+i)).toBeCloseTo(originalColors.getZ(i));
    }
    expect(player.root.getObjectByName('Barbarian_Hat')!.visible).toBe(false);
    expect(rival.root.getObjectByName('Barbarian_Hat')!.visible).toBe(true);
    expect(player.root.getObjectByName('RegaliaPauldronL')).toBeUndefined();

    // Verify Gen II and Gen III attach distinct 3D bone/sun-bronze pauldrons, chest regalia, and antler crowns
    const ldrGen1 = instantiateWarband(source, {...unit('leader',{t:'idle'}), owner:0, gen:1}, w);
    const ldrGen2 = instantiateWarband(source, {...unit('leader',{t:'idle'}), owner:0, gen:2}, w);
    const ldrGen3 = instantiateWarband(source, {...unit('leader',{t:'idle'}), owner:0, gen:3}, w);
    expect(ldrGen1.root.getObjectByName('RegaliaCrown')).toBeDefined();
    expect(ldrGen1.root.getObjectByName('RegaliaPauldronL')).toBeUndefined();
    expect(ldrGen2.root.getObjectByName('RegaliaPauldronL')).toBeDefined();
    expect(ldrGen2.root.getObjectByName('RegaliaChest')).toBeDefined();
    expect(ldrGen3.root.getObjectByName('RegaliaPauldronL')).toBeDefined();
    expect((ldrGen3.root.getObjectByName('RegaliaChest') as any).geometry.getAttribute('position').count)
      .toBeGreaterThan((ldrGen2.root.getObjectByName('RegaliaChest') as any).geometry.getAttribute('position').count);

    // Verify distinct racial 3D headpieces/regalia (Human sun-hawk circlet, Neanderthal mammoth skull & tusks, Denisovan jade-ibex horns)
    const humGuard = instantiateWarband(source, {...unit('guard',{t:'idle'}), owner:0, species:'human', gen:1}, w);
    const neaGuard = instantiateWarband(source, {...unit('guard',{t:'idle'}), owner:0, species:'neanderthal', gen:1}, w);
    const denGuard = instantiateWarband(source, {...unit('guard',{t:'idle'}), owner:0, species:'denisovan', gen:1}, w);
    expect(humGuard.root.getObjectByName('RegaliaSpeciesHead')).toBeDefined();
    expect(neaGuard.root.getObjectByName('RegaliaSpeciesHead')).toBeDefined();
    expect(denGuard.root.getObjectByName('RegaliaSpeciesHead')).toBeDefined();
    const humVerts = (humGuard.root.getObjectByName('RegaliaSpeciesHead') as any).geometry.getAttribute('position').count;
    const neaVerts = (neaGuard.root.getObjectByName('RegaliaSpeciesHead') as any).geometry.getAttribute('position').count;
    const denVerts = (denGuard.root.getObjectByName('RegaliaSpeciesHead') as any).geometry.getAttribute('position').count;
    expect(new Set([humVerts, neaVerts, denVerts]).size).toBe(3);

    // Verify distinct role silhouettes (worker dorsal basket, hunter arrow quiver, guard crested war-helm)
    const workerVis = instantiateWarband(source, {...unit('gatherer',{t:'idle'}), owner:0, species:'human', gen:1}, w);
    const hunterVis = instantiateWarband(source, {...unit('hunter',{t:'idle'}), owner:0, species:'human', gen:1}, w);
    expect(workerVis.root.getObjectByName('RegaliaRoleChest')).toBeDefined();
    expect(hunterVis.root.getObjectByName('RegaliaRoleChest')).toBeDefined();
    expect(humGuard.root.getObjectByName('RegaliaRoleHead')).toBeDefined();

    player.motion.dispose(); rival.motion.dispose();
    ldrGen1.motion.dispose(); ldrGen2.motion.dispose(); ldrGen3.motion.dispose();
    humGuard.motion.dispose(); neaGuard.motion.dispose(); denGuard.motion.dispose();
    workerVis.motion.dispose(); hunterVis.motion.dispose();
    vi.unstubAllGlobals();
  });
  it('maps actual jobs and combat roles to distinct authored clips', () => {
    expect(characterClip(unit('scout', {t:'idle'}), true)).toBe('Running_A');
    expect(characterClip(unit('guard', {t:'attack',target:1}), false)).toBe('1H_Melee_Attack_Stab');
    expect(characterClip(unit('brute', {t:'attack',target:1}), false)).toBe('2H_Melee_Attack_Chop');
    expect(characterClip(unit('hunter', {t:'attack',target:1}), false)).toBe('2H_Ranged_Shoot');
    expect(characterClip(unit('stalker', {t:'attack',target:1}), false)).toBe('Throw');
    expect(characterClip(unit('gatherer', {t:'gather',node:1}), false, 'wood')).toBe('1H_Melee_Attack_Chop');
    expect(characterClip(unit('gatherer', {t:'gather',node:1}), false, 'food')).toBe('PickUp');
  });
});
