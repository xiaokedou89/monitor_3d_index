/**
 * 自适应区域布局（P5 子区域方案）：
 * - 实体数 < DENSE_THRESHOLD：沿用网格/树布局，深度受限时按比例缩小间距与实体尺寸；
 * - 实体数 ≥ DENSE_THRESHOLD（密集区，如任务层"业务网" 73 个实体）：
 *   按类型分组构成水平条带子区域（自前向后排列），同带宽内网格排布，
 *   单元尺寸与实体尺寸按 fitFactor 同步缩小（原深度过大/遮挡严重/实体过大的根因解决）。
 * 布局坐标约定：x 为绝对坐标（区域左缘起），z 以区域中心为 0。
 */
import type { ZoneId } from '../types';
import { layoutZoneGrid, type GridResult } from './grid';
import { layoutTree, type TreeResult } from './tree';

/** 密集区阈值：实体数达到该值（约 8 行网格）时启用子区域分组 */
export const DENSE_THRESHOLD = 36;

/** 密集带单元尺寸基线（与网格布局一致，缩放比例作用于其上） */
const BAND_CELL = 2.2;
/** 带内边距（x/z 方向各留 1.0） */
const BAND_PAD = 1.0;
/** 带间距（z 方向） */
const BAND_GAP = 0.8;

export interface AdaptiveEntity {
  id: string;
  kind: string;
  /** 视觉半径（世界单位） */
  radius: number;
  parentId?: string;
  level?: number;
}

/** 子区域：一个类型的实体构成的水平条带 */
export interface AdaptiveSub {
  kind: string;
  ids: string[];
  /** 带 z 范围（以区域中心为 0） */
  z0: number;
  z1: number;
}

export interface AdaptiveResult {
  positions: Map<string, { x: number; z: number }>;
  /** 实际占用深度（z 跨度，≤ bounds.depth） */
  depth: number;
  /** 实体尺寸缩放（密集带 fitFactor 或缩格比例；非受限为 1） */
  scaleFactor: number;
  /** 子区域（仅密集区非空） */
  subs: AdaptiveSub[];
}

function fromGrid(r: GridResult): AdaptiveResult {
  return { positions: r.positions, depth: r.depth, scaleFactor: r.scaleFactor, subs: [] };
}

function fromTree(r: TreeResult): AdaptiveResult {
  return { positions: r.positions, depth: r.depth, scaleFactor: r.scaleFactor, subs: [] };
}

/**
 * 密集带布局：按类型分组（kindOrder 序稳定），每组一行带，带内网格排布。
 * fitFactor 收敛迭代：cell = 2.2 × f，使总带高贴合 bounds.depth（下限 0.45，防止过密）。
 */
function layoutBands(
  entities: readonly AdaptiveEntity[],
  bounds: { x0: number; x1: number; depth: number },
  kindOrder: readonly string[],
): AdaptiveResult {
  const w = bounds.x1 - bounds.x0;
  const groups = new Map<string, AdaptiveEntity[]>();
  const kindRank = new Map(kindOrder.map((k, i) => [k, i]));
  for (const e of entities) {
    const arr = groups.get(e.kind) ?? [];
    arr.push(e);
    groups.set(e.kind, arr);
  }
  const sortedGroups = [...groups.entries()].sort((a, b) => {
    const ra = kindRank.get(a[0]) ?? 0;
    const rb = kindRank.get(b[0]) ?? 0;
    if (ra !== rb) return ra - rb;
    return a[1].length !== b[1].length ? b[1].length - a[1].length : a[0] < b[0] ? -1 : 1;
  });

  const naturalDepth = (f: number): number => {
    const cell = BAND_CELL * f;
    const cols = Math.max(1, Math.floor((w - BAND_PAD * 2) / cell));
    let d = 0;
    for (const [, es] of sortedGroups) d += Math.ceil(es.length / cols) * cell;
    d += (sortedGroups.length - 1) * BAND_GAP;
    return d;
  };

  // 二分求最大 f ∈ [0.45, 1] 使带总深 ≤ bounds.depth。
  // naturalDepth 对 f 单调不减（cell 增大 → 列数减少 → 行数增多），
  // 迭代法在"cell 缩至列数跳变"处会振荡（f 在 0.45 与 1 间来回），二分收敛稳定。
  let f: number;
  if (naturalDepth(1) <= bounds.depth) {
    f = 1; // 深度充裕：保持原尺寸
  } else if (naturalDepth(0.45) > bounds.depth) {
    f = 0.45; // 即使最密也放不下：取下限尽力而为（深度略超上限，实体不裁剪）
  } else {
    let lo = 0.45;
    let hi = 1;
    for (let i = 0; i < 14; i++) {
      const mid = (lo + hi) / 2;
      if (naturalDepth(mid) <= bounds.depth) lo = mid;
      else hi = mid;
    }
    f = lo;
  }
  const cell = BAND_CELL * f;
  const cols = Math.max(1, Math.floor((w - BAND_PAD * 2) / cell));

  const positions = new Map<string, { x: number; z: number }>();
  const subs: AdaptiveSub[] = [];
  let totalD = 0;
  for (const [, es] of sortedGroups) {
    const rows = Math.ceil(es.length / cols);
    totalD += rows * cell;
  }
  totalD += (sortedGroups.length - 1) * BAND_GAP;

  let cursor = -totalD / 2;
  for (const [kind, es] of sortedGroups) {
    const rows = Math.ceil(es.length / cols);
    const bandH = rows * cell;
    const z0 = cursor;
    const z1 = cursor + bandH;
    const ids: string[] = [];
    es.forEach((e, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      positions.set(e.id, {
        x: bounds.x0 + BAND_PAD + cell / 2 + col * cell,
        z: z0 + cell / 2 + row * cell,
      });
      ids.push(e.id);
    });
    subs.push({ kind, ids, z0, z1 });
    cursor = z1 + BAND_GAP;
  }

  return { positions, depth: totalD, scaleFactor: f, subs };
}

/**
 * @param entities 待布局实体
 * @param bounds 区域范围与深度上限（深度来自平面尺寸配置减去边距）
 * @param opts.mode 非密集区布局模式（设备/应用层 grid，任务层 tree）
 * @param opts.kindOrder 类型稳定排序
 */
export function layoutAdaptive(
  entities: readonly AdaptiveEntity[],
  bounds: { x0: number; x1: number; depth: number },
  opts: { mode: 'grid' | 'tree'; kindOrder?: readonly string[] } = { mode: 'grid' },
): AdaptiveResult {
  if (entities.length === 0) {
    return { positions: new Map(), depth: Math.max(bounds.depth, 6), scaleFactor: 1, subs: [] };
  }
  if (entities.length >= DENSE_THRESHOLD) {
    return layoutBands(entities, bounds, opts.kindOrder ?? []);
  }
  const zone = 'enterprise' as ZoneId; // bounds 已给定，zone 仅作为兜底参数不再参与计算
  if (opts.mode === 'tree') {
    return fromTree(
      layoutTree(zone, entities, { bounds: { x0: bounds.x0, x1: bounds.x1 }, depth: bounds.depth }),
    );
  }
  return fromGrid(
    layoutZoneGrid(zone, entities, { bounds: { x0: bounds.x0, x1: bounds.x1 }, depth: bounds.depth }),
  );
}
