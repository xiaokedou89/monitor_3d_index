/**
 * 告警面板：活动告警列表（级别色点闪烁 + 标题 + 实体 + 仿真时刻），
 * 点击展开详情与处置建议；支持"定位实体"联动选中。
 */
import { ALERT_LEVEL_LABELS, type Alert } from '../shared/types';
import { ALERT_LEVEL_COLORS } from '../shared/palette';
import type { LiveStore } from '../shared/sim/store';
import type { AppStore } from './store/app-store';
import { clear, el } from './dom';

export interface AlertFeedDeps {
  root: HTMLElement;
  store: LiveStore;
  appStore: AppStore;
}

export interface AlertFeed {
  dispose(): void;
}

export function createAlertFeed(deps: AlertFeedDeps): AlertFeed {
  const { root, store, appStore } = deps;
  let expandedId: string | null = null;

  const render = (): void => {
    clear(root);
    const alerts = store.alertsSorted();
    root.append(
      el('div', { class: 'panel-title' },
        el('span', { text: `实时告警（${alerts.length}）` }),
      ),
    );
    if (alerts.length === 0) {
      root.append(el('div', { class: 'alert-item' }, el('span', { class: 'alert-meta', text: '当前无活动告警' })));
      return;
    }
    root.append(
      el('div', { class: 'alert-list' },
        ...alerts.map((a) => item(a)),
      ),
    );
  };

  const item = (a: Alert): HTMLElement => {
    const entity = store.entity(a.entityId);
    const expanded = expandedId === a.id;
    const age = Math.max(store.state.t - a.raisedAt, 0);
    return el('div', {},
      el('div', {
        class: 'alert-item',
        onclick: () => {
          expandedId = expanded ? null : a.id;
          render();
        },
      },
        el('span', { class: 'alert-dot', style: `background:${ALERT_LEVEL_COLORS[a.level]};box-shadow:0 0 8px ${ALERT_LEVEL_COLORS[a.level]}` }),
        el('div', {},
          el('div', { class: 'alert-title', text: a.title }),
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

  const unsub = store.subscribe((envs) => {
    if (envs.some(({ ev }) => ev.type === 'alert:raise' || ev.type === 'alert:clear')) render();
  });

  render();
  return {
    dispose() {
      unsub();
    },
  };
}
