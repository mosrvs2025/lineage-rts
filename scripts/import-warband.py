"""Adapt KayKit's CC0 characters: bake gradient atlases, retain useful clips, repack GLB.
Usage: python scripts/import-warband.py /path/to/KayKit-Character-Pack-Adventures-1.0
"""
import sys,json,struct,io
from pathlib import Path
import numpy as np
from PIL import Image
source=Path(sys.argv[1])/'addons/kaykit_character_pack_adventures/Characters/gltf'
out=Path('public/assets/characters');out.mkdir(parents=True,exist_ok=True)
clips={'Idle','Walking_A','Running_A','1H_Melee_Attack_Chop','1H_Melee_Attack_Stab','2H_Melee_Attack_Chop','2H_Melee_Attack_Stab','2H_Melee_Idle','2H_Ranged_Shoot','Throw','Interact','PickUp','Spellcasting','Cheer','Hit_A','Death_A'}
for name in ['Barbarian','Rogue']:
 b=(source/(name+'.glb')).read_bytes();length=struct.unpack_from('<I',b,12)[0];j=json.loads(b[20:20+length]);binary=b[28+length:]
 def acc(i):
  a=j['accessors'][i];v=j['bufferViews'][a['bufferView']];dims={'VEC2':2,'VEC3':3,'VEC4':4,'SCALAR':1,'MAT4':16}[a['type']]
  return np.frombuffer(binary,dtype={5126:'<f4',5123:'<u2',5125:'<u4',5121:'u1'}[a['componentType']],count=a['count']*dims,offset=v.get('byteOffset',0)+a.get('byteOffset',0)).reshape(-1,dims)
 image=j['images'][0];bv=j['bufferViews'][image['bufferView']];atlas=np.asarray(Image.open(io.BytesIO(binary[bv.get('byteOffset',0):bv.get('byteOffset',0)+bv['byteLength']])).convert('RGB'))/255
 # Bake the original painted gradient colors into vertices in linear color space.
 extra=[]
 for mesh in j['meshes']:
  for p in mesh['primitives']:
   uv=acc(p['attributes']['TEXCOORD_0']);x=np.clip((uv[:,0]*atlas.shape[1]).astype(int),0,atlas.shape[1]-1);y=np.clip((uv[:,1]*atlas.shape[0]).astype(int),0,atlas.shape[0]-1)
   c=atlas[y,x];linear=np.where(c<=.04045,c/12.92,((c+.055)/1.055)**2.4).astype('<f4');data=linear.tobytes()
   vi=len(j['bufferViews']);j['bufferViews'].append({'buffer':0,'byteLength':len(data),'_data':data});ai=len(j['accessors']);j['accessors'].append({'bufferView':vi,'componentType':5126,'count':len(linear),'type':'VEC3'})
   p['attributes']['COLOR_0']=ai;p['attributes'].pop('TEXCOORD_0',None)
 j['materials']=[{'name':'KayKit baked gradient atlas','pbrMetallicRoughness':{'metallicFactor':0,'roughnessFactor':.82}}]
 for m in j['meshes']:
  for p in m['primitives']:p['material']=0
 for key in ['images','textures','samplers']:j.pop(key,None)
 j['animations']=[a for a in j['animations'] if a['name'] in clips]
 for a in j['animations']:
  a['channels']=[c for c in a['channels'] if not any(token in j['nodes'][c['target']['node']]['name'] for token in ['IK','control-'])]
  used_samplers=sorted({c['sampler'] for c in a['channels']});sr={old:new for new,old in enumerate(used_samplers)}
  a['samplers']=[a['samplers'][i] for i in used_samplers]
  for c in a['channels']:c['sampler']=sr[c['sampler']]
 # Keep only reachable accessor data, excluding the 60 unused animation clips and atlas.
 used=set()
 for m in j['meshes']:
  for p in m['primitives']:
   used.update(p['attributes'].values())
   if 'indices' in p:used.add(p['indices'])
 for s in j['skins']:used.add(s['inverseBindMatrices'])
 for a in j['animations']:
  for s in a['samplers']:used.update([s['input'],s['output']])
 remap={old:new for new,old in enumerate(sorted(used))};accessors=[j['accessors'][i] for i in sorted(used)]
 views=sorted({a['bufferView'] for a in accessors});vmap={old:new for new,old in enumerate(views)};packed=bytearray();newviews=[]
 for i in views:
  v=j['bufferViews'][i];data=v.get('_data',binary[v.get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']]);packed+=b'\0'*((-len(packed))%4);newviews.append({**{k:value for k,value in v.items() if k not in ['byteOffset','_data']},'byteOffset':len(packed)});packed+=data
 for a in accessors:a['bufferView']=vmap[a['bufferView']]
 for m in j['meshes']:
  for p in m['primitives']:
   p['attributes']={k:remap[v] for k,v in p['attributes'].items()}
   if 'indices' in p:p['indices']=remap[p['indices']]
 for s in j['skins']:s['inverseBindMatrices']=remap[s['inverseBindMatrices']]
 for a in j['animations']:
  for s in a['samplers']:s['input']=remap[s['input']];s['output']=remap[s['output']]
 j['accessors']=accessors;j['bufferViews']=newviews;j['buffers']=[{'byteLength':len(packed)}]
 j['asset']['extras']={'source':'KayKit Adventurers 1.0 by Kay Lousberg','license':'CC0-1.0','adaptation':'Lineage: vertex-baked original atlas, trimmed animation library'}
 payload=json.dumps(j,separators=(',',':')).encode();payload+=b' '*((-len(payload))%4);packed+=b'\0'*((-len(packed))%4)
 result=struct.pack('<III',0x46546c67,2,12+8+len(payload)+8+len(packed))+struct.pack('<II',len(payload),0x4e4f534a)+payload+struct.pack('<II',len(packed),0x004e4942)+packed
 path=out/('warband-'+name.lower()+'.glb');path.write_bytes(result);print(path,len(result),len(j['animations']),'clips')
