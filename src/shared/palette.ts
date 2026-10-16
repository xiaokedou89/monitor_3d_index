/**
 * 全局视觉语义配色（渲染层、缩略图、图例共用）。
 * 深空科技风：暗蓝黑背景 + 青/蓝/紫/琥珀分层强调 + 高饱和告警红。
 */

export const PALETTE = {
  /** 背景 */
  bg: '#040b18',
  /** 地域层强调色 */
  layerGeo: '#22d3ee',
  /** 设备层强调色 */
  layerDevice: '#3b82f6',
  /** 应用层强调色 */
  layerApp: '#a78bfa',
  /** 任务层强调色 */
  layerTask: '#34d399',
  /** 连线语义：控制（蓝系） */
  edgeControl: '#3b82f6',
  /** 连线语义：数据（黄系） */
  edgeData: '#f5b93b',
  /** 连线语义：告警数据（红系，运行时切换） */
  edgeAlert: '#ef4444',
  /** 关键控制连线（更亮） */
  edgeCritical: '#60a5fa',
  /** 层间关联连线 */
  edgeCross: '#8b5cf6',
  /** 分区底板 */
  zoneFill: 'rgba(59,130,246,0.05)',
  /** 告警级别色 */
  alertCritical: '#ef4444',
  alertMajor: '#f97316',
  alertMinor: '#eab308',
  alertInfo: '#38bdf8',
  /** 在线/离线/降级/繁忙状态色 */
  stateOnline: '#22c55e',
  stateOffline: '#6b7280',
  stateDegraded: '#f97316',
  stateBusy: '#facc15',
  /** UI 面板 */
  panelBg: 'rgba(7,18,36,0.86)',
  panelBorder: 'rgba(94,234,212,0.22)',
  text: '#dbeafe',
  textDim: '#7da2c9',
  accent: '#22d3ee',
} as const;

export const ALERT_LEVEL_COLORS = {
  critical: PALETTE.alertCritical,
  major: PALETTE.alertMajor,
  minor: PALETTE.alertMinor,
  info: PALETTE.alertInfo,
} as const;

/** 消息类别色（P4 消息状态展示区/动态消息窗体）：系统/安全/实体/链路 */
export const CATEGORY_COLORS = {
  system: '#94a3b8',
  security: '#f43f5e',
  entity: '#f5b93b',
  link: '#38bdf8',
} as const;

export const ENTITY_STATE_COLORS = {
  online: PALETTE.stateOnline,
  offline: PALETTE.stateOffline,
  degraded: PALETTE.stateDegraded,
  busy: PALETTE.stateBusy,
} as const;

/** 层 → 强调色 */
export const LAYER_COLORS = {
  geo: PALETTE.layerGeo,
  device: PALETTE.layerDevice,
  app: PALETTE.layerApp,
  task: PALETTE.layerTask,
} as const;

/** 区域 → 强调色（各层分区保持一致） */
export const ZONE_COLORS = {
  enterprise: '#38bdf8',
  business: '#818cf8',
  'cn-public': '#34d399',
  'global-public': '#f59e0b',
} as const;

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const v = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** 十六进制 → css rgba 字符串 */
export function hexToCss(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}
