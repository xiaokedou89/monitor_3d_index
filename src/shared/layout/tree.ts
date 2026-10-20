/**
 * 任务层多级树形布局：
 * 层级（0=总部 / 1=大区总代理 / 2=终端网点）沿 x 从左到右排列，
 * 叶子节点在 z 方向均匀分配槽位，内部节点取子树叶子槽位均值。
 * 从构造上保证同层兄弟节点不重叠。
 */
import type { ZoneId } from '../types';
import { ZONE_X } from './layer';

export interface TreeEntity {
  id: string;
  parentId?: string;
  level?: number;
  radius: number;
}

export interface TreeResult {
  positions: Map<string, { x: number; z: number }>;
  depth: number;
  maxLevel: number;
  /** 实体尺寸缩放（深度受限时 < 1） */
  scaleFactor: number;
}

export function layoutTree(
  zone: ZoneId,
  entities: readonly TreeEntity[],
  opts: { leafSpacing?: number; bounds?: { x0: number; x1: number }; depth?: number } = {},
): TreeResult {
  const { x0, x1 } = opts.bounds ?? ZONE_X[zone];
  const baseLeafSpacing = opts.leafSpacing ?? 1.9;
  let leafSpacing = baseLeafSpacing;
  const positions = new Map<string, { x: number; z: number }>();

  const childrenOf = new Map<string, string[]>();
  let maxLevel = 0;
  for (const e of entities) {
    maxLevel = Math.max(maxLevel, e.level ?? 0);
    if (e.parentId) {
      const arr = childrenOf.get(e.parentId) ?? [];
      arr.push(e.id);
      childrenOf.set(e.parentId, arr);
    }
  }

  const roots = entities.filter((e) => !e.parentId);
  const levelSpan = maxLevel > 0 ? ((x1 - x0) - 2.4) / maxLevel : (x1 - x0);

  const levelX = (level: number): number => {
    if (maxLevel === 0) return (x0 + x1) / 2;
    return x0 + 1.2 + level * levelSpan + levelSpan / 2;
  };

  // 叶子槽位分配：按根 → 子 → 孙的稳定顺序
  const leaves: string[] = [];
  const walk = (id: string): void => {
    const kids = childrenOf.get(id);
    if (!kids || kids.length === 0) {
      leaves.push(id);
    } else {
      for (const k of kids) walk(k);
    }
  };
  for (const r of roots) walk(r.id);

  const leafSlot = new Map<string, number>();
  leaves.forEach((id, i) => leafSlot.set(id, i));
  const totalLeaves = leaves.length || 1;

  // 内部节点 z = 子树叶子槽位均值（自底向上，按 id 记忆化）
  const slotCache = new Map<string, number>();
  const slotOf = (id: string): number => {
    const cached = slotCache.get(id);
    if (cached !== undefined) return cached;
    const kids = childrenOf.get(id);
    let slot: number;
    if (!kids || kids.length === 0) {
      slot = leafSlot.get(id)!;
    } else {
      slot = kids.reduce((acc, k) => acc + slotOf(k), 0) / kids.length;
    }
    slotCache.set(id, slot);
    return slot;
  };

  const zOfSlot = (slot: number): number =>
    (slot - (totalLeaves - 1) / 2) * leafSpacing;

  // 深度受限时缩小叶子间距（实体同步按 scaleFactor 缩放）
  if (opts.depth !== undefined && totalLeaves > 1) {
    leafSpacing = Math.min(leafSpacing, Math.max((opts.depth - 1) / (totalLeaves - 1), 0.5));
  }
  const scaleFactor = Math.min(1, leafSpacing / baseLeafSpacing);

  for (const e of entities) {
    const level = e.level ?? 0;
    positions.set(e.id, { x: levelX(level), z: zOfSlot(slotOf(e.id)) });
  }

  return {
    positions,
    depth: Math.max(totalLeaves * leafSpacing, 8),
    maxLevel,
    scaleFactor,
  };
}
