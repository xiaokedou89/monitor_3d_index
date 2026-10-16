/**
 * 区域对象（P5）：全局/层/网/子区域作为"区域实体"可被 3D 点击选中、查看详情与配置。
 * 纯函数模块（零 three 依赖，浏览器与 Node 共用，可单测）：
 * regionKey（状态标识）/ regionLabel（面板标题）/ entitiesInRegion / relationsInRegion /
 * layoutTargetOf（布局设置 tab 联动目标）。
 * 子区域实体按"该层该区域该类型"过滤（密集区按类型分带，带成员即同类型实体）。
 */
import type { Dataset, Entity, LayerId, Relation, ZoneId } from './types';
import { LAYER_LABELS, ZONE_LABELS } from './types';
import { kindDef } from './kinds';

/** 区域对象标识（与 AppStore.Selection 的 region 分支共用） */
export type RegionId =
  | { type: 'global' }
  | { type: 'layer'; layer: LayerId }
  | { type: 'zone'; layer: LayerId; zone: ZoneId }
  | { type: 'sub'; layer: LayerId; zone: ZoneId; kind: string };

/** 区域稳定标识（选中比较/集合 key 用） */
export function regionKey(r: RegionId): string {
  switch (r.type) {
    case 'global':
      return 'global';
    case 'layer':
      return `layer:${r.layer}`;
    case 'zone':
      return `zone:${r.layer}:${r.zone}`;
    case 'sub':
      return `sub:${r.layer}:${r.zone}:${r.kind}`;
  }
}

/** 区域类型中文名（面板副标题/属性表用） */
export function regionTypeLabel(r: RegionId): string {
  switch (r.type) {
    case 'global':
      return '全局';
    case 'layer':
      return '层';
    case 'zone':
      return '网（逻辑区域）';
    case 'sub':
      return '子区域';
  }
}

/** 区域展示名：全局总览 / 设备分布层 / 设备分布层 · 企业网 / 任务分布层 · 业务网 · 终端网点 */
export function regionLabel(r: RegionId): string {
  switch (r.type) {
    case 'global':
      return '全局总览';
    case 'layer':
      return LAYER_LABELS[r.layer];
    case 'zone':
      return `${LAYER_LABELS[r.layer]} · ${ZONE_LABELS[r.zone]}`;
    case 'sub':
      return `${LAYER_LABELS[r.layer]} · ${ZONE_LABELS[r.zone]} · ${kindDef(r.kind).label}`;
  }
}

/** 区域包含的实体（全局=全部；子区域=该层该区域该类型的实体） */
export function entitiesInRegion(dataset: Dataset, r: RegionId): Entity[] {
  switch (r.type) {
    case 'global':
      return dataset.entities;
    case 'layer':
      return dataset.entities.filter((e) => e.layer === r.layer);
    case 'zone':
      return dataset.entities.filter((e) => e.layer === r.layer && e.zone === r.zone);
    case 'sub':
      return dataset.entities.filter((e) => e.layer === r.layer && e.zone === r.zone && e.kind === r.kind);
  }
}

/** 区域内部连线（两个端点都在区域内；全局=全部连线） */
export function relationsInRegion(dataset: Dataset, r: RegionId): Relation[] {
  if (r.type === 'global') return dataset.relations;
  const ids = new Set(entitiesInRegion(dataset, r).map((e) => e.id));
  return dataset.relations.filter((rel) => ids.has(rel.from) && ids.has(rel.to));
}

/** 布局设置 tab 的 3D 联动目标（点击网/子区域时切换到对应配置行）；层/全局无对应行返回 null */
export function layoutTargetOf(r: RegionId): { layer: LayerId; zone: ZoneId; kind?: string } | null {
  switch (r.type) {
    case 'zone':
      return { layer: r.layer, zone: r.zone };
    case 'sub':
      return { layer: r.layer, zone: r.zone, kind: r.kind };
    default:
      return null;
  }
}
