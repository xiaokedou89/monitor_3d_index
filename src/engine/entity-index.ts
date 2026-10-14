/**
 * EntityIndex：实体 id → 世界坐标的单一事实来源。
 * 连线锚点、告警 FX、标签、缩略图全部通过 positionOf(id) 查询，
 * 展开子平面时切换为展开坐标（保留基准坐标以便恢复）。
 *
 * P5 布局配置（见显示设置"区域布局"）：
 * - 区域平面尺寸（宽/深）可配置：setZoneSizes 重算区域 x 范围并自适应重布局；
 * - 密集区按类型分组构成子区域（带），实体按 fitFactor 缩小尺寸与间距；
 * - 子区域/实体可单独配置偏移（dx/dz）与缩放（scale），叠加生效；
 * - scaleFactorOf(id) 供实体渲染/选中环/标签统一缩放。
 */
import * as THREE from 'three';
import type { LayerId, ZoneId } from '../shared/types';
import { ZONES } from '../shared/types';
import { LAYER_HEIGHTS, ZONE_WIDTH } from '../shared/layout/layer';
import { AMERICAS_LNG_THRESHOLD, layoutLng, projectGeo, projectGeoPos, type MapLayoutId } from '../shared/geo';
import type { Dataset, Entity } from '../shared/types';
import { layoutAdaptive, type AdaptiveSub, type AdaptiveResult } from '../shared/layout/adaptive';
import { layoutExpanded } from '../shared/layout/expanded';

/** 实体级位置/尺寸微调（显示设置"区域布局"持久化） */
export interface PositionOverride {
  dx: number;
  dz: number;
  scale: number;
}

/** 子区域级微调 + 折叠 */
export interface SubOverride extends PositionOverride {
  collapsed: boolean;
}

/** 区域整体覆盖（P5：key = `${layer}:${zone}`，位置偏移 + 底板配色/透明度） */
export interface ZoneOverride {
  dx: number;
  dz: number;
  color?: string;
  opacity?: number;
}

/** 区域平面尺寸（宽 w / 深 d，世界单位；d 含 1.6 边距） */
export interface ZoneSize {
  w: number;
  d: number;
}

export type LayoutConfigInput = {
  zoneSizes: Partial<Record<LayerId, Partial<Record<ZoneId, ZoneSize>>>>;
  entityOverrides: Record<string, PositionOverride>;
  subOverrides: Record<string, SubOverride>;
};

interface Entry {
  layer: LayerId;
  zone?: ZoneId;
  kind: string;
  /** 布局位置（不含偏移/缩放，重布局基准） */
  layoutPos: { x: number; z: number };
  /** 地域层实体原始经纬度（地图展示布局 A/B 切换时重投影用） */
  geo?: { lng: number; lat: number };
  base: THREE.Vector3;
  current: THREE.Vector3;
  expanded: boolean;
  /** 未施加层分离位移时的 y（基准坐标或展开平面坐标） */
  anchorY: number;
}

export interface LayerLayoutInfo {
  /** 每区域布局深度（z 跨度），供区域板/缩略图使用 */
  depths: Record<string, number>;
}

/** 区域 x 范围与深度（宽按配置累加，居中对称） */
export interface ZoneBounds {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  d: number;
}

const PAD_DEPTH = 1.6; // 区域板边距（zone-boxes PAD 0.8 × 2）

export class EntityIndex {
  private entries = new Map<string, Entry>();
  /** 每层每区域布局深度 */
  readonly layoutInfo: Record<LayerId, Record<string, number>> = {
    geo: {},
    device: {},
    app: {},
    task: {},
  };
  /** 每层实体视觉半径（由 size 映射 × 缩放系数） */
  private baseRadii = new Map<string, number>();
  /** 层分离位移（聚焦某层时其他层整体上下移动，见 setLayerShift） */
  private shifts: Record<LayerId, number> = { geo: 0, device: 0, app: 0, task: 0 };
  /** 每层实体 id 列表（层分离扇出用） */
  private idsByLayer: Record<LayerId, string[]> = { geo: [], device: [], app: [], task: [] };
  /** 每层区域实体 id 列表（重布局用） */
  private idsByZone: Record<LayerId, Record<ZoneId, string[]>> = {
    geo: {} as Record<ZoneId, string[]>,
    device: {} as Record<ZoneId, string[]>,
    app: {} as Record<ZoneId, string[]>,
    task: {} as Record<ZoneId, string[]>,
  };
  /** 区域平面尺寸配置（运行时，由显示设置驱动） */
  private zoneSizes: Record<LayerId, Record<ZoneId, ZoneSize>> = {
    geo: {} as Record<ZoneId, ZoneSize>,
    device: {} as Record<ZoneId, ZoneSize>,
    app: {} as Record<ZoneId, ZoneSize>,
    task: {} as Record<ZoneId, ZoneSize>,
  };
  /** 每层区域 x 范围（由宽度配置累加） */
  private zoneX: Record<LayerId, Record<ZoneId, { x0: number; x1: number }>> = {
    geo: {} as Record<ZoneId, { x0: number; x1: number }>,
    device: {} as Record<ZoneId, { x0: number; x1: number }>,
    app: {} as Record<ZoneId, { x0: number; x1: number }>,
    task: {} as Record<ZoneId, { x0: number; x1: number }>,
  };
  /** 密集带适配缩放（布局产生） */
  private bandFactor = new Map<string, number>();
  /** 实体/子区域微调（显示设置持久化） */
  private entityOverride = new Map<string, PositionOverride>();
  private subOverride = new Map<string, SubOverride>();
  /** 区域整体覆盖（P5：整体偏移 + 配色/透明度，view-sync 转发给区域板） */
  private zoneOverride = new Map<string, ZoneOverride>();
  /** 综合缩放 = bandFactor × 子区域 scale × 实体 scale */
  private scaleFactors = new Map<string, number>();
  /** 每层每区域子区域（密集带） */
  private subs: Record<LayerId, Record<ZoneId, AdaptiveSub[]>> = {
    geo: {} as Record<ZoneId, AdaptiveSub[]>,
    device: {} as Record<ZoneId, AdaptiveSub[]>,
    app: {} as Record<ZoneId, AdaptiveSub[]>,
    task: {} as Record<ZoneId, AdaptiveSub[]>,
  };

  constructor(dataset: Dataset) {
    this.build(dataset);
  }

  private build(dataset: Dataset): void {
    const radiusOf = (e: Entity): number => 0.38 + e.size * 0.14;
    for (const e of dataset.entities) {
      this.baseRadii.set(e.id, radiusOf(e));
      this.idsByLayer[e.layer].push(e.id);
      if (e.zone) {
        const arr = this.idsByZone[e.layer][e.zone] ?? (this.idsByZone[e.layer][e.zone] = []);
        arr.push(e.id);
      }
    }

    // 地域层：经纬度投影（原始经纬度留存，供地图展示布局切换重投影）
    for (const e of dataset.entities) {
      if (e.layer !== 'geo') continue;
      const { x, z } = projectGeoPos(e.geo!);
      this.entries.set(e.id, {
        layer: e.layer,
        ...(e.zone ? { zone: e.zone } : {}),
        kind: e.kind,
        layoutPos: { x, z },
        geo: { lng: e.geo!.lng, lat: e.geo!.lat },
        base: new THREE.Vector3(x, LAYER_HEIGHTS.geo, z),
        current: new THREE.Vector3(x, LAYER_HEIGHTS.geo, z),
        expanded: false,
        anchorY: LAYER_HEIGHTS.geo,
      });
      this.scaleFactors.set(e.id, 1);
    }

    // 设备/应用/任务层：先建条目（layoutPos 由下方自适应布局填充）
    for (const e of dataset.entities) {
      if (e.layer === 'geo') continue;
      this.entries.set(e.id, {
        layer: e.layer,
        ...(e.zone ? { zone: e.zone } : {}),
        kind: e.kind,
        layoutPos: { x: 0, z: 0 },
        base: new THREE.Vector3(0, LAYER_HEIGHTS[e.layer], 0),
        current: new THREE.Vector3(0, LAYER_HEIGHTS[e.layer], 0),
        expanded: false,
        anchorY: LAYER_HEIGHTS[e.layer],
      });
      this.scaleFactors.set(e.id, 1);
    }

    // 设备/应用/任务层：自适应布局（首轮用默认宽度与天然深度确定平面尺寸）
    for (const layer of ['device', 'app', 'task'] as const) {
      this.computeZoneX(layer);
      for (const zone of ZONES) {
        const ids = this.idsByZone[layer][zone] ?? [];
        const bounds = this.zoneBoundsOf(layer, zone);
        const result = this.runLayout(layer, ids, { x0: bounds.x0, x1: bounds.x1, depth: 60 });
        this.zoneSizes[layer][zone] = {
          w: this.zoneSizes[layer][zone]?.w ?? ZONE_WIDTH,
          d: Math.round(result.depth + PAD_DEPTH),
        };
        this.commitLayout(layer, zone, ids, result);
      }
    }
  }

  /** 由宽度配置重算该层区域 x 范围（各区域首尾相接、整体居中） */
  private computeZoneX(layer: LayerId): void {
    const totalW = ZONES.reduce((acc, z) => acc + (this.zoneSizes[layer][z]?.w ?? ZONE_WIDTH), 0);
    let cursor = -totalW / 2;
    for (const zone of ZONES) {
      const w = this.zoneSizes[layer][zone]?.w ?? ZONE_WIDTH;
      this.zoneX[layer][zone] = { x0: cursor, x1: cursor + w };
      cursor += w;
    }
  }

  /** 区域空间范围（未叠加区域整体偏移；重布局求解用，避免偏移被二次叠加） */
  rawZoneBoundsOf(layer: LayerId, zone: ZoneId): ZoneBounds {
    const { x0, x1 } = this.zoneX[layer][zone] ?? { x0: -30, x1: -15 };
    const d = this.zoneSizes[layer][zone]?.d ?? 8;
    return { x0, x1, z0: -d / 2, z1: d / 2, d };
  }

  /** 区域空间范围（含区域整体偏移），供区域板/缩略图/展开使用 */
  zoneBoundsOf(layer: LayerId, zone: ZoneId): ZoneBounds {
    const raw = this.rawZoneBoundsOf(layer, zone);
    const ov = this.zoneOverride.get(`${layer}:${zone}`);
    if (!ov) return raw;
    return {
      x0: raw.x0 + ov.dx,
      x1: raw.x1 + ov.dx,
      z0: raw.z0 + ov.dz,
      z1: raw.z1 + ov.dz,
      d: raw.d,
    };
  }

  /** 初始布局配置（供显示设置 store 默认值：当前天然布局即默认视觉；含 P5 区域整体覆盖空表） */
  initialLayoutConfig(): LayoutConfigInput & { zoneOverrides: Record<string, ZoneOverride> } {
    const zoneSizes: LayoutConfigInput['zoneSizes'] = {};
    for (const layer of ['device', 'app', 'task'] as const) {
      zoneSizes[layer] = {};
      for (const zone of ZONES) {
        zoneSizes[layer]![zone] = { ...this.zoneSizes[layer][zone] };
      }
    }
    return { zoneSizes, entityOverrides: {}, subOverrides: {}, zoneOverrides: {} };
  }

  private runLayout(
    layer: LayerId,
    ids: string[],
    bounds: { x0: number; x1: number; depth: number },
  ): AdaptiveResult {
    const mode = layer === 'task' ? 'tree' : 'grid';
    const kindOrder = [...new Set(ids.map((id) => this.entries.get(id)?.kind ?? ''))];
    return layoutAdaptive(
      ids.map((id) => {
        const e = this.entries.get(id)!;
        return {
          id,
          kind: e.kind,
          radius: this.baseRadii.get(id) ?? 0.5,
        };
      }),
      bounds,
      { mode, kindOrder },
    );
  }

  /** 布局结果写入条目（layoutPos/bandFactor/subs/layoutInfo），不触碰偏移与层分离 */
  private commitLayout(layer: LayerId, zone: ZoneId, ids: string[], result: AdaptiveResult): void {
    this.subs[layer][zone] = result.subs;
    this.layoutInfo[layer][zone] = result.depth;
    for (const id of ids) {
      const entry = this.entries.get(id);
      if (!entry) continue;
      const p = result.positions.get(id);
      if (!p) continue;
      entry.layoutPos = p;
      this.bandFactor.set(id, result.scaleFactor);
    }
  }

  /** 由 layoutPos + 偏移重算 base/current（保持展开与层分离状态） */
  private applyDerived(ids: string[]): string[] {
    const affected: string[] = [];
    for (const id of ids) {
      const entry = this.entries.get(id);
      if (!entry) continue;
      const sub = entry.zone ? this.subOverride.get(this.subKey(entry.layer, entry.zone, entry.kind)) : undefined;
      const ov = this.entityOverride.get(id);
      const zov = entry.zone ? this.zoneOverride.get(`${entry.layer}:${entry.zone}`) : undefined;
      const x = entry.layoutPos.x + (sub?.dx ?? 0) + (ov?.dx ?? 0) + (zov?.dx ?? 0);
      const z = entry.layoutPos.z + (sub?.dz ?? 0) + (ov?.dz ?? 0) + (zov?.dz ?? 0);
      entry.base.set(x, LAYER_HEIGHTS[entry.layer], z);
      this.scaleFactors.set(id, (this.bandFactor.get(id) ?? 1) * (sub?.scale ?? 1) * (ov?.scale ?? 1));
      if (!entry.expanded) {
        entry.current.set(x, entry.anchorY + this.shifts[entry.layer], z);
      }
      affected.push(id);
    }
    return affected;
  }

  /**
   * 配置某层区域平面尺寸（宽/深），重算区域 x 范围并自适应重布局该层全部区域。
   * 返回受影响实体 id（供 view-sync 扇出矩阵/连线/标签）。
   */
  setZoneSizes(layer: LayerId, sizes: Partial<Record<ZoneId, ZoneSize>>): string[] {
    const affected: string[] = [];
    for (const [zone, size] of Object.entries(sizes)) {
      if (!size) continue;
      this.zoneSizes[layer][zone as ZoneId] = { w: size.w, d: size.d };
    }
    this.computeZoneX(layer);
    for (const zone of ZONES) {
      const ids = this.idsByZone[layer][zone] ?? [];
      // 重布局求解用未偏移范围（区域整体偏移在 applyDerived 中叠加，避免二次偏移）
      const bounds = this.rawZoneBoundsOf(layer, zone);
      const result = this.runLayout(layer, ids, { x0: bounds.x0, x1: bounds.x1, depth: Math.max(bounds.d - PAD_DEPTH, 2) });
      this.commitLayout(layer, zone, ids, result);
      affected.push(...this.applyDerived(ids));
    }
    return affected;
  }

  /**
   * 切换世界地图展示布局（P1）：地域层实体按布局重投影。
   * A 布局（以中国为中心）：美洲实体（经度 < -30）整体 +360° 移至中国以东；
   * B 布局：线性经纬度（初始投影）。保留实体/层分离/展开状态，返回受影响实体 id。
   */
  setMapLayout(layout: MapLayoutId): string[] {
    for (const id of this.idsByLayer.geo) {
      const entry = this.entries.get(id);
      if (!entry?.geo) continue;
      const lng = layoutLng(layout, entry.geo.lng, entry.geo.lng < AMERICAS_LNG_THRESHOLD);
      const { x, z } = projectGeo(lng, entry.geo.lat);
      entry.layoutPos.x = x;
      entry.layoutPos.z = z;
    }
    return this.applyDerived(this.idsByLayer.geo);
  }

  /** 应用实体/子区域微调配置（偏移与缩放）与区域整体覆盖，返回受影响实体 id */
  applyOverrides(
    entityOverrides: Record<string, PositionOverride>,
    subOverrides: Record<string, SubOverride>,
    zoneOverrides: Record<string, ZoneOverride> = {},
  ): string[] {
    this.entityOverride.clear();
    for (const [id, ov] of Object.entries(entityOverrides)) this.entityOverride.set(id, ov);
    this.subOverride.clear();
    for (const [key, ov] of Object.entries(subOverrides)) this.subOverride.set(key, ov);
    this.zoneOverride.clear();
    for (const [key, ov] of Object.entries(zoneOverrides)) this.zoneOverride.set(key, ov);
    const affected: string[] = [];
    for (const layer of ['geo', 'device', 'app', 'task'] as const) {
      affected.push(...this.applyDerived(this.idsByLayer[layer]));
    }
    return affected;
  }

  /** 区域整体覆盖查询（view-sync 转发给区域板配色/透明度） */
  zoneOverrideOf(layer: LayerId, zone: ZoneId): ZoneOverride | undefined {
    return this.zoneOverride.get(`${layer}:${zone}`);
  }

  private subKey(layer: LayerId, zone: ZoneId, kind: string): string {
    return `${layer}:${zone}:${kind}`;
  }

  /** 某层某区域当前子区域（密集带；非密集区为空数组） */
  subsOf(layer: LayerId, zone: ZoneId): AdaptiveSub[] {
    return this.subs[layer][zone] ?? [];
  }

  /** 子区域折叠用的 key → 实体 id（view-sync 活跃过滤） */
  subIdsByKey(key: string): string[] {
    const [layer, zone, kind] = key.split(':') as [LayerId, ZoneId, string];
    return this.subsOf(layer, zone).find((s) => s.kind === kind)?.ids ?? [];
  }

  /** 某层实体 id 列表（层分离扇出用） */
  idsOfLayer(layer: LayerId): string[] {
    return this.idsByLayer[layer];
  }

  /** 地域层带世界坐标范围（缩略图地域带显示用，随地图展示布局 A/B 切换变化） */
  geoBandRange(): { x0: number; x1: number } {
    let x0 = Infinity;
    let x1 = -Infinity;
    for (const id of this.idsByLayer.geo) {
      const p = this.entries.get(id)?.layoutPos;
      if (!p) continue;
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x);
    }
    const pad = 4;
    return { x0: x0 - pad, x1: x1 + pad };
  }

  /**
   * 层分离位移：把该层所有实体（含展开到浮空子平面的）整体垂直移动 dy。
   * current.y = anchorY + dy（anchorY 为基准或展开平面 y），再次调用直接覆盖。
   */
  setLayerShift(layer: LayerId, dy: number, force = false): void {
    if (!force && this.shifts[layer] === dy) return;
    this.shifts[layer] = dy;
    for (const id of this.idsByLayer[layer]) {
      const entry = this.entries.get(id);
      if (entry) entry.current.y = entry.anchorY + dy;
    }
  }

  shiftOf(layer: LayerId): number {
    return this.shifts[layer];
  }

  radiusOf(id: string): number {
    return (this.baseRadii.get(id) ?? 0.5) * (this.scaleFactors.get(id) ?? 1);
  }

  /** 实体视觉尺寸缩放系数（bandFactor × 子区域 × 实体微调；实体渲染矩阵用） */
  scaleFactorOf(id: string): number {
    return this.scaleFactors.get(id) ?? 1;
  }

  positionOf(id: string): THREE.Vector3 {
    const e = this.entries.get(id);
    if (!e) {
      console.warn(`[EntityIndex] 未知实体: ${id}`);
      return new THREE.Vector3();
    }
    return e.current;
  }

  /** 应用展开布局：将一组实体切换到展开平面坐标（返回受影响 id 列表） */
  applyExpansion(ids: string[], layout: Map<string, { x: number; z: number }>, planeY: number): string[] {
    const affected: string[] = [];
    for (const id of ids) {
      const pos = layout.get(id);
      const entry = this.entries.get(id);
      if (!pos || !entry) continue;
      entry.current.set(pos.x, planeY, pos.z);
      entry.anchorY = planeY; // 展开期间层分离位移也作用于展开平面
      entry.expanded = true;
      affected.push(id);
    }
    return affected;
  }

  /** 恢复基准坐标（收起展开） */
  restoreExpansion(ids: string[]): string[] {
    const affected: string[] = [];
    for (const id of ids) {
      const entry = this.entries.get(id);
      if (!entry || !entry.expanded) continue;
      entry.current.copy(entry.base);
      entry.current.y += this.shifts[entry.layer]; // 收起后恢复当前层分离位移
      entry.anchorY = entry.base.y;
      entry.expanded = false;
      affected.push(id);
    }
    return affected;
  }

  /** 生成某区域展开布局（纯函数包装，供 view-sync 调用） */
  static expandedLayout(entities: Array<{ id: string; kind: string; radius: number }>): ReturnType<typeof layoutExpanded> {
    return layoutExpanded(entities);
  }
}
