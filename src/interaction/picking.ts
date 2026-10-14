/**
 * 拾取：
 * - 实体：Raycaster 命中 InstancedMesh → instanceId → 槽位不变映射 entityIds[i]；
 *   或命中 GLB 替换模型（userData.entityId 标识，含子网格）；
 * - 连线：实体未命中时降级 id-buffer 离屏 pass（每点击一次渲染一帧）。
 * - 区域（P5）：子区域拾取面优先（高于底板、两趟拾取保证命中优先级），
 *   其次网底板/层标题拾取面，最后地图网格 = 地域层；
 *   非聚焦层区域不可拾取（focus 门控，与实体拾取同一交互约定）。
 * 坐标转换统一以渲染 canvas 的 CSS 像素为基准。
 */
import * as THREE from 'three';
import type { LayerId } from '../shared/types';
import type { RegionId } from '../shared/regions';
import type { EntityMeshRegistry } from '../render/entities/entity-meshes';
import type { EdgePicker } from '../render/edges/id-buffer';

export interface Picker {
  /** 返回命中实体 id 或 null */
  pickEntity(clientX: number, clientY: number): string | null;
  /** 返回命中连线 relationId 或 null（独立 id-buffer pass） */
  pickEdge(clientX: number, clientY: number): string | null;
  /** 返回命中区域（全局/层/网/子区域）或 null；focus 为当前聚焦层（仅聚焦层与总览态可命中） */
  pickRegion(clientX: number, clientY: number, focus: LayerId | 'all'): RegionId | null;
  dispose(): void;
}

export interface RegionPickDeps {
  /** 区域拾取目标（zone-boxes 提供，几何重建后引用自动更新） */
  targets: () => { sub: THREE.Object3D[]; zone: THREE.Object3D[] };
  /** 地图网格组（命中 = 选中地域层） */
  mapGroup: THREE.Group;
}

const RAYCASTER = new THREE.Raycaster();

export function createPicker(
  camera: THREE.PerspectiveCamera,
  domElement: HTMLElement,
  entityMeshes: EntityMeshRegistry,
  edgePicker: EdgePicker,
  regionDeps: RegionPickDeps,
): Picker {
  const meshEntityIds = new Map<THREE.Object3D, string[]>();
  for (const { mesh, entityIds } of entityMeshes.meshes) meshEntityIds.set(mesh, entityIds);

  const localPos = (clientX: number, clientY: number): { x: number; y: number } => {
    const rect = domElement.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const ndc = (x: number, y: number, w: number, h: number): THREE.Vector2 =>
    new THREE.Vector2((x / w) * 2 - 1, -(y / h) * 2 + 1);

  return {
    pickEntity(clientX, clientY) {
      const { x, y } = localPos(clientX, clientY);
      const w = domElement.clientWidth;
      const h = domElement.clientHeight;
      if (w === 0 || h === 0) return null;
      RAYCASTER.setFromCamera(ndc(x, y, w, h), camera);
      // GLB 根递归命中子网格；实例化网格与其并列，distance 排序后取最近
      const hits = RAYCASTER.intersectObjects([...entityMeshes.glbRoots, ...entityMeshes.all], true);
      const hit = hits[0];
      if (!hit) return null;
      let id: string | null = null;
      if (typeof hit.object.userData.entityId === 'string') {
        id = hit.object.userData.entityId; // GLB 模型（根或子网格均带实体 id）
      } else {
        const ids = meshEntityIds.get(hit.object);
        id = ids?.[hit.instanceId ?? -1] ?? null;
      }
      // 折叠隐藏的实体（aActive=0 的实例不渲染但 Raycaster 仍命中；GLB 根 visible=false 不命中）需过滤
      if (id && !entityMeshes.isActive(id)) return null;
      return id;
    },

    pickEdge(clientX, clientY) {
      const { x, y } = localPos(clientX, clientY);
      const w = domElement.clientWidth;
      const h = domElement.clientHeight;
      if (x < 0 || y < 0 || x > w || y > h) return null;
      return edgePicker.pick(camera, x, y);
    },

    pickRegion(clientX, clientY, focus) {
      const { x, y } = localPos(clientX, clientY);
      const w = domElement.clientWidth;
      const h = domElement.clientHeight;
      if (w === 0 || h === 0) return null;
      RAYCASTER.setFromCamera(ndc(x, y, w, h), camera);
      /** 非聚焦层区域不可拾取（与实体拾取一致：聚焦某层时仅该层/总览态全层可命中） */
      const allowed = (r: RegionId): boolean => focus === 'all' || (r.type !== 'global' && r.layer === focus);
      // 两趟：子区域拾取面优先（抬高 0.03 于底板之上），其次网底板/层标题拾取面
      const { sub, zone } = regionDeps.targets();
      const subHit = RAYCASTER.intersectObjects(sub, false)[0];
      if (subHit?.object.userData.region) {
        const r = subHit.object.userData.region as RegionId;
        if (allowed(r)) return r;
        return null;
      }
      const zoneHit = RAYCASTER.intersectObjects(zone, false)[0];
      if (zoneHit?.object.userData.region) {
        const r = zoneHit.object.userData.region as RegionId;
        if (allowed(r)) return r;
        return null;
      }
      // 地图网格 = 地域层（顶面/侧壁/附图均算命中）
      const mapHit = RAYCASTER.intersectObject(regionDeps.mapGroup, true)[0];
      if (!mapHit) return null;
      const r: RegionId = { type: 'layer', layer: 'geo' };
      return allowed(r) ? r : null;
    },

    dispose() {
      edgePicker.dispose();
    },
  };
}
