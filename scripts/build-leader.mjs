/** Original Lineage character source. Run with node scripts/build-leader.mjs.
 * Model coordinates match the game's existing skeleton: feet y=0, forward +z.
 * GLBs can be imported into Blender for further sculpting/texture/animation work. */
import * as T from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { writeFileSync, mkdirSync } from 'node:fs';
globalThis.FileReader = class { readAsArrayBuffer(b) { b.arrayBuffer().then(v=>{this.result=v;this.onloadend?.();}); } };
const bones=[['root',null,0,0,0],['hips','root',0,.46,0],['spine','hips',0,.54,0],['head','spine',0,.84,0],['shL','spine',-.21,.76,0],['elL','shL',-.21,.52,0],['handL','elL',-.21,.3,0],['shR','spine',.21,.76,0],['elR','shR',.21,.52,0],['handR','elR',.21,.3,0],['hipL','hips',-.1,.44,0],['kneeL','hipL',-.1,.22,0],['hipR','hips',.1,.44,0],['kneeR','hipR',.1,.22,0]];
const team='#27b7c6';
for (const [species,skin,broad] of [['human','#c9916b',1],['neanderthal','#b78663',1.14],['denisovan','#a77350',1.06]]) {
 const parts=[];
 function add(g,color,bone,pos=[0,0,0],scale=[1,1,1],rotation=[0,0,0],blend) {
  g=g.index?g.toNonIndexed():g.clone();
  const m=new T.Matrix4().compose(new T.Vector3(...pos),new T.Quaternion().setFromEuler(new T.Euler(...rotation)),new T.Vector3(...scale));g.applyMatrix4(m);
  const p=g.attributes.position,n=g.attributes.normal,c=new T.Color(color),colors=[],indices=[],weights=[];
  for(let i=0;i<p.count;i++) {
   // Painted light-to-dark planes with warm upward surfaces, kept independent of scene lighting.
   const shade=color===team?1:.82+.18*Math.max(0,n.getY(i))+.06*Math.max(0,n.getZ(i));
   colors.push(c.r*shade,c.g*shade,c.b*shade);
   const influence=blend?blend(p.getY(i)):0;indices.push(bones.findIndex(b=>b[0]===bone),blend?bones.findIndex(b=>b[0]===blend.bone):0,0,0);weights.push(1-influence,influence,0,0);
  }
  g.setAttribute('color',new T.Float32BufferAttribute(colors,3));g.setAttribute('skinIndex',new T.Uint16BufferAttribute(indices,4));g.setAttribute('skinWeight',new T.Float32BufferAttribute(weights,4));g.deleteAttribute('uv');parts.push(g);
 }
 const ell=(bone,color,p,s)=>add(new T.SphereGeometry(1,12,8),color,bone,p,s);
 const profile=(bone,color,rings,p,s=[1,1,1],blend)=>add(new T.LatheGeometry(rings.map(([r,y])=>new T.Vector2(r,y)),12),color,bone,p,s,[0,0,0],blend);
 const tooth=(bone,p,s=[1,1,1])=>add(new T.ConeGeometry(.026,.13,6),'#e8d7aa',bone,p,s,[Math.PI,0,0]);
 // Shaped leather body and flared hide skirt, broad shoulders and narrow waist.
 profile('spine','#705039',[[.15,0],[.17,.05],[.2,.16],[.265,.28],[.23,.34],[.12,.38]],[0,.49,0],[broad,1,.65]);
 profile('hips','#45372d',[[.27,0],[.29,.045],[.205,.25],[.16,.29]],[0,.23,0],[broad,1,.67]);
 profile('hips','#b28b52',[[.174,0],[.182,.018],[.182,.07],[.174,.08]],[0,.48,0],[broad,1,.86]);
 ell('spine','#d4af65',[0,.525,.155],[.055,.047,.023]);
 // Team-colored chest bib and mantle, intentionally large enough to read overhead.
 ell('spine',team,[0,.69,.142],[.16*broad,.15,.025]);
 ell('spine','#312a25',[0,.845,-.025],[.32*broad,.105,.19]);
 for(const side of [-1,1]) {
  const hip=side<0?'hipL':'hipR',knee=side<0?'kneeL':'kneeR',sh=side<0?'shL':'shR',el=side<0?'elL':'elR';
  ell(hip,'#65513d',[side*.105,.335,0],[.09,.155,.09]);
  profile(knee,'#3c3028',[[.075,0],[.09,.035],[.068,.18],[.075,.22]],[side*.105,.035,0],[1,1,1.12]);
  ell(knee,'#352b25',[side*.105,.045,.045],[.085,.047,.15]);
  profile(knee,'#af9b76',[[.073,0],[.077,.018],[.077,.035],[.073,.04]],[side*.105,.18,0]);
  // Continuous arm surface with a blended elbow rather than disconnected blocks.
  const blend=y=>T.MathUtils.smoothstep(.59-y,0,.12);blend.bone=el;
  profile(sh,skin,[[.055,0],[.065,.045],[.073,.15],[.086,.25],[.075,.32],[.035,.35]],[side*.235,.3,0],[1,1,1],blend);
  ell(sh,'#b6a079',[side*.235,.775,0],[.13,.095,.14]);
  for(let j=0;j<4;j++)tooth(sh,[side*(.16+j*.055),.79,.13],[.7,1+j%2*.3,.7]);
  ell(el,'#46372b',[side*.235,.365,0],[.071,.062,.074]);
  ell(el,skin,[side*.235,.287,.015],[.057,.067,.048]);
  ell(el,skin,[side*.19,.3,.04],[.026,.043,.027]);
 }
 // Head, jaw, ears, nose and brow; flattened face instead of a round bead head.
 ell('head',skin,[0,.949,.013],[.148*broad,.173,.128]);
 ell('head',skin,[0,.86,.065],[.115,.079,.092]);
 ell('head',skin,[0,.934,.139],[.035,.055,.044]);
 for(const side of [-1,1]) {
  ell('head',skin,[side*.151*broad,.94,.002],[.027,.048,.023]);
  ell('head','#33231d',[side*.06,.97,.13],[.053,.019,.018]);
  ell('head','#e4d3af',[side*.061,.95,.132],[.025,.012,.009]);
  ell('head','#201a17',[side*.061,.95,.141],[.009,.012,.004]);
  ell('head','#32271e',[side*.115,1.035,-.035],[.055,.11,.095]);
 }
 ell('head','#32271e',[0,1.075,-.032],[.147*broad,.075,.125]);
 profile('head','#3d2b22',[[.025,0],[.067,.055],[.105,.12],[.095,.14]],[0,.725,.09],[1,1,.64]);
 profile('head',team,[[.151,0],[.156,.013],[.156,.045],[.151,.05]],[0,1.015,0],[broad,1,.87]);
 // Bone crown with a clearly recognizable three-prong silhouette.
 for(const side of [-1,0,1])add(new T.ConeGeometry(.035,side===0?.29:.22,7),side===0?team:'#e7d3a3','head',[side*.105,1.16+(side===0?.03:0),-.025],[1,1,.5],[0,0,-side*.28]);
 // Layered fur mantle scallops and tooth necklace.
 for(let i=0;i<11;i++) {
  const a=i/10*Math.PI;
  ell('spine',i%2?'#594533':'#725c43',[Math.cos(a)*.27*broad,.77,-.045+Math.sin(a)*.16],[.065,.09,.06]);
 }
 for(let i=0;i<7;i++)tooth('spine',[(i-3)*.039,.735+Math.abs(i-3)*.018,.17],[.65,.7,.65]);
 // Segmented, tapered cape; its folds are modeled rather than a flat box.
 for(let i=0;i<7;i++) {
  const x=(i-3)*.052;
  ell('spine',team,[x,.55,-.155-Math.cos(i*1.8)*.014],[.04,.29-Math.abs(i-3)*.025,.026]);
 }
 const geo=mergeVertices(mergeGeometries(parts,false));geo.computeBoundingSphere();
 const bs=bones.map(([name])=>{const b=new T.Bone();b.name=name;return b;});
 bones.forEach(([,parent,x,y,z],i)=>{const pi=bones.findIndex(b=>b[0]===parent);bs[i].position.set(x-(pi<0?0:bones[pi][2]),y-(pi<0?0:bones[pi][3]),z-(pi<0?0:bones[pi][4]));if(pi>=0)bs[pi].add(bs[i]);});
 const mesh=new T.SkinnedMesh(geo,new T.MeshStandardMaterial({vertexColors:true,roughness:.86}));mesh.name='Lineage_ClanLeader';mesh.add(bs[0]);mesh.bind(new T.Skeleton(bs));
 const scene=new T.Scene();scene.add(mesh);
 const out=await new GLTFExporter().parseAsync(scene,{binary:true});
 mkdirSync('public/assets/characters',{recursive:true});writeFileSync(`public/assets/characters/leader-${species}.glb`,Buffer.from(out));
 console.log(species,geo.index.count/3,'triangles',out.byteLength,'bytes');
}
