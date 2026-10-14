/**
 * 地域层地图渲染：
 * - 世界地图低清轮廓（背景装饰，中国部分以 DataV 数据为准覆盖）
 * - 中国立体地图（含台湾省/港澳，逐省着色 + 侧壁挤出 + 省界亮线）
 * - 十段线（南海边界断续线，独立着色）
 * - 右下角"南海诸岛"附图（海南省域数据 + 十段线重投影 inset，虚线框标注）
 * 数据源：public/data/{china,world,hainan}.geo.json（fetch-map-data.mjs 核验落盘）
 */
import * as THREE from 'three';
import { layoutLng, projectGeo, type MapLayoutId } from '../../shared/geo';
import { hexToCss } from '../../shared/palette';
import { injectLayerDim, layerDimUniforms } from '../../engine/materials';
import { buildExtrusionWalls, triangulatePolygons, type Ring } from './tri';
import { buildRingSegments } from './ring-lines';

/** 地图所有面片材质统一挂接地域层淡化 uniform（transparent 使层间分离时的 alpha 淡化生效） */
function mapMaterial(params: THREE.MeshBasicMaterialParameters): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ transparent: true, ...params });
  injectLayerDim(m, layerDimUniforms.geo);
  return m;
}

/** GeoJSON Feature（宽松结构；世界数据带 Natural Earth CONTINENT 属性） */
interface GeoFeature {
  properties?: { name?: string; adcode?: string; CONTINENT?: string };
  geometry?: { type: string; coordinates: unknown };
}

interface GeoCollection {
  features: GeoFeature[];
}

/** MultiPolygon 坐标 → 环列表 */
function ringsOf(feature: GeoFeature): Ring[][] {
  const g = feature.geometry;
  if (!g) return [];
  if (g.type === 'Polygon') return [g.coordinates as Ring[]];
  if (g.type === 'MultiPolygon') return g.coordinates as Ring[][];
  return [];
}

/** 十段线特征（空名 / adcode 100000_JD） */
export function isTenDashFeature(feature: GeoFeature): boolean {
  return !feature.properties?.name || feature.properties?.adcode === '100000_JD';
}

const CHINA_PROJECT = (lng: number, lat: number): [number, number] => {
  const p = projectGeo(lng, lat);
  return [p.x, p.z];
};

/**
 * 世界地图与中国地图共用同一投影（1:1 地理比例，同中心 104°E/35°N）——
 * 曾用任意常数 ×0.34 缩小，导致中国轮廓反而溢出世界轮廓东/北缘、比例失真。
 * 南极洲（纬度全部低于 -58° 的特征）裁剪掉，避免背景向南延伸过远破坏画面平衡。
 * 展示布局（A/B）经 layoutLng 逐要素变换经度（A 布局美洲 +360° 至中国以东）。
 */
const WORLD_PROJECT = CHINA_PROJECT;

/** 世界地图裁剪阈值：特征外环最大纬度低于该值整体丢弃（南极洲） */
const WORLD_SOUTH_CLIP = -58;

/** 美洲洲属判定（A 布局平移依据；与地域实体按经度阈值判定对应） */
function isAmericasFeature(feature: GeoFeature): boolean {
  const c = feature.properties?.CONTINENT;
  return c === 'North America' || c === 'South America';
}

function featureMaxLat(feature: GeoFeature): number {
  let max = -Infinity;
  for (const ringList of ringsOf(feature)) {
    const outer = ringList[0];
    if (!outer) continue;
    for (const p of outer) max = Math.max(max, p[1]);
  }
  return max;
}

/** 风格样式模板可调的地图配色（见显示设置"风格样式"） */
export interface MapPalette {
  /** 省面顶色基调（与逐省顶点色乘算） */
  topTint: string;
  /** 省界/十段线/南海附图框 */
  border: string;
  /** 侧壁/世界轮廓/南海附图填充（派生明暗） */
  wall: string;
}

export interface MapGeometryBundle {
  group: THREE.Group;
  /** 风格样式：按名称定位材质更新地图配色（世界轮廓=wall×0.45，附图填充=wall×1.5） */
  setPalette(p: MapPalette): void;
  /** 世界地图展示布局 A/B 切换（两套世界网格预构建，仅切换显隐） */
  setMapLayout(layout: MapLayoutId): void;
}

export interface MapData {
  china: GeoCollection;
  world: GeoCollection;
  hainan: GeoCollection;
}

export async function loadMapData(base = 'data/'): Promise<MapData> {
  const [china, world, hainan] = await Promise.all([
    fetch(`${base}china.geo.json`).then((r) => r.json() as Promise<GeoCollection>),
    fetch(`${base}world.geo.json`).then((r) => r.json() as Promise<GeoCollection>),
    fetch(`${base}hainan.geo.json`).then((r) => r.json() as Promise<GeoCollection>),
  ]);
  console.log('读取的地图数据: china')
  console.log(china)
  return { china, world, hainan };
}

const MAP_TOP = 0;
const MAP_BOTTOM = -0.45;
/** 十段线抬升高度（避免 z-fighting） */
const TEN_DASH_Y = 0.04;

function addActiveAttribute(geometry: THREE.BufferGeometry, count: number): void {
  geometry.setAttribute('aActive', new THREE.BufferAttribute(new Float32Array(count).fill(1), 1));
}

/** 构建中国立体地图（顶面 + 侧壁 + 省界亮线），不含十段线 */
function buildChinaMesh(china: GeoCollection): THREE.Group {
  const group = new THREE.Group();
  const provFeatures = china.features.filter((f) => !isTenDashFeature(f));
  const tenDash = china.features.find((f) => isTenDashFeature(f));

  // 逐省顶点颜色（同色调微差区分省界）
  const topVertices: number[] = [];
  const topIndices: number[] = [];
  const topColors: number[] = [];
  const wallVertices: number[] = [];
  const wallIndices: number[] = [];
  const wallColors: number[] = [];
  const borderPoints: number[] = [];

  const baseRgb: [number, number, number] = [0.055, 0.14, 0.28]; // 深蓝基调
  const wallRgb: [number, number, number] = [0.03, 0.07, 0.16];

  let provIdx = 0;
  for (const f of provFeatures) {
    const rings = ringsOf(f);
    if (rings.length === 0) continue;
    // 顶点色微差：省与省之间可辨识
    const shade = 1 + ((provIdx * 37) % 13) * 0.018;
    const rgb: [number, number, number] = [
      Math.min(baseRgb[0] * shade, 0.12),
      Math.min(baseRgb[1] * shade, 0.28),
      Math.min(baseRgb[2] * shade, 0.5),
    ];
    const top = triangulatePolygons(rings, CHINA_PROJECT);
    const baseIdx = topVertices.length / 3;
    for (let i = 0; i < top.vertices.length; i += 2) {
      topVertices.push(top.vertices[i]!, MAP_TOP, top.vertices[i + 1]!);
      topColors.push(...rgb);
    }
    for (const t of top.indices) topIndices.push(baseIdx + t);

    const walls = buildExtrusionWalls(rings, CHINA_PROJECT, MAP_TOP, MAP_BOTTOM);
    const wallBase = wallVertices.length / 3;
    wallVertices.push(...walls.vertices);
    for (const t of walls.indices) wallIndices.push(wallBase + t);
    for (let i = 0; i < walls.vertices.length / 3; i++) wallColors.push(...wallRgb);

    // 省界亮线：逐环展开线段对（跨环杂线根因修复，见 ring-lines.ts）
    borderPoints.push(...buildRingSegments(rings, CHINA_PROJECT, MAP_TOP + 0.02));
    provIdx++;
  }

  const topGeo = new THREE.BufferGeometry();
  topGeo.setAttribute('position', new THREE.Float32BufferAttribute(topVertices, 3));
  topGeo.setAttribute('color', new THREE.Float32BufferAttribute(topColors, 3));
  topGeo.setIndex(topIndices);
  addActiveAttribute(topGeo, topVertices.length / 3);
  const topMat = mapMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const topMesh = new THREE.Mesh(topGeo, topMat);
  topMesh.name = 'china-top';
  group.add(topMesh);

  const wallGeo = new THREE.BufferGeometry();
  wallGeo.setAttribute('position', new THREE.Float32BufferAttribute(wallVertices, 3));
  wallGeo.setAttribute('color', new THREE.Float32BufferAttribute(wallColors, 3));
  wallGeo.setIndex(wallIndices);
  addActiveAttribute(wallGeo, wallVertices.length / 3);
  const wallMat = mapMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const wallMesh = new THREE.Mesh(wallGeo, wallMat);
  wallMesh.name = 'china-wall';
  group.add(wallMesh);

  // 省界亮线
  if (borderPoints.length > 0) {
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(borderPoints, 3));
    const lineMat = new THREE.LineBasicMaterial({
      color: 0x2b6cb0,
      transparent: true,
      opacity: 0.55,
    });
    const border = new THREE.LineSegments(lineGeo, lineMat);
    border.name = 'china-border';
    group.add(border);
  }

  // 十段线：以线段绘制断续线（曾以三角化实心填充绘制，数据中每段为细长多边形，
  // 实心填充在南海上形成贯穿岛屿群之间的粗色带，看起来像无意义的连线）
  if (tenDash) {
    const tdPoints = buildRingSegments(ringsOf(tenDash), CHINA_PROJECT, TEN_DASH_Y);
    const tdGeo = new THREE.BufferGeometry();
    tdGeo.setAttribute('position', new THREE.Float32BufferAttribute(tdPoints, 3));
    const tdMat = new THREE.LineBasicMaterial({ color: 0x4dd9f2 });
    const tdLine = new THREE.LineSegments(tdGeo, tdMat);
    tdLine.name = 'ten-dash';
    group.add(tdLine);
  }

  return group;
}

/**
 * 世界低清轮廓背景（与中国地图同投影 1:1；南极洲等高纬特征裁剪；layout 决定美洲经度平移）。
 * 返回填充面 + 海岸线描边两件套：曾仅以 wall×0.45 暗色填充，与背景色几乎同色，
 * 再经 ACES 色调映射 + sRGB 编码暗部压缩后肉眼完全不可见（A/B 布局均"看不到世界地图"）。
 * 现填充提亮至 wall×2.2、附加 border 色海岸线，世界轮廓在背景上清晰可辨。
 */
function buildWorldMesh(
  world: GeoCollection,
  layout: MapLayoutId,
  name: string,
): { fill: THREE.Mesh; outline: THREE.LineSegments } {
  const vertices: number[] = [];
  const indices: number[] = [];
  const linePoints: number[] = [];
  for (const f of world.features) {
    if (featureMaxLat(f) < WORLD_SOUTH_CLIP) continue; // 裁剪南极洲
    const americas = isAmericasFeature(f);
    const project: typeof WORLD_PROJECT = (lng, lat) => {
      const p = projectGeo(layoutLng(layout, lng, americas), lat);
      return [p.x, p.z];
    };
    const ringsOfF = ringsOf(f);
    const top = triangulatePolygons(ringsOfF, project);
    const base = vertices.length / 2;
    vertices.push(...top.vertices);
    for (const t of top.indices) indices.push(base + t);
    // 海岸线描边与填充共用同一逐要素投影（美洲 +360° 一致，不产生填充/描边错位）
    linePoints.push(...buildRingSegments(ringsOfF, project, MAP_BOTTOM + 0.02));
  }
  const geo = new THREE.BufferGeometry();
  const pos: number[] = [];
  for (let i = 0; i < vertices.length; i += 2) {
    pos.push(vertices[i]!, MAP_BOTTOM - 0.01, vertices[i + 1]!);
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(indices);
  addActiveAttribute(geo, pos.length / 3);
  const fillMat = mapMaterial({
    color: 0x163970,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
  });
  const fill = new THREE.Mesh(geo, fillMat);
  fill.name = name;
  fill.renderOrder = -2;

  const outlineGeo = new THREE.BufferGeometry();
  outlineGeo.setAttribute('position', new THREE.Float32BufferAttribute(linePoints, 3));
  const outlineMat = new THREE.LineBasicMaterial({
    color: 0x2b6cb0,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  const outline = new THREE.LineSegments(outlineGeo, outlineMat);
  outline.name = `${name}-outline`;
  outline.renderOrder = -2;
  return { fill, outline };
}

/**
 * 南海诸岛附图：将南海海域（海南 + 三沙 + 十段线）整体平移缩放到右下角附图框。
 * 合规做法：只做整体平移/缩放，绝不修改几何。
 */
function buildSouthSeaInset(china: GeoCollection, hainan: GeoCollection): THREE.Group {
  const group = new THREE.Group();

  // 源数据：海南全部 19 个地市 + 十段线
  const features = [...hainan.features];
  const tenDash = china.features.find((f) => isTenDashFeature(f));
  if (tenDash) features.push(tenDash);

  // 源范围（南海海域）
  const srcLng: [number, number] = [106, 122.5];
  const srcLat: [number, number] = [2, 24];
  // 目标附图框（地图右下角，世界坐标）
  const target = { x0: 16.5, x1: 27.5, z0: 5.0, z1: 15.5 };
  const scaleX = (target.x1 - target.x0) / (srcLng[1] - srcLng[0]);
  const scaleZ = (target.z1 - target.z0) / (srcLat[1] - srcLat[0]);
  const scale = Math.min(scaleX, scaleZ);

  const proj = (lng: number, lat: number): [number, number] => {
    const [x, z] = CHINA_PROJECT(lng, lat);
    const cx = CHINA_PROJECT((srcLng[0] + srcLng[1]) / 2, 0)[0];
    const sx = target.x0 + (target.x1 - target.x0) / 2 + (x - cx) * scale;
    const cz = (target.z0 + target.z1) / 2 + (z - CHINA_PROJECT(0, (srcLat[0] + srcLat[1]) / 2)[1]) * scale;
    return [sx, cz];
  };

  for (const f of features) {
    if (isTenDashFeature(f)) {
      // 附图内十段线同样以线段绘制（不与岛屿间形成实心色带）
      const pts = buildRingSegments(ringsOf(f), proj, TEN_DASH_Y);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      const tdInset = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x4dd9f2 }));
      tdInset.name = 'inset-ten-dash';
      group.add(tdInset);
      continue;
    }
    const tris = triangulatePolygons(ringsOf(f), proj);
    const pos: number[] = [];
    for (let i = 0; i < tris.vertices.length; i += 2) {
      pos.push(tris.vertices[i]!, MAP_TOP + 0.01, tris.vertices[i + 1]!);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(tris.indices);
    addActiveAttribute(geo, pos.length / 3);
    const mat = mapMaterial({
      color: 0x14508c,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
    });
    const fill = new THREE.Mesh(geo, mat);
    fill.name = 'inset-fill';
    group.add(fill);
  }

  // 附图虚线框 + 标签
  const frame = new THREE.BufferGeometry();
  const { x0, x1, z0, z1 } = target;
  frame.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [x0, 0.06, z0, x1, 0.06, z0, x1, 0.06, z1, x0, 0.06, z1],
      3,
    ),
  );
  const frameMat = new THREE.LineBasicMaterial({ color: 0x4dd9f2, transparent: true, opacity: 0.8 });
  const frameLine = new THREE.LineLoop(frame, frameMat);
  frameLine.name = 'inset-frame';
  group.add(frameLine);

  return group;
}

/** 组装完整地域层地图 */
export function buildMapGroup(data: MapData): MapGeometryBundle {
  const group = new THREE.Group();
  group.name = 'map-group';
  // 世界地图两套布局预构建（填充 + 海岸线描边）：A 中国居中（默认显示）/ B 线性经纬度（切换显隐，不重建几何）
  const worldA = buildWorldMesh(data.world, 'china-centered', 'world-backdrop');
  const worldB = buildWorldMesh(data.world, 'linear', 'world-backdrop-b');
  worldB.fill.visible = false;
  worldB.outline.visible = false;
  group.add(worldA.fill, worldA.outline, worldB.fill, worldB.outline);
  group.add(buildChinaMesh(data.china));
  group.add(buildSouthSeaInset(data.china, data.hainan));
  group.scale.set(1, 1, 1);

  const setPalette = (p: MapPalette): void => {
    const tint = new THREE.Color(p.topTint);
    const border = new THREE.Color(p.border);
    const wall = new THREE.Color(p.wall);
    // 世界轮廓提亮 2.2×（曾 0.45× 与背景几乎同色，ACES+sRGB 暗部压缩后不可见）
    const world = wall.clone().multiplyScalar(2.2);
    const inset = wall.clone().multiplyScalar(1.5); // 附图填充比侧壁更亮
    group.traverse((obj) => {
      const mat = (obj as THREE.Mesh).material as THREE.MeshBasicMaterial | THREE.LineBasicMaterial | null;
      if (!mat || !('color' in mat)) return;
      switch (obj.name) {
        case 'china-top': mat.color.copy(tint); break;
        case 'china-wall': mat.color.copy(wall); break;
        case 'china-border':
        case 'ten-dash':
        case 'inset-ten-dash':
        case 'inset-frame': mat.color.copy(border); break;
        case 'world-backdrop':
        case 'world-backdrop-b': mat.color.copy(world); break;
        case 'world-backdrop-outline':
        case 'world-backdrop-b-outline': mat.color.copy(border); break;
        case 'inset-fill': mat.color.copy(inset); break;
      }
    });
  };

  const setMapLayout = (layout: MapLayoutId): void => {
    worldA.fill.visible = layout === 'china-centered';
    worldA.outline.visible = layout === 'china-centered';
    worldB.fill.visible = layout === 'linear';
    worldB.outline.visible = layout === 'linear';
  };

  return { group, setPalette, setMapLayout };
}

/** 供图例/缩略图使用的配色提示 */
export const MAP_COLORS = {
  china: '#0e2447',
  tenDash: '#4dd9f2',
  inset: '#14508c',
} as const;

export { hexToCss };
