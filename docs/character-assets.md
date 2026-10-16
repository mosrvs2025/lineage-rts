# Character asset provenance and adaptation

**Creator:** Kay Lousberg / KayKit Game Assets  
**Pack:** KayKit Character Pack: Adventurers 1.0  
**Official source:** https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0  
**Pinned source revision:** `672074b73ba276876a19e8816ecdc5241817ab47`  
**License:** CC0 1.0 Universal; original license included alongside runtime GLBs.

Only the public Barbarian and Rogue GLB files are used. No paid or EXTRA-tier files are included. The original creator authored the meshes, rigs, gradient texture atlases, accessories and animations. These are adaptations, not original Lineage sculpting work.

`import-warband.py` samples each original gradient atlas into linear vertex colors, retains sixteen relevant clips, removes animation channels for unused IK controls, and repacks only reachable buffer data. It preserves native bind poses and native animation rigs. At runtime, SkeletonUtils clones independent skeletons, team-colored geometry variants are cached, and six matching-bind-space body sections share one merged skinned draw. The original UVs/textures are no longer needed at runtime. Bear-pelt hats, cloaks, axes and shields come from the original pack; Lineage's existing spear, bow and work tools attach to the new native hand slots.

The old script-built leader prototype is removed by this revision. Runtime integration covers all humanoid unit kinds but shares two character bases; this is not eleven uniquely sculpted models. Clan differences use proportions, palette and equipment. Wildlife and environment art are unchanged.

To reproduce, clone the official source at the pinned revision, then run:

```sh
python scripts/import-warband.py /path/to/KayKit-Character-Pack-Adventures-1.0
npm run art:preview
npm run build
npm test
```

The importer and CPU review need Python, NumPy and Pillow. The review uses the game's runtime factory and authored clip poses, including a 58-degree overhead angle. It is not a screenshot of a running WebGL game; CPU lighting differs from the game's shader. The cloud browser could not initialize WebGL, so visual verification of all animation frames and physical-device performance remains outstanding.
