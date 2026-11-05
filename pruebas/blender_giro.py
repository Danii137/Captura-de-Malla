# Renderiza un giro de 360° alrededor de un GLB con texturas (fotogramas PNG), para hacer el vídeo o el GIF
# de la portada con FFmpeg (hacer_videos.mjs).
# Uso: blender -b --factory-startup -P blender_giro.py -- archivo.glb carpeta_salida_absoluta [fotogramas] [ancho] [alto]
import bpy, sys, math, os
from mathutils import Vector
argv = sys.argv[sys.argv.index('--') + 1:]
src, out = argv[0], argv[1]
n = int(argv[2]) if len(argv) > 2 else 120
W = int(argv[3]) if len(argv) > 3 else 1280
H = int(argv[4]) if len(argv) > 4 else 720
os.makedirs(out, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
mn = Vector((1e18, 1e18, 1e18)); mx = Vector((-1e18, -1e18, -1e18))
for o in objs:
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        mn = Vector((min(mn[i], w[i]) for i in range(3))); mx = Vector((max(mx[i], w[i]) for i in range(3)))
ctr = (mn + mx) / 2; size = mx - mn
sc = bpy.context.scene
sc.render.engine = 'BLENDER_WORKBENCH'
sc.display.shading.light = 'FLAT'
sc.display.shading.color_type = 'TEXTURE'
sc.view_settings.view_transform = 'Standard'   # colores de las texturas tal cual
sc.display.render_aa = '8'
sc.render.resolution_x = W; sc.render.resolution_y = H
sc.render.image_settings.file_format = 'PNG'
sc.world = bpy.data.worlds.new('w'); sc.world.color = (0.105, 0.125, 0.145)
cam = bpy.data.cameras.new('c'); cam.lens = 32; cam.clip_end = 1e5
co = bpy.data.objects.new('c', cam); sc.collection.objects.link(co); sc.camera = co
R = max(size.x, size.y) * 0.78
Z = mx.z + max(size.x, size.y) * 0.42
target = Vector((ctr.x, ctr.y, mn.z + size.z * 0.15))
for i in range(n):
    a = -math.pi / 2 - 0.6 + 2 * math.pi * i / n   # empieza desde el suroeste
    co.location = (ctr.x + R * math.cos(a), ctr.y + R * math.sin(a), Z)
    co.rotation_euler = (target - co.location).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = os.path.join(out, 'f_%03d.png' % i)
    bpy.ops.render.render(write_still=True)
print('GIRO OK', n, 'fotogramas')
