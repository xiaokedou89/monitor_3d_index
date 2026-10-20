/**
 * 帮助窗口（P4，右上角 ❓ 打开）：
 * - 连接语义 tab：连线语义/告警级别/各层实体类型配色（自独立图例面板迁入）；
 * - 操作说明 tab：鼠标/键盘/面板交互操作说明（键盘视角微调需聚焦某层时生效）。
 */
import { KIND_DEFS_BY_LAYER } from '../shared/kinds';
import { ALERT_LEVEL_COLORS, PALETTE } from '../shared/palette';
import { ALERT_LEVEL_LABELS } from '../shared/types';
import type { AppStore } from './store/app-store';
import { clear, el } from './dom';

export interface HelpWindowDeps {
  root: HTMLElement;
  appStore: AppStore;
}

export interface HelpWindow {
  dispose(): void;
}

const LAYER_TITLES: Record<string, string> = {
  geo: '地域分布层',
  device: '设备分布层',
  app: '应用分布层',
  task: '任务分布层',
};

export function createHelpWindow(deps: HelpWindowDeps): HelpWindow {
  const { root, appStore } = deps;
  let tab: 'semantics' | 'guide' = 'semantics';

  const render = (): void => {
    clear(root);
    const open = appStore.get().helpOpen;
    root.classList.toggle('hidden', !open);
    if (!open) return;
    root.append(
      el('div', { class: 'panel-title' },
        el('span', { text: '帮助' }),
        el('button', { class: 'close-btn', text: '✕', onclick: () => appStore.set({ helpOpen: false }) }),
      ),
      el('div', { class: 'tabs' },
        tabBtn('semantics', '连接语义'),
        tabBtn('guide', '操作说明'),
      ),
      el('div', { class: 'help-body' }, ...(tab === 'semantics' ? semantics() : guide())),
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

  const legendRow = (color: string, label: string): HTMLElement =>
    el('div', { class: 'legend-row' },
      el('span', { class: 'legend-swatch line', style: `background:${color};box-shadow:0 0 4px ${color}` }),
      el('span', { text: label }),
    );

  const semantics = (): HTMLElement[] => [
    el('div', { class: 'legend-section' },
      el('div', { class: 'legend-head', text: '连线语义' }),
      legendRow(PALETTE.edgeControl, '控制（蓝）· 关键控制加粗流动'),
      legendRow(PALETTE.edgeData, '数据（黄）· 粗细∝流量'),
      legendRow(PALETTE.edgeAlert, '告警数据（红）· 流动虚线'),
    ),
    el('div', { class: 'legend-section' },
      el('div', { class: 'legend-head', text: '告警级别' }),
      ...(Object.keys(ALERT_LEVEL_COLORS) as Array<keyof typeof ALERT_LEVEL_COLORS>).map((level) =>
        legendRow(ALERT_LEVEL_COLORS[level], ALERT_LEVEL_LABELS[level]),
      ),
    ),
    el('div', { class: 'legend-section' },
      el('div', { class: 'legend-head', text: '实体类型' }),
      ...(Object.keys(KIND_DEFS_BY_LAYER) as Array<keyof typeof KIND_DEFS_BY_LAYER>).map((layer) =>
        el('details', {},
          el('summary', { text: LAYER_TITLES[layer] ?? layer, style: 'color:var(--text);cursor:pointer;padding:2px 0' }),
          el('div', { class: 'legend-kinds' },
            ...KIND_DEFS_BY_LAYER[layer].map((k) =>
              el('span', { class: 'legend-kind', style: `color:${k.color}`, text: k.label }),
            ),
          ),
        ),
      ),
    ),
  ];

  const guideRow = (keys: string, desc: string): HTMLElement =>
    el('div', { class: 'guide-row' },
      el('span', { class: 'guide-keys', text: keys }),
      el('span', { text: desc }),
    );

  const guide = (): HTMLElement[] => [
    el('div', { class: 'legend-section' },
      el('div', { class: 'legend-head', text: '鼠标操作' }),
      guideRow('左键拖动', '旋转视角'),
      guideRow('右键拖动 / 平移', '平移视点'),
      guideRow('滚轮', '缩放视距'),
      guideRow('左键单击', '选中实体 / 连线 / 层 / 网 / 子区域'),
    ),
    el('div', { class: 'legend-section' },
      el('div', { class: 'legend-head', text: '键盘视角微调（聚焦某层时生效）' }),
      guideRow('W / S', '前移 / 后移'),
      guideRow('A / D', '左移 / 右移'),
      guideRow('Q / E', '下移 / 上移'),
      guideRow('J / K', '缩小 / 增大视线与平面夹角'),
      guideRow('H / L', '向左 / 向右扭头（水平旋转视线）'),
      el('div', { class: 'detail-sub', text: '移动与扭转步进值可在 设置 → 显示设置 中配置。' }),
    ),
    el('div', { class: 'legend-section' },
      el('div', { class: 'legend-head', text: '面板操作' }),
      guideRow('左侧层签', '聚焦对应层 / 总览；聚焦后可展开区域'),
      guideRow('分层缩略图', '点击层带聚焦；点击分区展开/收起；总览按钮回全局视角'),
      guideRow('3D 点击区域', '选中层/网/子区域：详情窗口展示、缩略图高亮、布局配置联动'),
      guideRow('消息状态区', '4 类消息计数与折线；📜 打开该类历史列表'),
      guideRow('动态消息窗体', '实时滚动展示告警/提示/工单，点击条目展开详情'),
      guideRow('实体控制窗口', '选中实体=管理操作；选中区域=批量发送指令/发布消息/同步管理策略'),
      guideRow('设置 ⚙', '显示设置 / 布局设置 / 演示设置三个 tab'),
    ),
  ];

  const unsub = appStore.subscribe(() => render());

  render();
  return {
    dispose() {
      unsub();
    },
  };
}
