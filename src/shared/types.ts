/**
 * 全系统共享数据契约（浏览器与 Node 数据生成器共用，零 three 依赖）。
 * 实体 / 关系 / 告警 / 仿真事件 / 剧本 / 数据集。
 */

/** 四个展示层面：地域 / 设备 / 应用 / 任务 */
export type LayerId = 'geo' | 'device' | 'app' | 'task';
export const LAYERS: readonly LayerId[] = ['geo', 'device', 'app', 'task'] as const;

export const LAYER_LABELS: Record<LayerId, string> = {
  geo: '地域分布层',
  device: '设备分布层',
  app: '应用分布层',
  task: '任务分布层',
};

/** 设备/应用/任务层的四个矩形逻辑区域（从左到右） */
export type ZoneId = 'enterprise' | 'business' | 'cn-public' | 'global-public';
export const ZONES: readonly ZoneId[] = ['enterprise', 'business', 'cn-public', 'global-public'] as const;

export const ZONE_LABELS: Record<ZoneId, string> = {
  enterprise: '企业网',
  business: '业务网',
  'cn-public': '公网（境内）',
  'global-public': '公网（境外）',
};

/** 经纬度 */
export interface GeoPos {
  lat: number;
  lng: number;
}

export type EntityState = 'online' | 'offline' | 'degraded' | 'busy';

/** 统计摘要项（实体详情面板"摘要"tab） */
export interface StatItem {
  key: string;
  label: string;
  value: number | string;
  unit?: string;
  /** metric=数值指标(可实时更新) text=静态文本 */
  kind: 'metric' | 'text';
  /** 数值格式：raw 原值 / bytes 字节 / duration 时长(小时) / ratio 百分比 */
  fmt?: 'raw' | 'bytes' | 'duration' | 'ratio';
}

/** 属性项（实体详情面板"属性"tab） */
export interface AttrItem {
  key: string;
  label: string;
  value: string;
}

/** 配置项（实体详情面板"配置"tab） */
export interface ConfigItem {
  key: string;
  label: string;
  value: string | number | boolean;
  kind: 'text' | 'number' | 'boolean' | 'select';
  options?: string[];
  unit?: string;
}

/** 管理操作定义（实体详情面板"操作"tab） */
export interface OpDef {
  id: string;
  label: string;
  icon?: string;
  danger?: boolean;
  /** 是否需要二次确认（提示文案） */
  confirm?: string;
  /** 操作参数表单（可为空） */
  params?: ConfigItem[];
  /** 执行后对实体状态的影响（仿真演示用） */
  effect?: { state?: EntityState; statPatch?: Array<{ key: string; value: number | string }> };
}

export interface Entity {
  id: string;
  layer: LayerId;
  /** 类型 key（英文标识） */
  kind: string;
  /** 类型中文名 */
  kindLabel: string;
  name: string;
  /** 设备/应用/任务层：所属逻辑区域 */
  zone?: ZoneId;
  /** 地域层：经纬度 */
  geo?: GeoPos;
  /** 重要度 1~3，映射视觉尺度 */
  size: number;
  /** 任务树：父节点 id（任务层多级细分） */
  parentId?: string;
  /** 任务树层级：0=总部 1=大区 2=终端网点 */
  level?: number;
  state: EntityState;
  attrs: AttrItem[];
  stats: StatItem[];
  config: ConfigItem[];
  ops: OpDef[];
}

/**
 * 连线语义：控制（蓝系）/ 数据（黄系）/ 告警数据（红系）。
 * 静态关系只有 control|data；'alert' 仅作为运行时动态切换（告警数据流）。
 */
export type RelationKind = 'control' | 'data' | 'alert';
/** intra=同层连线 cross=层间关联连线 */
export type RelationScope = 'intra' | 'cross';
/** 层间关联语义：部署（机房→设备）/ 运行（设备→应用）/ 承载（应用→任务）/ 隶属（组织→任务） */
export type CrossType = 'deploy' | 'run' | 'bear' | 'own';

export const CROSS_LABELS: Record<CrossType, string> = {
  deploy: '部署于',
  run: '运行于',
  bear: '承载',
  own: '隶属',
};

export interface Relation {
  id: string;
  from: string;
  to: string;
  kind: RelationKind;
  scope: RelationScope;
  /** 层间关联语义（scope=cross 时有效） */
  crossType?: CrossType;
  /** normal / critical（关键控制关系加粗+动态效果） */
  importance: 'normal' | 'critical';
  /** 相对流量 0~1 → 连线粗细 */
  volume: number;
}

export type AlertLevel = 'critical' | 'major' | 'minor' | 'info';

export const ALERT_LEVEL_LABELS: Record<AlertLevel, string> = {
  critical: '严重',
  major: '重要',
  minor: '次要',
  info: '提示',
};

/**
 * 消息类别（P4 消息状态展示区/动态消息窗体）：
 * system=系统运行消息 security=安全告警 entity=实体运行告警 link=链路传输告警
 */
export type AlertCategory = 'system' | 'security' | 'entity' | 'link';

export const ALERT_CATEGORY_LABELS: Record<AlertCategory, string> = {
  system: '系统运行消息',
  security: '安全告警',
  entity: '实体运行告警',
  link: '链路传输告警',
};

export interface Alert {
  id: string;
  entityId: string;
  /** 关联的连线（告警数据流展示用，可选） */
  relationId?: string;
  /** 消息类别（系统/安全/实体/链路），P4 统计与历史列表按此归类 */
  category: AlertCategory;
  level: AlertLevel;
  title: string;
  detail: string;
  suggestion: string;
  raisedAt: number;
  clearedAt?: number;
  status: 'active' | 'cleared';
}

/** 动态提示消息/工单（仿真剧本生成，P4 动态消息窗体） */
export interface Notice {
  id: string;
  /** notice=提示消息 ticket=工单 */
  kind: 'notice' | 'ticket';
  category: AlertCategory;
  title: string;
  detail: string;
  raisedAt: number;
}

/** 仿真事件（事件溯源：所有运行时变更 = SimEvent 经 reducer 应用） */
export type SimEvent =
  | { type: 'entity:state'; entityId: string; state: EntityState }
  | { type: 'stat:update'; entityId: string; patch: Array<{ key: string; value: number | string }> }
  | { type: 'relation:volume'; relationId: string; volume: number }
  | { type: 'relation:kind'; relationId: string; kind: RelationKind }
  | { type: 'alert:raise'; alert: Alert }
  | { type: 'alert:clear'; alertId: string }
  | { type: 'notice:push'; notice: Notice };

export interface SimEventEnvelope {
  seq: number;
  /** 仿真时间（秒） */
  t: number;
  ev: SimEvent;
}

/** 剧本步骤：at=剧本时间（秒），events=该时刻批量触发的事件 */
export interface ScenarioStep {
  at: number;
  events: SimEvent[];
}

export interface Scenario {
  id: string;
  name: string;
  description: string;
  /** 剧本总时长（秒），loop=true 循环播放 */
  duration: number;
  loop: boolean;
  steps: ScenarioStep[];
}

export interface DatasetMeta {
  version: number;
  seed: number;
  generatedAt: string;
  entityCount: number;
  relationCount: number;
}

export interface Dataset {
  meta: DatasetMeta;
  entities: Entity[];
  relations: Relation[];
  scenarios: Scenario[];
}

/** 数据集校验结果 */
export interface ValidationResult {
  ok: boolean;
  errors: string[];
}
