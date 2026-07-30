"""
Second Brain — Corporate Memphis Animation
Blender 4.0 Python Script
Run: blender --background --python animate.py
Output: video/out/story.mp4  (40 seconds, 1920x1080, 30fps)

Coordinate space:
  Camera at (0, 0, 10), ORTHO scale=16 → X ∈ [-8,8], Y ∈ [-4.5,4.5]
  All objects in XY plane at Z=0 (layered by tiny Z offsets)
  All materials: flat emission, no lighting needed
"""

import bpy, math, os

# ── PALETTE (sRGB hex → linear float) ─────────────────────────────────────────
def _lin(c): return (c / 255) ** 2.2
def rgb(r, g, b): return tuple(_lin(x) for x in (r, g, b))

NAVY       = rgb(27,  32,  64)
CREAM      = rgb(244, 239, 232)
INDIGO     = rgb(91,  111, 224)
AMBER      = rgb(232, 169, 77)
SHIRT      = rgb(45,  58,  107)
SKIN       = rgb(200, 168, 130)
HAIR       = rgb(45,  45,  45)
DESK       = rgb(139, 115, 85)
FLOOR      = rgb(212, 207, 198)
WALL       = rgb(237, 232, 223)
WIN_MORN   = rgb(232, 169, 77)
WIN_MID    = rgb(255, 255, 240)
WIN_EVE    = rgb(107, 95,  175)
WIN_NIGHT  = rgb(20,  18,  40)
WIN_FRAME  = rgb(180, 140, 50)
SCREEN_COL = rgb(91,  111, 224)

FPS, W, H  = 30, 1920, 1080
TOTAL      = 40 * FPS  # 1200

# ── LOW-LEVEL HELPERS ──────────────────────────────────────────────────────────

def clear_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for d in (bpy.data.meshes, bpy.data.materials, bpy.data.curves):
        for b in list(d): d.remove(b)

def new_mat(name, color, alpha=1.0):
    """Flat emission material, optionally transparent."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    em  = nt.nodes.new('ShaderNodeEmission')
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    em.inputs['Color'].default_value    = (*color, 1.0)
    em.inputs['Strength'].default_value = 1.0
    if alpha < 1.0:
        m.blend_method = 'BLEND'
        tr  = nt.nodes.new('ShaderNodeBsdfTransparent')
        mix = nt.nodes.new('ShaderNodeMixShader')
        mix.inputs['Fac'].default_value = alpha
        nt.links.new(tr.outputs['BSDF'],       mix.inputs[1])
        nt.links.new(em.outputs['Emission'],   mix.inputs[2])
        nt.links.new(mix.outputs['Shader'],    out.inputs['Surface'])
    else:
        nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
    return m, em   # return emission node for later color animation

def add_plane(name, x, y, sx, sy, color, z=0.0, alpha=1.0):
    bpy.ops.mesh.primitive_plane_add(size=1, location=(x, y, z))
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = (sx, sy, 1)
    m, em = new_mat(name + '_M', color, alpha)
    obj.data.materials.append(m)
    return obj, em

def add_circle(name, x, y, r, color, z=0.01, verts=48):
    bpy.ops.mesh.primitive_circle_add(
        vertices=verts, radius=r, fill_type='TRIFAN', location=(x, y, z))
    obj = bpy.context.active_object
    obj.name = name
    m, em = new_mat(name + '_M', color)
    obj.data.materials.append(m)
    return obj, em

def add_line(name, x1, y1, x2, y2, thickness, color, z=0.02):
    """Thin rectangle as a line between two points."""
    cx  = (x1 + x2) / 2
    cy  = (y1 + y2) / 2
    ln  = math.hypot(x2 - x1, y2 - y1)
    ang = math.atan2(y2 - y1, x2 - x1)
    obj, em = add_plane(name, cx, cy, ln, thickness, color, z)
    obj.rotation_euler = (0, 0, ang)
    return obj, em

def hide(obj, frame, hidden=True):
    obj.hide_viewport = hidden
    obj.hide_render   = hidden
    obj.keyframe_insert(data_path='hide_viewport', frame=frame)
    obj.keyframe_insert(data_path='hide_render',   frame=frame)

def show_range(obj, s, e):
    hide(obj, 1,   True)
    hide(obj, s,   False)
    hide(obj, e,   True)

def kf_loc(obj, frame, loc):
    obj.location = loc
    obj.keyframe_insert(data_path='location', frame=frame)

def kf_scale(obj, frame, sc):
    obj.scale = sc
    obj.keyframe_insert(data_path='scale', frame=frame)

def kf_rot(obj, frame, rot_z):
    obj.rotation_euler = (0, 0, rot_z)
    obj.keyframe_insert(data_path='rotation_euler', frame=frame)

def kf_color(em_node, frame, color):
    em_node.inputs['Color'].default_value = (*color, 1.0)
    em_node.inputs['Color'].keyframe_insert(data_path='default_value', frame=frame)

def ease(a, b, t):
    """Smooth-step interpolation."""
    t = max(0.0, min(1.0, t))
    t = t * t * (3 - 2 * t)
    if isinstance(a, tuple):
        return tuple(a[i] + (b[i] - a[i]) * t for i in range(len(a)))
    return a + (b - a) * t

# ── SCENE SETUP ───────────────────────────────────────────────────────────────

def setup_scene():
    clear_scene()

    sc = bpy.context.scene
    sc.frame_start = 1
    sc.frame_end   = TOTAL
    sc.render.fps  = FPS
    sc.render.resolution_x           = W
    sc.render.resolution_y           = H
    sc.render.resolution_percentage  = 100
    sc.render.image_settings.file_format = 'FFMPEG'
    sc.render.ffmpeg.format          = 'MPEG4'
    sc.render.ffmpeg.codec           = 'H264'
    sc.render.ffmpeg.constant_rate_factor = 'MEDIUM'
    sc.render.ffmpeg.audio_codec     = 'NONE'

    out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out', 'story')
    sc.render.filepath = out_dir

    # World background: transparent (objects cover it)
    world = bpy.data.worlds['World']
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (*NAVY, 1.0)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.0

    # Camera
    cam_d = bpy.data.cameras.new('Camera')
    cam_d.type        = 'ORTHO'
    cam_d.ortho_scale = 16.0
    cam_o = bpy.data.objects.new('Camera', cam_d)
    bpy.context.scene.collection.objects.link(cam_o)
    cam_o.location       = (0, 0, 10)
    cam_o.rotation_euler = (0, 0, 0)
    sc.camera = cam_o
    return cam_o, cam_d

# ── SCENE 1 — GLOBE (frames 1 – 150) ─────────────────────────────────────────
# Flat Earth with network lines; camera zooms toward one amber node.

GLOBE_NODES = [
    (-3.2, 1.8), (0.0, 2.4), (3.1, 1.5), (5.0, 0.2),
    (3.8,-1.2), (0.5,-2.0), (-2.8,-1.5), (-5.0, 0.3),
    (-0.5, 0.2),  # node 8 — camera target
    (2.0, 0.8), (-1.8, 1.0),
]
GLOBE_EDGES = [
    (0,1),(1,2),(2,3),(3,4),(4,5),(5,6),(6,7),(7,0),
    (0,8),(1,8),(2,9),(3,9),(4,9),(5,8),(8,9),(8,10),(10,1),(10,6),
]

def build_scene1(cam_o, cam_d):
    S, E = 1, 160

    # Navy background
    bg, _ = add_plane('S1_bg', 0, 0, 16, 9, NAVY, z=-0.1)
    show_range(bg, S, E)

    # Earth circle
    earth, _ = add_circle('S1_earth', 0, 0, 3.8, NAVY, z=0.0, verts=64)
    # Earth outline — slightly larger cream circle behind
    earth_rim, _ = add_circle('S1_rim', 0, 0, 3.9, CREAM, z=-0.01, verts=64)
    earth_rim_obj = earth_rim
    for o in (earth, earth_rim):
        show_range(o, S, E)

    # Continent blobs (simple cream polygons approximated as planes)
    conts = [
        ('C1', -1.2, 0.8,  0.9, 0.55),
        ('C2',  0.8, 1.2,  0.7, 0.45),
        ('C3',  2.0, 0.3,  0.8, 0.50),
        ('C4', -0.5,-0.6,  0.6, 0.40),
    ]
    for nm, x, y, sx, sy in conts:
        c, _ = add_plane(f'S1_{nm}', x, y, sx, sy, CREAM, z=0.01, alpha=0.18)
        show_range(c, S, E)

    # Network lines
    line_objs = []
    for i, (a, b) in enumerate(GLOBE_EDGES):
        x1, y1 = GLOBE_NODES[a]
        x2, y2 = GLOBE_NODES[b]
        lo, _ = add_line(f'S1_L{i}', x1, y1, x2, y2, 0.025, CREAM, z=0.03)
        lo_obj = lo
        # Fade lines in: 1→60
        hide(lo_obj, 1, True)
        hide(lo_obj, 45, False)
        hide(lo_obj, E, True)
        line_objs.append(lo_obj)

    # Network nodes — small cream dots
    for i, (nx, ny) in enumerate(GLOBE_NODES):
        r = 0.09 if i != 8 else 0.13
        col = CREAM if i != 8 else AMBER
        nd, _ = add_circle(f'S1_N{i}', nx, ny, r, col, z=0.04)
        show_range(nd, S, E)

    # Camera zoom toward node 8 (-0.5, 0.2)
    # Start: scale=16, pos=(0,0,10)   End: scale=5, pos=(-0.5*X, 0.2*Y, 10)
    # We move cam XY to track node 8 while zooming
    cam_o.location = (0, 0, 10)
    cam_o.keyframe_insert(data_path='location', frame=1)
    cam_d.ortho_scale = 16
    cam_d.keyframe_insert(data_path='ortho_scale', frame=1)

    cam_o.location = (-1.2, 0.5, 10)
    cam_o.keyframe_insert(data_path='location', frame=E)
    cam_d.ortho_scale = 6
    cam_d.keyframe_insert(data_path='ortho_scale', frame=E)

# ── SCENE 2 — ROOM + HERO (frames 121 – 420) ─────────────────────────────────
# Hero walks in, sets down papers + laptop, sits, camera pulls to corner view.

def build_scene2(cam_o, cam_d):
    S, E = 121, 430

    # Reset camera at scene start
    cam_o.location = (0, 0, 10)
    cam_o.keyframe_insert(data_path='location', frame=S)
    cam_d.ortho_scale = 16
    cam_d.keyframe_insert(data_path='ortho_scale', frame=S)

    # Camera pull-back: zoom out a bit and shift up
    cam_o.location = (2.0, 1.0, 10)
    cam_o.keyframe_insert(data_path='location', frame=S + 200)
    cam_d.ortho_scale = 18
    cam_d.keyframe_insert(data_path='ortho_scale', frame=S + 200)

    # Floor
    fl, _ = add_plane('S2_floor', 0, -2.8, 16, 3.5, FLOOR, z=0.0)
    show_range(fl, S, E)

    # Wall
    wl, _ = add_plane('S2_wall', 0, 1.5, 16, 5.5, WALL, z=0.0)
    show_range(wl, S, E)

    # Window — right side, morning amber, animated to darker later
    win, win_em = add_plane('S2_win', 5.5, 1.5, 2.0, 3.2, WIN_MORN, z=0.05)
    show_range(win, S, E)

    # Window frame lines
    wf_h, _ = add_plane('S2_wfH', 5.5, 1.5, 2.0, 0.07, WIN_FRAME, z=0.06)
    wf_v, _ = add_plane('S2_wfV', 5.5, 1.5, 0.07, 3.2, WIN_FRAME, z=0.06)
    for o in (wf_h, wf_v): show_range(o, S, E)

    # Desk surface
    desk, _ = add_plane('S2_desk', 0, -1.1, 8.0, 0.18, DESK, z=0.1)
    show_range(desk, S, E)

    # Desk legs
    for lx in (-3.8, 3.8):
        leg, _ = add_plane(f'S2_leg{lx}', lx, -1.7, 0.15, 1.2, DESK, z=0.1)
        show_range(leg, S, E)

    # Laptop (appears after hero sits: frame S+60)
    lap_body, _ = add_plane('S2_lap', 0.8, -0.88, 1.4, 0.12, HAIR, z=0.2)
    lap_screen,_ = add_plane('S2_screen', 0.8, -0.5, 1.2, 0.72, HAIR, z=0.2)
    lap_glow, _  = add_plane('S2_glow', 0.8, -0.5, 1.1, 0.65, INDIGO, z=0.21)
    for o in (lap_body, lap_screen, lap_glow):
        hide(o, 1, True); hide(o, S+60, False); hide(o, E, True)

    # Paper stack on desk (appears after hero sits)
    for i in range(4):
        pap, _ = add_plane(f'S2_pap{i}', -1.5 + i*0.02, -0.97 + i*0.025,
                           1.1, 0.065, CREAM if i%2==0 else WALL, z=0.15+i*0.01)
        hide(pap, 1, True); hide(pap, S+60, False); hide(pap, E, True)

    # ── Hero ──────────────────────────────────────────────────────────────────
    # Enters from left (x=-9) at frame S, arrives at desk (x=-0.5) at S+50

    def hero_parts(prefix, z_base=0.3):
        """Create hero body parts, return dict."""
        parts = {}
        # Body
        parts['body'],_ = add_plane(f'{prefix}_body', 0, -0.8, 0.55, 0.75, SHIRT, z_base)
        # Head
        parts['head'],_ = add_circle(f'{prefix}_head', 0, -0.25, 0.32, SKIN, z_base+0.01)
        # Hair
        parts['hair'],_ = add_circle(f'{prefix}_hair', 0, -0.12, 0.26, HAIR, z_base+0.02, verts=32)
        # L arm
        parts['larm'],_ = add_plane(f'{prefix}_larm', -0.4, -0.72, 0.17, 0.52, SHIRT, z_base)
        # R arm
        parts['rarm'],_ = add_plane(f'{prefix}_rarm',  0.4, -0.72, 0.17, 0.52, SHIRT, z_base)
        return parts

    hero = hero_parts('H2')
    all_hero = list(hero.values())

    for o in all_hero:
        hide(o, 1, True)
        hide(o, S,  False)
        hide(o, E,  True)

    # Walk-in: x from -9 to -0.5, frames S → S+50
    for o in all_hero:
        o.location.x = -9
        o.keyframe_insert(data_path='location', frame=S)
        o.location.x = -0.5
        o.keyframe_insert(data_path='location', frame=S+50)

    # Sit down: slight drop in y, frames S+50 → S+65
    for o in all_hero:
        o.location.y -= 0.3
        o.keyframe_insert(data_path='location', frame=S+65)

# ── SCENE 3 — TIME-LAPSE (frames 361 – 780) ──────────────────────────────────
# Top-corner view; papers multiply; hero slumps; window changes colour; sleeps.

def build_scene3(cam_o, cam_d):
    S, E = 361, 790

    # Camera: top-corner — shift right and up, zoom out slightly
    cam_o.location = (3.5, 2.0, 10)
    cam_o.keyframe_insert(data_path='location', frame=S)
    cam_d.ortho_scale = 20
    cam_d.keyframe_insert(data_path='ortho_scale', frame=S)

    # Floor (top-down feel)
    fl, _ = add_plane('S3_floor', 0, -1.0, 16, 9, FLOOR, z=0.0)
    show_range(fl, S, E)

    # Back wall strip
    wl, _ = add_plane('S3_wall', 0, 3.5, 16, 3.0, WALL, z=0.01)
    show_range(wl, S, E)

    # Window — color animates through day
    win, win_em = add_plane('S3_win', 4.5, 2.5, 2.0, 2.8, WIN_MORN, z=0.05)
    show_range(win, S, E)

    # Animate window colour through time of day
    kf_color(win_em, S,       WIN_MORN)    # morning amber
    kf_color(win_em, S+130,   WIN_MID)     # midday white
    kf_color(win_em, S+240,   WIN_MORN)    # afternoon warm
    kf_color(win_em, S+300,   WIN_EVE)     # evening violet
    kf_color(win_em, S+370,   WIN_NIGHT)   # night black

    # Window frame
    wfH, _ = add_plane('S3_wfH', 4.5, 2.5, 2.0, 0.07, WIN_FRAME, z=0.06)
    wfV, _ = add_plane('S3_wfV', 4.5, 2.5, 0.07, 2.8, WIN_FRAME, z=0.06)
    for o in (wfH, wfV): show_range(o, S, E)

    # Desk — top-down view (wider, more square)
    desk, _ = add_plane('S3_desk', 0, -0.5, 7.0, 3.5, DESK, z=0.1)
    show_range(desk, S, E)

    # Laptop on desk
    lap,  _ = add_plane('S3_lap',  1.2, -0.4, 1.6, 1.0, HAIR,   z=0.2)
    glw,  _ = add_plane('S3_glw',  1.2, -0.4, 1.4, 0.88, INDIGO, z=0.21)
    for o in (lap, glw): show_range(o, S, E)

    # Papers — appear progressively (one every 30 frames)
    paper_positions = [
        (-2.0,-0.2), (-2.8, 0.1), (-1.4, 0.4), (-0.2,-0.6),
        (-3.2,-0.4), (-0.8, 0.6), (-2.5, 0.8), (-1.0,-0.9),
        ( 3.5,-1.5), ( 3.0,-1.2), (-3.8,-1.4), ( 2.8,-1.8),
    ]
    for i, (px, py) in enumerate(paper_positions):
        p, _ = add_plane(f'S3_P{i}', px, py, 1.0, 0.07,
                         CREAM if i%2==0 else WALL, z=0.15+i*0.01)
        appear = S + i * 30
        hide(p, 1,      True)
        hide(p, appear, False)
        hide(p, E,      True)

    # Desk lamp (appears at S+300)
    lamp_p, _ = add_plane('S3_lp', 2.8, -0.2, 0.1, 0.6, DESK, z=0.3)
    lamp_h, _ = add_plane('S3_lh', 2.8, 0.15, 0.5, 0.15, DESK, z=0.31)
    lamp_g, _ = add_circle('S3_lg', 2.8, -0.6, 1.2, AMBER, z=0.25, verts=32)
    for o in (lamp_p, lamp_h, lamp_g):
        hide(o, 1,      True)
        hide(o, S+300,  False)
        hide(o, E,      True)
    # Lamp glow starts at 0 opacity — we can't easily do alpha animation here,
    # so just show it from S+300

    # Hero (top-down silhouette) — posture keyframed via scale Y compression
    h_body,_ = add_plane('S3_body', -0.5, -0.3, 0.5, 0.7, SHIRT, z=0.4)
    h_head,_ = add_circle('S3_head', -0.5,  0.1, 0.28, SKIN, z=0.41)
    h_hair,_ = add_circle('S3_hair', -0.5,  0.2, 0.22, HAIR, z=0.42)
    hero_parts3 = [h_body, h_head, h_hair]
    for o in hero_parts3:
        hide(o, 1, True); hide(o, S, False); hide(o, E, True)

    # Slump: tilt body forward (rotate) over time
    kf_rot(h_body, S,       0)
    kf_rot(h_body, S+370,   0.35)   # leaning forward ~20 deg

    # Night darkness overlay
    dark, _ = add_plane('S3_dark', 0, 0, 16, 9, HAIR, z=0.8, alpha=0.0)
    show_range(dark, S, E)
    # We can't animate alpha easily with emission; use hide/show of a semi-transparent plane
    # Instead: add a second dark overlay that fades in at S+300
    dark2, _ = add_plane('S3_dark2', 0, 0, 16, 9, NAVY, z=0.8, alpha=0.5)
    hide(dark2, 1,      True)
    hide(dark2, S+300,  False)
    hide(dark2, E,      True)

    # Hero asleep: head drops onto desk at S+360
    kf_loc(h_head, S+360, (-0.5+0.6,  -0.25, 0))
    kf_loc(h_head, S+355, (-0.5, 0.1, 0))

# ── SCENE 4 — STRUGGLE (frames 721 – 1140) ───────────────────────────────────
# Eye-level. Hero searches papers, holds head, spots screen.

def build_scene4(cam_o, cam_d):
    S, E = 721, 1150

    # Camera: back to front view, eye level, push into screen at end
    cam_o.location = (0, 0, 10)
    cam_o.keyframe_insert(data_path='location', frame=S)
    cam_d.ortho_scale = 16
    cam_d.keyframe_insert(data_path='ortho_scale', frame=S)

    # Camera push toward laptop (at 0.8, -0.5) in last 90 frames
    cam_o.location = (2.5, -0.8, 10)
    cam_o.keyframe_insert(data_path='location', frame=E-90)
    cam_d.ortho_scale = 6
    cam_d.keyframe_insert(data_path='ortho_scale', frame=E-90)

    # Floor
    fl, _ = add_plane('S4_floor', 0, -2.8, 16, 3.5, FLOOR, z=0.0)
    show_range(fl, S, E)

    # Wall
    wl, _ = add_plane('S4_wall', 0, 1.5, 16, 5.5, WALL, z=0.0)
    show_range(wl, S, E)

    # Window — morning light (new day)
    win, win_em = add_plane('S4_win', 5.5, 1.5, 2.0, 3.2, WIN_NIGHT, z=0.05)
    show_range(win, S, E)
    kf_color(win_em, S,      WIN_NIGHT)
    kf_color(win_em, S+60,   WIN_MORN)     # brightens as hero wakes up

    # Desk
    desk, _ = add_plane('S4_desk', 0, -1.1, 8.0, 0.18, DESK, z=0.1)
    show_range(desk, S, E)

    # Laptop
    lap_b, _ = add_plane('S4_lapB', 0.8, -0.88, 1.4, 0.12, HAIR,   z=0.2)
    lap_s, _ = add_plane('S4_lapS', 0.8, -0.5,  1.2, 0.72, HAIR,   z=0.2)
    lap_g, _ = add_plane('S4_lapG', 0.8, -0.5,  1.1, 0.65, INDIGO, z=0.21)
    # Glow brightens when camera pushes in
    lap_ga,_ = add_plane('S4_lapGA',0.8, -0.5,  1.1, 0.65, AMBER,  z=0.22)
    for o in (lap_b, lap_s, lap_g): show_range(o, S, E)
    hide(lap_ga, 1, True)
    hide(lap_ga, E-90, False)
    hide(lap_ga, E, True)

    # Papers on desk — messy pile
    paper_pos = [
        (-1.8,-0.97), (-1.2,-0.94), (-2.4,-1.0),
        (-0.6,-0.96), (-3.0,-0.98), (-1.5,-0.92),
    ]
    for i,(px,py) in enumerate(paper_pos):
        p,_ = add_plane(f'S4_dp{i}', px, py, 1.0, 0.065,
                        CREAM if i%2==0 else WALL, z=0.15+i*0.008)
        show_range(p, S, E)

    # Papers on floor
    floor_pap = [
        (-4.0,-2.0,  8), (-3.2,-2.3, -12), (-5.0,-1.8,  5),
        ( 4.5,-2.1, 15), ( 5.2,-2.4, -8),
    ]
    for i,(px,py,rot) in enumerate(floor_pap):
        p,_ = add_plane(f'S4_fp{i}', px, py, 1.0, 0.065, CREAM, z=0.12)
        p.rotation_euler = (0, 0, math.radians(rot))
        show_range(p, S, E)

    # Chair back
    ch,_ = add_plane('S4_chair', -0.5, -1.8, 1.4, 0.1, DESK, z=0.15)
    show_range(ch, S, E)

    # ── Hero ─────────────────────────────────────────────────────────────────
    h_body,_ = add_plane('S4_body', -0.5, -0.8,  0.55, 0.75, SHIRT, z=0.3)
    h_head,_ = add_circle('S4_head',-0.5, -0.25, 0.32, SKIN,  z=0.31)
    h_hair,_ = add_circle('S4_hair',-0.5, -0.12, 0.26, HAIR,  z=0.32)
    h_larm,_ = add_plane('S4_larm', -0.9, -0.72, 0.17, 0.52, SHIRT, z=0.3)
    h_rarm,_ = add_plane('S4_rarm', -0.1, -0.72, 0.17, 0.52, SHIRT, z=0.3)
    all_h4 = [h_body, h_head, h_hair, h_larm, h_rarm]
    for o in all_h4: show_range(o, S, E)

    # Phase 1 (S → S+60): upright, fresh energy — hero sits straight
    kf_rot(h_body, S,    0)
    kf_rot(h_body, S+60, 0)

    # Phase 2 (S+60 → S+180): searching — arms move side to side
    kf_loc(h_larm, S+60,  (-0.9, -0.72, 0))
    kf_loc(h_larm, S+90,  (-1.6, -0.55, 0))   # arm reaches into pile
    kf_loc(h_larm, S+120, (-0.9, -0.72, 0))
    kf_loc(h_larm, S+150, (-1.8, -0.50, 0))
    kf_loc(h_larm, S+180, (-0.9, -0.72, 0))

    # Phase 3 (S+180 → S+300): head-in-hands frustrated pose
    kf_rot(h_body, S+190, 0.15)   # slight lean forward
    kf_loc(h_larm, S+195, (-0.82, -0.30, 0))  # arms up to temples
    kf_loc(h_rarm, S+195, (-0.18, -0.30, 0))
    kf_rot(h_head, S+195, 0.1)    # head slightly bowed

    # Phase 4 (S+300 → E): eyes drift to screen — head turns toward laptop
    kf_rot(h_head, S+310, -0.3)   # turning right toward screen


# ── TRANSITION (frames 1081 – 1200) ──────────────────────────────────────────
# Laptop screen expands to fill frame → white flash.

def build_transition(cam_o, cam_d):
    S, E = 1081, 1200

    # Reset camera exactly where scene 4 left it
    # Then we expand the screen plane to fill the view

    # Screen plane starts at laptop size and grows to fill 16x9
    sc_p, _ = add_plane('TR_screen', 0.8, -0.5, 1.1, 0.65, INDIGO, z=5.0)
    show_range(sc_p, S, E)
    kf_scale(sc_p, S,     (1.1,  0.65, 1))
    kf_scale(sc_p, S+80,  (16,   9,    1))
    kf_loc(sc_p,   S,     (0.8, -0.5,  5))
    kf_loc(sc_p,   S+80,  (0,    0,    5))

    # White flash
    fl, _ = add_plane('TR_flash', 0, 0, 16, 9, CREAM, z=6.0)
    hide(fl, 1,     True)
    hide(fl, S+80,  False)
    hide(fl, E,     True)

# ── MAIN ──────────────────────────────────────────────────────────────────────

def main():
    cam_o, cam_d = setup_scene()
    build_scene1(cam_o, cam_d)
    build_scene2(cam_o, cam_d)
    build_scene3(cam_o, cam_d)
    build_scene4(cam_o, cam_d)
    build_transition(cam_o, cam_d)

    # Set all keyframe interpolation to BEZIER for smooth motion
    for action in bpy.data.actions:
        for fcurve in action.fcurves:
            for kp in fcurve.keyframe_points:
                kp.interpolation = 'BEZIER'

    print("✓ Scene built. Starting render…")
    bpy.ops.render.render(animation=True)
    print("✓ Render complete → video/out/story.mp4")

main()
