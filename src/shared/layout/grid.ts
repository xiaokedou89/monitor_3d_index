/**
 * 矩形分区网格布局（设备层/应用层）：
 * 区域内按类型分组（同类型聚簇），行优先从左到右、从前到后填充网格。
 * 网格单元尺寸 ≥ 最大实体视觉直径，从构造上保证无重叠。
 * 支持自定义区域范围（bounds）与深度上限（depth）：超限时按比例缩小单元尺寸与实体尺寸。
 */
import type { ZoneId } from '../types';
import { ZONE_X } from './layer';

export interface GridEntity {
  id: string;
  kind: string;
  /** 视觉半径（世界单位，由 size 重要度映射） */
  radius: number;
}

export interface GridResult {
  /** id → 平面位置 */
  positions: Map<string, { x: number; z: number }>;
  /** 该区域布局深度（z 跨度） */
  depth: number;
  cols: number;
  rows: number;
  cell: number;
  /** 实体尺寸缩放（深度受限时 < 1，保证单元直径与实体直径同步缩小不重叠） */
  scaleFactor: number;
}

/**
 * @param zone 所属区域
 * @param entities 待布局实体（可跨类型）
 * @param opts.cell 网格单元尺寸（默认 2.2）
 * @param opts.kindOrder 类型排序（同类型聚簇顺序）
 * @param opts.bounds 区域 x 范围（默认 ZONE_X[zone]，平面尺寸配置传入自定义值）
 * @param opts.depth 布局深度上限（默认不限，取自平面尺寸配置减去边距）
 */
export function layoutZoneGrid(
  zone: ZoneId,
  entities: readonly GridEntity[],
  opts: { cell?: number; kindOrder?: readonly string[]; bounds?: { x0: number; x1: number }; depth?: number } = {},
): GridResult {
  const { x0, x1 } = opts.bounds ?? ZONE_X[zone];
  const baseCell = opts.cell ?? 2.2;
  const pad = 1.0;
  const cols = Math.max(1, Math.floor((x1 - x0 - pad * 2) / baseCell));
  const rowsBase = Math.ceil(entities.length / cols);

  // 深度受限时缩小单元尺寸（实体同步按 scaleFactor 缩放，见 EntityIndex）
  let cell = baseCell;
  if (opts.depth !== undefined && rowsBase > 0) {
    cell = Math.min(cell, Math.max((opts.depth - pad * 2) / rowsBase, 0.5));
  }
  const scaleFactor = Math.min(1, cell / baseCell);
  const rows = Math.ceil(entities.length / cols);
  const kindRank = new Map((opts.kindOrder ?? []).map((k, i) => [k, i]));

  // 同类型聚簇：按类型序 + 名称序稳定排序
  const sorted = [...entities].sort((a, b) => {
    const ka = kindRank.get(a.kind) ?? 0;
    const kb = kindRank.get(b.kind) ?? 0;
    if (ka !== kb) return ka - kb;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const positions = new Map<string, { x: number; z: number }>();
  const zCenter = ((rows - 1) / 2) * cell;
  sorted.forEach((e, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    positions.set(e.id, {
      x: x0 + pad + cell / 2 + col * cell,
      z: row * cell - zCenter,
    });
  });

  return { positions, depth: Math.max(rows * cell, 6), cols, rows, cell, scaleFactor };
}
