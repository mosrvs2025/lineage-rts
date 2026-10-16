"""
Blender 5.2 Asset & Portrait Generator for Lineage RTS
Run via:
  "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe" --background --python scripts/blender_generate.py

Generates:
  1. Sculpted low-poly 3D meshes exported to:
     - public/models/lineage_assets.glb
     - src/render/blenderMeshes.ts (synchronous Three.js BufferGeometry data)
  2. Studio-lit Cycles 3D clan leader portraits:
     - public/portraits/human.png
     - public/portraits/neanderthal.png
     - public/portraits/denisovan.png
"""

import os
import math
import json
import bpy
import bmesh
from mathutils import Vector, Euler

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
MODELS_DIR = os.path.join(ROOT, "public", "models")
PORTRAITS_DIR = os.path.join(ROOT, "public", "portraits")
TS_OUT = os.path.join(ROOT, "src", "render", "blenderMeshes.ts")

os.makedirs(MODELS_DIR, exist_ok=True)
os.makedirs(PORTRAITS_DIR, exist_ok=True)


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def apply_modifiers(obj):
    ctx = bpy.context
    ctx.view_layer.objects.active = obj
    for mod in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=mod.name)


def make_sculpted_torso(name: str, bulk: float = 1.0, waist: float = 0.78) -> bpy.types.Object:
    """Create an anatomical low-poly torso + tunic with chest taper, shoulders, and waist."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    # Build a 5-ring vertical profile from hem (y=0.30) to neck base (y=0.84)
    # Note: In Three.js Y is up, Z is forward. We'll author directly in Three.js coordinates
    # (x = right, y = up, z = forward) for the exported TS buffer.
    rings = [
        # (y, rx, rz, z_offset)
        (0.31, 0.175 * bulk, 0.115 * bulk, 0.00),   # tunic flare hem
        (0.46, 0.155 * bulk, 0.098 * bulk, 0.00),   # pelvis / belt
        (0.56, 0.145 * bulk * waist, 0.095 * bulk, 0.005),  # waist
        (0.71, 0.205 * bulk, 0.132 * bulk, 0.015),  # chest / pectorals
        (0.82, 0.185 * bulk, 0.112 * bulk, 0.005),  # shoulders / clavicle
        (0.86, 0.085 * bulk, 0.075 * bulk, 0.00),   # neck base
    ]
    segs = 10
    ring_verts = []
    for r_idx, (y, rx, rz, zoff) in enumerate(rings):
        v_ring = []
        for i in range(segs):
            ang = (i / segs) * math.tau
            cx = math.cos(ang) * rx
            cz = math.sin(ang) * rz + zoff
            # Subtle chest definition on front (+z) at chest ring
            if r_idx == 3 and cz > 0:
                cz += 0.018 * bulk * abs(math.cos(ang))
            # Tunic hem ripple on bottom ring
            if r_idx == 0:
                y_rip = y + 0.012 * math.sin(ang * 5)
            else:
                y_rip = y
            v_ring.append(bm.verts.new((cx, y_rip, cz)))
        ring_verts.append(v_ring)

    for r in range(len(ring_verts) - 1):
        for i in range(segs):
            v1 = ring_verts[r][i]
            v2 = ring_verts[r][(i + 1) % segs]
            v3 = ring_verts[r + 1][(i + 1) % segs]
            v4 = ring_verts[r + 1][i]
            bm.faces.new((v1, v2, v3, v4))

    # Cap top and bottom
    bm.faces.new(reversed(ring_verts[0]))
    bm.faces.new(ring_verts[-1])
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj


def make_sculpted_head(name: str, brow: float = 0.0, jaw: float = 1.0, cranium_z: float = 1.0) -> bpy.types.Object:
    """Create a sculpted low-poly cranium with brow ridge, cheekbones, nose bridge, and jaw."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=2, radius=0.155)
    for v in bm.verts:
        x, y, z = v.co.x, v.co.y, v.co.z
        # Stretch cranium depth
        z *= cranium_z
        # Taper chin/jaw at bottom front
        if y < -0.02:
            t = min(1.0, (-y - 0.02) / 0.14)
            x *= (1.0 - 0.22 * t) * jaw
            if z > 0:
                z *= (1.0 - 0.12 * t)
        # Cheekbones & brow ridge on front (+z)
        if z > 0.04:
            # Brow ridge around y in [0.02, 0.065]
            if 0.015 <= y <= 0.07:
                z += (0.018 + brow * 0.026) * (1.0 - abs(x) / 0.16)
            # Cheekbones
            if -0.03 <= y <= 0.02 and abs(x) > 0.05:
                x *= 1.08
                z += 0.012
            # Nose bridge
            if -0.035 <= y <= 0.04 and abs(x) < 0.038:
                z += 0.034 * (1.0 - abs(x) / 0.04)
        # Occipital bun at back (-z)
        if z < -0.06 and -0.04 <= y <= 0.04:
            z -= brow * 0.022
        # Shift center to head height (0, 0.92, 0.01)
        v.co = Vector((x, y + 0.92, z + 0.01))

    bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj


def make_chieftain_crown(name: str) -> bpy.types.Object:
    """Carved antler-and-ivory crown with tall feathers for clan leaders."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()

    # Brow circlet at y=0.96
    segs = 12
    r_in, r_out = 0.152, 0.172
    bot, top = [], []
    for i in range(segs):
        a = (i / segs) * math.tau
        bot.append(bm.verts.new((math.cos(a) * r_out, 0.945, math.sin(a) * r_out + 0.01)))
        top.append(bm.verts.new((math.cos(a) * r_in, 0.985, math.sin(a) * r_in + 0.01)))
    for i in range(segs):
        bm.faces.new((bot[i], bot[(i + 1) % segs], top[(i + 1) % segs], top[i]))

    # Antler tines / spikes rising from the circlet
    spike_angles = [-0.9, -0.45, 0.0, 0.45, 0.9]
    for idx, ang in enumerate(spike_angles):
        sx = math.sin(ang) * 0.165
        sz = math.cos(ang) * 0.165 + 0.01
        h = 0.22 if idx == 2 else (0.17 if idx in (1, 3) else 0.13)
        base_r = 0.022
        b0 = bm.verts.new((sx - base_r, 0.97, sz))
        b1 = bm.verts.new((sx + base_r, 0.97, sz))
        b2 = bm.verts.new((sx, 0.97, sz + base_r))
        b3 = bm.verts.new((sx, 0.97, sz - base_r))
        tip = bm.verts.new((sx * 1.18, 0.98 + h, sz * 1.05))
        bm.faces.new((b0, b2, tip))
        bm.faces.new((b2, b1, tip))
        bm.faces.new((b1, b3, tip))
        bm.faces.new((b3, b0, tip))

    bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj


def make_ancestral_totem(name: str) -> bpy.types.Object:
    """Sculpted ancestral totem pillar with carved spirit wings for the Clan Hearth."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    # Tapered octagonal carved pillar from y=0 to y=2.6
    levels = [
        (0.0, 0.24, 0.22),
        (0.6, 0.21, 0.19),
        (1.2, 0.23, 0.20),
        (1.8, 0.19, 0.17),
        (2.4, 0.24, 0.21),
        (2.75, 0.14, 0.14),
    ]
    segs = 8
    rings = []
    for y, rx, rz in levels:
        ring = []
        for i in range(segs):
            a = (i / segs) * math.tau
            ring.append(bm.verts.new((math.cos(a) * rx, y, math.sin(a) * rz)))
        rings.append(ring)
    for r in range(len(rings) - 1):
        for i in range(segs):
            bm.faces.new((rings[r][i], rings[r][(i + 1) % segs], rings[r + 1][(i + 1) % segs], rings[r + 1][i]))
    bm.faces.new(rings[-1])

    # Carved spirit horns / wings at y=2.1
    for side in (-1, 1):
        w0 = bm.verts.new((side * 0.16, 1.85, 0.0))
        w1 = bm.verts.new((side * 0.16, 2.25, 0.0))
        w2 = bm.verts.new((side * 0.62, 2.48, 0.06))
        w3 = bm.verts.new((side * 0.52, 1.98, -0.06))
        bm.faces.new((w0, w1, w2, w3) if side > 0 else (w1, w0, w3, w2))

    bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj


def extract_mesh_data(obj: bpy.types.Object):
    """Extract flat non-indexed vertex positions [x,y,z,...] rounded to 3 decimals for compact TS output."""
    mesh = obj.data
    mesh.calc_loop_triangles()
    pos = []
    for tri in mesh.loop_triangles:
        for vi in tri.vertices:
            v = mesh.vertices[vi].co
            pos.extend([round(v.x, 3), round(v.y, 3), round(v.z, 3)])
    return pos


def make_mat(name: str, hex_col: str, rough: float = 0.7, metal: float = 0.0, emit: float = 0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    h = hex_col.lstrip("#")
    r, g, b = [int(h[i:i+2], 16) / 255.0 for i in (0, 2, 4)]
    # sRGB to linear approximation
    r, g, b = r ** 2.2, g ** 2.2, b ** 2.2
    bsdf.inputs["Base Color"].default_value = (r, g, b, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if emit > 0 and "Emission Color" in bsdf.inputs:
        bsdf.inputs["Emission Color"].default_value = (r, g, b, 1.0)
        bsdf.inputs["Emission Strength"].default_value = emit
    return mat


def add_part(bm, geom_type: str, size, pos, rot=(0, 0, 0), scale=(1, 1, 1)):
    temp = bmesh.new()
    if geom_type == "sphere":
        bmesh.ops.create_icosphere(temp, subdivisions=2, radius=size)
    elif geom_type == "box":
        bmesh.ops.create_cube(temp, size=1.0)
        bmesh.ops.scale(temp, vec=size, verts=temp.verts)
    elif geom_type == "cone":
        bmesh.ops.create_cone(temp, cap_ends=True, cap_tris=True, segments=10, radius1=size[0], radius2=size[1], depth=size[2])
    bmesh.ops.scale(temp, vec=scale, verts=temp.verts)
    rot_mat = Euler(rot, 'XYZ').to_matrix().to_4x4()
    bmesh.ops.transform(temp, matrix=rot_mat, verts=temp.verts)
    bmesh.ops.translate(temp, vec=pos, verts=temp.verts)
    # copy into bm
    v_map = {}
    for v in temp.verts:
        v_map[v.index] = bm.verts.new(v.co)
    for f in temp.faces:
        bm.faces.new([v_map[v.index] for v in f.verts])
    temp.free()


def make_hero_head_bm(brow_strength: float, jaw_width: float):
    """Create a finely sculpted low-poly heroic head in Blender Z-up coordinates (-Y forward)."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=2, radius=0.29)
    for v in bm.verts:
        x, y, z = v.co.x, v.co.y, v.co.z
        # Vertical proportion
        z *= 1.12
        # Taper lower face into a chiseled jawline & chin
        if z < -0.04:
            t = min(1.0, (-z - 0.04) / 0.25)
            x *= (1.0 - 0.34 * t) * jaw_width
            if y < 0:
                y *= (1.0 - 0.14 * t)
        # Flatten temple sides slightly
        if abs(x) > 0.18 and z > -0.05:
            x *= 0.92
        # Front face sculpting (-y is forward toward camera)
        if y < -0.08:
            # Eye sockets recession
            if 0.01 <= z <= 0.085 and 0.045 <= abs(x) <= 0.155:
                y += 0.032
            # Supraorbital brow ridge above eyes
            if 0.075 <= z <= 0.145 and abs(x) <= 0.20:
                ridge = (0.025 + 0.038 * brow_strength) * (1.0 - (abs(x) / 0.22) ** 2)
                y -= ridge
                z -= 0.008 * brow_strength
            # Cheekbone flare (zygomatic arch)
            if -0.06 <= z <= 0.025 and 0.11 <= abs(x) <= 0.24:
                y -= 0.022
                x *= 1.05
        v.co = Vector((x, y, z + 0.32))
    return bm


def render_clan_portrait(species: str, cfg: dict, out_path: str):
    """Build and render a studio-lit 3/4 heroic 3D character bust in Blender Cycles."""
    clear_scene()
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 32
    scene.cycles.use_denoising = False
    scene.render.resolution_x = 256
    scene.render.resolution_y = 256
    scene.render.film_transparent = False

    # World background
    world = bpy.data.worlds.new("StudioWorld")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bh = cfg["bg"].lstrip("#")
    br, bg_c, bb = [(int(bh[i:i+2], 16) / 255.0) ** 2.2 for i in (0, 2, 4)]
    bg.inputs[0].default_value = (br * 0.24, bg_c * 0.24, bb * 0.24, 1.0)
    bg.inputs[1].default_value = 1.0

    root_rot = Euler((0.0, 0.0, cfg.get("yaw", -0.24)), 'XYZ').to_matrix().to_4x4()

    def mesh_obj(name, bm_data, mat):
        bmesh.ops.transform(bm_data, matrix=root_rot, verts=bm_data.verts)
        m = bpy.data.meshes.new(name)
        bmesh.ops.triangulate(bm_data, faces=bm_data.faces)
        bm_data.to_mesh(m)
        bm_data.free()
        for p in m.polygons:
            p.use_smooth = False
        o = bpy.data.objects.new(name, m)
        o.data.materials.append(mat)
        bpy.context.collection.objects.link(o)
        return o

    # Materials
    m_skin = make_mat("skin", cfg["skin"], rough=0.52)
    m_hair = make_mat("hair", cfg["hair"], rough=0.76)
    m_tunic = make_mat("tunic", cfg["tunic"], rough=0.78)
    m_fur = make_mat("fur", cfg["fur"], rough=0.88)
    m_bone = make_mat("bone", "#f0e5cc", rough=0.4)
    m_team = make_mat("team", cfg["team"], rough=0.35, emit=0.22)
    m_eye = make_mat("eye", "#120d0a", rough=0.1)
    m_sclera = make_mat("sclera", "#f4efe6", rough=0.25)
    m_ochre = make_mat("ochre", "#d84e28", rough=0.55, emit=0.18)
    m_gold = make_mat("gold", "#e8bd63", rough=0.28, metal=0.75)

    # 1. Chest Tunic & Layered Fur Mantle
    bm_tunic = bmesh.new()
    add_part(bm_tunic, "cone", (0.56, 0.34, 0.65), (0, 0.02, -0.42), scale=(1.15, 0.82, 1.0))
    mesh_obj("Tunic", bm_tunic, m_tunic)

    bm_fur = bmesh.new()
    for sx in (-1, 1):
        add_part(bm_fur, "sphere", 0.26, (sx * 0.34, 0.02, -0.17), scale=(1.15, 0.9, 0.6))
        add_part(bm_fur, "sphere", 0.20, (sx * 0.22, -0.10, -0.19), scale=(1.0, 0.85, 0.55))
    add_part(bm_fur, "sphere", 0.34, (0, 0.12, -0.16), scale=(1.4, 0.85, 0.55))
    mesh_obj("FurMantle", bm_fur, m_fur)

    # 2. Sculpted Head, Neck, Nose, Lips & Ears
    bm_skin = make_hero_head_bm(cfg["brow_val"], cfg["jaw_val"])
    add_part(bm_skin, "cone", (0.145, 0.125, 0.28), (0, 0.02, 0.02))
    # Chiseled nose bridge and tip
    add_part(bm_skin, "cone", (0.048, 0.018, 0.14), (0, -0.285, 0.315), rot=(-0.22, 0, 0), scale=(0.85, 1.1, 1.0))
    # Subtle mouth/upper lip ridge
    add_part(bm_skin, "box", (0.095, 0.03, 0.022), (0, -0.268, 0.21))
    # Ears
    for sx in (-1, 1):
        add_part(bm_skin, "sphere", 0.062, (sx * 0.275, -0.01, 0.31), scale=(0.4, 0.65, 1.05))
    mesh_obj("Skin", bm_skin, m_skin)

    # 3. Expressive Eyes (sclera + dark iris + bright catchlight)
    bm_sclera = bmesh.new()
    bm_eyes = bmesh.new()
    for sx in (-1, 1):
        add_part(bm_sclera, "sphere", 0.042, (sx * 0.105, -0.242, 0.352), scale=(1.15, 0.7, 0.82))
        add_part(bm_eyes, "sphere", 0.028, (sx * 0.102, -0.264, 0.352), scale=(0.95, 0.6, 0.95))
        add_part(bm_sclera, "sphere", 0.009, (sx * 0.094, -0.278, 0.362))
    mesh_obj("Sclera", bm_sclera, m_sclera)
    mesh_obj("Eyes", bm_eyes, m_eye)

    # 4. Sculpted Hair, Side Locks, Eyebrows & Beard
    bm_hair = bmesh.new()
    add_part(bm_hair, "sphere", 0.305, (0, 0.045, 0.39), scale=(1.03, 1.06, 0.95))
    # Angled eyebrows
    for sx in (-1, 1):
        add_part(bm_hair, "box", (0.095, 0.035, 0.024), (sx * 0.105, -0.265, 0.405), rot=(0, sx * 0.14, 0))
        # Braided side locks framing face
        add_part(bm_hair, "cone", (0.075, 0.028, 0.42), (sx * 0.245, 0.01, 0.14), rot=(0.1, sx * 0.15, 0))
        add_part(bm_hair, "cone", (0.09, 0.04, 0.46), (sx * 0.19, 0.14, 0.12), rot=(0.18, sx * 0.1, 0))
    if cfg["beard"]:
        add_part(bm_hair, "sphere", 0.185, (0, -0.175, 0.16), scale=(1.08, 0.85, 0.92))
        add_part(bm_hair, "cone", (0.145, 0.035, 0.24), (0, -0.21, 0.03), rot=(math.pi - 0.12, 0, 0))
        # Mustache
        for sx in (-1, 1):
            add_part(bm_hair, "box", (0.085, 0.038, 0.028), (sx * 0.055, -0.268, 0.225), rot=(0, sx * -0.28, 0))
    mesh_obj("Hair", bm_hair, m_hair)

    # 5. Clan Headband & Sash
    bm_team = bmesh.new()
    add_part(bm_team, "cone", (0.298, 0.292, 0.068), (0, 0.008, 0.465), scale=(1.0, 1.04, 1.0))
    add_part(bm_team, "box", (0.14, 0.04, 0.42), (0.15, -0.19, -0.34), rot=(0.18, 0.42, 0))
    mesh_obj("TeamBand", bm_team, m_team)

    # 6. Carved Antler/Ivory Crown & Tooth Necklace
    bm_bone = bmesh.new()
    for i in range(7):
        ang = (i - 3) * 0.22
        nx = math.sin(ang) * 0.24
        ny = -math.cos(ang) * 0.21
        add_part(bm_bone, "cone", (0.024, 0.006, 0.085), (nx, ny, -0.105 - abs(i - 3) * 0.008), rot=(math.pi - 0.35, 0, -ang))
    for i in range(5):
        ang = (i - 2) * 0.28
        cx = math.sin(ang) * 0.285
        cy = -math.cos(ang) * 0.285
        h = 0.21 if i == 2 else (0.155 if i in (1, 3) else 0.105)
        add_part(bm_bone, "cone", (0.026, 0.005, h), (cx, cy, 0.515 + h * 0.35), rot=(-0.12, ang * 0.35, 0))
    mesh_obj("BoneRegalia", bm_bone, m_bone)

    if cfg.get("ochre"):
        bm_ochre = bmesh.new()
        for sx in (-1, 1):
            add_part(bm_ochre, "box", (0.065, 0.015, 0.022), (sx * 0.145, -0.248, 0.285), rot=(0, sx * 0.18, -sx * 0.35))
            add_part(bm_ochre, "box", (0.055, 0.015, 0.018), (sx * 0.145, -0.242, 0.252), rot=(0, sx * 0.18, -sx * 0.35))
        add_part(bm_ochre, "sphere", 0.036, (0, -0.295, 0.468), scale=(0.8, 0.5, 1.2))
        mesh_obj("OchrePaint", bm_ochre, m_ochre)

    bm_gold = bmesh.new()
    add_part(bm_gold, "sphere", 0.048, (0, -0.225, -0.095), scale=(1.2, 0.55, 1.2))
    add_part(bm_gold, "sphere", 0.032, (0, -0.298, 0.465), scale=(1.0, 0.5, 1.0))
    mesh_obj("GoldClasp", bm_gold, m_gold)

    # Studio 3-point lighting (warm campfire key + cool rim + soft fill)
    def add_light(name, ltype, energy, color, pos, rot=(0, 0, 0)):
        ld = bpy.data.lights.new(name, type=ltype)
        ld.energy = energy
        ld.color = color
        if ltype == 'AREA':
            ld.size = 1.8
        lo = bpy.data.objects.new(name, ld)
        lo.location = pos
        lo.rotation_euler = rot
        bpy.context.collection.objects.link(lo)

    add_light("KeyFire", 'AREA', 90.0, (1.0, 0.78, 0.52), (-1.35, -1.55, 0.62), (1.1, 0, -0.65))
    add_light("RimMoon", 'AREA', 70.0, (0.52, 0.80, 1.0), (1.4, 1.15, 1.15), (-0.8, 0, 2.3))
    add_light("FillWarm", 'POINT', 30.0, (1.0, 0.90, 0.78), (0.95, -1.65, 0.18))

    # Camera
    cam_data = bpy.data.cameras.new("PortraitCam")
    cam_data.lens = 72
    cam_obj = bpy.data.objects.new("PortraitCam", cam_data)
    cam_obj.location = (0.0, -2.18, 0.25)
    cam_obj.rotation_euler = (math.radians(88.5), 0.0, 0.0)
    bpy.context.collection.objects.link(cam_obj)
    scene.camera = cam_obj

    scene.render.filepath = out_path
    bpy.ops.render.render(write_still=True)
    print(f"Rendered portrait: {out_path}")


def main():
    clear_scene()
    meshes = {
        "torso_human": make_sculpted_torso("torso_human", bulk=1.0, waist=0.78),
        "torso_neanderthal": make_sculpted_torso("torso_neanderthal", bulk=1.16, waist=0.88),
        "torso_denisovan": make_sculpted_torso("torso_denisovan", bulk=1.08, waist=0.82),
        "head_human": make_sculpted_head("head_human", brow=0.1, jaw=0.95, cranium_z=1.0),
        "head_neanderthal": make_sculpted_head("head_neanderthal", brow=0.95, jaw=1.14, cranium_z=1.14),
        "head_denisovan": make_sculpted_head("head_denisovan", brow=0.6, jaw=1.08, cranium_z=1.06),
        "crown_leader": make_chieftain_crown("crown_leader"),
        "totem_hearth": make_ancestral_totem("totem_hearth"),
    }

    # Export .glb asset bundle
    glb_path = os.path.join(MODELS_DIR, "lineage_assets.glb")
    bpy.ops.export_scene.gltf(filepath=glb_path, export_format='GLB')
    print(f"Exported GLB: {glb_path}")

    # Export compact TS vertex buffers for synchronous Three.js geometry creation
    exported = {k: extract_mesh_data(obj) for k, obj in meshes.items()}
    ts_lines = [
        "/** Auto-generated by Blender 5.2 via scripts/blender_generate.py — do not edit by hand. */",
        "import * as THREE from 'three';",
        "",
        "const RAW: Record<string, number[]> = " + json.dumps(exported, separators=(",", ":")) + ";",
        "",
        "const cache = new Map<string, THREE.BufferGeometry>();",
        "export function blenderGeo(name: keyof typeof RAW): THREE.BufferGeometry {",
        "  let g = cache.get(name);",
        "  if (!g) {",
        "    g = new THREE.BufferGeometry();",
        "    g.setAttribute('position', new THREE.Float32BufferAttribute(RAW[name], 3));",
        "    g.computeVertexNormals();",
        "    cache.set(name, g);",
        "  }",
        "  return g.clone();",
        "}",
        "",
    ]
    with open(TS_OUT, "w", encoding="utf-8") as f:
        f.write("\n".join(ts_lines))
    print(f"Wrote TypeScript mesh module: {TS_OUT}")

    # Render Cycles 3D clan portraits
    portraits = {
        "human": {
            "skin": "#e0b288", "hair": "#3a2516", "tunic": "#a44a32", "fur": "#6a482c",
            "team": "#27b7c6", "bg": "#264058", "brow_val": 0.15, "jaw_val": 0.94,
            "beard": False, "ochre": False, "yaw": -0.22,
        },
        "neanderthal": {
            "skin": "#d49e7c", "hair": "#4a2c18", "tunic": "#7a4228", "fur": "#3e2d20",
            "team": "#e89a3c", "bg": "#523c26", "brow_val": 0.95, "jaw_val": 1.12,
            "beard": True, "ochre": False, "yaw": 0.20,
        },
        "denisovan": {
            "skin": "#b5835c", "hair": "#1a1412", "tunic": "#5c4a6e", "fur": "#48382c",
            "team": "#38d39c", "bg": "#3e2e50", "brow_val": 0.55, "jaw_val": 1.02,
            "beard": False, "ochre": True, "yaw": -0.18,
        },
    }
    for sp, cfg in portraits.items():
        render_clan_portrait(sp, cfg, os.path.join(PORTRAITS_DIR, f"{sp}.png"))


if __name__ == "__main__":
    main()
