/**
 * 设置面板（P2）：顶栏"⚙ 设置"按钮打开（AppStore.settingsOpen 联动高亮），
 * 系统设置操作总入口，按三个 tab 分组（后续可扩展更多设置页）：
 * - 显示设置：告警发光特效（范围/强度/开关）、泛光 bloom、连线、层间分离、
 *   视角控制（聚焦俯仰角/键盘步进，P3）、地图布局（A/B，P1）、风格样式、标签；
 * - 布局设置：P5 区域布局（层/区域平面尺寸、密集区子区域折叠/微调、选中实体微调、
 *   命名布局预设保存/应用/删除）；
 * - 演示设置：剧本切换/倍速/暂停/一键演示导览/层间关联（自 HUD 顶栏迁入）。
 * 全部写入 DisplaySettingsStore（持久化 localStorage），由 view-sync 实时应用。
 */
import type { Dataset, LayerId, ZoneId } from '../shared/types';
import { ZONES, ZONE_LABELS } from '../shared/types';
import { MAP_LAYOUT_LABELS, type MapLayoutId } from '../shared/geo';
import type { AppState, AppStore, CrossLinksMode, CrossLinksState } from './store/app-store';
import type { LiveStore } from '../shared/sim/store';
import { BUILTIN_STYLES, DisplaySettingsStore, type DisplaySettings, type LayoutConfig, type SubOverride, type ZoneOverride, type ZoneSize } from './store/display-settings';
import { ZONE_COLORS } from '../shared/palette';
import { clear, el } from './dom';

export interface SettingsPanelDeps {
  root: HTMLElement;
  appStore: AppStore;
  settingsStore: DisplaySettingsStore;
  /** 软渲染环境 bloom 被强制禁用，面板给出提示 */
  bloomSupported: boolean;
  /** 子区域提供者（密集区按类型分组的带；非密集区返回空数组） */
  subsOf?: (layer: LayerId, zone: ZoneId) => Array<{ kind: string; label: string }>;
  /** 实体名查询（"选中实体微调"行显示） */
  entityNameOf?: (id: string) => string | null;
  /** 演示设置 tab（P2）：剧本/倍速/暂停/导览/层间关联 */
  dataset: Dataset;
  store: LiveStore;
  setScenario(id: string | null): void;
  startTour?(): void;
}

export interface SettingsPanel {
  toggle(): void;
  dispose(): void;
}

type NumKey =
  | 'alertGlowScale'
  | 'alertGlowIntensity'
  | 'bloomStrength'
  | 'bloomRadius'
  | 'bloomThreshold'
  | 'edgeMinPx'
  | 'focusSeparation'
  | 'focusPitchDeg'
  | 'cameraAngleStepDeg'
  | 'cameraMoveStep';
type BoolKey = 'alertFxOn' | 'alertTintOn' | 'bloomOn' | 'edgeFlowOn' | 'edgePulseOn' | 'labelsOn';

const CROSS_MODES: Array<{ id: CrossLinksMode; label: string }> = [
  { id: 'none', label: '隐藏层间关联' },
  { id: 'pair', label: '仅两层间' },
  { id: 'all', label: '全部显示' },
  { id: 'entity', label: '选中实体相关' },
];

const TAB_LABELS: Record<AppState['settingsTab'], string> = {
  display: '显示设置',
  layout: '布局设置',
  demo: '演示设置',
};

type TabId = AppState['settingsTab'];

export function createSettingsPanel(deps: SettingsPanelDeps): SettingsPanel {
  const { root, appStore, settingsStore, dataset, store, setScenario, startTour } = deps;
  root.classList.add('panel');

  const setField = <K extends keyof DisplaySettings>(key: K, value: DisplaySettings[K]): void => {
    settingsStore.set({ [key]: value } as Partial<DisplaySettings>);
  };

  /** 滑块行：label + range（实时写入 store 并持久化）+ 当前值 */
  const sliderRow = (
    label: string,
    key: NumKey,
    min: number,
    max: number,
    step: number,
    format: (v: number) => string,
  ): HTMLElement => {
    const valueEl = el('span', { class: 'settings-value', text: format(settingsStore.get()[key]) });
    return el('div', { class: 'settings-row' },
      el('span', { class: 'settings-label', text: label }),
      el('input', {
        type: 'range',
        min: String(min),
        max: String(max),
        step: String(step),
        value: String(settingsStore.get()[key]),
        'data-key': key,
        oninput: (e: Event) => {
          const v = Number((e.target as HTMLInputElement).value);
          valueEl.textContent = format(v);
          setField(key, v);
        },
      }),
      valueEl,
    );
  };

  /** 开关行：label + 开关（checkbox 视觉化为滑块轨道）+ 可选提示 */
  const toggleRow = (label: string, key: BoolKey, hint = ''): HTMLElement =>
    el('div', { class: 'settings-row' },
      el('label', { class: 'settings-toggle', title: label },
        el('input', {
          type: 'checkbox',
          checked: settingsStore.get()[key] ? '' : undefined,
          'data-key': key,
          onchange: (e: Event) => setField(key, (e.target as HTMLInputElement).checked),
        }),
        el('span', { class: 'settings-toggle-track' }),
      ),
      el('span', { class: 'settings-label', text: label }),
      hint ? el('span', { class: 'settings-hint', text: hint }) : '',
    );

  const section = (title: string, rows: Array<HTMLElement>): HTMLElement =>
    el('div', { class: 'settings-section' },
      el('div', { class: 'settings-section-title', text: title }),
      ...rows);

  // ---- 区域布局（P5）：层/区域选择、平面尺寸、子区域、实体微调、布局预设 ----
  let layoutLayer: LayerId = 'task';
  let layoutZone: ZoneId = 'business';
  let presetName = '';
  const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
  const patchLayout = (fn: (l: LayoutConfig) => LayoutConfig): void => {
    setField('layout', fn(clone(settingsStore.get().layout)));
  };

  const layoutSliderRow = (
    label: string,
    min: number,
    max: number,
    step: number,
    format: (v: number) => string,
    read: () => number,
    write: (v: number) => void,
  ): HTMLElement => {
    const valueEl = el('span', { class: 'settings-value', text: format(read()) });
    return el('div', { class: 'settings-row' },
      el('span', { class: 'settings-label', text: label }),
      el('input', {
        type: 'range',
        min: String(min),
        max: String(max),
        step: String(step),
        value: String(read()),
        oninput: (e: Event) => {
          const v = Number((e.target as HTMLInputElement).value);
          valueEl.textContent = format(v);
          write(v);
        },
      }),
      valueEl,
    );
  };

  const sizeOf = (): ZoneSize => {
    const z = settingsStore.get().layout.zoneSizes[layoutLayer]?.[layoutZone];
    return { w: z?.w ?? 15, d: z?.d ?? 8 };
  };
  const setSize = (patch: Partial<ZoneSize>): void =>
    patchLayout((l) => {
      const layerSizes = l.zoneSizes[layoutLayer] ?? (l.zoneSizes[layoutLayer] = {});
      const cur = layerSizes[layoutZone] ?? { w: 15, d: 8 };
      layerSizes[layoutZone] = { ...cur, ...patch };
      return l;
    });

  const subKey = (kind: string): string => `${layoutLayer}:${layoutZone}:${kind}`;
  const subOf = (kind: string): SubOverride => {
    const s = settingsStore.get().layout.subOverrides[subKey(kind)];
    return { dx: s?.dx ?? 0, dz: s?.dz ?? 0, scale: s?.scale ?? 1, collapsed: s?.collapsed ?? false };
  };
  const patchSub = (kind: string, patch: Partial<SubOverride>): void =>
    patchLayout((l) => {
      const cur = l.subOverrides[subKey(kind)] ?? { dx: 0, dz: 0, scale: 1, collapsed: false };
      l.subOverrides[subKey(kind)] = { ...cur, ...patch };
      return l;
    });

  const layoutSection = (): HTMLElement => {
    const rows: HTMLElement[] = [];
    // 层/区域选择
    rows.push(el('div', { class: 'settings-row' },
      el('span', { class: 'settings-label', text: '层' }),
      el('select', {
        'data-layout-layer': '',
        onchange: (e: Event) => {
          layoutLayer = (e.target as HTMLSelectElement).value as LayerId;
          render();
        },
      },
        el('option', { value: 'device', text: '设备分布层', selected: layoutLayer === 'device' ? '' : undefined }),
        el('option', { value: 'app', text: '应用分布层', selected: layoutLayer === 'app' ? '' : undefined }),
        el('option', { value: 'task', text: '任务分布层', selected: layoutLayer === 'task' ? '' : undefined }),
      ),
      el('span', { class: 'settings-label', text: '区域' }),
      el('select', {
        'data-layout-zone': '',
        onchange: (e: Event) => {
          layoutZone = (e.target as HTMLSelectElement).value as ZoneId;
          render();
        },
      },
        ...ZONES.map((z) => el('option', { value: z, text: ZONE_LABELS[z], selected: layoutZone === z ? '' : undefined })),
      ),
    ));
    // 平面尺寸
    const wRow = layoutSliderRow('平面宽度', 8, 30, 0.5, (v) => v.toFixed(1), () => sizeOf().w, (v) => setSize({ w: v }));
    (wRow.querySelector('input') as HTMLInputElement).setAttribute('data-layout-w', '');
    rows.push(wRow);
    const dRow = layoutSliderRow('平面深度', 4, 60, 0.5, (v) => v.toFixed(1), () => sizeOf().d, (v) => setSize({ d: v }));
    (dRow.querySelector('input') as HTMLInputElement).setAttribute('data-layout-d', '');
    rows.push(dRow);

    // 区域整体配置（P5-4）：位置偏移/配色/透明度覆盖；3D 中点击网/子区域联动切换目标
    const zKey = `${layoutLayer}:${layoutZone}`;
    const zov = settingsStore.get().layout.zoneOverrides[zKey];
    const patchZone = (patch: Partial<ZoneOverride>): void =>
      patchLayout((l) => {
        const cur = l.zoneOverrides[zKey] ?? { dx: 0, dz: 0 };
        l.zoneOverrides[zKey] = { ...cur, ...patch };
        return l;
      });
    rows.push(el('div', { class: 'settings-subtitle', text: `区域整体配置 · ${ZONE_LABELS[layoutZone]}` }));
    const zxRow = layoutSliderRow('　X偏移', -20, 20, 0.5, (v) => v.toFixed(1), () => zov?.dx ?? 0, (v) => patchZone({ dx: v }));
    (zxRow.querySelector('input') as HTMLInputElement).setAttribute('data-zone-dx', '');
    rows.push(zxRow);
    const zzRow = layoutSliderRow('　Z偏移', -20, 20, 0.5, (v) => v.toFixed(1), () => zov?.dz ?? 0, (v) => patchZone({ dz: v }));
    (zzRow.querySelector('input') as HTMLInputElement).setAttribute('data-zone-dz', '');
    rows.push(zzRow);
    rows.push(el('div', { class: 'settings-row' },
      el('span', { class: 'settings-label', text: '　配色' }),
      el('input', {
        type: 'color',
        value: zov?.color ?? ZONE_COLORS[layoutZone],
        'data-zone-color': '',
        oninput: (e: Event) => patchZone({ color: (e.target as HTMLInputElement).value }),
      }),
      el('span', { class: 'settings-hint', text: zov?.color ? '' : '缺省跟随风格样式区域色' }),
    ));
    const zoRow = layoutSliderRow('　透明度', 0, 0.3, 0.01, (v) => v.toFixed(2), () => zov?.opacity ?? settingsStore.get().style.plateOpacity, (v) => patchZone({ opacity: v }));
    (zoRow.querySelector('input') as HTMLInputElement).setAttribute('data-zone-opacity', '');
    rows.push(zoRow);
    rows.push(el('div', { class: 'settings-row' },
      el('span', { class: 'settings-label', text: '　' }),
      el('button', {
        class: 'btn small',
        text: '清除本区域覆盖',
        'data-zone-reset': '',
        onclick: () => {
          patchLayout((l) => {
            delete l.zoneOverrides[zKey];
            return l;
          });
          render();
        },
      }),
      el('span', { class: 'settings-hint', text: '在 3D 中点击网/子区域可切换配置目标' }),
    ));

    // 子区域（密集区按类型分组的带）：折叠 + 位置/尺寸微调
    for (const sub of deps.subsOf?.(layoutLayer, layoutZone) ?? []) {
      const s = subOf(sub.kind);
      rows.push(el('div', { class: 'settings-row settings-subrow' },
        el('label', { class: 'settings-toggle', title: `折叠「${sub.label}」` },
          el('input', {
            type: 'checkbox',
            checked: s.collapsed ? '' : undefined,
            'data-sub-collapse': sub.kind,
            onchange: (e: Event) => patchSub(sub.kind, { collapsed: (e.target as HTMLInputElement).checked }),
          }),
          el('span', { class: 'settings-toggle-track' }),
        ),
        el('span', { class: 'settings-label', text: `子区域 · ${sub.label}` }),
      ));
      rows.push(layoutSliderRow(`　${sub.label} X偏移`, -6, 6, 0.1, (v) => v.toFixed(1), () => subOf(sub.kind).dx, (v) => patchSub(sub.kind, { dx: v })));
      rows.push(layoutSliderRow(`　${sub.label} Z偏移`, -6, 6, 0.1, (v) => v.toFixed(1), () => subOf(sub.kind).dz, (v) => patchSub(sub.kind, { dz: v })));
      rows.push(layoutSliderRow(`　${sub.label} 缩放`, 0.5, 1.5, 0.05, (v) => `×${v.toFixed(2)}`, () => subOf(sub.kind).scale, (v) => patchSub(sub.kind, { scale: v })));
    }

    // 选中实体微调
    const sel = appStore.get().selection;
    if (sel?.kind === 'entity') {
      const name = deps.entityNameOf?.(sel.id) ?? sel.id;
      const patchEntity = (patch: Partial<{ dx: number; dz: number; scale: number }>): void =>
        patchLayout((l) => {
          const cur = l.entityOverrides[sel.id] ?? { dx: 0, dz: 0, scale: 1 };
          l.entityOverrides[sel.id] = { ...cur, ...patch };
          return l;
        });
      rows.push(el('div', { class: 'settings-subtitle', text: `选中实体微调 · ${name}` }));
      rows.push(layoutSliderRow('　X偏移', -10, 10, 0.1, (v) => v.toFixed(1), () => (settingsStore.get().layout.entityOverrides[sel.id] ?? { dx: 0, dz: 0, scale: 1 }).dx, (v) => patchEntity({ dx: v })));
      rows.push(layoutSliderRow('　Z偏移', -10, 10, 0.1, (v) => v.toFixed(1), () => (settingsStore.get().layout.entityOverrides[sel.id] ?? { dx: 0, dz: 0, scale: 1 }).dz, (v) => patchEntity({ dz: v })));
      rows.push(layoutSliderRow('　缩放', 0.3, 3, 0.05, (v) => `×${v.toFixed(2)}`, () => (settingsStore.get().layout.entityOverrides[sel.id] ?? { dx: 0, dz: 0, scale: 1 }).scale, (v) => patchEntity({ scale: v })));
    } else {
      rows.push(el('div', { class: 'settings-hint-row', text: '在 3D 场景中选中实体后，可在此单独微调其位置与大小。' }));
    }

    // 布局预设：保存/选择/应用/删除
    const presets = settingsStore.get().layoutPresets;
    const active = settingsStore.get().activeLayoutName;
    rows.push(el('div', { class: 'settings-subtitle', text: '布局预设（保存/应用命名区域布局）' }));
    rows.push(el('div', { class: 'settings-row' },
      el('input', {
        type: 'text',
        class: 'settings-input',
        placeholder: '布局名称',
        value: presetName,
        'data-preset-name': '',
        oninput: (e: Event) => {
          presetName = (e.target as HTMLInputElement).value;
        },
      }),
      el('button', {
        class: 'btn small',
        text: '保存当前布局',
        onclick: () => {
          const name = presetName.trim();
          if (!name) return;
          const config = clone(settingsStore.get().layout);
          setField('layoutPresets', [...presets.filter((p) => p.name !== name), { name, config }]);
          setField('activeLayoutName', name);
          presetName = '';
          render();
        },
      }),
    ));
    if (presets.length > 0) {
      rows.push(el('div', { class: 'settings-row' },
        el('select', {
          'data-preset-select': '',
          onchange: (e: Event) => {
            presetName = (e.target as HTMLSelectElement).value;
          },
        },
          ...presets.map((p) =>
            el('option', { value: p.name, text: p.name + (p.name === active ? '（当前）' : ''), selected: p.name === active ? '' : undefined }),
          ),
        ),
        el('button', {
          class: 'btn small',
          text: '应用',
          'data-preset-apply': '',
          onclick: () => {
            const name = presetName || presets[0]?.name;
            const preset = presets.find((p) => p.name === name);
            if (!preset) return;
            setField('layout', clone(preset.config));
            setField('activeLayoutName', preset.name);
            render();
          },
        }),
        el('button', {
          class: 'btn small danger',
          text: '删除',
          onclick: () => {
            const name = presetName || presets[0]?.name;
            if (!name) return;
            setField('layoutPresets', presets.filter((p) => p.name !== name));
            if (settingsStore.get().activeLayoutName === name) setField('activeLayoutName', '');
            presetName = '';
            render();
          },
        }),
      ));
    }
    return section('区域布局', rows);
  };

  // ---- 风格样式（P6）：模板选择/应用 + 保存当前样式/删除（配色定制见 docs/06） ----
  let styleName = '';
  const styleSection = (): HTMLElement => {
    const presets = settingsStore.get().stylePresets;
    const active = settingsStore.get().activeStyleName;
    const options = [...BUILTIN_STYLES, ...presets];
    const rows: HTMLElement[] = [];
    rows.push(el('div', { class: 'settings-row' },
      el('span', { class: 'settings-label', text: '样式模板' }),
      el('select', {
        'data-style-select': '',
        onchange: (e: Event) => {
          styleName = (e.target as HTMLSelectElement).value;
        },
      },
        ...options.map((p) =>
          el('option', {
            value: p.name,
            text: p.name + (p.name === active ? '（当前）' : ''),
            selected: p.name === active ? '' : undefined,
          }),
        ),
      ),
    ));
    rows.push(el('div', { class: 'settings-row' },
      el('button', {
        class: 'btn small',
        text: '应用',
        'data-style-apply': '',
        onclick: () => {
          const name = styleName || options[0]?.name;
          const preset = options.find((p) => p.name === name);
          if (!preset) return;
          setField('style', JSON.parse(JSON.stringify(preset.style)) as DisplaySettings['style']);
          setField('activeStyleName', preset.name);
          render();
        },
      }),
      el('span', { class: 'settings-hint', text: '内置主题与保存的模板；配色定制方法见 docs/06' }),
    ));
    rows.push(el('div', { class: 'settings-row' },
      el('input', {
        type: 'text',
        class: 'settings-input',
        placeholder: '样式名称',
        value: styleName,
        'data-style-name': '',
        oninput: (e: Event) => {
          styleName = (e.target as HTMLInputElement).value;
        },
      }),
      el('button', {
        class: 'btn small',
        text: '保存当前样式',
        'data-style-save': '',
        onclick: () => {
          const name = styleName.trim();
          if (!name) return;
          const style = JSON.parse(JSON.stringify(settingsStore.get().style)) as DisplaySettings['style'];
          setField('stylePresets', [...presets.filter((p) => p.name !== name), { name, style }]);
          setField('activeStyleName', name);
          styleName = '';
          render();
        },
      }),
    ));
    if (presets.length > 0) {
      rows.push(el('div', { class: 'settings-row' },
        el('button', {
          class: 'btn small danger',
          text: '删除选中样式',
          'data-style-delete': '',
          onclick: () => {
            const name = styleName || presets[0]?.name;
            if (!name) return;
            setField('stylePresets', presets.filter((p) => p.name !== name));
            if (settingsStore.get().activeStyleName === name) setField('activeStyleName', '');
            styleName = '';
            render();
          },
        }),
        el('span', { class: 'settings-hint', text: '仅可删除保存的模板；内置主题不可删' }),
      ));
    }
    return section('风格样式', rows);
  };

  // ---- tab 内容 ----
  const displayBody = (): HTMLElement[] => [
    section('告警发光特效', [
      toggleRow('开启告警发光特效', 'alertFxOn', '光晕/扩散环/发光点'),
      sliderRow('光晕范围', 'alertGlowScale', 0.4, 4, 0.05, (v) => `×${v.toFixed(2)}`),
      sliderRow('光晕强度', 'alertGlowIntensity', 0, 4, 0.05, (v) => `×${v.toFixed(2)}`),
      toggleRow('实体告警着色', 'alertTintOn', '实体按告警级别染色'),
    ]),
    section('泛光（Bloom）', [
      toggleRow('开启泛光', 'bloomOn', deps.bloomSupported ? '' : '软渲染环境强制禁用'),
      sliderRow('强度', 'bloomStrength', 0, 0.005, 0.0001, (v) => v.toFixed(4)),
      sliderRow('半径', 'bloomRadius', 0, 1, 0.05, (v) => v.toFixed(2)),
      sliderRow('阈值', 'bloomThreshold', 0, 1, 0.05, (v) => v.toFixed(2)),
    ]),
    section('连线', [
      sliderRow('最小像素宽', 'edgeMinPx', 0.6, 2.4, 0.05, (v) => `${v.toFixed(2)}px`),
      toggleRow('流动动画', 'edgeFlowOn', '控制/告警虚线流动'),
      toggleRow('关键连线脉冲', 'edgePulseOn', '重要控制边宽度呼吸'),
    ]),
    section('视角控制', [
      sliderRow('聚焦俯仰角', 'focusPitchDeg', 15, 85, 1, (v) => `${v.toFixed(0)}°`),
      sliderRow('视角步进角度', 'cameraAngleStepDeg', 1, 15, 1, (v) => `${v.toFixed(0)}°`),
      sliderRow('移动步进', 'cameraMoveStep', 0.5, 20, 0.5, (v) => v.toFixed(1)),
      el('div', {
        class: 'settings-hint-row',
        text: '聚焦某层后：J/K 压向/抬离平面，H/L 左右扭头，W/A/S/D 平移，Q/E 升降。',
      }),
    ]),
    styleSection(),
    section('标签', [toggleRow('显示实体标签', 'labelsOn')]),
  ];

  const layoutBody = (): HTMLElement[] => [
    section('地图布局', [
      el('div', { class: 'settings-row' },
        el('span', { class: 'settings-label', text: '布局' }),
        el('select', {
          'data-map-layout': '',
          onchange: (e: Event) => setField('mapLayout', (e.target as HTMLSelectElement).value as MapLayoutId),
        },
          ...(Object.entries(MAP_LAYOUT_LABELS) as Array<[MapLayoutId, string]>).map(([id, label]) =>
            el('option', { value: id, text: label, selected: settingsStore.get().mapLayout === id ? '' : undefined }),
          ),
        ),
      ),
      el('div', {
        class: 'settings-hint-row',
        text: 'A 布局以中国为中心（美洲平移至中国以东）；切换后世界轮廓与地域实体同步重投影。',
      }),
    ]),
    section('层间分离', [
      sliderRow('分离距离', 'focusSeparation', 0, 100, 0.5, (v) => v.toFixed(1)),
    ]),
    layoutSection(),
  ];

  const demoBody = (): HTMLElement[] => {
    const state = appStore.get();
    const rows: HTMLElement[] = [];
    rows.push(el('div', { class: 'settings-row' },
      el('span', { class: 'settings-label', text: '剧本' }),
      el('select', {
        'data-demo-scenario': '',
        onchange: (e: Event) => setScenario((e.target as HTMLSelectElement).value || null),
      },
        el('option', { value: '', text: '无（环境噪声）', selected: state.scenarioId === null ? '' : undefined }),
        ...dataset.scenarios.map((s) =>
          el('option', { value: s.id, text: s.name, selected: state.scenarioId === s.id ? '' : undefined }),
        ),
      ),
    ));
    rows.push(el('div', { class: 'settings-row' },
      el('span', { class: 'settings-label', text: '倍速' }),
      el('select', {
        'data-demo-speed': '',
        disabled: state.paused ? '' : undefined,
        onchange: (e: Event) => {
          store.engine.speed = Number((e.target as HTMLSelectElement).value);
          appStore.set({ paused: false });
        },
      },
        ...['0.5', '1', '2', '4'].map((v) =>
          el('option', {
            value: v,
            text: `${v}×`,
            selected: !state.paused && store.engine.speed === Number(v) ? '' : undefined,
          }),
        ),
      ),
    ));
    rows.push(el('div', { class: 'settings-row' },
      el('label', { class: 'settings-toggle', title: '暂停仿真' },
        el('input', {
          type: 'checkbox',
          checked: state.paused ? '' : undefined,
          'data-demo-pause': '',
          onchange: (e: Event) => {
            const paused = (e.target as HTMLInputElement).checked;
            store.engine.speed = paused ? 0 : 1;
            appStore.set({ paused });
          },
        }),
        el('span', { class: 'settings-toggle-track' }),
      ),
      el('span', { class: 'settings-label', text: '暂停仿真' }),
    ));
    if (startTour) {
      rows.push(el('div', { class: 'settings-row' },
        el('button', { class: 'btn small', text: '▶ 一键演示导览', 'data-demo-tour': '', onclick: () => startTour() }),
      ));
    }
    rows.push(el('div', { class: 'settings-row' },
      el('span', { class: 'settings-label', text: '层间关联' }),
      el('select', {
        'data-demo-crosslinks': '',
        onchange: (e: Event) => {
          const mode = (e.target as HTMLSelectElement).value as CrossLinksMode;
          let crossLinks: CrossLinksState;
          if (mode === 'pair') crossLinks = { mode, pair: state.crossLinks.pair ?? ['device', 'app'] };
          else if (mode === 'entity' && state.selection?.kind === 'entity') crossLinks = { mode, entityId: state.selection.id };
          else crossLinks = { mode };
          appStore.set({ crossLinks });
        },
      },
        ...CROSS_MODES.map((m) =>
          el('option', { value: m.id, text: m.label, selected: state.crossLinks.mode === m.id ? '' : undefined }),
        ),
      ),
    ));
    if (state.crossLinks.mode === 'pair') {
      const pair = state.crossLinks.pair ?? (['device', 'app'] as [LayerId, LayerId]);
      const layerOptions = (['geo', 'device', 'app', 'task'] as const).map((id) => ({ id, label: ({ geo: '地域层', device: '设备层', app: '应用层', task: '任务层' })[id] }));
      const make = (idx: 0 | 1): HTMLSelectElement =>
        el('select', {
          'data-demo-pair-a': idx === 0 ? '' : undefined,
          'data-demo-pair-b': idx === 1 ? '' : undefined,
          onchange: (e: Event) => {
            const next = [...pair] as [LayerId, LayerId];
            next[idx] = (e.target as HTMLSelectElement).value as LayerId;
            appStore.set({ crossLinks: { mode: 'pair', pair: next } });
          },
        },
          ...layerOptions.map((l) => el('option', { value: l.id, text: l.label, selected: pair[idx] === l.id ? '' : undefined })),
        );
      rows.push(el('div', { class: 'settings-row' },
        el('span', { class: 'settings-label', text: '层对' }),
        make(0),
        el('span', { class: 'settings-value', text: '↔' }),
        make(1),
      ));
    }
    rows.push(el('div', {
      class: 'settings-hint-row',
      text: '剧本按时间轴注入告警与提示/工单消息；提示消息在左侧动态消息窗体滚动弹出。',
    }));
    return [section('演示控制', rows)];
  };

  const tabBar = (tab: TabId): HTMLElement =>
    el('div', { class: 'settings-tabs' },
      ...(Object.keys(TAB_LABELS) as TabId[]).map((t) =>
        el('button', {
          class: `settings-tab${t === tab ? ' active' : ''}`,
          'data-settings-tab': t,
          text: TAB_LABELS[t],
          onclick: () => appStore.set({ settingsTab: t }),
        }),
      ),
    );

  const render = (): void => {
    clear(root);
    const tab = appStore.get().settingsTab;
    root.append(
      el('div', { class: 'panel-title' },
        el('span', { text: '设置' }),
        el('button', {
          class: 'close-btn',
          title: '关闭',
          text: '✕',
          onclick: () => appStore.set({ settingsOpen: false }),
        }),
      ),
      tabBar(tab),
      el('div', { class: 'settings-body' },
        ...(tab === 'display' ? displayBody() : tab === 'layout' ? layoutBody() : demoBody()),
      ),
      el('div', { class: 'settings-footer' },
        el('button', {
          class: 'btn small',
          text: '恢复默认',
          onclick: () => {
            settingsStore.reset();
            render();
          },
        }),
      ),
    );
  };

  // 打开/关闭、tab 切换、选中实体变化、演示状态（剧本/暂停/层间关联）变化时重绘。
  // 滑块等控件写入 settingsStore（不触发 AppStore 通知），拖动过程不会被重绘打断。
  let lastOpen = appStore.get().settingsOpen;
  let lastTab = appStore.get().settingsTab;
  let lastSelection = appStore.get().selection;
  let lastScenario = appStore.get().scenarioId;
  let lastPaused = appStore.get().paused;
  let lastCross = appStore.get().crossLinks;
  let lastTarget = appStore.get().layoutTarget;
  root.classList.toggle('hidden', !lastOpen);
  const unsubApp = appStore.subscribe((state) => {
    // 布局设置 tab 的 3D 联动（P5-4）：点击网/子区域 → 切换层/区域配置目标
    const targetChanged = state.layoutTarget !== lastTarget;
    if (targetChanged) {
      lastTarget = state.layoutTarget;
      if (state.layoutTarget) {
        layoutLayer = state.layoutTarget.layer;
        layoutZone = state.layoutTarget.zone;
      }
    }
    if (
      !targetChanged &&
      state.settingsOpen === lastOpen &&
      state.settingsTab === lastTab &&
      state.selection === lastSelection &&
      state.scenarioId === lastScenario &&
      state.paused === lastPaused &&
      state.crossLinks === lastCross
    ) {
      return;
    }
    lastOpen = state.settingsOpen;
    lastTab = state.settingsTab;
    lastSelection = state.selection;
    lastScenario = state.scenarioId;
    lastPaused = state.paused;
    lastCross = state.crossLinks;
    root.classList.toggle('hidden', !state.settingsOpen);
    if (state.settingsOpen) render();
  });

  return {
    toggle: () => appStore.set({ settingsOpen: !appStore.get().settingsOpen }),
    dispose: () => unsubApp(),
  };
}
