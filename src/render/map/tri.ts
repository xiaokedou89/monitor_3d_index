/**
 * GeoJSON 多边形三角化工具（基于 earcut）。
 * - 环清洗：闭合未闭合环、绕向归一化（外环逆时针、洞顺时针）；
 * - 不依赖 THREE.Shape（ShapeUtils 对大地图多边形有性能坑）；
 * - 返回合并后的顶点数组与索引，供地图网格构建。
 */
import earcut from 'earcut';

export type Ring = Array<[number, number]>; // [lng, lat]

export interface PolygonRings {
  outer: Ring;
  holes: Ring[];
}

/** 投影回调：经纬度 → 平面坐标 [x, z] */
export type ProjectFn = (lng: number, lat: number) => [number, number];

function signedArea(ring: Ring): number {
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    area += a[0] * b[1] - b[0] * a[1];
  }
  return area / 2;
}

/** 闭合环（首尾不一致时补上） */
export function closeRing(ring: Ring): Ring {
  if (ring.length < 3) return ring;
  const first = ring[0]!;
  const last = ring[ring.length - 1]!;
  if (first[0] === last[0] && first[1] === last[1]) return ring;
  return [...ring, [...first] as [number, number]];
}

/** 绕向归一化：outer=CCW, holes=CW（earcut 约定） */
function normalizeWinding(rings: Ring[]): Ring[] {
  const areas = rings.map((r) => signedArea(r));
  const outerArea = areas[0] ?? 0;
  return rings.map((r, i) => {
    const isHole = i > 0;
    const cw = isHole ? (areas[i] ?? 0) > 0 : outerArea < 0;
    return cw ? [...r].reverse() : r;
  });
}

export interface TriResult {
  /** 投影后的平面顶点 [x, z] 展平数组 */
  vertices: number[];
  /** 三角面索引 */
  indices: number[];
}

/**
 * 对一组多边形（外环+洞）做投影 + 三角化。
 * @param polygons GeoJSON Polygon/MultiPolygon 的环列表（每个元素：[外环, 洞...]）
 */
export function triangulatePolygons(
  polygons: Ring[][],
  project: ProjectFn,
): TriResult {
  const vertices: number[] = [];
  const indices: number[] = [];

  for (const rings of polygons) {
    const closed = rings.map((r) => closeRing(r.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))));
    if (closed[0]!.length < 3) continue;
    const normalized = normalizeWinding(closed);

    const flat: number[] = [];
    const holeIndices: number[] = [];
    const base = vertices.length / 2;
    let count = 0;
    for (let ri = 0; ri < normalized.length; ri++) {
      const ring = normalized[ri]!;
      if (ri > 0) holeIndices.push(count);
      count += ring.length;
      for (const p of ring) {
        const [x, z] = project(p[0], p[1]);
        flat.push(x, z);
      }
    }
    // 跳过面积退化的环（部分数据存在重复点导致 earcut 报错）
    try {
      const tris = earcut(flat, holeIndices, 2);
      for (const t of tris) indices.push(base + t);
      vertices.push(...flat);
    } catch {
      // 该多边形三角化失败：跳过（数据清洗在 fetch 脚本中已做核验，此为兜底）
      console.warn('[tri] 多边形三角化失败，已跳过');
    }
  }

  return { vertices, indices };
}

/** 多边形外环 → 3D 挤出侧壁四边形（顶点+索引），用于地图厚度 */
export function buildExtrusionWalls(
  polygons: Ring[][],
  project: ProjectFn,
  yTop: number,
  yBottom: number,
): TriResult {
  const vertices: number[] = [];
  const indices: number[] = [];
  let base = 0;

  for (const rings of polygons) {
    const ring = closeRing(rings[0] ?? []);
    for (let i = 0; i < ring.length - 1; i++) {
      const a = ring[i]!;
      const b = ring[i + 1]!;
      const [ax, az] = project(a[0], a[1]);
      const [bx, bz] = project(b[0], b[1]);
      vertices.push(ax, yTop, az, bx, yTop, bz, bx, yBottom, bz, ax, yBottom, az);
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
      base += 4;
    }
  }

  return { vertices, indices };
}
