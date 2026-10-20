/**
 * 动态消息窗体（P4，左侧中部，替代原告警面板）：
 * - 实时模式（默认）：告警 + 提示消息 + 工单按触发时间混排滚动展示，点击展开详情；
 *   内容为空时自动隐藏，有新消息自动弹出；
 * - 历史列表模式（消息状态区 📜 触发）：按类别展示全部历史（含已清除告警），
 *   可返回实时模式或关闭；
 * - 关闭模式：整窗隐藏。
 */
import { ALERT_LEVEL_LABELS, type Alert, type Notice } from '../shared/types';
import { ALERT_LEVEL_COLORS, CATEGORY_COLORS } from '../shared/palette';
import type { LiveStore } from '../shared/sim/store';
import type { AppStore } from './store/app-store';
import { CATEGORY_SHORT } from './stats-board';
import { clear, el } from './dom';

export interface MessageWindowDeps {
  root: HTMLElement;
  store: LiveStore;
  appStore: AppStore;
}

export interface MessageWindow {
  dispose(): void;
}

type Item = { kind: 'alert'; a: Alert } | { kind: 'notice'; n: Notice };

const MAX_LIVE_ITEMS = 30;

export function createMessageWindow(deps: MessageWindowDeps): MessageWindow {
  const { root, store, appStore } = deps;
  let expandedId: string | null = null;
  let lastMode = appStore.get().messageMode;

  const render = (): void => {
    clear(root);
    const st = appStore.get();
    const mode = st.messageMode;
    lastMode = mode;
    root.setAttribute('data-msg-mode', mode.mode);
    if (mode.mode === 'closed') {
      root.classList.add('hidden');
      return;
    }

    let items: Item[];
    if (mode.mode === 'live') {
      const alerts = store.alertsSorted().map((a): Item => ({ kind: 'alert', a }));
      const notices = store.noticesSorted().map((n): Item => ({ kind: 'notice', n }));
      items = [...alerts, ...notices].sort((x, y) => raisedAt(y) - raisedAt(x));
      if (items.length === 0) {
        root.classList.add('hidden');
        return;
      }
    } else {
      const cat = mode.category;
      const alerts = Object.values(store.state.alerts)
        .filter((a) => a.category === cat)
        .sort((a, b) => b.raisedAt - a.raisedAt)
        .map((a): Item => ({ kind: 'alert', a }));
      const notices = store.noticesSorted()
        .filter((n) => n.category === cat)
        .map((n): Item => ({ kind: 'notice', n }));
      items = [...alerts, ...notices].sort((x, y) => raisedAt(y) - raisedAt(x));
    }
    root.classList.remove('hidden');

    const title =
      mode.mode === 'history'
        ? `${CATEGORY_SHORT[mode.category]} · 历史列表（${items.length}）`
        : `实时消息（${items.length}）`;
    root.append(
      el('div', { class: 'panel-title' },
        el('span', { class: 'msg-title-wrap' },
          mode.mode === 'history'
            ? el('button', {
                class: 'close-btn',
                title: '返回实时模式',
                text: '← 实时',
                onclick: () => appStore.set({ messageMode: { mode: 'live' } }),
              })
            : '',
          el('span', { text: title }),
        ),
        el('button', {
          class: 'close-btn',
          title: '关闭动态消息窗体（可通过消息状态区历史图标或新消息重新打开）',
          text: '✕',
          onclick: () => appStore.set({ messageMode: { mode: 'closed' } }),
        }),
      ),
    );

    const shown = mode.mode === 'live' ? items.slice(0, MAX_LIVE_ITEMS) : items;
    root.append(el('div', { class: 'alert-list' }, ...shown.map((it) => item(it))));
    if (shown.length < items.length) {
      root.append(el('div', { class: 'alert-meta', style: 'padding:4px 10px 8px', text: `仅显示最新 ${MAX_LIVE_ITEMS} 条，查看全部请打开历史列表` }));
    }
  };

  const raisedAt = (it: Item): number => (it.kind === 'alert' ? it.a.raisedAt : it.n.raisedAt);

  const item = (it: Item): HTMLElement => {
    if (it.kind === 'notice') return noticeItem(it.n);
    const a = it.a;
    const entity = store.entity(a.entityId);
    const expanded = expandedId === a.id;
    const age = Math.max(store.state.t - a.raisedAt, 0);
    const cleared = a.status === 'cleared';
    return el('div', { 'data-msg-item': a.id },
      el('div', {
        class: 'alert-item',
        onclick: () => {
          expandedId = expanded ? null : a.id;
          render();
        },
      },
        el('span', { class: 'alert-dot', style: `background:${ALERT_LEVEL_COLORS[a.level]};box-shadow:0 0 8px ${ALERT_LEVEL_COLORS[a.level]}` }),
        el('div', {},
          el('div', { class: 'alert-title' },
            el('span', { text: a.title }),
            cleared ? el('span', { class: 'chip', style: 'color:#94a3b8', text: '已清除' }) : '',
            el('span', { class: 'chip', style: `color:${CATEGORY_COLORS[a.category]}`, text: CATEGORY_SHORT[a.category] }),
          ),
          el('div', { class: 'alert-meta', text: `${ALERT_LEVEL_LABELS[a.level]} · ${entity?.name ?? a.entityId} · T+${age.toFixed(1)}s` }),
        ),
      ),
      expanded
        ? el('div', { class: 'alert-detail' },
            el('div', { text: a.detail }),
            el('div', { class: 'alert-suggestion', text: `处置建议：${a.suggestion}` }),
            el('div', { class: 'alert-actions' },
              el('button', {
                class: 'btn small',
                text: '定位实体',
                onclick: () => {
                  appStore.set({ selection: { kind: 'entity', id: a.entityId } });
                  appStore.set({ focus: store.entity(a.entityId)?.layer ?? 'all' });
                },
              }),
              a.relationId
                ? el('button', {
                    class: 'btn small',
                    text: '查看连线',
                    onclick: () => appStore.set({ selection: { kind: 'relation', id: a.relationId! } }),
                  })
                : '',
            ),
          )
        : '',
    );
  };

  const noticeItem = (n: Notice): HTMLElement => {
    const expanded = expandedId === n.id;
    const age = Math.max(store.state.t - n.raisedAt, 0);
    return el('div', { 'data-msg-item': n.id },
      el('div', {
        class: 'alert-item',
        onclick: () => {
          expandedId = expanded ? null : n.id;
          render();
        },
      },
        el('span', { class: 'notice-icon', text: n.kind === 'ticket' ? '🧾' : '💡' }),
        el('div', {},
          el('div', { class: 'alert-title' },
            el('span', { text: n.title }),
            el('span', { class: 'chip', style: `color:${CATEGORY_COLORS[n.category]}`, text: n.kind === 'ticket' ? '工单' : '提示' }),
          ),
          el('div', { class: 'alert-meta', text: `${CATEGORY_SHORT[n.category]} · T+${age.toFixed(1)}s` }),
        ),
      ),
      expanded ? el('div', { class: 'alert-detail' }, el('div', { text: n.detail })) : '',
    );
  };

  // 模式切换（实时/历史/关闭）时整体重绘；实时模式下的消息变化由 store 事件驱动
  const unsubApp = appStore.subscribe(() => {
    const m = appStore.get().messageMode;
    if (m !== lastMode) render();
  });
  const unsubStore = store.subscribe((envs) => {
    if (envs.length === 0) {
      render(); // 剧本重置：清空告警/通知 → 实时模式自动隐藏
      return;
    }
    if (envs.some(({ ev }) => ev.type === 'alert:raise' || ev.type === 'alert:clear' || ev.type === 'notice:push')) {
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
