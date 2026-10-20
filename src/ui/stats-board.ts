/**
 * 消息状态展示区（P4，左侧上方）：
 * 4 类消息计数卡片（系统/安全/实体/链路），每卡 = 全量计数 + 活动告警数 +
 * 最近 10 分钟时序折线图（MessageHistory 环形缓冲）；点击卡片历史图标 →
 * 动态消息窗体切换为该类历史列表模式。
 */
import type { AlertCategory } from '../shared/types';
import { ALERT_CATEGORY_LABELS } from '../shared/types';
import { CATEGORY_COLORS } from '../shared/palette';
import type { LiveStore } from '../shared/sim/store';
import type { MessageHistory } from './message-history';
import { SPARK_BUCKETS } from './message-history';
import type { AppStore } from './store/app-store';
import { clear, el } from './dom';

export interface StatsBoardDeps {
  root: HTMLElement;
  history: MessageHistory;
  appStore: AppStore;
  store: LiveStore;
}

export interface StatsBoard {
  dispose(): void;
}

/** 卡片短标签（面板空间有限，完整标签见历史列表标题） */
export const CATEGORY_SHORT: Record<AlertCategory, string> = {
  system: '系统',
  security: '安全',
  entity: '实体',
  link: '链路',
};

const CATEGORIES: AlertCategory[] = ['system', 'security', 'entity', 'link'];

/** 折线图 canvas 像素尺寸（DPR=1 固定，仅作示意） */
const SPARK_W = 132;
const SPARK_H = 26;

export function createStatsBoard(deps: StatsBoardDeps): StatsBoard {
  const { root, history, appStore, store } = deps;

  const drawSpark = (canvas: HTMLCanvasElement, cat: AlertCategory): void => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, SPARK_W, SPARK_H);
    const values = history.get().spark[cat];
    const max = Math.max(1, ...values);
    const color = CATEGORY_COLORS[cat];
    // 填充面积 + 折线
    ctx.beginPath();
    ctx.moveTo(0, SPARK_H);
    for (let i = 0; i < SPARK_BUCKETS; i++) {
      const x = (i / (SPARK_BUCKETS - 1)) * SPARK_W;
      const y = SPARK_H - 2 - (values[i]! / max) * (SPARK_H - 6);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(SPARK_W, SPARK_H);
    ctx.closePath();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    for (let i = 0; i < SPARK_BUCKETS; i++) {
      const x = (i / (SPARK_BUCKETS - 1)) * SPARK_W;
      const y = SPARK_H - 2 - (values[i]! / max) * (SPARK_H - 6);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.stroke();
  };

  const card = (cat: AlertCategory): HTMLElement => {
    const { counts } = history.get();
    const c = counts[cat];
    const st = appStore.get();
    const inHistory = st.messageMode.mode === 'history' && st.messageMode.category === cat;
    return el('div', { class: 'stats-card', 'data-stats-cat': cat },
      el('div', { class: 'stats-card-head' },
        el('span', { class: 'stats-cat-label', style: `color:${CATEGORY_COLORS[cat]}`, text: CATEGORY_SHORT[cat] }),
        el('button', {
          class: `history-btn${inHistory ? ' active' : ''}`,
          'data-history-cat': cat,
          title: `查看${ALERT_CATEGORY_LABELS[cat]}历史列表`,
          text: '📜',
          onclick: () =>
            appStore.set({ messageMode: inHistory ? { mode: 'live' } : { mode: 'history', category: cat } }),
        }),
      ),
      el('div', { class: 'stats-card-nums' },
        el('span', { class: 'stats-total', 'data-stats-total': '', text: String(c.total) }),
        el('span', { class: 'stats-active', 'data-stats-active': '', text: `活动 ${c.active}` }),
      ),
      el('canvas', {
        class: 'stats-spark',
        'data-spark': cat,
        width: String(SPARK_W),
        height: String(SPARK_H),
      }),
    );
  };

  const render = (): void => {
    clear(root);
    root.append(
      el('div', { class: 'panel-title' }, el('span', { text: '消息状态' })),
      el('div', { class: 'stats-grid' }, ...CATEGORIES.map(card)),
      el('div', { class: 'stats-hint', text: '点击卡片 📜 图标查看该类历史列表' }),
    );
    // 折线图在卡片挂载后绘制
    for (const cat of CATEGORIES) {
      const canvas = root.querySelector<HTMLCanvasElement>(`canvas[data-spark="${cat}"]`);
      if (canvas) drawSpark(canvas, cat);
    }
  };

  const unsubApp = appStore.subscribe(() => {
    // 历史图标高亮态跟随 messageMode
    render();
  });
  // 消息事件 → 计数/折线刷新（MessageHistory 由 main.ts 先行入账，注册序保证先于本订阅）
  const unsubStore = store.subscribe((envs) => {
    if (envs.length === 0 || envs.some(({ ev }) => ev.type === 'alert:raise' || ev.type === 'alert:clear' || ev.type === 'notice:push')) {
      render();
    }
  });

  render();
  return {
    dispose() {
      unsubApp();
      unsubStore();
    },
  };
}
