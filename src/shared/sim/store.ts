/**
 * LiveStore：运行时数据仓库（浏览器侧）。
 * 持有数据集 + 仿真状态，对外提供订阅与派生查询（实时指标、连线语义、活动告警）。
 * 客户端渲染层是纯投影：只订阅事件流，不直接改状态。
 */
import type {
  Alert,
  Dataset,
  Entity,
  EntityState,
  Notice,
  Relation,
  RelationKind,
  SimEventEnvelope,
  StatItem,
} from '../types';
import { SimEngine } from './engine';
import { initSimState, reduceMany, type SimState } from './events';

export class LiveStore {
  readonly dataset: Dataset;
  readonly engine: SimEngine;
  state: SimState;

  private listeners = new Set<(envs: SimEventEnvelope[]) => void>();

  constructor(dataset: Dataset, opts: { noisePeriod?: number; noiseBatch?: number } = {}) {
    this.dataset = dataset;
    this.engine = new SimEngine(dataset, opts);
    this.state = initSimState(dataset);
  }

  /** 应用外部事件信封（DataSource 推送），并通知订阅者 */
  apply(envs: SimEventEnvelope[]): void {
    if (envs.length === 0) return;
    this.engine.state = reduceMany(this.engine.state, envs);
    this.state = this.engine.state;
    this.notify(envs);
  }

  /** 本地仿真步进（推荐 100ms），返回并应用产生的事件 */
  tick(dt: number): SimEventEnvelope[] {
    const envs = this.engine.tick(dt);
    if (envs.length > 0) {
      this.state = this.engine.state;
      this.notify(envs);
    }
    return envs;
  }

  /** 重置仿真状态（剧本切换用）：回到初始状态（清空活动告警与指标覆盖） */
  resetToInitial(): void {
    this.engine.state = initSimState(this.dataset);
    this.state = this.engine.state;
    this.notify([]);
  }

  subscribe(cb: (envs: SimEventEnvelope[]) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private notify(envs: SimEventEnvelope[]): void {
    for (const cb of this.listeners) cb(envs);
  }

  // ---- 查询 ----

  entity(id: string): Entity | undefined {
    return this.dataset.entities.find((e) => e.id === id);
  }

  entitiesOfLayer(layer: Entity['layer']): Entity[] {
    return this.dataset.entities.filter((e) => e.layer === layer);
  }

  stateOf(id: string): EntityState {
    return this.state.entityState[id] ?? 'online';
  }

  /** 实时统计摘要（基线指标 + 事件覆盖） */
  statsOf(id: string): StatItem[] {
    const e = this.entity(id);
    if (!e) return [];
    const overrides = this.state.statOverrides[id];
    if (!overrides) return e.stats;
    return e.stats.map((s) =>
      s.kind === 'metric' && overrides[s.key] !== undefined
        ? { ...s, value: overrides[s.key] as number | string }
        : s,
    );
  }

  volumeOf(relationId: string, fallback: number): number {
    return this.state.relationVolume[relationId] ?? fallback;
  }

  kindOf(relationId: string, fallback: RelationKind): RelationKind {
    return this.state.relationKind[relationId] ?? fallback;
  }

  relation(id: string): Relation | undefined {
    return this.dataset.relations.find((r) => r.id === id);
  }

  /** 与实体相关的所有关系 */
  relationsOf(entityId: string): Relation[] {
    return this.dataset.relations.filter((r) => r.from === entityId || r.to === entityId);
  }

  activeAlerts(): Alert[] {
    return Object.values(this.state.alerts).filter((a) => a.status === 'active');
  }

  alertsOf(entityId: string): Alert[] {
    return this.activeAlerts().filter((a) => a.entityId === entityId);
  }

  alertsSorted(): Alert[] {
    return this.activeAlerts().sort((a, b) => b.raisedAt - a.raisedAt);
  }

  /** 全部动态提示消息/工单（按触发时间倒序） */
  noticesSorted(): Notice[] {
    return Object.values(this.state.notices).sort((a, b) => b.raisedAt - a.raisedAt);
  }

  notice(id: string): Notice | undefined {
    return this.state.notices[id];
  }
}
