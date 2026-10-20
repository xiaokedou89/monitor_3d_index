/**
 * 仿真引擎：剧本时间线播放 + 环境指标噪声，全部确定性（种子化 PRNG）。
 * 调用方以固定步长调用 tick(dt)（推荐 100ms），引擎返回该步内产生的事件信封。
 */
import type { Dataset, Scenario, SimEvent, SimEventEnvelope } from '../types';
import { mulberry32, randFloat, randInt, randPick, type Rng } from '../rng';
import { initSimState, reduceMany, type SimState } from './events';

export interface EngineOpts {
  /** 环境噪声周期（仿真秒），默认 0.5s */
  noisePeriod?: number;
  /** 每次噪声更新实体数 */
  noiseBatch?: number;
}

export class SimEngine {
  readonly dataset: Dataset;
  state: SimState;
  private player: ScenarioPlayer | null = null;
  private noiseTimer = 0;
  private rng: Rng;
  private noisePeriod: number;
  private noiseBatch: number;
  /** 仿真时间倍速（0=暂停） */
  speed = 1;

  constructor(dataset: Dataset, opts: EngineOpts = {}) {
    this.dataset = dataset;
    this.state = initSimState(dataset);
    this.rng = mulberry32(dataset.meta.seed ^ 0x9e3779b9);
    this.noisePeriod = opts.noisePeriod ?? 0.5;
    this.noiseBatch = opts.noiseBatch ?? 8;
  }

  loadScenario(id: string | null): Scenario | null {
    if (!id) {
      this.player = null;
      return null;
    }
    const sc = this.dataset.scenarios.find((s) => s.id === id) ?? null;
    this.player = sc ? new ScenarioPlayer(sc) : null;
    return sc;
  }

  get scenario(): Scenario | null {
    return this.player?.scenario ?? null;
  }

  /** 推进 dt 秒（仿真时间），返回事件信封列表（已应用到 state） */
  tick(dt: number): SimEventEnvelope[] {
    if (this.speed === 0 || dt <= 0) return [];
    const dtSim = dt * this.speed;
    const due: SimEvent[] = [];
    if (this.player) due.push(...this.player.advance(dtSim));
    due.push(...this.advanceNoise(dtSim));
    if (due.length === 0) return [];

    // 同一批事件共享同一时间戳，seq 连续递增
    const baseT = this.state.t + dtSim;
    let seq = this.state.seq;
    const envs: SimEventEnvelope[] = due.map((ev) => ({ seq: ++seq, t: baseT, ev }));
    this.state = reduceMany(this.state, envs);
    return envs;
  }

  /** 环境指标噪声：随机挑选实体对其数值指标做有界随机游走 */
  private advanceNoise(dt: number): SimEvent[] {
    this.noiseTimer += dt;
    if (this.noiseTimer < this.noisePeriod) return [];
    this.noiseTimer -= this.noisePeriod;

    const out: SimEvent[] = [];
    const candidates = this.dataset.entities.filter((e) =>
      e.stats.some((s) => s.kind === 'metric' && typeof s.value === 'number'),
    );
    if (candidates.length === 0) return out;

    for (let i = 0; i < this.noiseBatch; i++) {
      const e = randPick(this.rng, candidates);
      const metrics = e.stats.filter(
        (s): s is typeof s & { value: number } => s.kind === 'metric' && typeof s.value === 'number',
      );
      const m = randPick(this.rng, metrics);
      // 有界随机游走：±8% 以内，保持正值
      const drift = (this.rng() * 2 - 1) * Math.max(m.value * 0.08, 1);
      out.push({
        type: 'stat:update',
        entityId: e.id,
        patch: [{ key: m.key, value: Math.max(0, Math.round(m.value + drift)) }],
      });
      // 小概率联动更新一条相邻关系流量
      if (this.rng() < 0.2) {
        const rels = this.dataset.relations.filter((r) => r.from === e.id || r.to === e.id);
        if (rels.length > 0) {
          const r = randPick(this.rng, rels);
          out.push({
            type: 'relation:volume',
            relationId: r.id,
            volume: Math.min(1, Math.max(0.05, r.volume + randFloat(this.rng, -0.06, 0.06))),
          });
        }
      }
    }
    return out;
  }

  /** 随机跳转（演示用）：直接 emit 一个随机告警 */
  injectRandomAlert(): SimEvent {
    const e = randPick(this.rng, this.dataset.entities);
    const level = randPick(this.rng, ['critical', 'major', 'minor'] as const);
    return {
      type: 'alert:raise',
      alert: {
        id: `inj-${randInt(this.rng, 10000, 99999)}`,
        entityId: e.id,
        category: randPick(this.rng, ['entity', 'security', 'link'] as const),
        level,
        title: `${e.name} 运行异常`,
        detail: `仿真引擎检测到 ${e.name}（${e.kindLabel}）出现运行波动，可能影响上层业务。`,
        suggestion: '建议查看该实体统计摘要，检查相邻链路流量，必要时执行管理操作。',
        raisedAt: this.state.t,
        status: 'active',
      },
    };
  }
}

/** 剧本播放器：按时间线在固定步长推进中触发事件，支持循环 */
export class ScenarioPlayer {
  readonly scenario: Scenario;
  private idx = 0;
  private t = 0;

  constructor(scenario: Scenario) {
    this.scenario = scenario;
    // 按时间排序
    this.scenario.steps.sort((a, b) => a.at - b.at);
  }

  get time(): number {
    return this.t;
  }

  advance(dt: number): SimEvent[] {
    const out: SimEvent[] = [];
    this.t += dt;
    const { steps, duration, loop } = this.scenario;
    while (this.idx < steps.length && steps[this.idx]!.at <= this.t) {
      out.push(...steps[this.idx]!.events);
      this.idx++;
    }
    if (loop && this.t >= duration) {
      // 循环：回卷时间并重放剩余窗口内的步骤
      this.t %= duration;
      this.idx = 0;
      while (this.idx < steps.length && steps[this.idx]!.at <= this.t) {
        out.push(...steps[this.idx]!.events);
        this.idx++;
      }
    }
    return out;
  }

  seek(t: number): void {
    this.t = Math.max(0, Math.min(t, this.scenario.duration));
    this.idx = this.scenario.steps.findIndex((s) => s.at > this.t);
    if (this.idx < 0) this.idx = this.scenario.steps.length;
  }

  reset(): void {
    this.t = 0;
    this.idx = 0;
  }
}
