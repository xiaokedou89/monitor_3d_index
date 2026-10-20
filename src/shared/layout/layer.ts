/**
 * 层与区域的空间常量：各层高度（y）、四个矩形逻辑区域的 x 范围。
 * 地域层平面 y=0，向上逐层平面映射。
 */
import type { LayerId, ZoneId } from '../types';

/** 各层平面高度（世界单位） */
export const LAYER_HEIGHTS: Record<LayerId, number> = {
  geo: 0,
  device: 5.5,
  app: 11,
  task: 16.5,
};

/** 展开子平面相对其所在层的高度偏移 */
export const EXPANSION_OFFSET = 6.5;

/** 展开子平面的空间尺寸（世界单位） */
export const EXPANSION_PLANE = { width: 24, depth: 20 } as const;

/** 四个矩形逻辑区域（从左到右）的 x 范围 */
export const ZONE_X: Record<ZoneId, { x0: number; x1: number }> = {
  enterprise: { x0: -30, x1: -15 },
  business: { x0: -15, x1: 0 },
  'cn-public': { x0: 0, x1: 15 },
  'global-public': { x0: 15, x1: 30 },
};

/** 区域宽度 */
export const ZONE_WIDTH = 15;

export function zoneCenterX(zone: ZoneId): number {
  const r = ZONE_X[zone];
  return (r.x0 + r.x1) / 2;
}
