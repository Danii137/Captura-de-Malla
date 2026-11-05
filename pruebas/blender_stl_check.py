# Importa un STL para imprimir en Blender (sin ventana), comprueba que es un sólido cerrado y saca
# una imagen en perspectiva y otra de la base.
# Uso: blender -b --factory-startup -P blender_stl_check.py -- archivo.stl prefijo_absoluto
import bpy, bmesh, sys
from mathutils import Vector
argv = sys.argv[sys.argv.index('--') + 1:]
src, out = argv[0], argv[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.stl_import(filepath=src)
o = [x for x in bpy.context.scene.objects if x.type == 'MESH'][0]
bm = bmesh.new(); bm.from_mesh(o.data)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)  # el STL no comparte vértices: se sueldan
nonman = sum(1 for e in bm.edges if not e.is_manifold)
bound = sum(1 for e in bm.edges if e.is_boundary)
nocont = sum(1 for e in bm.edges if not e.is_contiguous)
vol = bm.calc_volume(signed=True)
mn = Vector((min(v.co.x for v in bm.verts), min(v.co.y for v in bm.verts), min(v.co.z for v in bm.verts)))
mx = Vector((max(v.co.x for v in bm.verts), max(v.co.y for v in bm.verts), max(v.co.z for v in bm.verts)))
print('STL', 'caras', len(bm.faces), 'vertices', len(bm.verts), 'aristas no manifold', nonman, 'de borde', bound,
      'normales incoherentes', nocont, 'volumen mm3', round(vol), 'caja', [round(v, 2) for v in mn], [round(v, 2) for v in mx])
print('CERRADO' if nonman == 0 and bound == 0 and nocont == 0 and vol > 0 else 'NO CERRADO')
bm.free()
sc = bpy.context.scene
sc.render.engine = 'BLENDER_WORKBENCH'
sc.display.shading.light = 'STUDIO'
sc.display.shading.color_type = 'SINGLE'
sc.display.shading.single_color = (0.82, 0.8, 0.76)
sc.display.shading.show_cavity = True
sc.render.resolution_x = 1600; sc.render.resolution_y = 1000
sc.world = bpy.data.worlds.new('w')
ctr = (mn + mx) / 2; size = mx - mn
cam = bpy.data.cameras.new('c'); cam.lens = 40; cam.clip_end = 1e5
co = bpy.data.objects.new('c', cam); sc.collection.objects.link(co); sc.camera = co
d = max(size.x, size.y)
co.location = (ctr.x - d * 0.55, ctr.y - d * 0.95, mx.z + d * 0.6)
co.rotation_euler = (ctr - co.location).to_track_quat('-Z', 'Y').to_euler()
sc.render.filepath = out + '_perspectiva.png'; bpy.ops.render.render(write_still=True)
# desde abajo (base plana) y de lado
co.location = (ctr.x + d * 0.5, ctr.y - d * 0.9, mn.z - d * 0.35)
co.rotation_euler = (ctr - co.location).to_track_quat('-Z', 'Y').to_euler()
sc.render.filepath = out + '_base.png'; bpy.ops.render.render(write_still=True)
# detalle cerca
co.location = (ctr.x - d * 0.12, ctr.y - d * 0.3, mx.z + d * 0.12)
co.rotation_euler = (Vector((ctr.x, ctr.y, mn.z + size.z * 0.4)) - co.location).to_track_quat('-Z', 'Y').to_euler()
sc.render.filepath = out + '_detalle.png'; bpy.ops.render.render(write_still=True)
print('RENDER OK')
