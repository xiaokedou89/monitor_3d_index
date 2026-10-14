/**
 * 连线渲染注册表：
 * - 构建：dataset.relations 固定顺序 → 单合并几何（ribbon.ts）
 * - 动态更新：宽/类型/位置/显隐/淡化 均按边顶点子段原地写入（10Hz 批量提交）
 * - 拾取：id-buffer 离屏 pass（边索引编码色），见 id-buffer.ts
 */
import * as THREE from 'three';
import type { Dataset, LayerId, Relation } from '../../shared/types';
import { EntityIndex } from '../../engine/entity-index';
import type { LiveStore } from '../../shared/sim/store';
import {
  buildRibbonGeometry,
  forEachVertex,
  halfWidthFor,
  sampleEdge,
  typeOfKind,
  RIBBON_SEGMENTS,
  type RibbonGeometryData,
} from './ribbon';
import { createRibbonMaterial, type RibbonUniforms } from './ribbon-material';

export interface EdgeRegistry {
  group: THREE.Group;
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  uniforms: RibbonUniforms;
  data: RibbonGeometryData;
  /** relationId → Relation（静态结构） */
  relationById: Map<string, Relation>;
  /** relationId → 端点层级 */
  layersOf: Map<string, [LayerId, LayerId]>;
  updateWidths(ids: string[]): void;
  updateKinds(ids: string[]): void;
  updatePositions(ids: string[]): void;
  setVisible(ids: string[], visible: boolean): void;
  applyDim(dimByLayer: Partial<Record<LayerId, number>>): void;
  /** 选中连线加粗（null 取消），影响后续 updateWidths 结果 */
  setWidthOverride(id: string | null): void;
  dispose(): void;
}

export function buildEdgeRenderer(
  dataset: Dataset,
  index: EntityIndex,
  store: LiveStore,
): EdgeRegistry {
  const data = buildRibbonGeometry(dataset, index);
  const material = createRibbonMaterial();
  material.side = THREE.DoubleSide;

  const mesh = new THREE.Mesh(data.geometry, material);
  mesh.name = 'edge-ribbon';
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  mesh.layers.set(0);

  const group = new THREE.Group();
  group.name = 'edge-group';
  group.add(mesh);

  const relationById = new Map<string, Relation>();
  const layersOf = new Map<string, [LayerId, LayerId]>();
  const layerOfEntity = new Map<string, LayerId>();
  for (const e of dataset.entities) layerOfEntity.set(e.id, e.layer);
  for (const rel of dataset.relations) {
    relationById.set(rel.id, rel);
    layersOf.set(rel.id, [layerOfEntity.get(rel.from) ?? 'device', layerOfEntity.get(rel.to) ?? 'device']);
  }

  /** 选中连线加粗倍率 */
  const OVERRIDE_MULT = 2.4;
  let widthOverrideId: string | null = null;

  const updateWidths = (ids: string[]): void => {
    let dirty = false;
    for (const id of ids) {
      const rel = relationById.get(id);
      if (!rel) continue;
      const mult = id === widthOverrideId ? OVERRIDE_MULT : 1;
      const w = halfWidthFor(store.volumeOf(id, rel.volume), rel.importance) * mult;
      dirty = forEachVertex(data, id, (vi) => {
        data.width.array[vi] = w;
      }) || dirty;
    }
    if (dirty) data.width.needsUpdate = true;
  };

  const updateKinds = (ids: string[]): void => {
    let dirty = false;
    for (const id of ids) {
      const rel = relationById.get(id);
      if (!rel) continue;
      const t = typeOfKind(store.kindOf(id, rel.kind));
      dirty = forEachVertex(data, id, (vi) => {
        data.type.array[vi] = t;
      }) || dirty;
    }
    if (dirty) data.type.needsUpdate = true;
  };

  const updatePositions = (ids: string[]): void => {
    let dirty = false;
    for (const id of ids) {
      const rel = relationById.get(id);
      if (!rel) continue;
      const a = index.positionOf(rel.from);
      const b = index.positionOf(rel.to);
      const layers = layersOf.get(id)!;
      const { points, tangents } = sampleEdge(a, b, layers[0] !== layers[1]);
      const r = data.ranges.get(id);
      if (!r) continue;
      for (let s = 0; s <= RIBBON_SEGMENTS; s++) {
        const p = points[s]!;
        const tg = tangents[s]!;
        for (let sd = 0; sd < 2; sd++) {
          const vi = r.vStart + s * 2 + sd;
          data.position.array[vi * 3] = p.x;
          data.position.array[vi * 3 + 1] = p.y;
          data.position.array[vi * 3 + 2] = p.z;
          data.tangent.array[vi * 3] = tg.x;
          data.tangent.array[vi * 3 + 1] = tg.y;
          data.tangent.array[vi * 3 + 2] = tg.z;
        }
      }
      dirty = true;
    }
    if (dirty) {
      data.position.needsUpdate = true;
      data.tangent.needsUpdate = true;
    }
  };

  const setVisible = (ids: string[], visibleFlag: boolean): void => {
    let dirty = false;
    const v = visibleFlag ? 1 : 0;
    for (const id of ids) {
      if (!relationById.has(id)) continue;
      dirty = forEachVertex(data, id, (vi) => {
        data.visible.array[vi] = v;
      }) || dirty;
    }
    if (dirty) data.visible.needsUpdate = true;
  };

  const setWidthOverride = (id: string | null): void => {
    const prev = widthOverrideId;
    widthOverrideId = id;
    if (prev) updateWidths([prev]);
    if (id) updateWidths([id]);
  };

  /** 按层淡化：边淡化值 = 两端点层淡化最大值（任一端淡化即淡化） */
  const applyDim = (dimByLayer: Partial<Record<LayerId, number>>): void => {
    let dirty = false;
    for (const [id, layers] of layersOf) {
      const d = Math.max(dimByLayer[layers[0]] ?? 0, dimByLayer[layers[1]] ?? 0);
      dirty = forEachVertex(data, id, (vi) => {
        data.dim.array[vi] = d;
      }) || dirty;
    }
    if (dirty) data.dim.needsUpdate = true;
  };

  const dispose = (): void => {
    data.geometry.dispose();
    material.dispose();
  };

  return {
    group,
    mesh,
    material,
    uniforms: material.uniforms as unknown as RibbonUniforms,
    data,
    relationById,
    layersOf,
    updateWidths,
    updateKinds,
    updatePositions,
    setVisible,
    applyDim,
    setWidthOverride,
    dispose,
  };
}
