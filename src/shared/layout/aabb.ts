/**
 * 2D 包围盒（x-z 平面）重叠检测，用于布局防重叠断言与测试。
 */

export interface Box2 {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** 由中心点 + 半径构造包围盒 */
export function boxOf(x: number, z: number, r: number): Box2 {
  return { x0: x - r, x1: x + r, z0: z - r, z1: z + r };
}

export function boxesOverlap(a: Box2, b: Box2, pad = 0): boolean {
  return (
    a.x0 < b.x1 + pad && a.x1 > b.x0 - pad && a.z0 < b.z1 + pad && a.z1 > b.z0 - pad
  );
}

export interface Placed {
  id: string;
  x: number;
  z: number;
  /** 视觉半径（世界单位） */
  radius: number;
}

/**
 * 检测一组布局结果中相互重叠的包围盒对。
 * @returns 重叠对描述数组（空数组 = 无重叠）
 */
export function findOverlaps(items: Placed[], pad = 0): string[] {
  const out: string[] = [];
  for (let i = 0; i < items.length; i++) {
    const a = items[i]!;
    const ba = boxOf(a.x, a.z, a.radius + pad);
    for (let j = i + 1; j < items.length; j++) {
      const b = items[j]!;
      if (boxesOverlap(ba, boxOf(b.x, b.z, b.radius + pad))) {
        out.push(`${a.id} ↔ ${b.id}`);
      }
    }
  }
  return out;
}
