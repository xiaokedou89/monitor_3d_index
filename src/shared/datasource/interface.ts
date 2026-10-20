/**
 * DataSource 抽象：所有运行时事件流的统一入口。
 * 三种实现可互换：静态种子 / 本地仿真引擎 / SSE 远程推送（mock 或真实后端）。
 * 换真实后端 = 换一行装配代码，渲染层无感知。
 */
import type { SimEventEnvelope } from '../types';

export interface DataSource {
  readonly kind: 'seed' | 'sim' | 'sse';
  /** 启动数据源 */
  start(): void;
  /** 停止数据源并释放资源 */
  stop(): void;
  /** 订阅事件流，返回退订函数 */
  onEvent(cb: (env: SimEventEnvelope) => void): () => void;
}
