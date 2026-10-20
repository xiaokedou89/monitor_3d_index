/**
 * 图例：连线语义（控制/数据/告警）、告警级别、各层实体类型色。
 * 静态渲染一次。
 */
import { KIND_DEFS_BY_LAYER } from '../shared/kinds';
import { ALERT_LEVEL_COLORS, PALETTE } from '../shared/palette';
import { ALERT_LEVEL_LABELS } from '../shared/types';
import { el } from './dom';

const LAYER_TITLES: Record<string, string> = {
  geo: '地域分布层',
  device: '设备分布层',
  app: '应用分布层',
  task: '任务分布层',
};

export function renderLegend(root: HTMLElement): void {
  const panel = el('div', { class: 'panel legend-panel' });

  panel.append(el('div', { class: 'legend-section' },
    el('div', { class: 'legend-head', text: '连线语义' }),
    legendRow(PALETTE.edgeControl, '控制（蓝）· 关键控制加粗流动'),
    legendRow(PALETTE.edgeData, '数据（黄）· 粗细∝流量'),
    legendRow(PALETTE.edgeAlert, '告警数据（红）· 流动虚线'),
  ));

  panel.append(el('div', { class: 'legend-section' },
    el('div', { class: 'legend-head', text: '告警级别' }),
    ...(Object.keys(ALERT_LEVEL_COLORS) as Array<keyof typeof ALERT_LEVEL_COLORS>).map((level) =>
      legendRow(ALERT_LEVEL_COLORS[level], ALERT_LEVEL_LABELS[level]),
    ),
  ));

  panel.append(el('div', { class: 'legend-section' },
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
  ));

  root.append(panel);
}

function legendRow(color: string, label: string): HTMLElement {
  return el('div', { class: 'legend-row' },
    el('span', { class: 'legend-swatch line', style: `background:${color};box-shadow:0 0 4px ${color}` }),
    el('span', { text: label }),
  );
}
