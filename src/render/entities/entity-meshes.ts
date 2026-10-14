/**
 * 实体实例化渲染：每个（层 × 形状）一个 InstancedMesh，颜色按实例（kind 色）。
 * 第一号数据一致性原则：实例槽位不可变 —— entityIds[i] 与实例 i 永远一一对应，
 * 隐藏一律走 aActive 属性（顶点移出裁剪空间），绝不 splice/重排。
 */
import * as THREE from 'three';
import type { Dataset, Entity, LayerId } from '../../shared/types';
import { kindDef } from '../../shared/kinds';
import { layerEntityMaterial } from '../../engine/materials';
import { EntityIndex } from '../../engine/entity-index';

export interface EntityMeshRegistry {
  /** 每个 InstancedMesh：entityIds[i] = 实例槽位 i 的实体 id */
  meshes: Array<{ mesh: THREE.InstancedMesh; entityIds: string[] }>;
  /** 全部实例化网格（拾取用） */
  all: THREE.InstancedMesh[];
  /** id → 槽位映射（O(1) 查找） */
  slots: Map<string, { mesh: THREE.InstancedMesh; slot: number }>;
  group: THREE.Group;
  setActive: (ids: string[], active: boolean) => void;
  /** 实例当前是否可见（aActive 或 GLB 根可见性，折叠过滤后拾取需排除） */
  isActive: (id: string) => boolean;
  setInstanceColor: (id: string, colorHex: string, restoreDefault?: boolean) => void;
  /** 按 EntityIndex 当前坐标重算实例矩阵/GLB 根变换（展开/收起/布局变更时批量调用） */
  updateMatrices: (ids: string[]) => void;
  /**
   * 层拾取开关：非聚焦层网格切到 layer 2（相机仍渲染、Raycaster 默认 layer 0 不命中）。
   * 只改 layers 掩码，不触碰实例槽位/可见性。
   */
  setPickable: (layer: LayerId, pickable: boolean) => void;
  /** GLB 替换模型根节点（拾取用；每实体一根，userData.entityId 标识） */
  glbRoots: THREE.Object3D[];
  /**
   * 按实体类型挂载 GLB 模型（P6）：每实体克隆一份模型场景、按 radiusOf 缩放到层平面，
   * 对应实例化槽位置 aActive=0（槽位不变式保持，绝不 splice）。
   */
  attachGlbModels: (kind: string, model: THREE.Object3D) => void;
  defaultColors: Map<string, string>;
}

/** 形状几何工厂（单位尺寸，实际缩放走实例矩阵） */
function shapeGeometry(shape: string): THREE.BufferGeometry {
  switch (shape) {
    case 'sphere':
      return new THREE.IcosahedronGeometry(0.62, 1);
    case 'hex':
      return new THREE.CylinderGeometry(0.6, 0.6, 0.95, 6);
    case 'column':
    case 'box':
    default:
      return new THREE.BoxGeometry(1, 1, 1);
  }
}

/** 单位形状 → 实例缩放/偏移（实体中心坐落在层平面上方）；factor 为布局配置缩放 */
function instanceTransform(shape: string, size: number, factor = 1): { scale: THREE.Vector3; lift: number } {
  const s = (0.62 + size * 0.24) * factor;
  switch (shape) {
    case 'box':
      return { scale: new THREE.Vector3(s, s, s), lift: 0.55 * s };
    case 'sphere':
      return { scale: new THREE.Vector3(s, s, s), lift: 0.68 * s };
    case 'hex':
      return { scale: new THREE.Vector3(s, s * 0.95, s), lift: 0.5 * s };
    case 'column':
      // 立柱：地域层机房按重要度增高
      return { scale: new THREE.Vector3(1.15 * s, 1.9 * s, 1.15 * s), lift: 1.9 * s * 0.5 };
    default:
      return { scale: new THREE.Vector3(s, s, s), lift: 0.5 * s };
  }
}

const MATRIX = new THREE.Matrix4();
const QUAT = new THREE.Quaternion();
const SCALE = new THREE.Vector3();
const POS = new THREE.Vector3();

export function buildEntityMeshes(dataset: Dataset, index: EntityIndex): EntityMeshRegistry {
  const group = new THREE.Group();
  group.name = 'entity-meshes';
  const meshes: EntityMeshRegistry['meshes'] = [];
  const slots = new Map<string, { mesh: THREE.InstancedMesh; slot: number }>();
  const defaultColors = new Map<string, string>();
  const all: THREE.InstancedMesh[] = [];
  // GLB 替换管线（P6）：id → { 根节点, 归一化基准缩放, 包围盒底部 y }
  const glbMap = new Map<string, { root: THREE.Object3D; baseScale: number; boxMinY: number }>();
  const glbRoots: THREE.Object3D[] = [];

  const layers: LayerId[] = ['geo', 'device', 'app', 'task'];

  for (const layer of layers) {
    const layerEntities = dataset.entities.filter((e) => e.layer === layer);
    // 按形状分组
    const byShape = new Map<string, Entity[]>();
    for (const e of layerEntities) {
      const shape = kindDef(e.kind).shape;
      const arr = byShape.get(shape) ?? [];
      arr.push(e);
      byShape.set(shape, arr);
    }
    const material = layerEntityMaterial(layer);

    for (const [shape, entities] of byShape) {
      const geometry = shapeGeometry(shape);
      // aActive：每实例 1 槽，隐藏时置 0
      const active = new THREE.InstancedBufferAttribute(new Float32Array(entities.length).fill(1), 1);
      geometry.setAttribute('aActive', active);

      const mesh = new THREE.InstancedMesh(geometry, material, entities.length);
      mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      const color = new THREE.Color();

      const entityIds: string[] = [];
      entities.forEach((e, i) => {
        entityIds.push(e.id);
        slots.set(e.id, { mesh, slot: i });
        const def = kindDef(e.kind);
        defaultColors.set(e.id, def.color);
        color.set(def.color);
        mesh.setColorAt(i, color);
        mesh.setMatrixAt(i, matrixFor(e, index));
      });
      mesh.instanceColor!.needsUpdate = true;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.userData.layer = layer;
      group.add(mesh);
      meshes.push({ mesh, entityIds });
      all.push(mesh);
    }
  }

  const setActive = (ids: string[], activeFlag: boolean): void => {
    for (const id of ids) {
      const glb = glbMap.get(id);
      if (glb) {
        glb.root.visible = activeFlag; // GLB 实体走根可见性（实例槽位恒 0）
        continue;
      }
      const entry = slots.get(id);
      if (!entry) continue;
      const attr = entry.mesh.geometry.getAttribute('aActive') as THREE.InstancedBufferAttribute;
      if (attr.array[entry.slot] === (activeFlag ? 1 : 0)) continue;
      attr.array[entry.slot] = activeFlag ? 1 : 0;
      attr.needsUpdate = true;
    }
  };

  const isActive = (id: string): boolean => {
    const glb = glbMap.get(id);
    if (glb) return glb.root.visible;
    const entry = slots.get(id);
    if (!entry) return false;
    const attr = entry.mesh.geometry.getAttribute('aActive') as THREE.InstancedBufferAttribute;
    return attr.array[entry.slot]! > 0.5;
  };

  const setInstanceColor = (id: string, colorHex: string, restoreDefault = false): void => {
    const entry = slots.get(id);
    if (!entry) return;
    const mesh = entry.mesh;
    const c = new THREE.Color(restoreDefault ? defaultColors.get(id) ?? colorHex : colorHex);
    mesh.setColorAt(entry.slot, c);
    mesh.instanceColor!.needsUpdate = true;
  };

  const entityById = new Map<string, Entity>();
  for (const e of dataset.entities) entityById.set(e.id, e);

  const updateMatrices = (ids: string[]): void => {
    for (const id of ids) {
      const glb = glbMap.get(id);
      const e = entityById.get(id);
      if (!e) continue;
      if (glb) {
        const s = glb.baseScale * index.radiusOf(e.id) * 2;
        const p = index.positionOf(e.id);
        glb.root.position.set(p.x, p.y - glb.boxMinY * s, p.z);
        glb.root.scale.setScalar(s);
        continue;
      }
      const entry = slots.get(id);
      if (!entry) continue;
      entry.mesh.setMatrixAt(entry.slot, matrixFor(e, index));
      entry.mesh.instanceMatrix.needsUpdate = true;
    }
  };

  const setPickable = (layer: LayerId, pickable: boolean): void => {
    for (const { mesh } of meshes) {
      if (mesh.userData.layer !== layer) continue;
      mesh.layers.set(pickable ? 0 : 2);
    }
    for (const [id, glb] of glbMap) {
      const e = entityById.get(id);
      if (!e || e.layer !== layer) continue;
      glb.root.layers.set(pickable ? 0 : 2);
    }
  };

  /** P6：按类型挂载 GLB 模型（克隆每实体一份，共享几何体；缩放使模型包围盒高 = 实体直径） */
  const attachGlbModels = (kind: string, model: THREE.Object3D): void => {
    const entities = dataset.entities.filter((e) => e.kind === kind);
    if (entities.length === 0) return;
    const box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3();
    box.getSize(size);
    const height = Math.max(size.y, 1e-3); // 防退化包围盒
    const baseScale = 1 / height;
    const boxMinY = box.min.y;
    for (const e of entities) {
      const root = model.clone(true); // 深克隆层级、共享 geometry/material（内存友好）
      root.traverse((o) => {
        o.userData.entityId = e.id; // 拾取：任一子网格命中都能解析回实体
      });
      root.name = `glb-${e.id}`;
      root.userData.layer = e.layer;
      const s = baseScale * index.radiusOf(e.id) * 2;
      const p = index.positionOf(e.id);
      root.position.set(p.x, p.y - boxMinY * s, p.z);
      root.scale.setScalar(s);
      group.add(root);
      glbMap.set(e.id, { root, baseScale, boxMinY });
      glbRoots.push(root);
      // 隐藏程序化槽位：aActive=0（槽位不变式保持，绝不 splice）
      const entry = slots.get(e.id);
      if (entry) {
        const attr = entry.mesh.geometry.getAttribute('aActive') as THREE.InstancedBufferAttribute;
        if (attr.array[entry.slot] !== 0) {
          attr.array[entry.slot] = 0;
          attr.needsUpdate = true;
        }
      }
    }
  };

  return {
    meshes, all, slots, group, setActive, isActive, setInstanceColor, updateMatrices, setPickable,
    glbRoots, attachGlbModels, defaultColors,
  };
}

function matrixFor(e: Entity, index: EntityIndex): THREE.Matrix4 {
  const shape = kindDef(e.kind).shape;
  // 布局配置缩放（密集带 fitFactor × 子区域 × 实体微调）统一作用于实例矩阵
  const { scale, lift } = instanceTransform(shape, e.size, index.scaleFactorOf(e.id));
  const pos = index.positionOf(e.id);
  POS.set(pos.x, pos.y + lift, pos.z);
  QUAT.identity();
  SCALE.copy(scale);
  return MATRIX.compose(POS, QUAT, SCALE).clone();
}

/** 选中/悬停高亮环（每实体一个时用，这里提供单例环移动方案） */
export function buildSelectionRing(colorHex: string, radius = 1.0): THREE.Mesh {
  const geometry = new THREE.TorusGeometry(radius, 0.05, 8, 48);
  const material = new THREE.MeshBasicMaterial({
    color: colorHex,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
  });
  const ring = new THREE.Mesh(geometry, material);
  ring.rotation.x = Math.PI / 2;
  ring.visible = false;
  ring.renderOrder = 5;
  return ring;
}
