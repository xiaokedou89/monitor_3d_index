/**
 * 消息历史（P4 消息状态展示区数据源，纯逻辑、无 DOM）：
 * 按消息类别（系统/安全/实体/链路）维护全量计数、活动告警计数与
 * 最近 60 个 10 秒桶的时序折线数据（环形缓冲，供 sparkline 绘制）。
 * - recordAlert/recordNotice：新消息入账（全量计数 + 活动计数 + 当前桶 +1）；
 * - clearAlert：告警清除（活动计数 -1，全量计数保留供历史列表）；
 * - advance：按仿真时间推进桶指针，跨桶清零、时间回退（剧本重置）清空全部桶；
 * - reset：整体清零（resetToInitial 时空事件流信号触发）。
 */
import type { Alert, AlertCategory, Notice } from '../shared/types';

export const SPARK_BUCKETS = 60;
export const SPARK_BUCKET_SECONDS = 10;

export interface CategoryCounts {
  /** 全量消息数（活动+已清除告警 + 提示消息 + 工单） */
  total: number;
  /** 活动告警数 */
  active: number;
}

export interface MessageHistoryState {
  counts: Record<AlertCategory, CategoryCounts>;
  /** 时序折线：每类别 60 个桶，每桶 = 该 10 秒窗口内新消息数（环形，桶 0 = 当前） */
  spark: Record<AlertCategory, number[]>;
}

const CATEGORIES: AlertCategory[] = ['system', 'security', 'entity', 'link'];

function emptyCounts(): Record<AlertCategory, CategoryCounts> {
  return {
    system: { total: 0, active: 0 },
    security: { total: 0, active: 0 },
    entity: { total: 0, active: 0 },
    link: { total: 0, active: 0 },
  };
}

function emptySpark(): Record<AlertCategory, number[]> {
  return {
    system: new Array<number>(SPARK_BUCKETS).fill(0),
    security: new Array<number>(SPARK_BUCKETS).fill(0),
    entity: new Array<number>(SPARK_BUCKETS).fill(0),
    link: new Array<number>(SPARK_BUCKETS).fill(0),
  };
}

export class MessageHistory {
  private counts = emptyCounts();
  private spark = emptySpark();
  private lastBucket = -1;

  /** 推进桶指针：跨桶清零中间桶；时间回退（剧本重置）清空全部桶 */
  advance(t: number): void {
    const idx = Math.max(0, Math.floor(t / SPARK_BUCKET_SECONDS));
    if (this.lastBucket < 0) {
      this.lastBucket = idx;
      return;
    }
    if (idx < this.lastBucket) {
      this.reset();
      this.lastBucket = idx;
      return;
    }
    const steps = Math.min(idx - this.lastBucket, SPARK_BUCKETS);
    for (let i = 1; i <= steps; i++) {
      const b = (this.lastBucket + i) % SPARK_BUCKETS;
      for (const cat of CATEGORIES) this.spark[cat][b] = 0;
    }
    this.lastBucket = idx;
  }

  recordAlert(a: Alert, t: number): void {
    this.advance(t);
    this.counts[a.category].total++;
    this.counts[a.category].active++;
    this.bump(a.category);
  }

  clearAlert(category: AlertCategory): void {
    this.counts[category].active = Math.max(0, this.counts[category].active - 1);
  }

  recordNotice(n: Notice, t: number): void {
    this.advance(t);
    this.counts[n.category].total++;
    this.bump(n.category);
  }

  /** 当前桶计数 +1 */
  private bump(cat: AlertCategory): void {
    const bucket = this.spark[cat];
    const idx = this.lastBucket % SPARK_BUCKETS;
    bucket[idx] = (bucket[idx] ?? 0) + 1;
  }

  reset(): void {
    this.counts = emptyCounts();
    this.spark = emptySpark();
    this.lastBucket = -1;
  }

  get(): MessageHistoryState {
    return { counts: this.counts, spark: this.spark };
  }
}
