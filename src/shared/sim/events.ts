/**
 * 仿真事件 reducer：事件溯源核心。
 * 所有运行时变更 = SimEventEnvelope 经 reduce 应用到 SimState。
 */
import type {
  Alert,
  Dataset,
  EntityState,
  Notice,
  RelationKind,
  SimEventEnvelope,
} from '../types';

export interface SimState {
  /** 仿真时间（秒） */
  t: number;
  seq: number;
  /** 实体实时状态 */
  entityState: Record<string, EntityState>;
  /** 实时统计指标覆盖（key: entityId → statKey → value） */
  statOverrides: Record<string, Record<string, number | string>>;
  /** 连线实时流量（相对值 0~1） */
  relationVolume: Record<string, number>;
  /** 连线实时语义（如数据流升级为告警数据流） */
  relationKind: Record<string, RelationKind>;
  /** 活动告警 */
  alerts: Record<string, Alert>;
  /** 动态提示消息/工单（P4 动态消息窗体） */
  notices: Record<string, Notice>;
  /** 完整事件日志（确定性重放依据） */
  log: SimEventEnvelope[];
}

/** 由数据集构造初始状态 */
export function initSimState(dataset: Dataset): SimState {
  const entityState: Record<string, EntityState> = {};
  for (const e of dataset.entities) entityState[e.id] = e.state;

  const relationVolume: Record<string, number> = {};
  for (const r of dataset.relations) relationVolume[r.id] = r.volume;

  return {
    t: 0,
    seq: 0,
    entityState,
    statOverrides: {},
    relationVolume,
    relationKind: {},
    alerts: {},
    notices: {},
    log: [],
  };
}

/** 纯函数：应用单个事件信封，返回新状态（浅拷贝变更记录） */
export function reduceSim(state: SimState, env: SimEventEnvelope): SimState {
  const next: SimState = {
    ...state,
    t: env.t,
    seq: env.seq,
    log: state.log.concat([env]),
  };
  const ev = env.ev;

  switch (ev.type) {
    case 'entity:state':
      next.entityState = { ...state.entityState, [ev.entityId]: ev.state };
      break;
    case 'stat:update': {
      const prev = state.statOverrides[ev.entityId] ?? {};
      const merged = { ...prev };
      for (const p of ev.patch) merged[p.key] = p.value;
      next.statOverrides = { ...state.statOverrides, [ev.entityId]: merged };
      break;
    }
    case 'relation:volume':
      next.relationVolume = { ...state.relationVolume, [ev.relationId]: ev.volume };
      break;
    case 'relation:kind':
      next.relationKind = { ...state.relationKind, [ev.relationId]: ev.kind };
      break;
    case 'alert:raise':
      next.alerts = { ...state.alerts, [ev.alert.id]: ev.alert };
      break;
    case 'alert:clear': {
      const prev = state.alerts[ev.alertId];
      if (!prev) break;
      next.alerts = {
        ...state.alerts,
        [ev.alertId]: { ...prev, status: 'cleared' as const, clearedAt: env.t },
      };
      break;
    }
    case 'notice:push':
      next.notices = { ...state.notices, [ev.notice.id]: ev.notice };
      break;
  }
  return next;
}

/** 批量应用事件信封 */
export function reduceMany(state: SimState, envs: SimEventEnvelope[]): SimState {
  let s = state;
  for (const env of envs) s = reduceSim(s, env);
  return s;
}
