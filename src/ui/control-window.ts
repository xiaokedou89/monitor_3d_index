/**
 * 实体控制窗口（P4，页面底部右侧）：
 * - 实体操作：选中实体的管理操作卡片（自详情面板"操作"tab 迁入）；
 * - 区域批量操作：选中区域（全局/层/网/子区域）时提供
 *   批量发送指令 / 发布消息 / 同步管理策略（演示动作，事件溯源注入）；
 * - 无选中时给出操作提示。
 */
import type { Dataset, Entity, OpDef, SimEvent, SimEventEnvelope } from '../shared/types';
import { ENTITY_STATE_COLORS } from '../shared/palette';
import { entitiesInRegion, regionLabel, type RegionId } from '../shared/regions';
import type { LiveStore } from '../shared/sim/store';
import type { AppStore } from './store/app-store';
import { clear, el } from './dom';
import type { Toaster } from './toast';

export interface ControlWindowDeps {
  root: HTMLElement;
  dataset: Dataset;
  store: LiveStore;
  appStore: AppStore;
  toaster: Toaster;
}

export interface ControlWindow {
  dispose(): void;
}

export function createControlWindow(deps: ControlWindowDeps): ControlWindow {
  const { root, dataset, store, appStore, toaster } = deps;

  const entityById = new Map<string, Entity>();
  for (const e of dataset.entities) entityById.set(e.id, e);

  const render = (): void => {
    clear(root);
    const sel = appStore.get().selection;
    root.append(el('div', { class: 'panel-title' }, el('span', { text: '实体控制' })));

    if (!sel) {
      root.append(el('div', { class: 'ctrl-hint', text: '在 3D 场景中点击实体（操作）或层/网/子区域（批量操作）后在此执行管理动作。' }));
      return;
    }
    if (sel.kind === 'entity') renderEntity(sel.id);
    else if (sel.kind === 'region') renderRegion(sel.region);
    else root.append(el('div', { class: 'ctrl-hint', text: '连线无直接控制操作：请点击其端点实体或所在区域。' }));
  };

  // ---- 实体操作 ----
  const renderEntity = (id: string): void => {
    const e = entityById.get(id);
    if (!e) return;
    const state = store.stateOf(id);
    root.append(el('div', { class: 'ctrl-body' },
      el('div', { class: 'detail-header' },
        el('span', { class: 'detail-name', text: e.name }),
        el('span', { class: 'chip', style: `color:${ENTITY_STATE_COLORS[state]}`, text: stateLabel(state) }),
      ),
      ...(e.ops.length === 0
        ? [el('div', { class: 'ctrl-hint', text: '该实体无可用管理操作' })]
        : e.ops.map((op) => opCard(e, op))),
    ));
  };

  const opCard = (e: Entity, op: OpDef): HTMLElement => {
    const params = op.params ?? [];
    const inputs = params.map((p) =>
      el('input', { type: p.kind === 'number' ? 'number' : 'text', value: String(p.value ?? ''), 'data-key': p.key }),
    );
    const execute = (): void => {
      if (op.confirm && !window.confirm(op.confirm)) return;
      const events: SimEvent[] = [];
      if (op.effect?.state) events.push({ type: 'entity:state', entityId: e.id, state: op.effect.state });
      if (op.effect?.statPatch) events.push({ type: 'stat:update', entityId: e.id, patch: op.effect.statPatch });
      const paramSummary = params
        .map((p, i) => `${p.label}=${(inputs[i] as HTMLInputElement | undefined)?.value ?? String(p.value)}`)
        .join('，');
      if (events.length > 0) {
        const baseSeq = store.state.seq;
        const baseT = store.state.t;
        const envs: SimEventEnvelope[] = events.map((ev, i) => ({ seq: baseSeq + i + 1, t: baseT, ev }));
        store.apply(envs);
      }
      toaster.show(`${op.label} 已执行${paramSummary ? `（${paramSummary}）` : ''}`);
    };

    return el('div', { class: `op-card${op.danger ? ' danger-card' : ''}`, 'data-op-card': op.label },
      el('div', { class: 'op-label', text: op.label }),
      params.length > 0
        ? el('div', { class: 'op-params' },
            ...params.map((p, i) =>
              el('label', {}, el('span', { text: p.label }), inputs[i]!),
            ),
          )
        : '',
      el('button', { class: `btn small${op.danger ? ' danger' : ''}`, text: '执行', onclick: execute }),
    );
  };

  // ---- 区域批量操作 ----
  const renderRegion = (r: RegionId): void => {
    const entities = entitiesInRegion(dataset, r);
    const batchOp = (
      key: 'send-cmd' | 'publish-msg' | 'sync-policy',
      label: string,
      confirmText: string,
      act: (list: Entity[]) => void,
    ): HTMLElement =>
      el('button', {
        class: 'btn small',
        'data-batch-op': key,
        text: label,
        disabled: entities.length === 0,
        onclick: () => {
          if (window.confirm(confirmText)) act(entities);
        },
      });

    const sendCmd = (list: Entity[]): void => {
      const baseSeq = store.state.seq;
      const t = store.state.t;
      const envs: SimEventEnvelope[] = list.map((e, i) => ({
        seq: baseSeq + i + 1,
        t,
        ev: { type: 'entity:state', entityId: e.id, state: 'online' },
      }));
      store.apply(envs);
      toaster.show(`已向 ${list.length} 个实体批量发送指令（演示：状态置为在线）`);
    };

    const publishMsg = (list: Entity[]): void => {
      const seq = store.state.seq + 1;
      const t = store.state.t;
      store.apply([
        {
          seq,
          t,
          ev: {
            type: 'notice:push',
            notice: {
              id: `op-notice-${seq}`,
              kind: 'notice',
              category: 'system',
              title: '区域管理消息',
              detail: `向 ${regionLabel(r)} 内 ${list.length} 个实体发布了管理消息（演示）。`,
              raisedAt: t,
            },
          },
        },
      ]);
      toaster.show(`已向 ${list.length} 个实体发布消息`);
    };

    const syncPolicy = (list: Entity[]): void => {
      toaster.show(`已向 ${list.length} 个实体同步管理策略（演示：无实际副作用）`);
    };

    root.append(el('div', { class: 'ctrl-body' },
      el('div', { class: 'detail-header' },
        el('span', { class: 'detail-name', text: regionLabel(r) }),
        el('span', { class: 'chip', style: 'color:#22d3ee', text: `实体 ${entities.length}` }),
      ),
      el('div', { class: 'ctrl-section-title', text: '区域批量操作' }),
      el('div', { class: 'ctrl-batch' },
        batchOp('send-cmd', '批量发送指令', `确认向「${regionLabel(r)}」内 ${entities.length} 个实体批量发送管理指令（演示：状态置为在线）？`, sendCmd),
        batchOp('publish-msg', '发布消息', `确认向「${regionLabel(r)}」内 ${entities.length} 个实体发布管理消息（演示：生成提示消息）？`, publishMsg),
        batchOp('sync-policy', '同步管理策略', `确认向「${regionLabel(r)}」内 ${entities.length} 个实体同步管理策略（演示：无实际副作用）？`, syncPolicy),
      ),
      entities.length === 0 ? el('div', { class: 'ctrl-hint', text: '区域内无实体，批量操作不可用' }) : '',
    ));
  };

  const stateLabel = (s: string): string =>
    s === 'online' ? '在线' : s === 'offline' ? '离线' : s === 'degraded' ? '降级' : '繁忙';

  const unsubApp = appStore.subscribe(() => render());
  const unsubStore = store.subscribe((envs) => {
    const sel = appStore.get().selection;
    if (!sel || sel.kind === 'relation') return;
    const relevant = envs.some(({ ev }) => {
      if (ev.type === 'entity:state' || ev.type === 'stat:update') {
        if (sel.kind === 'entity') return ev.entityId === sel.id;
        return entitiesInRegion(dataset, sel.region).some((e) => e.id === ev.entityId);
      }
      return false;
    });
    if (relevant) render();
  });

  render();
  return {
    dispose() {
      unsubApp();
      unsubStore();
    },
  };
}
