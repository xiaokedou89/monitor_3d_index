/**
 * 本地仿真数据源：包装 LiveStore.tick()，以固定节拍（100ms）驱动剧本时间线与指标噪声。
 * 走 LiveStore 保证状态单一事实来源：tick 内部应用事件并通知订阅者，
 * 本数据源仅做节拍与事件广播（与 SSE 数据源接口对齐）。
 */
import type { SimEventEnvelope } from '../types';
import type { LiveStore } from '../sim/store';
import type { DataSource } from './interface';

export interface SimLocalOptions {
  store: LiveStore;
  /** 节拍间隔（毫秒），默认 100 */
  intervalMs?: number;
}

export class SimLocalDataSource implements DataSource {
  readonly kind = 'sim' as const;
  private store: LiveStore;
  private intervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<(env: SimEventEnvelope) => void>();

  constructor(opts: SimLocalOptions) {
    this.store = opts.store;
    this.intervalMs = opts.intervalMs ?? 100;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      const envs = this.store.tick(this.intervalMs / 1000);
      for (const env of envs) {
        for (const cb of this.listeners) cb(env);
      }
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  onEvent(cb: (env: SimEventEnvelope) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
}
