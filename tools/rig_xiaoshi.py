"""
给单网格角色（小拾.glb）自动建骨并烘蒙皮权重，导出带 skins 的 GLB。

用法（headless）：
    blender --background --python tools/rig_xiaoshi.py -- <src.glb> <dst.glb> [decimate_ratio]

设计要点
--------
1. 不用 Blender 自带的 bone-heat 自动权重：91 万顶点跑它极慢且极易
   "failed to find solution"。这里改为「胶囊段距离 + 逐骨 falloff」的
   解析式权重，配合若干**硬规则**锁死关键区域（裙摆锁髋、腿锁腿骨、
   头锁头骨、长发锁 hair 骨），从根本上避免裙摆粘腿这类瑕疵。
2. 骨架坐标按实测剖面给出（身高 H 的比例，见 PROFILE 注释）：
   脚底 y=0，头顶 y=H；正面朝 +z。
3. 权重用 numpy 向量化计算，写入时按「权重值分桶」批量调用 vg.add，
   把 90 万次 Python 调用压到几百次。
"""

import sys
import time
import math

import bpy
from mathutils import Matrix

try:
    import numpy as np
except ImportError:  # Blender 自带 numpy，理论上不会走到这
    np = None


# ----------------------------------------------------------------------
# 实测剖面（世界空间，身高 H=1.136，脚底 y=0，正面 +z）
#   头顶/呆毛 0.96~1.00H   头 0.71~0.96H   颈 0.68~0.71H
#   肩 0.62~0.68H          上臂 0.56~0.62H  前臂/手 0.48~0.56H（手到腰高，贴身垂下）
#   裙摆 0.06~0.46H（宽 ±0.40H）  小腿 0.02~0.06H  脚 0~0.02H（|x|≤0.10H，z>0 在前）
#   注意：0.50~0.62H 处 |x| 可达 0.40H，那是**长发**外张，不是手臂。
# ----------------------------------------------------------------------

def bone_specs(H, z0):
    """返回 [(name, parent, head(xyz), tail(xyz), falloff)]，坐标为 Blender 世界空间。

    注意 Blender 是 Z-up：glTF 导入之后
        身高沿 +Z（脚底 z=0），正面朝 **-Y**，左右仍在 ±X。
    所以比例常数 (u, h, w) 映射为 (x, y, z) = (u*H, -w*H, z0 + h*H)。
    """
    P = lambda u, h, w: (u * H, -w * H, z0 + h * H)
    s = []
    add = lambda *a: s.append(a)

    # 躯干链（falloff 大，保证躯干与四肢过渡柔和）
    add('Hips', None, P(0, 0.40, 0.00), P(0, 0.50, 0.00), 0.13)
    add('Spine', 'Hips', P(0, 0.50, 0.00), P(0, 0.60, 0.00), 0.11)
    add('Chest', 'Spine', P(0, 0.60, 0.00), P(0, 0.665, 0.00), 0.10)
    add('Neck', 'Chest', P(0, 0.665, 0.00), P(0, 0.705, 0.00), 0.05)
    add('Head', 'Neck', P(0, 0.705, 0.00), P(0, 1.00, 0.00), 0.10)
    add('Hair', 'Head', P(0, 0.70, -0.03), P(0, 0.45, -0.12), 0.10)  # 长发整体随头摆

    for side, sign in (('_L', 1.0), ('_R', -1.0)):
        x = lambda u: sign * u
        # 手臂：贴身垂下，手在腰高（h≈0.50）
        add('Shoulder' + side, 'Chest',
            P(x(0.05), 0.655, 0.00), P(x(0.10), 0.645, 0.00), 0.09)
        add('UpperArm' + side, 'Shoulder' + side,
            P(x(0.10), 0.645, 0.00), P(x(0.125), 0.575, 0.005), 0.07)
        add('Forearm' + side, 'UpperArm' + side,
            P(x(0.125), 0.575, 0.005), P(x(0.135), 0.515, 0.02), 0.055)
        add('Hand' + side, 'Forearm' + side,
            P(x(0.135), 0.515, 0.02), P(x(0.145), 0.475, 0.03), 0.05)
        # 腿：细且靠前，几乎被裙摆盖住
        add('Thigh' + side, 'Hips',
            P(x(0.065), 0.39, 0.00), P(x(0.065), 0.22, 0.01), 0.07)
        add('Shin' + side, 'Thigh' + side,
            P(x(0.065), 0.22, 0.01), P(x(0.065), 0.06, 0.02), 0.05)
        add('Foot' + side, 'Shin' + side,
            P(x(0.065), 0.06, 0.02), P(x(0.065), 0.015, 0.10), 0.05)
    return s


# 参与距离权重计算的骨（Hair 只由硬规则命中，不参与距离竞争，
# 否则长发会把手臂/躯干的权重抢走）
DISTANCE_BONES = None  # 运行时填充


def log(*a):
    print('[rig]', *a, flush=True)


def parse_args():
    argv = sys.argv
    argv = argv[argv.index('--') + 1:] if '--' in argv else []
    src = argv[0] if len(argv) > 0 else None
    dst = argv[1] if len(argv) > 1 else None
    ratio = float(argv[2]) if len(argv) > 2 else 1.0
    return src, dst, ratio


def pick_mesh():
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    if not meshes:
        raise RuntimeError('导入后没有找到网格')
    return max(meshes, key=lambda o: len(o.data.vertices))


def bake_world_transform(obj):
    """把世界矩阵烘进顶点，然后把物体放回原点、解除父级。

    之后所有计算都可以在「脚底 y=0、正面 +z」的世界空间里用比例常数做。
    """
    mw = obj.matrix_world.copy()
    obj.data.transform(mw)
    obj.parent = None
    obj.matrix_world = Matrix()
    obj.data.update()


def build_armature(specs):
    bpy.ops.object.armature_add(enter_editmode=True, location=(0, 0, 0))
    arm = bpy.context.object
    arm.name = 'XiaoshiRig'
    arm.data.name = 'XiaoshiRig'
    ebs = arm.data.edit_bones
    for b in list(ebs):
        ebs.remove(b)
    created = {}
    for name, parent, head, tail, _f in specs:
        b = ebs.new(name)
        b.head = head
        b.tail = tail
        b.parent = created.get(parent) if parent else None
        created[name] = b
    bpy.ops.object.mode_set(mode='OBJECT')
    return arm


def compute_weights(coords, specs, H, z0):
    """coords: (N,3) float32 Blender 世界坐标。返回 (names, W(N,B)) 权重矩阵。"""
    n = coords.shape[0]
    names = [s[0] for s in specs]
    idx = {nm: i for i, nm in enumerate(names)}
    W = np.zeros((n, len(names)), dtype=np.float32)

    # ---- 硬规则（先写，后面的距离权重只在未被硬规则覆盖的顶点上生效）----
    h = (coords[:, 2] - z0) / H          # 归一化身高 0..1（Blender: +Z 朝上）
    u = np.abs(coords[:, 0]) / H         # |x| 归一化
    w = -coords[:, 1] / H                # Blender 里正面朝 -Y，取负后「正=前」
    locked = np.zeros(n, dtype=bool)

    def lock(mask, bone_name, weight=1.0):
        m = mask & ~locked
        if m.any():
            W[m, idx[bone_name]] = weight
            locked[m] = True
            log(f'  硬规则 {bone_name:<12} 顶点 {int(m.sum())}')

    # 1) 头部：h>0.68 且不是外张长发
    lock((h > 0.68) & (u < 0.24) & (w > -0.22), 'Head')
    # 2) 长发：外张（|u| 大）或后脑后方，垂到 h≈0.42
    lock(((u > 0.22) & (h > 0.42) & (h < 0.80)) |
         ((w < -0.16) & (h > 0.50) & (h < 0.80)), 'Hair')
    # 3) 腿：不能用「盒子」筛（会把裙摆前下摆一起圈进去，坐姿直接撕碎），
    #    改为沿腿骨胶囊的紧半径判定，并留一段软过渡与裙摆混合。
    def seg_dist(spec):
        a = np.array(spec[2], dtype=np.float32)
        b = np.array(spec[3], dtype=np.float32)
        ab = b - a
        t = np.clip((coords - a) @ ab / max(float(ab @ ab), 1e-9), 0.0, 1.0)
        return np.linalg.norm(coords - (a + t[:, None] * ab), axis=1)

    leg_names = ['Thigh_L', 'Shin_L', 'Foot_L', 'Thigh_R', 'Shin_R', 'Foot_R']
    leg_d = np.full(n, 1e9, dtype=np.float32)
    leg_b = np.full(n, -1, dtype=np.int32)
    for nm in leg_names:
        spec = next(s for s in specs if s[0] == nm)
        d = seg_dist(spec)
        better = d < leg_d
        leg_d = np.where(better, d, leg_d)
        leg_b = np.where(better, idx[nm], leg_b)

    R_LEG = 0.045 * H      # 腿骨实心半径：完全归腿
    R_SOFT = 0.095 * H     # 软过渡外沿：与裙摆混合
    leg_core = (leg_b >= 0) & (h < 0.32) & (leg_d < R_LEG)
    for nm in leg_names:
        lock(leg_core & (leg_b == idx[nm]), nm)
    # 过渡带：腿权重随距离衰减，其余给髋（裙摆）
    soft = (leg_b >= 0) & (h < 0.32) & (leg_d >= R_LEG) & (leg_d < R_SOFT) & ~locked
    if soft.any():
        x = np.clip((leg_d[soft] - R_LEG) / (R_SOFT - R_LEG), 0.0, 1.0)
        wleg = 1.0 - x * x * (3.0 - 2.0 * x)
        rows = np.where(soft)[0]
        W[rows, leg_b[rows]] = wleg
        W[rows, idx['Hips']] = 1.0 - wleg
        locked[rows] = True
        log(f'  软过渡 腿↔裙摆     顶点 {len(rows)}')
    # 4) 裙摆/躯干下部：一律锁髋，杜绝裙摆跟着腿走
    lock((h < 0.46) & ~locked, 'Hips')
    # 5) 后下方（鲸尾）：锁髋，随髋摆动
    lock((w < -0.18) & (h < 0.62) & (h > 0.30) & ~locked, 'Hips')

    # ---- 距离权重（只在未锁定的顶点上算）----
    free = np.where(~locked)[0]
    log(f'  距离权重待算顶点 {len(free)}')
    if len(free):
        P = coords[free]
        dist_names = [s[0] for s in specs if s[0] in DISTANCE_BONES]
        D = np.empty((len(free), len(dist_names)), dtype=np.float32)
        Wt = np.zeros_like(D)
        for j, nm in enumerate(dist_names):
            spec = next(s for s in specs if s[0] == nm)
            a = np.array(spec[2], dtype=np.float32)
            b = np.array(spec[3], dtype=np.float32)
            fall = spec[4] * H
            ab = b - a
            t = np.clip(((P - a) @ ab) / max(float(ab @ ab), 1e-9), 0.0, 1.0)
            proj = a + t[:, None] * ab
            d = np.linalg.norm(P - proj, axis=1)
            # 距离 → 权重：d<=0 为 1，fall 处衰减到 0（smoothstep）
            x = np.clip(d / fall, 0.0, 1.0)
            Wt[:, j] = 1.0 - x * x * (3.0 - 2.0 * x)
            D[:, j] = d
        # 取权重最大的两根，归一化
        top2 = np.argpartition(-Wt, 1, axis=1)[:, :2]
        for row, (j0, j1) in enumerate(top2):
            w0, w1 = Wt[row, j0], Wt[row, j1]
            s = w0 + w1
            if s < 1e-5:  # 都够不着 → 给最近的骨
                jn = int(np.argmin(D[row]))
                W[free[row], idx[dist_names[jn]]] = 1.0
            else:
                W[free[row], idx[dist_names[j0]]] = w0 / s
                W[free[row], idx[dist_names[j1]]] = w1 / s

    # 归一化（保险）
    ssum = W.sum(axis=1, keepdims=True)
    ssum[ssum < 1e-6] = 1.0
    W /= ssum
    return names, W


def write_weights(obj, names, W):
    """按权重分桶批量写入顶点组（把 90 万次 Python 调用压到几百次）。"""
    for j, nm in enumerate(names):
        vg = obj.vertex_groups.new(name=nm)
        w = W[:, j]
        sel = np.where(w > 0.004)[0]
        if len(sel) == 0:
            continue
        vals = np.round(w[sel] / 0.02).astype(np.int32)  # 0.02 为一档
        for bucket in np.unique(vals):
            ids = sel[vals == bucket]
            vg.add(ids.tolist(), float(bucket) * 0.02, 'REPLACE')
        log(f'  {nm:<12} 权重顶点 {len(sel)}')


def main():
    src, dst, ratio = parse_args()
    if not src or not dst:
        raise SystemExit('用法: blender --background --python rig_xiaoshi.py -- src.glb dst.glb [ratio]')
    t0 = time.time()
    log('源文件', src)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)
    log('导入完成 %.1fs' % (time.time() - t0))

    obj = pick_mesh()
    log('网格', obj.name, '顶点', len(obj.data.vertices))
    bake_world_transform(obj)
    obj.data.update()

    coords = np.empty(len(obj.data.vertices) * 3, dtype=np.float32)
    obj.data.vertices.foreach_get('co', coords)
    coords = coords.reshape(-1, 3)
    mn, mx = coords.min(axis=0), coords.max(axis=0)
    z0, H = float(mn[2]), float(mx[2] - mn[2])
    log('包围盒 min', mn.round(3), 'max', mx.round(3),
        'H=%.4f（沿 Z，Blender Z-up）' % H)

    if ratio < 0.999:
        log('减面 ratio=%.2f' % ratio)
        mod = obj.modifiers.new('Decimate', 'DECIMATE')
        mod.ratio = ratio
        mod.use_collapse_triangulate = True
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier='Decimate')
        log('减面后顶点', len(obj.data.vertices))
        coords = np.empty(len(obj.data.vertices) * 3, dtype=np.float32)
        obj.data.vertices.foreach_get('co', coords)
        coords = coords.reshape(-1, 3)

    specs = bone_specs(H, z0)
    global DISTANCE_BONES
    DISTANCE_BONES = {
        'Hips', 'Spine', 'Chest', 'Neck', 'Head',
        'Shoulder_L', 'Shoulder_R', 'UpperArm_L', 'UpperArm_R',
        'Forearm_L', 'Forearm_R', 'Hand_L', 'Hand_R',
        'Thigh_L', 'Thigh_R', 'Shin_L', 'Shin_R', 'Foot_L', 'Foot_R',
    }
    arm = build_armature(specs)
    log('骨架建成：%d 骨' % len(specs))

    t1 = time.time()
    names, W = compute_weights(coords, specs, H, z0)
    log('权重计算 %.1fs' % (time.time() - t1))

    t2 = time.time()
    write_weights(obj, names, W)
    log('权重写入 %.1fs' % (time.time() - t2))

    mod = obj.modifiers.new('Rig', 'ARMATURE')
    mod.object = arm
    obj.parent = arm

    t3 = time.time()
    bpy.ops.export_scene.gltf(
        filepath=dst,
        export_format='GLB',
        export_yup=True,
        export_skins=True,
        export_animations=False,
        export_cameras=False,
        export_lights=False,
        export_apply=True,
    )
    log('导出完成 %.1fs -> %s' % (time.time() - t3, dst))
    log('总耗时 %.1fs' % (time.time() - t0))
    try:
        import os
        log('文件大小 %.1f MB' % (os.path.getsize(dst) / 1048576))
    except Exception:
        pass


if __name__ == '__main__':
    main()
