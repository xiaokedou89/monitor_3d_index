/**
 * AppStore：视图状态单一事实来源（与 LiveStore 分工：
 * LiveStore 管"世界状态"，AppStore 管"视图状态"）。
 * 浅合并 + 逐键比较，仅在真正变化时通知（防止渲染循环抖动）。
 */
import type { AlertCategory, LayerId, ZoneId } from '../../shared/types';
import type { RegionId } from '../../shared/regions';

export type CrossLinksMode = 'none' | 'pair' | 'all' | 'entity';

export interface CrossLinksState {
  mode: CrossLinksMode;
  /** mode=pair 时关注的层对 */
  pair?: [LayerId, LayerId];
  /** mode=entity 时关注的实体 */
  entityId?: string;
}

/** 区域对象标识（P5）见 shared/regions：层/网/子区域与全局一样可被选中，作为"区域实体"查看详情 */
export type { RegionId } from '../../shared/regions';

/** 选中对象：实体 / 连线 / 区域（全局/层/网/子区域） */
export type Selection =
  | { kind: 'entity'; id: string }
  | { kind: 'relation'; id: string }
  | { kind: 'region'; region: RegionId }
  | null;

/** 动态消息窗体模式：实时弹出 / 某类历史列表 / 已关闭 */
export type MessageMode =
  | { mode: 'live' }
  | { mode: 'history'; category: AlertCategory }
  | { mode: 'closed' };

export interface AppState {
  /** 当前聚焦层（'all' = 全局总览，其他层淡化） */
  focus: LayerId | 'all';
  /** 当前选中（实体/连线/区域） */
  selection: Selection;
  /** 当前展开的区域（同层同时最多一个） */
  expansion: { layer: LayerId; zone: ZoneId } | null;
  /** 层间关联显示模式 */
  crossLinks: CrossLinksState;
  /** 当前剧本 id（null = 仅环境噪声） */
  scenarioId: string | null;
  /** 仿真暂停 */
  paused: boolean;
  /** 设置面板是否展开（设置内容在 DisplaySettingsStore，开关状态不持久化） */
  settingsOpen: boolean;
  /** 设置面板当前 tab（显示/布局/演示，可扩展） */
  settingsTab: 'display' | 'layout' | 'demo';
  /** 布局设置 tab 的 3D 联动目标（在 3D 中点击网/子区域时切换配置目标） */
  layoutTarget: { layer: LayerId; zone: ZoneId; kind?: string } | null;
  /** 帮助窗口开关（右上角 ❓） */
  helpOpen: boolean;
  /** 智能助手窗口开关（右上角 💬） */
  assistantOpen: boolean;
  /** 动态消息窗体模式（实时/历史/关闭） */
  messageMode: MessageMode;
}

export const initialAppState: AppState = {
  focus: 'all',
  selection: null,
  expansion: null,
  crossLinks: { mode: 'none' },
  scenarioId: null,
  paused: false,
  settingsOpen: false,
  settingsTab: 'display',
  layoutTarget: null,
  helpOpen: false,
  assistantOpen: false,
  messageMode: { mode: 'live' },
};

export class AppStore {
  private state: AppState = { ...initialAppState };
  private listeners = new Set<(state: AppState) => void>();

  get(): AppState {
    return this.state;
  }

  set(patch: Partial<AppState>): void {
    let changed = false;
    const next: AppState = { ...this.state };
    for (const key of Object.keys(patch) as Array<keyof AppState>) {
      const value = patch[key];
      if (value === undefined) continue;
      if (this.state[key] === value) continue;
      next[key] = value as never;
      changed = true;
    }
    if (!changed) return;
    this.state = next;
    for (const cb of this.listeners) cb(this.state);
  }

  subscribe(cb: (state: AppState) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
}
