/**
 * 实体类型定义（需求枚举的各类设备/应用/任务/地域对象）。
 * 数据生成器、渲染层（颜色/几何）、UI（图例）共用。
 */
import type { LayerId } from './types';

export interface KindDef {
  key: string;
  label: string;
  layer: LayerId;
  /** 实体标记主色 */
  color: string;
  /** 形状：box / sphere / column / hex（渲染层用） */
  shape: 'box' | 'sphere' | 'column' | 'hex';
}

const D = (key: string, label: string, color: string): KindDef => ({
  key,
  label,
  layer: 'device',
  color,
  shape: 'box',
});

const A = (key: string, label: string, color: string): KindDef => ({
  key,
  label,
  layer: 'app',
  color,
  shape: 'sphere',
});

const T = (key: string, label: string, color: string): KindDef => ({
  key,
  label,
  layer: 'task',
  color,
  shape: 'hex',
});

const G = (key: string, label: string, color: string): KindDef => ({
  key,
  label,
  layer: 'geo',
  color,
  shape: 'column',
});

/** 地域层对象：机房 / 云机房 / 组织机构 */
export const GEO_KINDS: readonly KindDef[] = [
  G('idc', '机房', '#22d3ee'),
  G('cloud-idc', '云机房', '#2dd4bf'),
  G('org', '组织机构', '#67e8f9'),
];

/** 设备层 10 类设备 */
export const DEVICE_KINDS: readonly KindDef[] = [
  D('terminal', '终端', '#60a5fa'),
  D('server', '服务器', '#3b82f6'),
  D('gateway', '网关', '#818cf8'),
  D('firewall', '防火墙', '#f97316'),
  D('netgap', '网闸', '#e879f9'),
  D('dedicated-device', '专线设备', '#0ea5e9'),
  D('dedicated-line', '专线线路', '#22d3ee'),
  D('enclave-idc', '飞地机房', '#14b8a6'),
  D('vps', '云主机(VPS)', '#a78bfa'),
  D('residential-proxy', '住宅代理', '#f59e0b'),
];

/** 应用层 13 类应用/服务 */
export const APP_KINDS: readonly KindDef[] = [
  A('biz-app', '业务APP', '#c084fc'),
  A('biz-mgmt-terminal', '业务管理终端', '#a78bfa'),
  A('data-collect', '数据采集服务', '#60a5fa'),
  A('data-analysis', '数据分析服务', '#38bdf8'),
  A('data-storage', '数据存储服务', '#818cf8'),
  A('arp-app', 'ARP应用', '#e879f9'),
  A('arp-service', 'ARP服务', '#d946ef'),
  A('vpn-service', 'VPN服务', '#22d3ee'),
  A('transport-proxy', '传输代理服务', '#2dd4bf'),
  A('security-monitor', '安全监测服务', '#34d399'),
  A('threat-response', '威胁处置系统', '#ef4444'),
  A('vps-control', 'VPS终端控制软件', '#f59e0b'),
  A('info-publish', '信息发布服务', '#facc15'),
];

/** 任务层 6 类任务 */
export const TASK_KINDS: readonly KindDef[] = [
  T('org-planning', '组织规划中心', '#34d399'),
  T('production', '生产管理', '#10b981'),
  T('sales', '销售管理', '#f59e0b'),
  T('after-sales', '售后服务', '#fb923c'),
  T('ops', '运维管理', '#38bdf8'),
  T('rd', '研发管理', '#a78bfa'),
];

export const KIND_DEFS_BY_LAYER: Record<LayerId, readonly KindDef[]> = {
  geo: GEO_KINDS,
  device: DEVICE_KINDS,
  app: APP_KINDS,
  task: TASK_KINDS,
};

const KIND_INDEX = new Map<string, KindDef>();
for (const defs of Object.values(KIND_DEFS_BY_LAYER)) {
  for (const d of defs) KIND_INDEX.set(d.key, d);
}

export function kindDef(key: string): KindDef {
  const d = KIND_INDEX.get(key);
  if (!d) throw new Error(`未知实体类型: ${key}`);
  return d;
}
