/**
 * 环线线段生成（纯函数，无 three 依赖，Node 可单测）：
 * LineSegments 按"严格两两成对"消费顶点 (v0,v1),(v2,v3),…。若把各环折线直接
 * 拼接进单个缓冲（省界亮线曾如此实现），凡环顶点数为奇数，就会在环边界处产生
 * 跨环杂线段——实测中国省界数据产生 163 条跨环线段，把南海诸岛岛屿一个接一个
 * 连起来（"岛屿之间多余连线"的根源）。此助手逐环展开为连续线段对，保证每对
 * 线段的两个端点必属同一环。
 */
import type { Ring } from './tri';

export type ProjectFn = (lng: number, lat: number) => [number, number];

/**
 * 把若干多边形环展开为 LineSegments 顶点（每对顶点一条线段，含闭合边），
 * y 统一取给定高度。返回扁平 [x,y,z, x,y,z, …]。
 */
export function buildRingSegments(polygons: Ring[][], project: ProjectFn, y: number): number[] {
  const out: number[] = [];
  for (const ringList of polygons) {
    // 每个多边形只取外环（ringList[0]），洞不画轮廓
    const outer = ringList[0];
    if (!outer || outer.length < 2) continue;
    for (let i = 0; i < outer.length; i++) {
      const a = outer[i]!;
      const b = outer[(i + 1) % outer.length]!;
      const [ax, az] = project(a[0], a[1]);
      const [bx, bz] = project(b[0], b[1]);
      out.push(ax, y, az, bx, y, bz);
    }
  }
  return out;
}
