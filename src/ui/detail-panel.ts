/**
 * 详情窗口（P4，页面底部中间）：实体（3 tab：摘要/属性/配置）、连线（端点/语义/实时流量/关联告警）
 * 与区域（3 tab：摘要/属性/配置）的统一展示窗口。
 * - 实体"操作"tab 已迁入实体控制窗口（实体操作 + 区域批量操作）；
 * - 窗口支持 缩小停靠（仅保留标题栏）/ 放大上拉大窗 / 还原；
 * - 订阅 LiveStore 事件：选中对象相关事件 → 刷新实时内容（流量条/统计/状态）。
 * P5 区域详情：全局/层/网/子区域作为"区域实体"查看，
 * 配置 tab = 区域内实体列表（可过滤检索、点击跳转实体详情）。
 */
import type { Dataset, Entity } from '../shared/types';
import { ENTITY_STATE_COLORS } from '../shared/palette';
import { CROSS_LABELS, LAYER_LABELS, ZONE_LABELS } from '../shared/types';
import { kindDef } from '../shared/kinds';
import {
  entitiesInRegion,
  regionLabel,
  regionTypeLabel,
  relationsInRegion,
  type RegionId,
} from '../shared/regions';
import type { LiveStore } from '../shared/sim/store';
import type { AppStore } from './store/app-store';
import { EntityIndex } from '../engine/entity-index';
import { clear, el } from './dom';

export interface DetailPanelDeps {
  root: HTMLElement;
  dataset: Dataset;
  store: LiveStore;
  appStore: AppStore;
  /** 区域位置范围展示（P5 区域详情） */
  index: EntityIndex;
}

export interface DetailPanel {
  dispose(): void;
}

const LAYER_NAMES: Record<string, string> = {
  geo: '地域分布层',
  device: '设备分布层',
  app: '应用分布层',
  task: '任务分布层',
};

const KIND_NAMES: Record<string, string> = {
  control: '控制',
  data: '数据',
  alert: '告警数据',
};

function fmtStatValue(v: number | string, fmt: string | undefined): string {
  if (typeof v === 'string') return v;
  switch (fmt) {
    case 'bytes': {
      const units = ['B', 'KB', 'MB', 'GB', 'TB'];
      let n = v;
      let i = 0;
      while (n >= 1024 && i < units.length - 1) {
        n /= 1024;
        i++;
      }
      return `${n.toFixed(n >= 100 ? 0 : 1)}`;
    }
    case 'duration':
      return `${v.toFixed(1)}h`;
    case 'ratio':
      return `${(v * 100).toFixed(1)}%`;
    default:
      return v.toLocaleString('zh-CN');
  }
}

export function createDetailPanel(deps: DetailPanelDeps): DetailPanel {
  const { root, dataset, store, appStore, index } = deps;
  let tab: 'summary' | 'attrs' | 'config' = 'summary';
  /** 缩小停靠 / 放大上拉：跨重绘保持 */
  let docked = false;
  let expanded = false;

  const entityById = new Map<string, Entity>();
  for (const e of dataset.entities) entityById.set(e.id, e);

  const render = (): void => {
    clear(root);
    root.classList.toggle('docked', docked);
    root.classList.toggle('expanded', expanded);
    const sel = appStore.get().selection;
    if (!sel) {
      root.classList.add('hidden');
      return;
    }
    root.classList.remove('hidden');
    if (sel.kind === 'relation') renderRelation(sel.id);
    else if (sel.kind === 'entity') renderEntity(sel.id);
    else renderRegion(sel.region);
  };

  /** 标题栏：标题 + 停靠/放大/关闭（各详情共用） */
  const titleRow = (label: string, name: string, chips: HTMLElement[] = []): HTMLElement =>
    el('div', { class: 'panel-title' },
      el('span', { class: 'title-left' },
        el('span', { text: label }),
        el('span', { class: 'title-sep', text: '|' }),
        el('span', { class: 'title-name', text: name }),
        ...chips,
      ),
      el('span', { class: 'title-actions' },
        el('button', {
          class: 'close-btn',
          'data-detail-dock': '',
          title: docked ? '还原窗口' : '缩小停靠（仅保留标题栏）',
          text: docked ? '⤢' : '—',
          onclick: () => {
            docked = !docked;
            render();
          },
        }),
        el('button', {
          class: 'close-btn',
          'data-detail-expand': '',
          title: expanded ? '还原大小' : '放大上拉大窗',
          text: expanded ? '⤡' : '⤢',
          onclick: () => {
            expanded = !expanded;
            render();
          },
        }),
        el('button', { class: 'close-btn', text: '✕', onclick: () => appStore.set({ selection: null }) }),
      ),
    );

  // ---- 区域（P5）：全局/层/网/子区域详情 ----
  const regionStat = (label: string, value: number | string, unit = ''): HTMLElement =>
    el('div', { class: 'stat-cell' },
      el('div', { class: 'stat-label', text: label }),
      el('div', {},
        el('span', { class: 'stat-value', text: String(value) }),
        unit ? el('span', { class: 'stat-unit', text: unit }) : '',
      ),
    );

  const renderRegion = (r: RegionId): void => {
    const entities = entitiesInRegion(dataset, r);
    const relations = relationsInRegion(dataset, r);
    const stateCounts = { online: 0, offline: 0, degraded: 0, busy: 0 };
    let activeAlerts = 0;
    for (const e of entities) {
      stateCounts[store.stateOf(e.id)]++;
      activeAlerts += store.alertsOf(e.id).length;
    }

    const regionAttrRows = (): HTMLElement[] => {
      const rows: Array<[string, string]> = [
        ['对象类型', regionTypeLabel(r)],
        ['名称', regionLabel(r)],
        ['实体数', String(entities.length)],
      ];
      if (r.type !== 'global') rows.push(['层', LAYER_LABELS[r.layer]]);
      if (r.type === 'zone' || r.type === 'sub') {
        rows.push(['网（逻辑区域）', ZONE_LABELS[r.zone]]);
        const b = index.zoneBoundsOf(r.layer, r.zone);
        rows.push(['位置范围 X', `${b.x0.toFixed(1)} ~ ${b.x1.toFixed(1)}`]);
        rows.push(['位置范围 Z', `${b.z0.toFixed(1)} ~ ${b.z1.toFixed(1)}`]);
      }
      if (r.type === 'zone') rows.push(['子区域数', String(index.subsOf(r.layer, r.zone).length)]);
      if (r.type === 'sub') {
        rows.push(['子区域类型', kindDef(r.kind).label]);
        const sub = index.subsOf(r.layer, r.zone).find((s) => s.kind === r.kind);
        if (sub) rows.push(['带范围 Z', `${sub.z0.toFixed(1)} ~ ${sub.z1.toFixed(1)}`]);
      }
      return rows.map(([k, v]) => el('tr', {}, el('td', { text: k }), el('td', { text: v })));
    };

    const regionTab = (): HTMLElement[] => {
      switch (tab) {
        case 'summary':
          return [el('div', { class: 'stat-grid' },
            regionStat('实体总数', entities.length),
            regionStat('在线', stateCounts.online),
            regionStat('离线', stateCounts.offline),
            regionStat('降级', stateCounts.degraded),
            regionStat('繁忙', stateCounts.busy),
            regionStat('活动告警', activeAlerts),
            regionStat('区域内连线', relations.length),
          )];
        case 'attrs':
          return [el('table', { class: 'kv-table' }, el('tbody', {}, ...regionAttrRows()))];
        case 'config':
          return renderRegionEntityList(entities);
      }
    };

    root.append(
      titleRow('区域详情', regionLabel(r), [el('span', { class: 'chip', style: 'color:#22d3ee', text: regionTypeLabel(r) })]),
      docked
        ? ''
        : el('div', { class: 'detail-body' },
            el('div', { class: 'tabs' },
              tabBtn('summary', '摘要'),
              tabBtn('attrs', '属性'),
              tabBtn('config', '配置'),
            ),
            el('div', { class: 'detail-body' }, ...regionTab()),
          ),
    );
  };

  /** 区域内实体列表（配置 tab）：过滤检索 + 点击选中实体；全局上限 100 条防 DOM 过载 */
  const renderRegionEntityList = (entities: Entity[]): HTMLElement[] => {
    const MAX_ROWS = 100;
    const total = entities.length;
    const list = el('div', { class: 'region-entity-list' });
    const renderRows = (query: string): void => {
      clear(list);
      const q = query.trim().toLowerCase();
      const filtered = q
        ? entities.filter((e) => e.name.toLowerCase().includes(q) || e.kindLabel.includes(q) || e.id.toLowerCase().includes(q))
        : entities;
      const shown = filtered.slice(0, MAX_ROWS);
      if (shown.length === 0) {
        list.append(el('div', { class: 'detail-sub', text: '无匹配实体' }));
        return;
      }
      for (const e of shown) {
        const state = store.stateOf(e.id);
        list.append(el('div', {
          class: 'region-entity-row',
          onclick: () => appStore.set({ selection: { kind: 'entity', id: e.id } }),
        },
          el('span', { class: 'region-entity-dot', style: `background:${kindDef(e.kind).color}` }),
          el('span', { class: 'region-entity-name', text: e.name }),
          el('span', { class: 'region-entity-kind', text: e.kindLabel }),
          el('span', { class: 'chip', style: `color:${ENTITY_STATE_COLORS[state]}`, text: stateLabel(state) }),
        ));
      }
      if (filtered.length > MAX_ROWS) {
        list.append(el('div', { class: 'detail-sub', text: `共 ${filtered.length} 条，仅显示前 ${MAX_ROWS} 条` }));
      }
    };
    const input = el('input', {
      type: 'search',
      class: 'settings-input',
      placeholder: '按名称/类型/编号过滤检索',
      'data-region-search': '',
      oninput: (e: Event) => renderRows((e.target as HTMLInputElement).value),
    });
    renderRows('');
    return [el('div', { class: 'region-list-wrap' },
      el('div', { class: 'settings-row' },
        el('span', { class: 'settings-label', text: `实体列表（共 ${total}）` }),
        input,
      ),
      list,
    )];
  };

  // ---- 实体 ----
  const renderEntity = (id: string): void => {
    const e = entityById.get(id);
    if (!e) return;
    const state = store.stateOf(id);
    const stateColor = ENTITY_STATE_COLORS[state];

    root.append(
      titleRow('实体详情', e.name, [
        el('span', { class: 'chip', style: `color:${stateColor}`, text: stateLabel(state) }),
        el('span', { class: 'chip', style: `color:${kindColor(e.kind)}`, text: e.kindLabel }),
      ]),
      docked
        ? ''
        : el('div', { class: 'detail-body' },
            el('div', { class: 'detail-sub', text: `${LAYER_NAMES[e.layer] ?? e.layer}${e.zone ? ' · ' + (ZONE_LABELS[e.zone] ?? e.zone) : ''}${e.geo ? ` · ${e.geo.lng.toFixed(2)}°E ${e.geo.lat.toFixed(2)}°N` : ''}` }),
            el('div', { class: 'tabs' },
              tabBtn('summary', '摘要'),
              tabBtn('attrs', '属性'),
              tabBtn('config', '配置'),
            ),
            el('div', { class: 'detail-body' }, ...renderTab(e)),
          ),
    );
  };

  const tabBtn = (key: typeof tab, label: string): HTMLButtonElement =>
    el('button', {
      class: `tab-btn${tab === key ? ' active' : ''}`,
      text: label,
      onclick: () => {
        tab = key;
        render();
      },
    });

  const renderTab = (e: Entity): HTMLElement[] => {
    switch (tab) {
      case 'summary':
        return [el('div', { class: 'stat-grid' },
          ...store.statsOf(e.id).map((s) =>
            el('div', { class: 'stat-cell' },
              el('div', { class: 'stat-label', text: s.label }),
              el('div', {},
                el('span', { class: 'stat-value', text: fmtStatValue(s.value, s.fmt) }),
                s.unit ? el('span', { class: 'stat-unit', text: s.unit }) : '',
              ),
            ),
          ),
        )];
      case 'attrs':
        return [el('table', { class: 'kv-table' },
          el('tbody', {},
            ...e.attrs.map((a) =>
              el('tr', {}, el('td', { text: a.label }), el('td', { text: a.value })),
            ),
          ),
        )];
      case 'config':
        return [el('table', { class: 'kv-table' },
          el('tbody', {},
            ...e.config.map((c) =>
              el('tr', {},
                el('td', { text: c.label }),
                el('td', { text: String(c.value) + (c.unit ? ` ${c.unit}` : '') }),
              ),
            ),
          ),
        )];
    }
  };

  // ---- 连线 ----
  const renderRelation = (id: string): void => {
    const rel = store.relation(id);
    if (!rel) return;
    const from = entityById.get(rel.from);
    const to = entityById.get(rel.to);
    const kind = store.kindOf(id, rel.kind);
    const volume = store.volumeOf(id, rel.volume);
    const kindColor = kind === 'control' ? '#3b82f6' : kind === 'data' ? '#f5b93b' : '#ef4444';
    const alerts = store.activeAlerts().filter((a) => a.relationId === id);

    root.append(
      titleRow('连线详情', `${from?.name ?? rel.from} → ${to?.name ?? rel.to}`),
      docked
        ? ''
        : el('div', { class: 'detail-body' },
            el('div', { class: 'rel-row' },
              el('span', { class: 'rel-link', text: from?.name ?? rel.from, onclick: () => appStore.set({ selection: { kind: 'entity', id: rel.from } }) }),
              el('span', { class: 'rel-arrow', text: '→' }),
              el('span', { class: 'rel-link', text: to?.name ?? rel.to, onclick: () => appStore.set({ selection: { kind: 'entity', id: rel.to } }) }),
            ),
            el('div', { class: 'detail-sub', text: `${rel.scope === 'cross' && rel.crossType ? CROSS_LABELS[rel.crossType] + '（层间关联）' : '同层连接'} · ${rel.importance === 'critical' ? '关键' : '常规'}` }),
            el('div', { class: 'rel-row' },
              el('span', { class: 'chip', style: `color:${kindColor}`, text: KIND_NAMES[kind] ?? kind }),
              el('span', { text: `实时流量 ${(volume * 100).toFixed(0)}%` }),
            ),
            el('div', { class: 'volume-bar' },
              el('div', { class: 'volume-fill', style: `width:${(volume * 100).toFixed(0)}%;background:${kindColor}` }),
            ),
            alerts.length > 0
              ? el('div', { class: 'alert-detail' },
                  ...alerts.map((a) =>
                    el('div', {},
                      el('div', { class: 'alert-title', text: `⚠ ${a.title}` }),
                      el('div', { text: a.detail }),
                      el('div', { class: 'alert-suggestion', text: `处置建议：${a.suggestion}` }),
                    ),
                  ),
                )
              : '',
          ),
    );
  };

  // ---- 实时刷新 ----
  const unsubApp = appStore.subscribe(() => render());
  const unsubStore = store.subscribe((envs) => {
    const sel = appStore.get().selection;
    if (!sel) return;
    const relevant = envs.some(({ ev }) => {
      if (ev.type === 'alert:raise' || ev.type === 'alert:clear') {
        const eid = ev.type === 'alert:raise' ? ev.alert.entityId : store.state.alerts[ev.alertId]?.entityId;
        if (sel.kind === 'entity') return eid === sel.id;
        if (sel.kind === 'relation') return store.relation(sel.id)?.from === eid || store.relation(sel.id)?.to === eid;
        // 区域：告警所属实体在区域内即刷新
        return entitiesInRegion(dataset, sel.region).some((e) => e.id === eid);
      }
      if (ev.type === 'entity:state' || ev.type === 'stat:update') {
        if (sel.kind === 'entity') return ev.entityId === sel.id;
        if (sel.kind === 'relation') return false;
        return entitiesInRegion(dataset, sel.region).some((e) => e.id === ev.entityId);
      }
      if (ev.type === 'relation:volume' || ev.type === 'relation:kind') {
        return sel.kind === 'relation' && ev.relationId === sel.id;
      }
      return false;
    });
    if (relevant) render();
  });

  const stateLabel = (s: string): string =>
    s === 'online' ? '在线' : s === 'offline' ? '离线' : s === 'degraded' ? '降级' : '繁忙';

  const kindColor = (kind: string): string => kindDef(kind).color;

  render();

  return {
    dispose() {
      unsubApp();
      unsubStore();
    },
  };
}
