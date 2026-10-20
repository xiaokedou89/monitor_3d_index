/**
 * 显示参数设置：默认值 + 运行时归一化 + 可持久化 Store。
 * 与 AppStore（视图状态）分离：显示参数是"渲染配置"而非视图状态，
 * 滑块拖动高频变化时不触发 HUD 等 AppStore 订阅者的整树重渲染。
 * 持久化到 localStorage（键 STORAGE_KEY），读取时逐字段归一化回退默认。
 *
 * P5 区域布局：layout（区域平面尺寸/子区域与实体微调/折叠状态）+ layoutPresets（命名布局预设）。
 * 区域尺寸默认值由 EntityIndex 首轮天然布局计算（initialLayout），保证"默认视觉 = 未配置视觉"。
 * P6 风格样式：style（背景/雾/分区底板/地图配色）+ stylePresets（命名样式模板，
 * 内置 4 主题 + 用户保存），由 view-sync 应用到场景/地图/区域板材质。
 */
import type { LayerId, ZoneId } from '../../shared/types';
import { ZONES } from '../../shared/types';
import type { MapLayoutId } from '../../shared/geo';

export interface DisplaySettings {
  /** 告警发光特效总开关（光晕四边形/扩散环/发光点） */
  alertFxOn: boolean;
  /** 光晕范围倍率（0.4–4.0，1.0 = 默认基线） */
  alertGlowScale: number;
  /** 光晕强度倍率（0–4.0，1.0 = 默认基线） */
  alertGlowIntensity: number;
  /** 告警实体着色（实体按告警级别染色） */
  alertTintOn: boolean;
  /** 泛光 bloom 开关（软渲染环境强制禁用，仅保留意图） */
  bloomOn: boolean;
  /** bloom 强度（0–0.005，细粒度可调，默认 0.0011） */
  bloomStrength: number;
  /** bloom 半径（0–1.0） */
  bloomRadius: number;
  /** bloom 亮度阈值（0–1.0） */
  bloomThreshold: number;
  /** 连线最小像素宽（0.6–2.4px，视觉与拾取材质共用） */
  edgeMinPx: number;
  /** 连线流动动画（控制/告警虚线流动） */
  edgeFlowOn: boolean;
  /** 关键控制连线宽度脉冲 */
  edgePulseOn: boolean;
  /** 层间分离距离（聚焦某层时，上方各层上移、下方各层下移的垂直距离，0–100 世界单位） */
  focusSeparation: number;
  /** 聚焦视角俯仰角：聚焦某层时视线与层平面的夹角（15–80°，默认 45°） */
  focusPitchDeg: number;
  /** 键盘视角步进：J/K 夹角、H/L 扭头的每键角度（1–15°，默认 3°） */
  cameraAngleStepDeg: number;
  /** 键盘移动步进：WASD/QE 视点平移的每键世界单位（0.5–20，默认 2） */
  cameraMoveStep: number;
  /** 世界地图展示布局：A 以中国为中心（美洲平移至右侧）/ B 线性经纬度（现状） */
  mapLayout: MapLayoutId;
  /** 实体/地标标签显示 */
  labelsOn: boolean;
  /** 区域布局配置（平面尺寸/子区域与实体微调/折叠） */
  layout: LayoutConfig;
  /** 已保存的命名布局预设 */
  layoutPresets: LayoutPreset[];
  /** 当前应用的布局预设名（'' = 未命名/自定义） */
  activeLayoutName: string;
  /** 风格样式（配色）配置 */
  style: StyleConfig;
  /** 已保存的命名样式模板 */
  stylePresets: StylePreset[];
  /** 当前应用的样式模板名（'' = 未命名/自定义） */
  activeStyleName: string;
}

/** 区域平面尺寸（宽 w 8–30 / 深 d 4–60，世界单位；d 含 1.6 边距） */
export interface ZoneSize {
  w: number;
  d: number;
}

/** 位置/尺寸微调（偏移世界单位，缩放倍率） */
export interface PositionOverride {
  dx: number;
  dz: number;
  scale: number;
}

/** 子区域微调（叠加 PositionOverride + 折叠开关） */
export interface SubOverride extends PositionOverride {
  collapsed: boolean;
}

/** 区域整体覆盖（P5：网层区域整体偏移 + 配色/透明度，key = `${layer}:${zone}`） */
export interface ZoneOverride {
  /** 区域整体水平/纵向偏移（世界单位，±20） */
  dx: number;
  dz: number;
  /** 区域底板基色覆盖（#rrggbb，可选；缺省跟随风格样式） */
  color?: string;
  /** 区域底板不透明度覆盖（0–0.3，可选；缺省跟随风格样式） */
  opacity?: number;
}

/** 区域布局配置 */
export interface LayoutConfig {
  zoneSizes: Partial<Record<LayerId, Partial<Record<ZoneId, ZoneSize>>>>;
  entityOverrides: Record<string, PositionOverride>;
  subOverrides: Record<string, SubOverride>;
  zoneOverrides: Record<string, ZoneOverride>;
}

/** 命名布局预设 */
export interface LayoutPreset {
  name: string;
  config: LayoutConfig;
}

/** 风格样式（配色）：背景/雾/分区底板/地图，全部十六进制色 */
export interface StyleConfig {
  /** 分区底板基色（plateZoneTint=false 时全部分区统一用此色） */
  plateColor: string;
  /** 分区底板不透明度（0–0.3） */
  plateOpacity: number;
  /** 分区底板是否按区域色着色（true 时 plateColor 仅作兜底） */
  plateZoneTint: boolean;
  /** 地图省面顶色基调（与逐省顶点色乘算） */
  mapTopTint: string;
  /** 地图省界/十段线/南海附图框颜色 */
  mapBorder: string;
  /** 地图侧壁/世界轮廓/南海附图填充颜色 */
  mapWall: string;
  /** 场景背景与雾颜色 */
  bgColor: string;
}

/** 命名样式模板 */
export interface StylePreset {
  name: string;
  style: StyleConfig;
}

/** 内置样式模板（风格样式下拉列表固定项；用户保存的模板同列表展示） */
export const BUILTIN_STYLES: StylePreset[] = [
  {
    name: '深空科技（默认）',
    style: {
      plateColor: '#3b82f6',
      plateOpacity: 0.05,
      plateZoneTint: true,
      mapTopTint: '#ffffff',
      mapBorder: '#2b6cb0',
      mapWall: '#0a1a33',
      bgColor: '#040b18',
    },
  },
  {
    name: '青蓝冰川',
    style: {
      plateColor: '#22d3ee',
      plateOpacity: 0.06,
      plateZoneTint: true,
      mapTopTint: '#cdeffa',
      mapBorder: '#38e0f5',
      mapWall: '#08365a',
      bgColor: '#04121f',
    },
  },
  {
    name: '琥珀暖阳',
    style: {
      plateColor: '#f5b93b',
      plateOpacity: 0.05,
      plateZoneTint: true,
      mapTopTint: '#f7e6c4',
      mapBorder: '#c98a1f',
      mapWall: '#2a1c0a',
      bgColor: '#140d04',
    },
  },
  {
    name: '素净灰阶',
    style: {
      plateColor: '#94a3b8',
      plateOpacity: 0.05,
      plateZoneTint: false,
      mapTopTint: '#cfd8e3',
      mapBorder: '#475569',
      mapWall: '#1a1e24',
      bgColor: '#0b0d10',
    },
  },
];

/** 静态兜底布局（运行时用 EntityIndex 初始布局替代，见 loadDisplaySettings） */
const STATIC_LAYOUT: LayoutConfig = {
  zoneSizes: {
    device: { enterprise: { w: 15, d: 8 }, business: { w: 15, d: 8 }, 'cn-public': { w: 15, d: 8 }, 'global-public': { w: 15, d: 8 } },
    app: { enterprise: { w: 15, d: 8 }, business: { w: 15, d: 8 }, 'cn-public': { w: 15, d: 8 }, 'global-public': { w: 15, d: 8 } },
    task: { enterprise: { w: 15, d: 8 }, business: { w: 15, d: 8 }, 'cn-public': { w: 15, d: 8 }, 'global-public': { w: 15, d: 8 } },
  },
  entityOverrides: {},
  subOverrides: {},
  zoneOverrides: {},
};

export const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = {
  alertFxOn: true,
  alertGlowScale: 1,
  alertGlowIntensity: 1,
  alertTintOn: true,
  bloomOn: true,
  bloomStrength: 0.0011,
  bloomRadius: 0.55,
  bloomThreshold: 0.82,
  edgeMinPx: 1.2,
  edgeFlowOn: true,
  edgePulseOn: true,
  focusSeparation: 10,
  focusPitchDeg: 45,
  cameraAngleStepDeg: 3,
  cameraMoveStep: 2,
  mapLayout: 'china-centered',
  labelsOn: true,
  layout: STATIC_LAYOUT,
  layoutPresets: [],
  activeLayoutName: '',
  style: BUILTIN_STYLES[0]!.style,
  stylePresets: [],
  activeStyleName: '',
};

const STORAGE_KEY = 'mc3d.display-settings.v1';

const num = (v: unknown, min: number, max: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
const obj = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};

const sanitizePosition = (v: unknown): PositionOverride => {
  const o = obj(v);
  return {
    dx: num(o.dx, -20, 20, 0),
    dz: num(o.dz, -20, 20, 0),
    scale: num(o.scale, 0.3, 3, 1),
  };
};

const sanitizeSub = (v: unknown): SubOverride => ({
  ...sanitizePosition(v),
  collapsed: bool(obj(v).collapsed, false),
});

const cloneLayout = (l: LayoutConfig): LayoutConfig => JSON.parse(JSON.stringify(l)) as LayoutConfig;

const hex = (v: unknown, fallback: string): string =>
  typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : fallback;

/** 风格样式归一化：颜色必须为 #rrggbb，透明度钳制 0–0.3 */
function sanitizeStyle(raw: unknown, fallback: StyleConfig): StyleConfig {
  const src = obj(raw);
  return {
    plateColor: hex(src.plateColor, fallback.plateColor),
    plateOpacity: num(src.plateOpacity, 0, 0.3, fallback.plateOpacity),
    plateZoneTint: bool(src.plateZoneTint, fallback.plateZoneTint),
    mapTopTint: hex(src.mapTopTint, fallback.mapTopTint),
    mapBorder: hex(src.mapBorder, fallback.mapBorder),
    mapWall: hex(src.mapWall, fallback.mapWall),
    bgColor: hex(src.bgColor, fallback.bgColor),
  };
}

/** 布局配置归一化：逐区域/逐条目钳制，缺失回退 fallback（运行时=初始天然布局） */
function sanitizeLayout(raw: unknown, fallback: LayoutConfig): LayoutConfig {
  const src = obj(raw);
  const srcSizes = obj(src.zoneSizes);
  const zoneSizes: LayoutConfig['zoneSizes'] = {};
  for (const layer of ['device', 'app', 'task'] as const) {
    zoneSizes[layer] = {};
    const srcLayer = obj(srcSizes[layer]);
    const fbLayer = obj(fallback.zoneSizes?.[layer]);
    for (const zone of ZONES) {
      const fb = obj(fbLayer[zone]);
      const v = obj(srcLayer[zone]);
      zoneSizes[layer]![zone] = {
        w: num(v.w, 8, 30, num(fb.w, 8, 30, 15)),
        d: num(v.d, 4, 60, num(fb.d, 4, 60, 8)),
      };
    }
  }
  const entityOverrides: Record<string, PositionOverride> = {};
  for (const [id, v] of Object.entries(obj(src.entityOverrides))) {
    entityOverrides[id] = sanitizePosition(v);
  }
  const subOverrides: Record<string, SubOverride> = {};
  for (const [key, v] of Object.entries(obj(src.subOverrides))) {
    subOverrides[key] = sanitizeSub(v);
  }
  const zoneOverrides: Record<string, ZoneOverride> = {};
  for (const [key, v] of Object.entries(obj(src.zoneOverrides))) {
    const o = obj(v);
    const out: ZoneOverride = {
      dx: num(o.dx, -20, 20, 0),
      dz: num(o.dz, -20, 20, 0),
    };
    if (typeof o.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(o.color)) out.color = o.color;
    if (typeof o.opacity === 'number' && Number.isFinite(o.opacity)) {
      out.opacity = Math.min(0.3, Math.max(0, o.opacity));
    }
    zoneOverrides[key] = out;
  }
  return { zoneSizes, entityOverrides, subOverrides, zoneOverrides };
}

/**
 * 逐字段归一化：数值钳制到合法区间（滑块极值），非法类型/缺失字段回退默认。
 * 保证 localStorage 被手工篡改或旧版本残留数据不会破坏渲染。
 * @param fallbackLayout 区域尺寸回退基准（运行时传入 EntityIndex 初始天然布局）
 */
export function normalizeDisplaySettings(raw: unknown, fallbackLayout: LayoutConfig = STATIC_LAYOUT): DisplaySettings {
  const src = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_DISPLAY_SETTINGS;
  const presetsRaw = Array.isArray(src.layoutPresets) ? src.layoutPresets : [];
  const layoutPresets: LayoutPreset[] = [];
  for (const p of presetsRaw) {
    const po = obj(p);
    const name = typeof po.name === 'string' ? po.name.trim() : '';
    if (!name || layoutPresets.length >= 20) continue;
    layoutPresets.push({ name, config: sanitizeLayout(po.config, fallbackLayout) });
  }
  const stylePresetsRaw = Array.isArray(src.stylePresets) ? src.stylePresets : [];
  const stylePresets: StylePreset[] = [];
  for (const p of stylePresetsRaw) {
    const po = obj(p);
    const name = typeof po.name === 'string' ? po.name.trim() : '';
    if (!name || stylePresets.length >= 20) continue;
    stylePresets.push({ name, style: sanitizeStyle(po.style, d.style) });
  }
  return {
    alertFxOn: bool(src.alertFxOn, d.alertFxOn),
    alertGlowScale: num(src.alertGlowScale, 0.4, 4, d.alertGlowScale),
    alertGlowIntensity: num(src.alertGlowIntensity, 0, 4, d.alertGlowIntensity),
    alertTintOn: bool(src.alertTintOn, d.alertTintOn),
    bloomOn: bool(src.bloomOn, d.bloomOn),
    bloomStrength: num(src.bloomStrength, 0, 0.005, d.bloomStrength),
    bloomRadius: num(src.bloomRadius, 0, 1, d.bloomRadius),
    bloomThreshold: num(src.bloomThreshold, 0, 1, d.bloomThreshold),
    edgeMinPx: num(src.edgeMinPx, 0.6, 2.4, d.edgeMinPx),
    edgeFlowOn: bool(src.edgeFlowOn, d.edgeFlowOn),
    edgePulseOn: bool(src.edgePulseOn, d.edgePulseOn),
    focusSeparation: num(src.focusSeparation, 0, 100, d.focusSeparation),
    focusPitchDeg: num(src.focusPitchDeg, 15, 80, d.focusPitchDeg),
    cameraAngleStepDeg: num(src.cameraAngleStepDeg, 1, 15, d.cameraAngleStepDeg),
    cameraMoveStep: num(src.cameraMoveStep, 0.5, 20, d.cameraMoveStep),
    mapLayout: src.mapLayout === 'china-centered' || src.mapLayout === 'linear' ? src.mapLayout : d.mapLayout,
    labelsOn: bool(src.labelsOn, d.labelsOn),
    layout: sanitizeLayout(src.layout, fallbackLayout),
    layoutPresets,
    activeLayoutName: typeof src.activeLayoutName === 'string' ? src.activeLayoutName : '',
    style: sanitizeStyle(src.style, d.style),
    stylePresets,
    activeStyleName: typeof src.activeStyleName === 'string' ? src.activeStyleName : '',
  };
}

/** 存储后端抽象（Node 单测注入 fake；浏览器默认 localStorage） */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function browserStorage(): StorageLike | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null; // 隐私模式/被禁用时静默退化为仅内存
  }
}

export function loadDisplaySettings(
  storage: StorageLike | null = browserStorage(),
  fallbackLayout: LayoutConfig = STATIC_LAYOUT,
): DisplaySettings {
  const defaults = (): DisplaySettings => ({
    ...DEFAULT_DISPLAY_SETTINGS,
    layout: cloneLayout(fallbackLayout),
  });
  if (!storage) return defaults();
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null) return defaults();
    return normalizeDisplaySettings(JSON.parse(raw) as unknown, fallbackLayout);
  } catch {
    return defaults(); // 坏 JSON 回退默认，不让启动崩掉
  }
}

/**
 * 显示参数 Store：浅合并 + 逐键比较（同 AppStore 模式），set 即持久化。
 * 消费方：view-sync（渲染管线实时应用）、settings-panel（控件读写）。
 */
export class DisplaySettingsStore {
  private state: DisplaySettings;
  private listeners = new Set<(state: DisplaySettings) => void>();

  constructor(
    private readonly storage: StorageLike | null = browserStorage(),
    private readonly fallbackLayout: LayoutConfig = STATIC_LAYOUT,
  ) {
    this.state = loadDisplaySettings(storage, fallbackLayout);
  }

  get(): DisplaySettings {
    return this.state;
  }

  set(patch: Partial<DisplaySettings>): void {
    let changed = false;
    const next: DisplaySettings = { ...this.state };
    for (const key of Object.keys(patch) as Array<keyof DisplaySettings>) {
      const value = patch[key];
      if (value === undefined) continue;
      if (this.state[key] === value) continue;
      next[key] = value as never;
      changed = true;
    }
    if (!changed) return;
    this.state = next;
    this.persist();
    for (const cb of this.listeners) cb(this.state);
  }

  /** 恢复显示参数默认并持久化（区域尺寸回到初始天然布局、样式回默认主题）；
   * 用户命名的布局预设/样式模板属用户数据，恢复默认不清除（仅解除当前活跃项）。 */
  reset(): void {
    const next = {
      ...DEFAULT_DISPLAY_SETTINGS,
      layout: cloneLayout(this.fallbackLayout),
      layoutPresets: this.state.layoutPresets,
      activeLayoutName: '',
      stylePresets: this.state.stylePresets,
      activeStyleName: '',
    };
    const changed = JSON.stringify(next) !== JSON.stringify(this.state);
    this.state = next;
    this.persist();
    if (changed) for (const cb of this.listeners) cb(this.state);
  }

  subscribe(cb: (state: DisplaySettings) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // 存储满/被禁用：功能不受影响，仅失去持久化
    }
  }
}
