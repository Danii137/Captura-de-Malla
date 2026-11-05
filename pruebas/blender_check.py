# Importa cada archivo exportado en Blender (sin ventana) y resume lo que ve.
# Uso: blender -b --factory-startup --python blender_check.py -- archivo1 archivo2 ...
import bpy, sys, os, zipfile, tempfile
from mathutils import Vector

sys.stdout.reconfigure(encoding="utf-8")
args = sys.argv[sys.argv.index("--") + 1:]

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def summary(tag):
    objs = [o for o in bpy.data.objects if o.type == "MESH"]
    nv = sum(len(o.data.vertices) for o in objs)
    nf = sum(len(o.data.polygons) for o in objs)
    mn = Vector((1e18, 1e18, 1e18)); mx = Vector((-1e18, -1e18, -1e18))
    for o in objs:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            mn = Vector(map(min, mn, w)); mx = Vector(map(max, mx, w))
    imgs = [i for i in bpy.data.images if i.size[0] > 0]
    uvs = sum(1 for o in objs if o.data.uv_layers)
    mats = len(bpy.data.materials)
    tex_nodes = 0
    for m in bpy.data.materials:
        if m.use_nodes:
            tex_nodes += sum(1 for n in m.node_tree.nodes if n.type == "TEX_IMAGE" and n.image)
    print(f"[{tag}] objetos={len(objs)} vértices={nv} caras={nf} con_UV={uvs} materiales={mats} imágenes_cargadas={len(imgs)} nodos_textura={tex_nodes}")
    print(f"[{tag}] caja min=({mn.x:.2f}, {mn.y:.2f}, {mn.z:.2f}) max=({mx.x:.2f}, {mx.y:.2f}, {mx.z:.2f})")

for f in args:
    reset()
    ext = os.path.splitext(f)[1].lower()
    try:
        if ext == ".glb":
            bpy.ops.import_scene.gltf(filepath=f)
        elif ext == ".fbx":
            bpy.ops.import_scene.fbx(filepath=f)
        elif ext == ".stl":
            bpy.ops.wm.stl_import(filepath=f)
        elif ext == ".zip":
            d = tempfile.mkdtemp()
            zipfile.ZipFile(f).extractall(d)
            objf = [os.path.join(d, n) for n in os.listdir(d) if n.endswith(".obj")][0]
            bpy.ops.wm.obj_import(filepath=objf)
        summary(os.path.basename(f))
    except Exception as e:
        print(f"[{os.path.basename(f)}] ERROR al importar: {e}")
