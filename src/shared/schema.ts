/**
 * 数据集校验：结构完整性、引用完整性、层一致性。
 * 数据生成器产物与运行时加载都必须通过校验。
 */
import type { AlertCategory, Dataset, Entity, LayerId, Relation, ValidationResult } from './types';
import { LAYERS, ZONES } from './types';

const CATEGORIES = new Set<AlertCategory>(['system', 'security', 'entity', 'link']);

function layerOf(ds: Dataset, id: string): LayerId | undefined {
  return ds.entities.find((e) => e.id === id)?.layer;
}

export function validateDataset(ds: Dataset): ValidationResult {
  const errors: string[] = [];
  const ids = new Set<string>();

  for (const e of ds.entities) {
    if (ids.has(e.id)) errors.push(`实体 id 重复: ${e.id}`);
    ids.add(e.id);
    if (!LAYERS.includes(e.layer)) errors.push(`实体 ${e.id} 层无效: ${e.layer}`);
    if (e.layer === 'geo' && !e.geo) errors.push(`地域层实体缺少经纬度: ${e.id}`);
    if (e.layer !== 'geo' && !ZONES.includes(e.zone!)) errors.push(`实体 ${e.id} 区域无效: ${e.zone}`);
    if (e.size < 1 || e.size > 3) errors.push(`实体 ${e.id} 重要度越界: ${e.size}`);
    if (e.parentId && !ids.has(e.parentId)) errors.push(`实体 ${e.id} 父节点不存在: ${e.parentId}`);
    for (const s of e.stats) {
      if (s.kind === 'metric' && typeof s.value !== 'number') {
        errors.push(`实体 ${e.id} 指标 ${s.key} 应为数值`);
      }
    }
  }

  const relIds = new Set<string>();
  for (const r of ds.relations) {
    if (relIds.has(r.id)) errors.push(`关系 id 重复: ${r.id}`);
    relIds.add(r.id);
    const fl = layerOf(ds, r.from);
    const tl = layerOf(ds, r.to);
    if (!fl) errors.push(`关系 ${r.id} 起点实体不存在: ${r.from}`);
    if (!tl) errors.push(`关系 ${r.id} 终点实体不存在: ${r.to}`);
    if (fl && tl) {
      if (r.scope === 'intra' && fl !== tl) errors.push(`同层关系 ${r.id} 两端跨层: ${fl}→${tl}`);
      if (r.scope === 'cross' && fl === tl) errors.push(`层间关系 ${r.id} 两端同层: ${fl}`);
      if (r.scope === 'cross' && !r.crossType) errors.push(`层间关系 ${r.id} 缺少 crossType`);
    }
    if (r.volume < 0 || r.volume > 1) errors.push(`关系 ${r.id} 流量越界: ${r.volume}`);
    if (r.kind === 'alert') errors.push(`静态关系 ${r.id} 不允许使用 alert 语义（仅运行时切换）`);
  }

  for (const sc of ds.scenarios) {
    const seen = new Set<number>();
    for (const step of sc.steps) {
      if (step.at < 0 || step.at > sc.duration) errors.push(`剧本 ${sc.id} 步骤时间越界: ${step.at}`);
      if (seen.has(step.at)) errors.push(`剧本 ${sc.id} 步骤时间重复: ${step.at}`);
      seen.add(step.at);
      for (const ev of step.events) {
        if (ev.type === 'entity:state' || ev.type === 'stat:update') {
          if (!ids.has(ev.entityId)) errors.push(`剧本 ${sc.id} 引用未知实体: ${ev.entityId}`);
        } else if (ev.type === 'alert:raise') {
          if (!ids.has(ev.alert.entityId)) errors.push(`剧本 ${sc.id} 告警引用未知实体: ${ev.alert.entityId}`);
          if (ev.alert.relationId && !relIds.has(ev.alert.relationId)) {
            errors.push(`剧本 ${sc.id} 告警引用未知关系: ${ev.alert.relationId}`);
          }
          if (!CATEGORIES.has(ev.alert.category)) errors.push(`剧本 ${sc.id} 告警类别无效: ${ev.alert.category}`);
        } else if (ev.type === 'notice:push') {
          if (!CATEGORIES.has(ev.notice.category)) errors.push(`剧本 ${sc.id} 消息类别无效: ${ev.notice.category}`);
        } else if (ev.type === 'relation:volume' || ev.type === 'relation:kind') {
          if (!relIds.has(ev.relationId)) errors.push(`剧本 ${sc.id} 引用未知关系: ${ev.relationId}`);
        }
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

/** 便捷类型守卫 */
export function isEntity(x: unknown): x is Entity {
  return typeof x === 'object' && x !== null && 'id' in x && 'layer' in x;
}

export function isRelation(x: unknown): x is Relation {
  return typeof x === 'object' && x !== null && 'from' in x && 'to' in x && 'kind' in x;
}
