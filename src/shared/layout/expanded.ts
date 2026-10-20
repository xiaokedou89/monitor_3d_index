/**
 * 展开子平面布局：在浮空平面（宽 EXPANSION_PLANE.width × 深 EXPANSION_PLANE.depth）上，
 * 按类型分栏（同类型聚簇为纵向条带）展开布置实体。
 *
 * 算法：先由实体总数推算所需列数 → 列宽 = min(可用宽/列数, 2×cell)；
 * 按类型序遍历实体，纵向填满一列后换列；从构造上保证无重叠。
 * 布局相对平面中心（0,0），调用方负责整体平移到目标区域上方。
 */
import { EXPANSION_PLANE } from './layer';

export interface ExpandedEntity {
  id: string;
  kind: string;
  radius: number;
}

export interface ExpandedResult {
  /** id → 相对平面中心的位置 */
  positions: Map<string, { x: number; z: number }>;
  /** 类型分栏段（用于绘制栏间分隔与栏标题） */
  bands: Array<{ kind: string; x0: number; x1: number }>;
}

export function layoutExpanded(
  entities: readonly ExpandedEntity[],
  opts: { cell?: number; kindOrder?: readonly string[] } = {},
): ExpandedResult {
  const { width, depth } = EXPANSION_PLANE;
  const cell = opts.cell ?? 2.4;
  const pad = 1.2;
  const innerWidth = width - pad * 2;
  const innerDepth = depth - pad * 2;

  const maxPerColumn = Math.max(1, Math.floor(innerDepth / cell));
  const totalColumns = Math.max(1, Math.ceil(entities.length / maxPerColumn));
  const columnWidth = Math.min(innerWidth / totalColumns, cell * 2);

  // 按类型分组，保持类型序
  const kindRank = new Map((opts.kindOrder ?? []).map((k, i) => [k, i]));
  const groups = new Map<string, ExpandedEntity[]>();
  for (const e of entities) {
    const arr = groups.get(e.kind) ?? [];
    arr.push(e);
    groups.set(e.kind, arr);
  }
  const kinds = [...groups.keys()].sort((a, b) => (kindRank.get(a) ?? 0) - (kindRank.get(b) ?? 0));

  const positions = new Map<string, { x: number; z: number }>();
  const bands: Array<{ kind: string; x0: number; x1: number }> = [];

  // 列起点 = 居中排布所有列
  const columnStartX = (col: number): number =>
    -innerWidth / 2 + columnWidth / 2 + col * columnWidth;

  let col = 0;
  let zCursor = 0;

  const currentBand = (kind: string): void => {
    const x = columnStartX(col);
    const last = bands[bands.length - 1];
    if (last && last.kind === kind && Math.abs(last.x1 - (x + columnWidth / 2)) < 1e-6) {
      // 同类型同列，扩展上一条分栏
      last.x1 = x + columnWidth / 2;
    } else {
      bands.push({ kind, x0: x - columnWidth / 2, x1: x + columnWidth / 2 });
    }
  };

  const zOf = (indexInColumn: number): number =>
    (indexInColumn - (maxPerColumn - 1) / 2) * cell;

  for (const kind of kinds) {
    const list = groups.get(kind)!;
    list.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    currentBand(kind);
    for (const e of list) {
      positions.set(e.id, { x: columnStartX(col), z: zOf(zCursor) });
      zCursor++;
      if (zCursor >= maxPerColumn) {
        zCursor = 0;
        col++;
        currentBand(kind);
      }
    }
  }

  return { positions, bands };
}
