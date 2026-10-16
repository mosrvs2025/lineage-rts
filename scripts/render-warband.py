"""CPU raster review of runtime-instantiated, posed character meshes. Not a game screenshot."""
import json,numpy as np
from PIL import Image,ImageDraw,ImageFont
from pathlib import Path
j=json.load(open('/tmp/lineage-warband-snapshot.json'));w,h=1600,1080
pixels=np.zeros((h,w,3),dtype=np.uint8)
for y in range(h):pixels[y,:,:]=np.array([15,24,29])+(1-y/h)*np.array([9,11,12])
depth=np.full((h,w),-np.inf)
def draw_model(row,cx,baseline,scale,tilt):
 ct,st=np.cos(tilt),np.sin(tilt);rot=np.array([[1,0,0],[0,ct,-st],[0,st,ct]])
 for m in row['meshes']:
  p=np.array(m['positions']).reshape(-1,3)@rot.T;n=np.array(m['normals']).reshape(-1,3)@rot.T;c=np.array(m['colors']).reshape(-1,3)
  screen=np.column_stack([cx+p[:,0]*scale,baseline-p[:,1]*scale]);faces=np.array(m['indices']).reshape(-1,3)
  light=np.maximum(0,n@np.array([-.35,.65,.7]))*.45+.6
  for f in faces:
   q=screen[f];lo=np.maximum(0,np.floor(q.min(axis=0)).astype(int));hi=np.minimum([w-1,h-1],np.ceil(q.max(axis=0)).astype(int))
   if np.any(hi<lo):continue
   x,y=np.meshgrid(np.arange(lo[0],hi[0]+1)+.5,np.arange(lo[1],hi[1]+1)+.5)
   den=(q[1,1]-q[2,1])*(q[0,0]-q[2,0])+(q[2,0]-q[1,0])*(q[0,1]-q[2,1])
   if abs(den)<1e-9:continue
   u=((q[1,1]-q[2,1])*(x-q[2,0])+(q[2,0]-q[1,0])*(y-q[2,1]))/den
   v=((q[2,1]-q[0,1])*(x-q[2,0])+(q[0,0]-q[2,0])*(y-q[2,1]))/den;bary=np.stack([u,v,1-u-v],axis=-1)
   z=bary@p[f,2];region=np.s_[lo[1]:hi[1]+1,lo[0]:hi[0]+1];visible=(bary.min(axis=-1)>=0)&(z>depth[region])
   rgb=np.clip((bary@c[f])*(bary@light[f])[...,None],0,1);rgb=np.where(rgb<=.0031308,rgb*12.92,1.055*rgb**(1/2.4)-.055)
   pixels[region][visible]=(rgb[visible]*255).astype(np.uint8);depth[region][visible]=z[visible]
for i,row in enumerate(j['rows']):draw_model(row,140+i*265,630,185,.15)
# Additional overhead pass uses the game's actual 58-degree camera pitch.
for i,row in enumerate(j['rows']):draw_model(row,140+i*265,947,78,np.radians(58))
im=Image.fromarray(pixels);d=ImageDraw.Draw(im)
font='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
def f(s):return ImageFont.truetype(font,s)
d.text((55,30),'LINEAGE',font=f(38),fill='#ecd6a2');d.text((55,83),'WARBAND / CHARACTER ART + AUTHORED MOTION',font=f(17),fill='#9fb6b4')
d.text((55,122),'Actual posed meshes from the runtime factory. CPU lighting; not a gameplay screenshot.',font=f(15),fill='#718b90')
for i,row in enumerate(j['rows']):
 title={'leader':'CLAN LEADER','guard':'SPEAR GUARD','hunter':'HUNTER','gatherer':'GATHERER','brute':'NEANDERTHAL BRUTE','scout':'SCOUT'}[row['kind']]
 d.text((35+i*265,652),title,font=f(15),fill='#e9d7ac')
d.line((55,720,1545,720),fill='#34494b');d.text((55,747),'OVERHEAD READABILITY / 58° GAME CAMERA PITCH',font=f(17),fill='#a0bcb8')
d.text((55,1015),'Adapted from KayKit Adventurers by Kay Lousberg (CC0). Original atlas colors baked into mesh vertices.',font=f(14),fill='#718b90')
im.save('docs/warband-preview.png')
