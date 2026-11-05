# Importa un GLB y saca dos imágenes (planta y perspectiva) con las texturas, para revisarlo a ojo.
# Uso: blender -b --factory-startup -P blender_render.py -- archivo.glb salida_prefijo
import bpy, sys, math
from mathutils import Vector
argv = sys.argv[sys.argv.index('--') + 1:]
src, out = argv[0], argv[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
mn = Vector((1e18, 1e18, 1e18)); mx = Vector((-1e18, -1e18, -1e18))
tris = 0
for o in objs:
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        mn = Vector((min(mn[i], w[i]) for i in range(3))); mx = Vector((max(mx[i], w[i]) for i in range(3)))
    tris += sum(len(p.vertices) - 2 for p in o.data.polygons)
print('OBJETOS', len(objs), 'TRIANGULOS', tris, 'CAJA', [round(v, 1) for v in mn], [round(v, 1) for v in mx])
print('MATERIALES', len(bpy.data.materials), 'IMAGENES', len(bpy.data.images), [ (i.name, i.size[0], i.size[1]) for i in bpy.data.images][:3])
ctr = (mn + mx) / 2; size = mx - mn
sc = bpy.context.scene
sc.render.engine = 'BLENDER_WORKBENCH'
sc.display.shading.light = 'FLAT'
sc.display.shading.color_type = 'TEXTURE'
sc.render.resolution_x = int(argv[2]) if len(argv) > 2 else 1600
sc.render.resolution_y = int(sc.render.resolution_x * max(0.3, min(1.5, size.y / max(size.x, 1e-6))))
sc.render.film_transparent = False
world = bpy.data.worlds.new('w'); sc.world = world
# planta (ortográfica, norte arriba = +Y)
cam = bpy.data.cameras.new('c'); cam.type = 'ORTHO'; cam.ortho_scale = max(size.x, size.y) * 1.02
co = bpy.data.objects.new('c', cam); sc.collection.objects.link(co); sc.camera = co
co.location = (ctr.x, ctr.y, mx.z + 500); co.rotation_euler = (0, 0, 0); cam.clip_end = 5000
sc.render.filepath = out + '_planta.png'; bpy.ops.render.render(write_still=True)
# perspectiva desde el suroeste
cam.type = 'PERSP'; cam.lens = 35
sc.render.resolution_y = int(sc.render.resolution_x * 0.6)
d = max(size.x, size.y) * 0.75
co.location = (ctr.x - d * 0.6, ctr.y - d * 0.9, mx.z + d * 0.55)
dirv = ctr - co.location; co.rotation_euler = dirv.to_track_quat('-Z', 'Y').to_euler()
sc.render.filepath = out + '_perspectiva.png'; bpy.ops.render.render(write_still=True)
# detalle: zona central de 60 m, cerca
co.location = (ctr.x - 40, ctr.y - 70, mn.z + 75)
dirv = Vector((ctr.x, ctr.y, mn.z + 15)) - co.location; co.rotation_euler = dirv.to_track_quat('-Z', 'Y').to_euler()
sc.render.filepath = out + '_detalle.png'; bpy.ops.render.render(write_still=True)
print('RENDER OK')
