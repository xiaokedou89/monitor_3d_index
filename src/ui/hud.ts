/**
 * HUD：顶栏（标题/实时计数/设置入口）+ 左侧层签 + 区域展开按钮。
 * 剧本/倍速/暂停/导览/层间关联等演示控制已迁入设置面板"演示设置"tab（P2）。
 */
import type { Dataset, LayerId, ZoneId } from '../shared/types';
import { LAYER_COLORS } from '../shared/palette';
import { ZONE_LABELS, ZONES } from '../shared/types';
import type { LiveStore } from '../shared/sim/store';
import { AppStore } from './store/app-store';
import { clear, el } from './dom';

export interface HudDeps {
  root: HTMLElement;
  dataset: Dataset;
  store: LiveStore;
  appStore: AppStore;
  focusLayer(layer: LayerId | 'all'): void;
  expandZone(layer: LayerId, zone: ZoneId): void;
  collapseExpansion(): void;
  /** 设置面板开关（settings-panel 注入） */
  toggleSettings?(): void;
}

export interface Hud {
  dispose(): void;
}

const LAYER_NAMES: Array<{ id: LayerId | 'all'; label: string }> = [
  { id: 'all', label: '总览' },
  { id: 'geo', label: '地域层' },
  { id: 'device', label: '设备层' },
  { id: 'app', label: '应用层' },
  { id: 'task', label: '任务层' },
];

export function createHud(deps: HudDeps): Hud {
  const { root, dataset, store, appStore } = deps;

  const render = (): void => {
    clear(root);
    const state = appStore.get();

    // ---- 顶栏 ----
    root.append(el('div', { class: 'hud-top panel' },
      el('span', { class: 'hud-title', text: '3D 展示管控系统' }),
      el('div', { class: 'hud-controls' },
        el('span', { class: 'hud-stats', text: `实体 ${dataset.entities.length} · 关系 ${dataset.relations.length} · 告警 ${store.activeAlerts().length}` }),
        deps.toggleSettings
          ? el('button', {
              class: `btn settings-btn${state.settingsOpen ? ' active' : ''}`,
              title: '设置：显示/布局/演示三类设置（含剧本、倍速、导览、地图布局等）',
              text: state.settingsOpen ? '⚙ 设置 ▲' : '⚙ 设置',
              onclick: () => deps.toggleSettings?.(),
            })
          : '',
      ),
    ));

    // ---- 左侧层签 ----
    root.append(el('div', { class: 'layer-tabs' },
      ...LAYER_NAMES.map(({ id, label }) =>
        el('div', {
          class: `layer-tab${state.focus === id ? ' active' : ''}`,
          onclick: () => deps.focusLayer(id),
        },
          el('span', {
            class: 'layer-dot',
            style: `background:${id === 'all' ? '#e0f2fe' : LAYER_COLORS[id]};color:${id === 'all' ? '#e0f2fe' : LAYER_COLORS[id]}`,
          }),
          el('span', { text: label }),
        ),
      ),
      // 聚焦非地域层时提供区域展开按钮
      state.focus !== 'all' && state.focus !== 'geo'
        ? el('div', { class: 'zone-chips' },
            ...ZONES.map((zone) => {
              const expanded = state.expansion?.layer === state.focus && state.expansion?.zone === zone;
              return el('button', {
                class: `zone-chip${expanded ? ' expanded' : ''}`,
                text: expanded ? `${ZONE_LABELS[zone]} ▾ 收起` : `⤢ ${ZONE_LABELS[zone]}`,
                onclick: () => {
                  if (expanded) deps.collapseExpansion();
                  else deps.expandZone(state.focus as LayerId, zone);
                },
              });
            }),
          )
        : '',
    ));
  };

  const unsubApp = appStore.subscribe(() => render());
  const unsubStore = store.subscribe((envs) => {
    if (envs.some(({ ev }) => ev.type === 'alert:raise' || ev.type === 'alert:clear')) render();
  });

  render();
  return {
    dispose() {
      unsubApp();
      unsubStore();
    },
  };
}
