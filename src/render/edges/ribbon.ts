/**
 * ribbon 几何采样：每条关系 → 三次贝塞尔中心线 N 段采样三角带。
 * 全部关系合并进单 BufferGeometry（单 draw call）。
 * 顶点属性（除 position 外均为每顶点标量/矢量）：
 *   aSide(±1) aFlow(0..1) aTangent aType(0控制/1数据/2告警)
 *   aWidthW(半宽) aImportance aPhase aDim aVisible
 * 动态更新（宽/类型/位置/显隐/淡化）一律按"边顶点子段"原地写入 —— 槽位布局永不变。
 */
import * as THREE from 'three';
import type { Dataset, LayerId, Relation } from '../../shared/types';
import { EntityIndex } from '../../engine/entity-index';

/** 每条边的采样段数（顶点数 = (SEGMENTS+1)*2） */
export const RIBBON_SEGMENTS = 14;

export interface EdgeRange {
  /** 该边在合并 buffer 中的顶点子段起点（顶点序号，非分量） */
  vStart: number;
  vCount: number;
  /** 索引子段 */
  iStart: number;
  iCount: number;
}

export interface RibbonGeometryData {
  geometry: THREE.BufferGeometry;
  position: THREE.Float32BufferAttribute;
  tangent: THREE.Float32BufferAttribute;
  side: THREE.Float32BufferAttribute;
  flow: THREE.Float32BufferAttribute;
  type: THREE.Float32BufferAttribute;
  width: THREE.Float32BufferAttribute;
  importance: THREE.Float32BufferAttribute;
  phase: THREE.Float32BufferAttribute;
  dim: THREE.Float32BufferAttribute;
  visible: THREE.Float32BufferAttribute;
  /** relationId → 顶点/索引子段 */
  ranges: Map<string, EdgeRange>;
  /** edgeIndex → relationId（固定顺序） */
  order: string[];
  /** relationId → [from, to] */
  endpoints: Map<string, [string, string]>;
}

/** 类型编码：kind → shader aType */
export function typeOfKind(kind: Relation['kind']): number {
  return kind === 'control' ? 0 : kind === 'data' ? 1 : 2;
}

/**
 * 世界空间半宽：流量 → 线宽用对数非线性映射。
 * 目的：低流量区间保留可读对比（体现传输量大小关系），
 * 高流量/运行期尖峰被压缩封顶（w 随 v 亚线性增长），
 * 避免线性放大导致粗线 + bloom 光晕笼罩全局展示区域。
 *   w = MIN + MAX · ln(1 + k·v) / ln(1 + k)   （v 无上限，v<0 视为 0）
 */
export function halfWidthFor(volume: number, importance: Relation['importance']): number {
  const MIN_W = 0.016;
  const MAX_W = 0.045;
  const LOG_K = 8;
  const v = Math.max(volume, 0);
  const w = MIN_W + (MAX_W * Math.log(1 + LOG_K * v)) / Math.log(1 + LOG_K);
  return importance === 'critical' ? w * 1.25 : w;
}

const UP = new THREE.Vector3(0, 1, 0);

/**
 * 三次贝塞尔采样：返回 N+1 个点与逐点切线（中心差分）。
 * - 同层：上弧（控制点双上抬）；
 * - 跨层：S 形（起点向上、终点向下，端点切线竖直衔接锚点）；
 * - 水平距离极小（跨层垂直栈）：直线。
 */
export function sampleEdge(
  a: THREE.Vector3,
  b: THREE.Vector3,
  cross: boolean,
): { points: THREE.Vector3[]; tangents: THREE.Vector3[] } {
  const N = RIBBON_SEGMENTS;
  const d = a.distanceTo(b);
  const horiz = Math.hypot(b.x - a.x, b.z - a.z);
  const h = Math.max(d * 0.35, 0.9);
  const h0 = Math.max(d / 3, 0.3);

  let p1: THREE.Vector3;
  let p2: THREE.Vector3;
  if (cross && horiz > 0.3) {
    p1 = new THREE.Vector3(a.x, a.y + h, a.z);
    p2 = new THREE.Vector3(b.x, b.y - h, b.z);
  } else if (horiz <= 0.3) {
    p1 = new THREE.Vector3(a.x, a.y + h0, a.z);
    p2 = new THREE.Vector3(b.x, b.y - h0, b.z);
  } else {
    p1 = new THREE.Vector3(a.x, a.y + h, a.z);
    p2 = new THREE.Vector3(b.x, b.y + h, b.z);
  }

  const pts: THREE.Vector3[] = [];
  for (let s = 0; s <= N; s++) {
    const t = s / N;
    pts.push(bezier(a, p1, p2, b, t));
  }

  const tangents: THREE.Vector3[] = [];
  for (let s = 0; s <= N; s++) {
    const prev = pts[Math.max(0, s - 1)]!;
    const next = pts[Math.min(N, s + 1)]!;
    const tg = next.clone().sub(prev);
    if (tg.lengthSq() < 1e-10) tangents.push(UP.clone());
    else tangents.push(tg.normalize());
  }
  return { points: pts, tangents };
}

function bezier(
  p0: THREE.Vector3,
  p1: THREE.Vector3,
  p2: THREE.Vector3,
  p3: THREE.Vector3,
  t: number,
): THREE.Vector3 {
  const u = 1 - t;
  const x = u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x;
  const y = u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y;
  const z = u * u * u * p0.z + 3 * u * u * t * p1.z + 3 * u * t * t * p2.z + t * t * t * p3.z;
  return new THREE.Vector3(x, y, z);
}

/** 构建全量 ribbon 合并几何（调用方持有 dataset 与 index） */
export function buildRibbonGeometry(dataset: Dataset, index: EntityIndex): RibbonGeometryData {
  const relations = dataset.relations;
  const N = RIBBON_SEGMENTS;
  const vertsPerEdge = (N + 1) * 2;
  const idxPerEdge = N * 6;
  const totalVerts = relations.length * vertsPerEdge;

  const position = new Float32Array(totalVerts * 3);
  const tangent = new Float32Array(totalVerts * 3);
  const side = new Float32Array(totalVerts);
  const flow = new Float32Array(totalVerts);
  const type = new Float32Array(totalVerts);
  const width = new Float32Array(totalVerts);
  const importance = new Float32Array(totalVerts);
  const phase = new Float32Array(totalVerts);
  const dim = new Float32Array(totalVerts);
  const visible = new Float32Array(totalVerts).fill(1);
  const indices = new Uint32Array(relations.length * idxPerEdge);

  const ranges = new Map<string, EdgeRange>();
  const order: string[] = [];
  const endpoints = new Map<string, [string, string]>();

  const layerOf = new Map<string, LayerId>();
  for (const e of dataset.entities) layerOf.set(e.id, e.layer);

  relations.forEach((rel, edgeIndex) => {
    order.push(rel.id);
    endpoints.set(rel.id, [rel.from, rel.to]);
    const from = index.positionOf(rel.from);
    const to = index.positionOf(rel.to);
    const cross = layerOf.get(rel.from) !== layerOf.get(rel.to);
    const { points, tangents } = sampleEdge(from, to, cross);

    const vStart = edgeIndex * vertsPerEdge;
    const iStart = edgeIndex * idxPerEdge;
    ranges.set(rel.id, { vStart, vCount: vertsPerEdge, iStart, iCount: idxPerEdge });

    const w = halfWidthFor(rel.volume, rel.importance);
    const imp = rel.importance === 'critical' ? 1 : 0;
    const t = typeOfKind(rel.kind);
    // 确定性相位（黄金角步进，避免同一时刻同相脉冲）
    const ph = (edgeIndex * 2.39996) % (Math.PI * 2);

    for (let s = 0; s <= N; s++) {
      const p = points[s]!;
      const tg = tangents[s]!;
      for (let sd = 0; sd < 2; sd++) {
        const vi = vStart + s * 2 + sd;
        position[vi * 3] = p.x;
        position[vi * 3 + 1] = p.y;
        position[vi * 3 + 2] = p.z;
        tangent[vi * 3] = tg.x;
        tangent[vi * 3 + 1] = tg.y;
        tangent[vi * 3 + 2] = tg.z;
        side[vi] = sd * 2 - 1;
        flow[vi] = s / N;
        type[vi] = t;
        width[vi] = w;
        importance[vi] = imp;
        phase[vi] = ph;
        dim[vi] = 0;
      }
    }

    for (let s = 0; s < N; s++) {
      const v0 = vStart + s * 2;
      const v1 = v0 + 1;
      const v2 = vStart + (s + 1) * 2 + 1;
      const v3 = v2 - 1;
      const ii = iStart + s * 6;
      indices[ii] = v0;
      indices[ii + 1] = v2;
      indices[ii + 2] = v1;
      indices[ii + 3] = v0;
      indices[ii + 4] = v3;
      indices[ii + 5] = v2;
    }
  });

  const geometry = new THREE.BufferGeometry();
  const attrDefs: Record<string, THREE.Float32BufferAttribute> = {
    position: new THREE.Float32BufferAttribute(position, 3),
    aTangent: new THREE.Float32BufferAttribute(tangent, 3),
    aSide: new THREE.Float32BufferAttribute(side, 1),
    aFlow: new THREE.Float32BufferAttribute(flow, 1),
    aType: new THREE.Float32BufferAttribute(type, 1),
    aWidthW: new THREE.Float32BufferAttribute(width, 1),
    aImportance: new THREE.Float32BufferAttribute(importance, 1),
    aPhase: new THREE.Float32BufferAttribute(phase, 1),
    aDim: new THREE.Float32BufferAttribute(dim, 1),
    aVisible: new THREE.Float32BufferAttribute(visible, 1),
  };
  for (const [name, attr] of Object.entries(attrDefs)) {
    if (name !== 'position') attr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute(name, attr);
  }
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));

  return {
    geometry,
    position: attrDefs.position!,
    tangent: attrDefs.aTangent!,
    side: attrDefs.aSide!,
    flow: attrDefs.aFlow!,
    type: attrDefs.aType!,
    width: attrDefs.aWidthW!,
    importance: attrDefs.aImportance!,
    phase: attrDefs.aPhase!,
    dim: attrDefs.aDim!,
    visible: attrDefs.aVisible!,
    ranges,
    order,
    endpoints,
  };
}

/** 边顶点子段工具：对该边全部顶点的逐顶点写入 */
export function forEachVertex(
  data: RibbonGeometryData,
  relationId: string,
  fn: (vi: number) => void,
): boolean {
  const r = data.ranges.get(relationId);
  if (!r) return false;
  for (let v = 0; v < r.vCount; v++) fn(r.vStart + v);
  return true;
}
