import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SkinnedMesh, Color } from 'three';

const expectedBones = ['root', 'hips', 'spine', 'head', 'shL', 'elL', 'handL', 'shR', 'elR', 'handR', 'hipL', 'kneeL', 'hipR', 'kneeR'];
describe('shipped clan leader assets', () => {
  for (const species of ['human', 'neanderthal', 'denisovan']) {
    it(`${species}: loads with compatible skin, visible team colors and bounded size`, async () => {
      const data = readFileSync(`public/assets/characters/leader-${species}.glb`);
      const gltf = await new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), '');
      const body = gltf.scene.getObjectByName('Lineage_ClanLeader') as SkinnedMesh;
      expect(body.isSkinnedMesh).toBe(true);
      expect(body.skeleton.bones.map(b => b.name)).toEqual(expectedBones);
      const g = body.geometry, weights = g.getAttribute('skinWeight'), indices = g.getAttribute('skinIndex');
      let blended = 0;
      for (let i = 0; i < weights.count; i++) {
        expect(weights.getX(i) + weights.getY(i) + weights.getZ(i) + weights.getW(i)).toBeCloseTo(1);
        expect(indices.getX(i)).toBeLessThan(expectedBones.length);
        expect(indices.getY(i)).toBeLessThan(expectedBones.length);
        if (weights.getY(i) > 0 && weights.getY(i) < 1) blended++;
      }
      expect(blended).toBeGreaterThan(0);
      const colors = g.getAttribute('color'), team = new Color('#27b7c6');
      let teamVertices = 0;
      for (let i = 0; i < colors.count; i++) if (Math.abs(colors.getX(i) - team.r) < .005 && Math.abs(colors.getY(i) - team.g) < .005 && Math.abs(colors.getZ(i) - team.b) < .005) teamVertices++;
      expect(teamVertices / colors.count).toBeGreaterThan(.1);
      g.computeBoundingBox();
      expect(g.boundingBox!.min.y).toBeGreaterThan(-.02);
      expect(g.boundingBox!.max.y).toBeLessThan(1.5);
      expect(data.byteLength).toBeLessThan(900_000);
    });
  }
});
