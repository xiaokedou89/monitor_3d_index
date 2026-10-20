/**
 * SSE 远程数据源：连接 mock 服务器（server/mock-sse.ts）或真实后端。
 * 协议：SSE 每行一个 JSON 事件信封 {seq, t, ev}。
 */
import type { SimEventEnvelope } from '../types';
import type { DataSource } from './interface';

export class SseDataSource implements DataSource {
  readonly kind = 'sse' as const;
  private es: EventSource | null = null;
  private listeners = new Set<(env: SimEventEnvelope) => void>();
  private url: string;

  constructor(url: string) {
    this.url = url;
  }

  start(): void {
    if (this.es) return;
    const es = new EventSource(this.url);
    this.es = es;
    es.onmessage = (msg: MessageEvent<string>) => {
      try {
        const env = JSON.parse(msg.data) as SimEventEnvelope;
        for (const cb of this.listeners) cb(env);
      } catch {
        console.warn('[sse] 非法事件信封:', msg.data);
      }
    };
    es.onerror = () => {
      console.warn('[sse] 连接异常，浏览器将自动重连');
    };
  }

  stop(): void {
    this.es?.close();
    this.es = null;
  }

  onEvent(cb: (env: SimEventEnvelope) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
}
