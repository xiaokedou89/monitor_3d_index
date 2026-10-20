/**
 * 告警事件模板：按事件类别（离线/攻击/故障/数据阻塞）提供标题、详情、处置建议模板。
 * 数据生成器用它构造 4 个演示剧本（正常运转/故障演练/攻击告警/跨层故障链）。
 * 另含动态提示消息/工单模板（NOTICE_TEMPLATES），供剧本生成 notice:push 事件（P4）。
 */
import type { Alert, AlertCategory, AlertLevel, LayerId, Notice } from '../types';

export type IncidentKind = 'offline' | 'attack' | 'fault' | 'blocked' | 'degraded';

export interface AlertTemplate {
  kind: IncidentKind;
  layer: LayerId;
  level: AlertLevel;
  /** 消息类别（P4 消息状态区按 系统/安全/实体/链路 归类统计） */
  category: AlertCategory;
  title: (name: string) => string;
  detail: (name: string, kindLabel: string) => string;
  suggestion: string;
}

export const ALERT_TEMPLATES: AlertTemplate[] = [
  {
    kind: 'offline',
    layer: 'geo',
    level: 'critical',
    category: 'entity',
    title: (n) => `${n} 离线故障`,
    detail: (n, k) => `${n}（${k}）与管控中心心跳中断超过阈值，机房内设备全部失联，可能由断电或骨干链路中断引起。`,
    suggestion: '立即联系机房值班人员现场排查供电与上联线路；启用备用链路；核查影响范围内的设备与业务，做好切换预案。',
  },
  {
    kind: 'offline',
    layer: 'device',
    level: 'critical',
    category: 'entity',
    title: (n) => `${n} 离线`,
    detail: (n, k) => `${n}（${k}）与管控中心心跳中断，设备失联，其上运行的应用与服务已无法响应。`,
    suggestion: '检查设备供电与网络连通性；若为攻击所致，先在边界防火墙隔离异常流量；恢复后核对运行于其上的应用状态。',
  },
  {
    kind: 'attack',
    layer: 'device',
    level: 'critical',
    category: 'security',
    title: (n) => `${n} 遭受攻击`,
    detail: (n, k) => `安全监测服务发现 ${n}（${k}）遭受持续攻击流量，CPU 负载异常升高，部分端口出现扫描与爆破行为。`,
    suggestion: '在防火墙下发阻断策略封禁攻击源；联动威胁处置系统清洗流量；检查设备基线配置是否被篡改。',
  },
  {
    kind: 'fault',
    layer: 'app',
    level: 'major',
    category: 'entity',
    title: (n) => `${n} 严重故障`,
    detail: (n, k) => `${n}（${k}）进程异常退出后自动拉起失败，服务不可用，下游任务节点数据请求堆积。`,
    suggestion: '立即重启服务并回滚最近一次配置变更；检查日志定位崩溃原因；必要时切换至备用实例承载流量。',
  },
  {
    kind: 'blocked',
    layer: 'app',
    level: 'major',
    category: 'link',
    title: (n) => `${n} 数据阻塞`,
    detail: (n, k) => `${n}（${k}）输出队列深度持续上升，数据处理时延超过 SLA 阈值 3 倍，上游采集服务缓冲即将耗尽。`,
    suggestion: '扩容处理线程数或消费端并发；排查下游数据存储服务磁盘与连接池状态；必要时限流低优先级任务。',
  },
  {
    kind: 'degraded',
    layer: 'device',
    level: 'minor',
    category: 'entity',
    title: (n) => `${n} 性能降级`,
    detail: (n, k) => `${n}（${k}）CPU/内存使用率超过 90%，转发性能下降，可能影响承载的上层应用服务质量。`,
    suggestion: '检查是否存在异常进程或资源泄漏；评估负载迁移；关注关联应用的时延指标变化。',
  },
  {
    kind: 'fault',
    layer: 'task',
    level: 'major',
    category: 'entity',
    title: (n) => `${n} 任务执行异常`,
    detail: (n, k) => `${n}（${k}）任务队列出现大量失败重试，下游网点反馈数据未按时到达，疑似策略配置错误。`,
    suggestion: '暂停该任务下发；核对最近一次策略变更；回滚至上一稳定版本后恢复下发。',
  },
  {
    kind: 'offline',
    layer: 'task',
    level: 'minor',
    category: 'entity',
    title: (n) => `${n} 节点离线`,
    detail: (n, k) => `${n}（${k}）长时间未上报心跳，可能为终端网点网络波动或客户端退出。`,
    suggestion: '检查网点侧网络连接；确认客户端运行状态；离线期间数据将暂存至上级节点。',
  },
];

export function buildAlert(
  tpl: AlertTemplate,
  entityId: string,
  name: string,
  kindLabel: string,
  raisedAt: number,
  opts: { relationId?: string; id?: string } = {},
): Alert {
  return {
    id: opts.id ?? `al-${entityId}-${tpl.kind}-${raisedAt}`,
    entityId,
    ...(opts.relationId !== undefined ? { relationId: opts.relationId } : {}),
    category: tpl.category,
    level: tpl.level,
    title: tpl.title(name),
    detail: tpl.detail(name, kindLabel),
    suggestion: tpl.suggestion,
    raisedAt,
    status: 'active',
  };
}

/** 动态提示消息/工单模板（固定文案，由剧本生成器在指定时间注入） */
export interface NoticeTemplate {
  kind: 'notice' | 'ticket';
  category: AlertCategory;
  title: string;
  detail: string;
}

export const NOTICE_TEMPLATES: NoticeTemplate[] = [
  {
    kind: 'notice',
    category: 'system',
    title: '系统自检完成',
    detail: '管控平台完成例行自检：渲染服务、仿真引擎、消息队列均运行正常。',
  },
  {
    kind: 'notice',
    category: 'system',
    title: '演示剧本已启动',
    detail: '当前演示剧本开始播放，仿真事件将按时间轴注入三维场景。',
  },
  {
    kind: 'notice',
    category: 'system',
    title: '例行巡检完成',
    detail: '本轮例行巡检完成，未发现高危配置项，巡检报告已归档。',
  },
  {
    kind: 'notice',
    category: 'security',
    title: '安全监测：扫描行为预警',
    detail: '边界防火墙监测到低频端口扫描行为，已自动提升监测等级并记录源地址。',
  },
  {
    kind: 'ticket',
    category: 'entity',
    title: '巡检工单：策略复核',
    detail: '巡检发现 1 处低风险策略配置项，已生成复核工单，请工程师在 24 小时内完成确认。',
  },
  {
    kind: 'ticket',
    category: 'entity',
    title: '故障处置工单',
    detail: '故障实体处置跟踪工单已生成，请值班工程师现场排查供电与上联线路并反馈结果。',
  },
  {
    kind: 'ticket',
    category: 'link',
    title: '链路切换确认工单',
    detail: '备用链路切换已执行，请网络工程师确认流量回切窗口与切换结果。',
  },
  {
    kind: 'ticket',
    category: 'security',
    title: '攻击处置闭环工单',
    detail: '攻击源封禁策略已下发并生效，请安全工程师确认处置闭环并归档报告。',
  },
];

export function buildNotice(
  tpl: NoticeTemplate,
  raisedAt: number,
  opts: { id?: string } = {},
): Notice {
  return {
    id: opts.id ?? `nt-${tpl.kind}-${raisedAt}`,
    kind: tpl.kind,
    category: tpl.category,
    title: tpl.title,
    detail: tpl.detail,
    raisedAt,
  };
}
