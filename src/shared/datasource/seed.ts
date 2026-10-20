/**
 * 静态种子数据源：仅展示数据集初始状态，不产生运行时事件。
 */
import type { SimEventEnvelope } from '../types';
import type { DataSource } from './interface';

export class SeedDataSource implements DataSource {
  readonly kind = 'seed' as const;

  start(): void {
    /* 无事件流 */
  }
  stop(): void {
    /* no-op */
  }
  onEvent(_cb: (env: SimEventEnvelope) => void): () => void {
    return () => {};
  }
}
