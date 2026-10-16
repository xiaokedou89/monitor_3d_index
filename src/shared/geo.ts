/**
 * 地理投影（等距圆柱）：经纬度 → 地域层平面坐标 (x, z)。
 * 以中国中心 (104°E, 35°N) 为原点，K=0.9 → 中国版图宽约 56 世界单位。
 * Node 数据生成器与浏览器渲染共用同一函数，保证一致性。
 */
import type { GeoPos } from './types';

export const GEO_CENTER_LNG = 104;
export const GEO_CENTER_LAT = 35;
export const GEO_K = 0.9;

/**
 * 世界地图展示布局（P1）：
 * - 'china-centered'（A 布局，默认）：以中国为中心，欧洲在最左端、美洲在最右端。
 *   美洲要素/实体经度整体 +360° 平移至中国以东，保证跨太平洋连线（如美国机房）
 *   方向连续、不绕到视野左端之外。保持 1:1 地理比例，不做压缩。
 * - 'linear'（B 布局）：线性经纬度投影（现状，美洲位于最左端）。
 */
export type MapLayoutId = 'china-centered' | 'linear';

export const MAP_LAYOUT_LABELS: Record<MapLayoutId, string> = {
  'china-centered': 'A 布局 · 以中国为中心',
  linear: 'B 布局 · 线性经纬度（现状）',
};

/** 美洲判定经度阈值：实体经度低于该值视为美洲（与世界地图要素按 CONTINENT 判定对应） */
export const AMERICAS_LNG_THRESHOLD = -30;

/**
 * 布局经度变换：A 布局下美洲经度 +360° 移至中国以东。
 * 阿留申群岛等跨反经线（lng>180）顶点先折回西半球再平移，避免超出极值。
 */
export function layoutLng(layout: MapLayoutId, lng: number, isAmericas: boolean): number {
  if (layout !== 'china-centered' || !isAmericas) return lng;
  const normalized = lng > 180 ? lng - 360 : lng;
  return normalized + 360;
}

/** 经纬度 → 平面坐标（世界单位） */
export function projectGeo(lng: number, lat: number): { x: number; z: number } {
  return {
    x: (lng - GEO_CENTER_LNG) * GEO_K,
    z: (GEO_CENTER_LAT - lat) * GEO_K,
  };
}

export function projectGeoPos(pos: GeoPos): { x: number; z: number } {
  return projectGeo(pos.lng, pos.lat);
}

/** 平面坐标 → 经纬度（缩略图/反查用） */
export function unprojectGeo(x: number, z: number): GeoPos {
  return { lng: x / GEO_K + GEO_CENTER_LNG, lat: GEO_CENTER_LAT - z / GEO_K };
}

/** 中国地图 GeoJSON 特征 adcode → 省名（用于地图悬停/点击展示） */
export const PROVINCE_ADCODE_NAMES: Record<string, string> = {
  '110000': '北京市',
  '120000': '天津市',
  '130000': '河北省',
  '140000': '山西省',
  '150000': '内蒙古自治区',
  '210000': '辽宁省',
  '220000': '吉林省',
  '230000': '黑龙江省',
  '310000': '上海市',
  '320000': '江苏省',
  '330000': '浙江省',
  '340000': '安徽省',
  '350000': '福建省',
  '360000': '江西省',
  '370000': '山东省',
  '410000': '河南省',
  '420000': '湖北省',
  '430000': '湖南省',
  '440000': '广东省',
  '450000': '广西壮族自治区',
  '460000': '海南省',
  '500000': '重庆市',
  '510000': '四川省',
  '520000': '贵州省',
  '530000': '云南省',
  '540000': '西藏自治区',
  '610000': '陕西省',
  '620000': '甘肃省',
  '630000': '青海省',
  '640000': '宁夏回族自治区',
  '650000': '新疆维吾尔自治区',
  '710000': '台湾省',
  '810000': '香港特别行政区',
  '820000': '澳门特别行政区',
};
