"""Offline asset inspection, not a gameplay screenshot. Requires numpy and Pillow."""
import struct, json
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw
b = Path('public/assets/characters/leader-human.glb').read_bytes()
length = struct.unpack_from('<I', b, 12)[0]
gltf = json.loads(b[20:20 + length]); binary = b[28 + length:]
def accessor(i):
    a = gltf['accessors'][i]; v = gltf['bufferViews'][a['bufferView']]
    dims = {'VEC3': 3, 'VEC4': 4, 'SCALAR': 1}[a['type']]
    return np.frombuffer(binary, dtype={5126: '<f4', 5123: '<u2', 5125: '<u4'}[a['componentType']], count=a['count'] * dims, offset=v.get('byteOffset', 0) + a.get('byteOffset', 0)).reshape(-1, dims)
primitive = gltf['meshes'][0]['primitives'][0]; a = primitive['attributes']
p, colors, normals = accessor(a['POSITION']), accessor(a['COLOR_0'])[:, :3], accessor(a['NORMAL'])
faces = accessor(primitive['indices']).reshape(-1, 3)
w, h = 1100, 850
pixels = np.full((h, w, 3), [23, 34, 41], dtype=np.uint8); depth = np.full((h, w), -np.inf)
for angle, offset, scale, tilt in [(.48, 320, 520, .22), (-.7, 820, 330, .65)]:
    ca, sa = np.cos(angle), np.sin(angle); ct, st = np.cos(tilt), np.sin(tilt)
    rotation = np.array([[1, 0, 0], [0, ct, -st], [0, st, ct]]) @ np.array([[ca, 0, sa], [0, 1, 0], [-sa, 0, ca]])
    v, n = p @ rotation.T, normals @ rotation.T
    screen = np.column_stack([offset + v[:, 0] * scale, 735 - v[:, 1] * scale])
    lighting = np.maximum(0, n @ np.array([-.3, .65, .7])) * .45 + .55
    for f in faces:
        q = screen[f]; lo = np.maximum(0, np.floor(q.min(axis=0)).astype(int)); hi = np.minimum([w-1, h-1], np.ceil(q.max(axis=0)).astype(int))
        if np.any(hi < lo): continue
        x, y = np.meshgrid(np.arange(lo[0], hi[0]+1)+.5, np.arange(lo[1], hi[1]+1)+.5)
        den = (q[1,1]-q[2,1])*(q[0,0]-q[2,0])+(q[2,0]-q[1,0])*(q[0,1]-q[2,1])
        if abs(den) < 1e-9: continue
        u = ((q[1,1]-q[2,1])*(x-q[2,0])+(q[2,0]-q[1,0])*(y-q[2,1]))/den
        vv = ((q[2,1]-q[0,1])*(x-q[2,0])+(q[0,0]-q[2,0])*(y-q[2,1]))/den
        bary = np.stack([u, vv, 1-u-vv], axis=-1)
        z = bary @ v[f,2]; region = np.s_[lo[1]:hi[1]+1,lo[0]:hi[0]+1]
        visible = (bary.min(axis=-1) >= 0) & (z > depth[region])
        rgb = np.clip((bary @ colors[f]) * (bary @ lighting[f])[...,None],0,1)
        rgb = np.where(rgb<=.0031308,rgb*12.92,1.055*rgb**(1/2.4)-.055)
        pixels[region][visible] = (rgb[visible]*255).astype(np.uint8); depth[region][visible] = z[visible]
im = Image.fromarray(pixels); d = ImageDraw.Draw(im)
d.text((35,25),'LINEAGE / CLAN LEADER — OFFLINE ASSET REVIEW',fill='#e4d3af')
d.text((35,815),'REST POSE / Existing game tools and animation are attached at runtime. Not a gameplay screenshot.',fill='#b7c7cf')
im.save('docs/leader-preview.png')
