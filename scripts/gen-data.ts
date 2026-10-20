/**
 * 模拟演示数据生成器（种子化、确定性）：
 *   node scripts/gen-data.ts [seed] [--out path]
 * 生成 4 层实体（地域/设备/应用/任务）、同层与层间关系、4 个演示剧本，
 * 校验通过后写入 public/data/dataset.json。
 * 同一 seed 输出逐字节一致。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  mulberry32,
  randFloat,
  randInt,
  randPick,
  randPickN,
  shuffle,
  type Rng,
} from '../src/shared/rng';
import type {
  AttrItem,
  Dataset,
  Entity,
  OpDef,
  Relation,
  Scenario,
  SimEvent,
  StatItem,
  ZoneId,
} from '../src/shared/types';
import { ZONES, ZONE_LABELS } from '../src/shared/types';
import { APP_KINDS, DEVICE_KINDS, GEO_KINDS, TASK_KINDS } from '../src/shared/kinds';
import {
  ALERT_TEMPLATES,
  buildAlert,
  buildNotice,
  NOTICE_TEMPLATES,
  type IncidentKind,
  type NoticeTemplate,
} from '../src/shared/sim/scenarios';
import { validateDataset } from '../src/shared/schema';

// ---------------------------------------------------------------------------
// 常量表
// ---------------------------------------------------------------------------

/** 城市坐标表（省会 + 港澳台 + 境外演示点位） */
interface CityDef {
  name: string;
  lat: number;
  lng: number;
  geoKind: 'idc' | 'cloud-idc' | 'org';
}

const CITIES: CityDef[] = [
  { name: '北京', lat: 39.9, lng: 116.4, geoKind: 'idc' },
  { name: '上海', lat: 31.2, lng: 121.5, geoKind: 'idc' },
  { name: '广州', lat: 23.1, lng: 113.3, geoKind: 'idc' },
  { name: '深圳', lat: 22.5, lng: 114.1, geoKind: 'idc' },
  { name: '杭州', lat: 30.3, lng: 120.2, geoKind: 'idc' },
  { name: '南京', lat: 32.1, lng: 118.8, geoKind: 'idc' },
  { name: '武汉', lat: 30.6, lng: 114.3, geoKind: 'idc' },
  { name: '成都', lat: 30.7, lng: 104.1, geoKind: 'idc' },
  { name: '重庆', lat: 29.6, lng: 106.5, geoKind: 'idc' },
  { name: '西安', lat: 34.3, lng: 108.9, geoKind: 'idc' },
  { name: '郑州', lat: 34.7, lng: 113.6, geoKind: 'idc' },
  { name: '济南', lat: 36.7, lng: 117.0, geoKind: 'idc' },
  { name: '青岛', lat: 36.1, lng: 120.4, geoKind: 'idc' },
  { name: '天津', lat: 39.1, lng: 117.2, geoKind: 'idc' },
  { name: '沈阳', lat: 41.8, lng: 123.4, geoKind: 'idc' },
  { name: '长沙', lat: 28.2, lng: 113.0, geoKind: 'idc' },
  { name: '福州', lat: 26.1, lng: 119.3, geoKind: 'idc' },
  { name: '昆明', lat: 25.0, lng: 102.7, geoKind: 'idc' },
  { name: '南宁', lat: 22.8, lng: 108.3, geoKind: 'idc' },
  { name: '海口', lat: 20.0, lng: 110.3, geoKind: 'idc' },
  { name: '兰州', lat: 36.1, lng: 103.8, geoKind: 'idc' },
  { name: '乌鲁木齐', lat: 43.8, lng: 87.6, geoKind: 'idc' },
  { name: '拉萨', lat: 29.7, lng: 91.1, geoKind: 'idc' },
  { name: '呼和浩特', lat: 40.8, lng: 111.7, geoKind: 'idc' },
  { name: '北京云基地', lat: 40.3, lng: 116.6, geoKind: 'cloud-idc' },
  { name: '上海云基地', lat: 31.4, lng: 121.9, geoKind: 'cloud-idc' },
  { name: '香港机房', lat: 22.3, lng: 114.2, geoKind: 'idc' },
  { name: '新加坡云机房', lat: 1.35, lng: 103.8, geoKind: 'cloud-idc' },
  { name: '东京机房', lat: 35.7, lng: 139.7, geoKind: 'idc' },
  { name: '法兰克福机房', lat: 50.1, lng: 8.7, geoKind: 'idc' },
  { name: '洛杉矶机房', lat: 34.05, lng: -118.2, geoKind: 'idc' },
];

const ORG_DEFS: Array<{ name: string; lat: number; lng: number }> = [
  { name: '集团总部', lat: 39.9, lng: 116.4 },
  { name: '华东分公司', lat: 31.2, lng: 121.5 },
  { name: '华南分公司', lat: 23.1, lng: 113.3 },
  { name: '西南分公司', lat: 30.7, lng: 104.1 },
  { name: '境外办事处', lat: 22.3, lng: 114.2 },
];

const PEOPLE = ['王磊', '李敏', '张伟', '刘洋', '陈静', '杨帆', '赵强', '孙丽', '周杰', '吴倩', '郑浩', '林芳'];
const DEV_BRANDS = ['华为', '浪潮', '联想', '戴尔', 'HPE', '深信服', '奇安信', '锐捷', '新华三', '中兴'];
const DEV_MODELS = ['SRX-660', 'S5700-52X', 'R750XS', 'NF5280M6', 'USG-F6600', 'NGFW-8000', 'GAP-2000', 'ZXR10-8900', 'WAF-A800', 'TS-2300'];
const OSES = ['Kylin V10', 'openEuler 22.03', 'Windows Server 2022', 'CentOS 7.9', 'Ubuntu 22.04', '麒麟 V10'];
const APP_UNITS = ['集团信息中心', '数据平台部', '业务研发部', '安全运营中心', '华东分公司技术部', '合作伙伴-星云科技'];
const TASK_ORGS = ['集团总部', '华东分公司', '华南分公司', '西南分公司', '境外办事处'];
const IDC_LEVELS = ['T3+', 'T4', 'T3'];
const POWER_MODES = ['双路市电+柴发', '双路市电+UPS', '市电+UPS'];

// 名称池
const DEVICE_NAME_POOL: Record<string, string[]> = {
  terminal: ['办公终端', '运维终端', '监控终端', '业务终端'],
  server: ['应用服务器', '数据库服务器', '存储服务器', '中间件服务器'],
  gateway: ['核心网关', '出口网关', '汇聚网关'],
  firewall: ['边界防火墙', '下一代防火墙', 'WAF防火墙'],
  netgap: ['安全隔离网闸', '单向光闸'],
  'dedicated-device': ['专线接入设备', '专线路由器'],
  'dedicated-line': ['专线线路'],
  'enclave-idc': ['飞地机房'],
  vps: ['云主机', 'VPS实例'],
  'residential-proxy': ['住宅代理节点', '动态IP节点'],
};

const APP_NAME_POOL: Record<string, string[]> = {
  'biz-app': ['订单业务APP', '库存业务APP', '客户管理APP', '报表业务APP'],
  'biz-mgmt-terminal': ['业务管理终端', '运营管理终端'],
  'data-collect': ['日志采集服务', '终端数据采集', '业务数据采集'],
  'data-analysis': ['实时分析引擎', '离线分析服务', '指标计算服务'],
  'data-storage': ['时序数据存储', '对象存储服务', '分布式文件存储'],
  'arp-app': ['ARP客户端', 'ARP应用终端'],
  'arp-service': ['ARP中继服务', 'ARP调度服务'],
  'vpn-service': ['IPsec-VPN服务', 'SSL-VPN服务', 'WireGuard-VPN'],
  'transport-proxy': ['传输代理服务', '反向代理服务', '多级转发代理'],
  'security-monitor': ['安全监测服务', '态势感知平台'],
  'threat-response': ['威胁处置系统'],
  'vps-control': ['VPS终端控制软件', '节点控制台'],
  'info-publish': ['信息发布服务', '内容分发服务'],
};

const TASK_AREA_NAMES = ['华北', '华东', '华南', '华中', '西南', '西北', '东北'];
const TASK_LEAF_NAMES = ['第一营业部', '第二营业部', '旗舰店', '直营店', '渠道网点', '服务站点', '体验中心', '区域门店'];

/** 各区域设备种类数量分布 */
const DEVICE_ZONE_PLAN: Record<ZoneId, Record<string, number>> = {
  enterprise: { terminal: 10, server: 12, gateway: 3, firewall: 3, netgap: 2, 'dedicated-device': 2, 'dedicated-line': 1 },
  business: { server: 14, terminal: 6, gateway: 4, firewall: 4, netgap: 3, 'dedicated-device': 4, 'dedicated-line': 3, 'enclave-idc': 2, vps: 2 },
  'cn-public': { vps: 14, 'dedicated-line': 3, gateway: 3, server: 6, 'dedicated-device': 3, firewall: 2 },
  'global-public': { vps: 16, 'residential-proxy': 10, 'enclave-idc': 3, 'dedicated-device': 3, 'dedicated-line': 3 },
};

const APP_ZONE_PLAN: Record<ZoneId, Record<string, number>> = {
  enterprise: { 'biz-app': 6, 'biz-mgmt-terminal': 4, 'data-collect': 4, 'data-analysis': 4, 'data-storage': 3, 'security-monitor': 2, 'threat-response': 1 },
  business: { 'biz-app': 8, 'data-collect': 6, 'data-analysis': 5, 'data-storage': 5, 'arp-app': 4, 'arp-service': 4, 'vpn-service': 4, 'transport-proxy': 4, 'security-monitor': 3, 'info-publish': 2 },
  'cn-public': { 'arp-service': 5, 'vpn-service': 5, 'transport-proxy': 4, 'security-monitor': 2, 'info-publish': 4, 'vps-control': 4 },
  'global-public': { 'arp-app': 4, 'vpn-service': 4, 'transport-proxy': 4, 'info-publish': 3, 'vps-control': 5 },
};

/** 任务树结构：zone → 每类任务 {大区数, 每大区网点数} */
const TASK_ZONE_PLAN: Record<ZoneId, Record<string, { regions: number; leaves: number }>> = {
  enterprise: { 'org-planning': { regions: 2, leaves: 3 }, production: { regions: 2, leaves: 4 }, ops: { regions: 2, leaves: 3 }, rd: { regions: 2, leaves: 3 } },
  business: { production: { regions: 3, leaves: 5 }, sales: { regions: 4, leaves: 6 }, 'after-sales': { regions: 3, leaves: 4 }, ops: { regions: 2, leaves: 3 } },
  'cn-public': { sales: { regions: 3, leaves: 5 }, 'after-sales': { regions: 3, leaves: 4 } },
  'global-public': { sales: { regions: 2, leaves: 3 } },
};

/** 重要度 → 视觉尺度 */
const sizeOf = (rng: Rng, important: boolean): number => (important ? 3 : randInt(rng, 1, 3));

// ---------------------------------------------------------------------------
// 构建器
// ---------------------------------------------------------------------------

let idCounter = 0;
const nid = (prefix: string): string => `${prefix}-${String(++idCounter).padStart(4, '0')}`;

function attr(key: string, label: string, value: string): AttrItem {
  return { key, label, value };
}

function metric(key: string, label: string, value: number, unit?: string, fmt?: StatItem['fmt']): StatItem {
  const item: StatItem = { key, label, value, kind: 'metric' };
  if (unit !== undefined) item.unit = unit;
  if (fmt !== undefined) item.fmt = fmt;
  return item;
}

function text(key: string, label: string, value: string): StatItem {
  return { key, label, value, kind: 'text' };
}

function op(id: string, label: string, extra: Partial<OpDef> = {}): OpDef {
  return { id, label, ...extra };
}

/** 地域层实体 */
function buildGeoEntities(rng: Rng): Entity[] {
  const out: Entity[] = [];
  const usedNames = new Set<string>();
  const uniqueName = (base: string): string => {
    let n = base;
    let i = 2;
    while (usedNames.has(n)) n = `${base}-${i++}`;
    usedNames.add(n);
    return n;
  };

  const makeRoom = (c: CityDef): Entity => {
    const kind = c.geoKind === 'cloud-idc' ? 'cloud-idc' : 'idc';
    const isCloud = kind === 'cloud-idc';
    const d = GEO_KINDS.find((k) => k.key === kind)!;
    const level = randPick(rng, IDC_LEVELS);
    const racks = randInt(rng, 80, 420);
    const id = nid('g');
    return {
      id,
      layer: 'geo',
      kind,
      kindLabel: d.label,
      // 站点名已含「机房」时不再追加（如 洛杉矶机房 → 洛杉矶机房，避免重复后缀）
      name: uniqueName(c.name + (!isCloud && !c.name.endsWith('机房') ? '机房' : '')),
      geo: { lat: c.lat, lng: c.lng },
      size: sizeOf(rng, !isCloud && randInt(rng, 0, 3) === 0),
      state: 'online',
      attrs: [
        attr('location', '机房位置', `${c.name}（${c.lat.toFixed(1)}°N, ${c.lng.toFixed(1)}°E）`),
        attr('level', '机房等级', level),
        attr('racks', '机柜数量', `${racks} 柜`),
        attr('lease', '租用时间', `${randInt(rng, 2019, 2025)}-${String(randInt(rng, 1, 12)).padStart(2, '0')} 至 ${randInt(rng, 2026, 2031)}-${String(randInt(rng, 1, 12)).padStart(2, '0')}`),
        attr('owner', '负责人', randPick(rng, PEOPLE)),
        attr('tel', '联系电话', `010-6${randInt(rng, 1000000, 9999999)}`),
        attr('power', '供电方式', randPick(rng, POWER_MODES)),
        attr('bandwidth', '上联带宽', `${randPick(rng, [10, 40, 100])} Gbps`),
      ],
      stats: [
        text('state', '运行状态', '在线'),
        metric('throughput', '数据吞吐量', randFloat(rng, 2, 60), 'Gbps', 'raw'),
        metric('devices', '设备数量', randInt(rng, 20, 300), '台'),
        metric('bw-util', '带宽利用率', randFloat(rng, 20, 80), '%', 'ratio'),
      ],
      config: [
        { key: 'temp-threshold', label: '高温告警阈值', value: randPick(rng, [28, 30, 32]), kind: 'number', unit: '℃' },
        { key: 'inspect-cycle', label: '自动巡检周期', value: randPick(rng, [1, 4, 8]), kind: 'number', unit: '小时' },
        { key: 'auto-failover', label: '故障自动切换', value: rng() < 0.6, kind: 'boolean' },
      ],
      ops: [
        op('enable-room', '启用机房', { effect: { state: 'online' } }),
        op('disable-room', '关闭机房', { danger: true, confirm: '关闭后机房内全部设备将离线，确认关闭？', effect: { state: 'offline' } }),
        op('inspect-room', '远程巡检', { effect: { statPatch: [{ key: 'bw-util', value: randFloat(rng, 10, 40) }] } }),
      ],
    };
  };

  for (const c of CITIES) out.push(makeRoom(c));

  for (const o of ORG_DEFS) {
    out.push({
      id: nid('g'),
      layer: 'geo',
      kind: 'org',
      kindLabel: '组织机构',
      name: uniqueName(o.name),
      geo: { lat: o.lat, lng: o.lng },
      size: sizeOf(rng, o.name === '集团总部'),
      state: 'online',
      attrs: [
        attr('type', '机构类型', randPick(rng, ['总部', '分公司', '办事处', '研发中心'])),
        attr('addr', '办公地址', o.name),
        attr('staff', '人员规模', `${randInt(rng, 80, 3000)} 人`),
        attr('owner', '负责人', randPick(rng, PEOPLE)),
        attr('founded', '设立时间', `${randInt(rng, 2008, 2022)} 年`),
      ],
      stats: [
        text('state', '运行状态', '在线'),
        metric('devices', '管理设备数', randInt(rng, 30, 500), '台'),
        metric('tasks', '在办任务数', randInt(rng, 5, 80), '项'),
      ],
      config: [
        { key: 'alert-level', label: '告警上报级别', value: randPick(rng, ['仅严重', '重要及以上', '全部']), kind: 'select', options: ['仅严重', '重要及以上', '全部'] },
      ],
      ops: [
        op('enable-org', '启用机构', { effect: { state: 'online' } }),
        op('disable-org', '停用机构', { danger: true, confirm: '停用后该机构任务节点将停止工作，确认停用？', effect: { state: 'offline' } }),
      ],
    });
  }
  return out;
}

/** 设备层实体 */
function buildDeviceEntities(rng: Rng): Entity[] {
  const out: Entity[] = [];
  for (const zone of ZONES) {
    const plan = DEVICE_ZONE_PLAN[zone];
    for (const [kind, count] of Object.entries(plan)) {
      const def = DEVICE_KINDS.find((k) => k.key === kind)!;
      const pool = DEVICE_NAME_POOL[kind]!;
      for (let i = 0; i < count; i++) {
        const important = ['gateway', 'firewall', 'netgap'].includes(kind) && rng() < 0.5;
        out.push({
          id: nid('d'),
          layer: 'device',
          kind,
          kindLabel: def.label,
          name: `${ZONE_LABELS[zone]}·${pool[i % pool.length]}-${String(i + 1).padStart(2, '0')}`,
          zone,
          size: sizeOf(rng, important),
          state: rng() < 0.94 ? 'online' : 'degraded',
          attrs: [
            attr('model', '设备型号', randPick(rng, DEV_MODELS)),
            attr('brand', '品牌', randPick(rng, DEV_BRANDS)),
            attr('asset', '资产编号', `ZC-${randInt(rng, 100000, 999999)}`),
            attr('cpu', '算力配置', `${randPick(rng, [4, 8, 16, 32, 64])}C / ${randPick(rng, [16, 32, 64, 128])}G`),
            attr('expire', '到期时间', `${randInt(rng, 2026, 2029)}-${String(randInt(rng, 1, 12)).padStart(2, '0')}`),
            attr('owner', '责任人', randPick(rng, PEOPLE)),
            attr('ip', 'IP地址', `10.${randInt(rng, 0, 200)}.${randInt(rng, 0, 255)}.${randInt(rng, 2, 254)}`),
            attr('os', '操作系统', randPick(rng, OSES)),
          ],
          stats: [
            text('state', '运行状态', '在线'),
            metric('uptime', '开机时长', randInt(rng, 24, 2600), 'h', 'duration'),
            metric('activity', '活跃程度', randFloat(rng, 15, 95), '%', 'ratio'),
            metric('cpu', 'CPU使用率', randFloat(rng, 10, 90), '%', 'ratio'),
            metric('mem', '内存使用率', randFloat(rng, 20, 85), '%', 'ratio'),
          ],
          config: [
            { key: 'auto-restart', label: '异常自动重启', value: rng() < 0.7, kind: 'boolean' },
            { key: 'monitor-interval', label: '监控采样间隔', value: randPick(rng, [5, 10, 30]), kind: 'number', unit: '秒' },
            { key: 'bandwidth-limit', label: '带宽上限', value: randPick(rng, [1, 4, 10]), kind: 'number', unit: 'Gbps' },
          ],
          ops: [
            op('start-device', '启动设备', { effect: { state: 'online' } }),
            op('stop-device', '停止设备', { danger: true, confirm: '停止后其上运行的应用与服务将中断，确认停止？', effect: { state: 'offline' } }),
            op('config-firewall', '配置防火墙', {
              params: [
                { key: 'rule', label: '规则名称', value: '', kind: 'text' },
                { key: 'action', label: '动作', value: 'deny', kind: 'select', options: ['deny', 'allow'] },
                { key: 'port', label: '端口', value: 443, kind: 'number' },
              ],
              effect: { statPatch: [{ key: 'activity', value: 88 }] },
            }),
            op('exec-cmd', '执行管理命令', {
              params: [
                { key: 'cmd', label: '命令', value: 'systemctl status', kind: 'text' },
                { key: 'args', label: '参数', value: '', kind: 'text' },
              ],
            }),
            op('reboot-device', '重启设备', { confirm: '重启约需 60 秒，期间业务短暂中断，确认重启？', effect: { state: 'degraded' } }),
          ],
        });
      }
    }
  }
  return out;
}

/** 应用层实体 */
function buildAppEntities(rng: Rng): Entity[] {
  const out: Entity[] = [];
  for (const zone of ZONES) {
    const plan = APP_ZONE_PLAN[zone];
    for (const [kind, count] of Object.entries(plan)) {
      const def = APP_KINDS.find((k) => k.key === kind)!;
      const pool = APP_NAME_POOL[kind]!;
      for (let i = 0; i < count; i++) {
        const important = ['threat-response', 'vpn-service', 'data-storage'].includes(kind) && rng() < 0.6;
        const inBytes = randInt(rng, 50, 9000);
        out.push({
          id: nid('a'),
          layer: 'app',
          kind,
          kindLabel: def.label,
          name: `${ZONE_LABELS[zone]}·${pool[i % pool.length]}-${String(i + 1).padStart(2, '0')}`,
          zone,
          size: sizeOf(rng, important),
          state: rng() < 0.95 ? 'online' : 'degraded',
          attrs: [
            attr('type', '类型', def.label),
            attr('version', '版本', `v${randInt(rng, 1, 5)}.${randInt(rng, 0, 9)}.${randInt(rng, 0, 9)}`),
            attr('unit', '开发单位', randPick(rng, APP_UNITS)),
            attr('admin', '管理员', randPick(rng, PEOPLE)),
            attr('path', '部署路径', `/opt/apps/${kind}-${randInt(rng, 100, 999)}`),
            attr('port', '监听端口', String(randPick(rng, [8080, 8443, 9000, 9200, 3306, 6379]))),
          ],
          stats: [
            text('state', '运行状态', '在线'),
            metric('uptime', '服务时长', randInt(rng, 20, 2100), 'h', 'duration'),
            metric('tasks', '承载任务数', randInt(rng, 1, 40), '个'),
            metric('in-bytes', '输入数据量', inBytes, 'GB', 'bytes'),
            metric('out-bytes', '输出数据量', Math.round(inBytes * randFloat(rng, 0.3, 1.5)), 'GB', 'bytes'),
            metric('in-biz-ratio', '输入·业务数据占比', randFloat(rng, 20, 80), '%', 'ratio'),
            metric('out-task-ratio', '输出·任务数据占比', randFloat(rng, 20, 80), '%', 'ratio'),
          ],
          config: [
            { key: 'threads', label: '处理线程数', value: randPick(rng, [4, 8, 16]), kind: 'number' },
            { key: 'log-level', label: '日志级别', value: 'info', kind: 'select', options: ['debug', 'info', 'warn', 'error'] },
            { key: 'retention', label: '数据保留期', value: randPick(rng, [7, 30, 90]), kind: 'number', unit: '天' },
            { key: 'encrypt', label: '传输加密', value: rng() < 0.8, kind: 'boolean' },
          ],
          ops: [
            op('start-service', '启动服务', { effect: { state: 'online' } }),
            op('stop-service', '停止服务', { danger: true, confirm: '停止后承载任务将中断，确认停止？', effect: { state: 'offline' } }),
            op('config-params', '配置运行参数', {
              params: [
                { key: 'threads', label: '处理线程数', value: 8, kind: 'number' },
                { key: 'log-level', label: '日志级别', value: 'info', kind: 'select', options: ['debug', 'info', 'warn', 'error'] },
              ],
            }),
            op('data-manage', '执行数据管理', {
              params: [
                { key: 'action', label: '操作', value: '归档', kind: 'select', options: ['清理', '归档', '导出'] },
                { key: 'range', label: '时间范围', value: '近7天', kind: 'text' },
              ],
            }),
            op('restart-service', '重启服务', { confirm: '重启期间服务短暂不可用，确认重启？', effect: { state: 'degraded' } }),
          ],
        });
      }
    }
  }
  return out;
}

/** 任务层实体（多级树：总部 → 大区总代理 → 终端网点） */
function buildTaskEntities(rng: Rng): Entity[] {
  const out: Entity[] = [];
  const usedNames = new Set<string>();
  for (const zone of ZONES) {
    const plan = TASK_ZONE_PLAN[zone];
    for (const [kind, { regions, leaves }] of Object.entries(plan)) {
      const def = TASK_KINDS.find((k) => k.key === kind)!;
      const rootId = nid('t');
      const rootName = `${ZONE_LABELS[zone]}·${def.label}`;
      usedNames.add(rootName);
      out.push({
        id: rootId,
        layer: 'task',
        kind,
        kindLabel: def.label,
        name: rootName,
        zone,
        size: 3,
        level: 0,
        state: 'online',
        attrs: [
          attr('code', '任务编号', `T-${def.key.toUpperCase()}-${zone.slice(0, 2).toUpperCase()}`),
          attr('owner', '负责人', randPick(rng, PEOPLE)),
          attr('org', '所属组织', randPick(rng, TASK_ORGS)),
          attr('cycle', '计划周期', randPick(rng, ['日', '周', '月', '季度'])),
          attr('priority', '优先级', randPick(rng, ['P0', 'P1', 'P2'])),
        ],
        stats: [
          text('state', '任务状态', '运行中'),
          metric('progress', '任务进度', randFloat(rng, 30, 95), '%', 'ratio'),
          metric('queue', '队列长度', randInt(rng, 5, 200), '项'),
          metric('output', '今日产出量', randInt(rng, 100, 8000), '条'),
          metric('timeout', '超时率', randFloat(rng, 0.2, 6), '%', 'ratio'),
        ],
        config: [
          { key: 'dispatch-freq', label: '下发频率', value: randPick(rng, [5, 15, 30, 60]), kind: 'number', unit: '分钟' },
          { key: 'retention', label: '数据保留期', value: randPick(rng, [30, 90, 180]), kind: 'number', unit: '天' },
          { key: 'alert-on-fail', label: '失败即时告警', value: true, kind: 'boolean' },
        ],
        ops: [
          op('dispatch-task', '任务下发', {
            params: [
              { key: 'name', label: '任务名称', value: '', kind: 'text' },
              { key: 'priority', label: '优先级', value: 'P2', kind: 'select', options: ['P0', 'P1', 'P2'] },
            ],
          }),
          op('config-strategy', '策略配置', {
            params: [
              { key: 'freq', label: '下发频率(分)', value: 15, kind: 'number' },
              { key: 'retention', label: '保留期(天)', value: 90, kind: 'number' },
            ],
          }),
          op('pause-task', '暂停任务', { effect: { state: 'degraded' } }),
          op('resume-task', '恢复任务', { effect: { state: 'online' } }),
        ],
      });

      const areaNames = shuffle(rng, [...TASK_AREA_NAMES]).slice(0, regions);
      for (let ri = 0; ri < regions; ri++) {
        const regionId = nid('t');
        const regionName = `${ZONE_LABELS[zone]}·${def.label}·${areaNames[ri]}大区`;
        out.push({
          id: regionId,
          layer: 'task',
          kind,
          kindLabel: def.label,
          name: regionName,
          zone,
          parentId: rootId,
          level: 1,
          size: 2,
          state: rng() < 0.97 ? 'online' : 'busy',
          attrs: [
            attr('code', '任务编号', `T-${def.key.toUpperCase()}-${zone.slice(0, 2).toUpperCase()}-R${ri + 1}`),
            attr('owner', '负责人', randPick(rng, PEOPLE)),
            attr('cycle', '计划周期', '日'),
            attr('priority', '优先级', randPick(rng, ['P1', 'P2'])),
          ],
          stats: [
            text('state', '任务状态', '运行中'),
            metric('progress', '任务进度', randFloat(rng, 30, 95), '%', 'ratio'),
            metric('queue', '队列长度', randInt(rng, 5, 120), '项'),
            metric('output', '今日产出量', randInt(rng, 50, 3000), '条'),
          ],
          config: [{ key: 'dispatch-freq', label: '下发频率', value: randPick(rng, [15, 30, 60]), kind: 'number', unit: '分钟' }],
          ops: [
            op('dispatch-task', '任务下发', {}),
            op('pause-task', '暂停任务', { effect: { state: 'degraded' } }),
            op('resume-task', '恢复任务', { effect: { state: 'online' } }),
          ],
        });

        const leafNames = shuffle(rng, [...TASK_LEAF_NAMES]).slice(0, leaves);
        for (let li = 0; li < leaves; li++) {
          out.push({
            id: nid('t'),
            layer: 'task',
            kind,
            kindLabel: def.label,
            name: `${regionName}·${leafNames[li]}`,
            zone,
            parentId: regionId,
            level: 2,
            size: 1,
            state: rng() < 0.96 ? 'online' : 'busy',
            attrs: [
              attr('code', '任务编号', `T-${def.key.toUpperCase()}-${zone.slice(0, 2).toUpperCase()}-R${ri + 1}L${li + 1}`),
              attr('owner', '负责人', randPick(rng, PEOPLE)),
              attr('cycle', '计划周期', '日'),
              attr('priority', '优先级', 'P2'),
            ],
            stats: [
              text('state', '任务状态', '运行中'),
              metric('progress', '任务进度', randFloat(rng, 20, 98), '%', 'ratio'),
              metric('queue', '队列长度', randInt(rng, 2, 40), '项'),
              metric('output', '今日产出量', randInt(rng, 10, 800), '条'),
            ],
            config: [],
            ops: [
              op('dispatch-task', '任务下发', {}),
              op('pause-task', '暂停任务', { effect: { state: 'degraded' } }),
              op('resume-task', '恢复任务', { effect: { state: 'online' } }),
            ],
          });
        }
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 关系生成
// ---------------------------------------------------------------------------

function rel(from: string, to: string, kind: 'control' | 'data', extra: Partial<Relation> = {}): Relation {
  return {
    id: nid('r'),
    from,
    to,
    kind,
    scope: extra.scope ?? 'intra',
    importance: extra.importance ?? 'normal',
    volume: extra.volume ?? randFloat(rng, 0.15, 1),
    ...(extra as object),
  };
}
// rel 使用全局 rng（见 main 中声明顺序）

let rng: Rng;

function byZoneKind(entities: Entity[], zone: ZoneId, kind: string): Entity[] {
  return entities.filter((e) => e.zone === zone && e.kind === kind);
}

function buildRelations(entities: Entity[]): Relation[] {
  const out: Relation[] = [];
  const devices = entities.filter((e) => e.layer === 'device');
  const apps = entities.filter((e) => e.layer === 'app');
  const tasks = entities.filter((e) => e.layer === 'task');
  const geos = entities.filter((e) => e.layer === 'geo');

  // --- 设备层：区域内控制/数据链 ---
  for (const zone of ZONES) {
    const gws = byZoneKind(devices, zone, 'gateway');
    const fws = byZoneKind(devices, zone, 'firewall');
    const srvs = byZoneKind(devices, zone, 'server');
    const terms = byZoneKind(devices, zone, 'terminal');
    const vps = byZoneKind(devices, zone, 'vps');
    const proxies = byZoneKind(devices, zone, 'residential-proxy');
    const nets = byZoneKind(devices, zone, 'netgap');
    const lines = byZoneKind(devices, zone, 'dedicated-line');
    const dd = byZoneKind(devices, zone, 'dedicated-device');
    const enclaves = byZoneKind(devices, zone, 'enclave-idc');

    // 网关 → 防火墙 关键控制链
    for (const gw of gws.slice(0, 2)) {
      for (const fw of fws.slice(0, 2)) {
        out.push(rel(gw.id, fw.id, 'control', { importance: 'critical', volume: randFloat(rng, 0.4, 0.9) }));
      }
    }
    // 防火墙 → 服务器 控制（采样防爆炸）
    for (const fw of fws) {
      for (const s of randPickN(rng, srvs, Math.min(4, srvs.length))) {
        out.push(rel(fw.id, s.id, 'control', { volume: randFloat(rng, 0.2, 0.6) }));
      }
    }
    // 终端 → 服务器 数据
    for (const t of terms) {
      out.push(rel(t.id, randPick(rng, srvs).id, 'data', { volume: randFloat(rng, 0.1, 0.7) }));
    }
    // 服务器互连数据（链式环）
    for (let i = 0; i < srvs.length; i++) {
      out.push(rel(srvs[i]!.id, srvs[(i + 1) % srvs.length]!.id, 'data', { volume: randFloat(rng, 0.2, 0.9) }));
    }
    // 网闸 → 服务器 控制
    for (const n of nets) {
      const s = randPick(rng, srvs);
      out.push(rel(n.id, s.id, 'control', { importance: rng() < 0.5 ? 'critical' : 'normal', volume: randFloat(rng, 0.3, 0.8) }));
    }
    // VPS 控制/数据
    for (const v of vps) {
      if (gws.length > 0) out.push(rel(randPick(rng, gws).id, v.id, 'control', { volume: randFloat(rng, 0.2, 0.7) }));
      const other = randPick(rng, vps.filter((x) => x.id !== v.id));
      if (other) out.push(rel(v.id, other.id, 'data', { volume: randFloat(rng, 0.1, 0.6) }));
    }
    // 专线设备 → 专线线路 数据
    for (const l of lines) {
      const d = randPick(rng, dd.length > 0 ? dd : srvs);
      out.push(rel(d.id, l.id, 'data', { volume: randFloat(rng, 0.3, 1) }));
    }
    // 住宅代理 → VPS 控制
    for (const p of proxies) {
      if (vps.length > 0) out.push(rel(randPick(rng, vps).id, p.id, 'control', { volume: randFloat(rng, 0.2, 0.6) }));
    }
    // 飞地机房 → 服务器/网关/专线设备 数据
    for (const enc of enclaves) {
      const pool = srvs.length > 0 ? srvs : gws.length > 0 ? gws : dd;
      const target = randPick(rng, pool);
      if (target) out.push(rel(enc.id, target.id, 'data', { volume: randFloat(rng, 0.2, 0.8) }));
    }
  }

  // --- 设备层：跨区域边界链（关键控制） ---
  const entFw = byZoneKind(devices, 'enterprise', 'firewall');
  const bizGw = byZoneKind(devices, 'business', 'gateway');
  const cnGw = byZoneKind(devices, 'cn-public', 'gateway');
  const glGw = byZoneKind(devices, 'global-public', 'gateway');
  if (entFw.length > 0 && bizGw.length > 0)
    out.push(rel(entFw[0]!.id, bizGw[0]!.id, 'control', { importance: 'critical', volume: randFloat(rng, 0.5, 1) }));
  if (bizGw.length > 0 && cnGw.length > 0)
    out.push(rel(bizGw[0]!.id, cnGw[0]!.id, 'control', { importance: 'critical', volume: randFloat(rng, 0.4, 0.9) }));
  if (cnGw.length > 0 && glGw.length > 0)
    out.push(rel(cnGw[0]!.id, glGw[0]!.id, 'control', { importance: 'critical', volume: randFloat(rng, 0.3, 0.8) }));
  const bizLines = byZoneKind(devices, 'business', 'dedicated-line');
  const cnLines = byZoneKind(devices, 'cn-public', 'dedicated-line');
  for (const l of bizLines) {
    const d = randPick(rng, cnLines.length > 0 ? cnLines : cnGw);
    if (d) out.push(rel(l.id, d.id, 'data', { volume: randFloat(rng, 0.4, 1) }));
  }

  // --- 应用层：控制/数据链 ---
  for (const zone of ZONES) {
    const zoneApps = apps.filter((a) => a.zone === zone);
    const monitors = zoneApps.filter((a) => a.kind === 'security-monitor');
    const thr = zoneApps.filter((a) => a.kind === 'threat-response');
    const collectors = zoneApps.filter((a) => a.kind === 'data-collect');
    const analyzers = zoneApps.filter((a) => a.kind === 'data-analysis');
    const storages = zoneApps.filter((a) => a.kind === 'data-storage');
    const bizApps = zoneApps.filter((a) => a.kind === 'biz-app');
    const arpApps = zoneApps.filter((a) => a.kind === 'arp-app');
    const arpSvcs = zoneApps.filter((a) => a.kind === 'arp-service');
    const vpns = zoneApps.filter((a) => a.kind === 'vpn-service');
    const proxies = zoneApps.filter((a) => a.kind === 'transport-proxy');
    const pubs = zoneApps.filter((a) => a.kind === 'info-publish');
    const vpc = zoneApps.filter((a) => a.kind === 'vps-control');
    const mgmt = zoneApps.filter((a) => a.kind === 'biz-mgmt-terminal');

    // 安全监测 → 应用 控制（采样）
    for (const m of monitors) {
      const targets = randPickN(rng, zoneApps.filter((a) => a !== m), Math.min(6, zoneApps.length - 1));
      for (const t of targets) out.push(rel(m.id, t.id, 'control', { volume: randFloat(rng, 0.1, 0.5) }));
    }
    // 威胁处置 → 安全监测 关键控制
    for (const t of thr) {
      const m = randPick(rng, monitors);
      if (m) out.push(rel(t.id, m.id, 'control', { importance: 'critical', volume: randFloat(rng, 0.5, 0.9) }));
    }
    // 采集 → 分析 → 存储 数据链
    for (const c of collectors) {
      const a = randPick(rng, analyzers);
      if (a) out.push(rel(c.id, a.id, 'data', { volume: randFloat(rng, 0.3, 0.9) }));
    }
    for (const a of analyzers) {
      const s = randPick(rng, storages);
      if (s) out.push(rel(a.id, s.id, 'data', { volume: randFloat(rng, 0.3, 0.9) }));
    }
    // 业务APP → 采集 数据
    for (const b of bizApps) {
      const c = randPick(rng, collectors);
      if (c) out.push(rel(b.id, c.id, 'data', { volume: randFloat(rng, 0.2, 0.8) }));
    }
    // ARP 应用 → ARP 服务 数据
    for (const a of arpApps) {
      const s = randPick(rng, arpSvcs);
      if (s) out.push(rel(a.id, s.id, 'data', { volume: randFloat(rng, 0.2, 0.7) }));
    }
    // VPN ↔ 传输代理 数据
    for (const v of vpns) {
      const p = randPick(rng, proxies);
      if (p) out.push(rel(v.id, p.id, 'data', { volume: randFloat(rng, 0.3, 0.9) }));
    }
    // 发布 → 存储 数据
    for (const p of pubs) {
      const s = randPick(rng, storages);
      if (s) out.push(rel(s.id, p.id, 'data', { volume: randFloat(rng, 0.2, 0.6) }));
    }
    // 管理终端 → 业务APP 控制
    for (const m of mgmt) {
      const b = randPick(rng, bizApps);
      if (b) out.push(rel(m.id, b.id, 'control', { importance: rng() < 0.4 ? 'critical' : 'normal', volume: randFloat(rng, 0.2, 0.6) }));
    }
    // VPS 控制软件 → 业务APP 控制
    for (const v of vpc) {
      const b = randPick(rng, bizApps.length > 0 ? bizApps : zoneApps);
      if (b) out.push(rel(v.id, b.id, 'control', { volume: randFloat(rng, 0.2, 0.6) }));
    }
  }

  // --- 任务层：树形 控制下发（父→子）+ 数据上报（子→父） ---
  for (const t of tasks) {
    if (t.parentId) {
      out.push(rel(t.parentId, t.id, 'control', { importance: t.level === 1 ? 'critical' : 'normal', volume: randFloat(rng, 0.2, 0.7) }));
      out.push(rel(t.id, t.parentId, 'data', { volume: randFloat(rng, 0.3, 0.9) }));
    }
  }

  // --- 层间关联 ---
  // deploy: 机房/云机房 → 设备
  const rooms = geos.filter((g) => g.kind === 'idc');
  const clouds = geos.filter((g) => g.kind === 'cloud-idc');
  for (const d of devices) {
    let host: Entity | undefined;
    if (d.zone === 'global-public') {
      host = randPick(rng, clouds.length > 0 ? clouds : rooms);
    } else if (d.kind === 'vps' && d.zone === 'cn-public') {
      host = randPick(rng, clouds);
    } else {
      host = randPick(rng, rooms);
    }
    if (host) out.push(rel(host.id, d.id, 'control', { scope: 'cross', crossType: 'deploy', volume: randFloat(rng, 0.2, 0.8) }));
  }
  // run: 设备（服务器/VPS）→ 应用
  const servers = devices.filter((d) => d.kind === 'server' || d.kind === 'vps');
  for (const a of apps) {
    const candidates = servers.filter((s) => s.zone === a.zone);
    const host = randPick(rng, candidates.length > 0 ? candidates : servers);
    if (host) out.push(rel(host.id, a.id, 'control', { scope: 'cross', crossType: 'run', volume: randFloat(rng, 0.2, 0.8) }));
  }
  // bear: 应用 → 任务（应用承载任务节点数据与策略）
  const bizOrDataApps = apps.filter((a) => ['biz-app', 'data-analysis', 'data-storage', 'data-collect'].includes(a.kind));
  const taskRoots = tasks.filter((t) => t.level === 0);
  for (const t of taskRoots) {
    const candidates = bizOrDataApps.filter((a) => a.zone === t.zone);
    const host = randPick(rng, candidates.length > 0 ? candidates : bizOrDataApps);
    if (host) out.push(rel(host.id, t.id, 'control', { scope: 'cross', crossType: 'bear', volume: randFloat(rng, 0.3, 0.9) }));
  }
  // own: 组织机构 → 任务（总部/分公司隶属任务节点）
  const orgs = geos.filter((g) => g.kind === 'org');
  const entRoots = tasks.filter((t) => t.level === 0 && t.zone === 'enterprise');
  for (let i = 0; i < Math.min(orgs.length, entRoots.length); i++) {
    out.push(rel(orgs[i]!.id, entRoots[i]!.id, 'control', { scope: 'cross', crossType: 'own', volume: randFloat(rng, 0.2, 0.6) }));
  }

  return out;
}

// ---------------------------------------------------------------------------
// 剧本生成
// ---------------------------------------------------------------------------

function alertOn(
  rngLocal: Rng,
  entities: Entity[],
  relations: Relation[],
  kind: IncidentKind,
  layer: Entity['layer'],
  zone: ZoneId | null,
  entityKind: string | null,
  t: number,
): { ev: SimEvent; alert: ReturnType<typeof buildAlert> } | null {
  const tpl = ALERT_TEMPLATES.find((x) => x.kind === kind && x.layer === layer)!;
  let pool = entities.filter((e) => e.layer === layer);
  if (zone) pool = pool.filter((e) => e.zone === zone);
  if (entityKind) pool = pool.filter((e) => e.kind === entityKind);
  if (pool.length === 0) return null;
  const e = randPick(rngLocal, pool);
  const relCandidates = relations.filter((r) => r.from === e.id || r.to === e.id);
  const alert = buildAlert(
    tpl,
    e.id,
    e.name,
    e.kindLabel,
    t,
    relCandidates.length > 0 ? { relationId: randPick(rngLocal, relCandidates).id } : {},
  );
  return { ev: { type: 'alert:raise', alert }, alert };
}

/** 动态提示消息/工单步骤（固定模板、固定 id，不消耗 rng，保证告警时间点稳定） */
function noticeStep(tpl: NoticeTemplate, at: number, scenarioId: string): { at: number; events: SimEvent[] } {
  return {
    at,
    events: [{ type: 'notice:push', notice: buildNotice(tpl, at, { id: `nt-${scenarioId}-${at}` }) }],
  };
}

function buildScenarios(entities: Entity[], relations: Relation[]): Scenario[] {
  const sRng = mulberry32(20260828);

  // 1. 正常运转（少量提示级告警，自动恢复）
  const normalSteps: { at: number; events: SimEvent[] }[] = [];
  for (const t of [15, 55, 95]) {
    const r = alertOn(sRng, entities, relations, 'degraded', 'device', null, null, t);
    if (r) {
      normalSteps.push({ at: t, events: [r.ev] });
      normalSteps.push({ at: t + 20, events: [{ type: 'alert:clear', alertId: r.alert.id }] });
    }
  }
  normalSteps.push(
    noticeStep(NOTICE_TEMPLATES[0]!, 5, 'normal'),
    noticeStep(NOTICE_TEMPLATES[2]!, 50, 'normal'),
    noticeStep(NOTICE_TEMPLATES[4]!, 100, 'normal'),
  );

  // 2. 故障演练
  const faultSteps: { at: number; events: SimEvent[] }[] = [];
  {
    const room = entities.find((e) => e.layer === 'geo' && e.kind === 'idc');
    const fw = entities.find((e) => e.layer === 'device' && e.kind === 'firewall');
    const app = entities.find((e) => e.layer === 'app' && e.kind === 'data-analysis');
    const task = entities.find((e) => e.layer === 'task' && e.level === 1);
    if (room) {
      const r = alertOn(sRng, entities, relations, 'offline', 'geo', null, null, 10);
      if (r) faultSteps.push({
        at: 10,
        events: [
          { type: 'entity:state', entityId: room.id, state: 'offline' },
          r.ev,
        ],
      });
    }
    if (fw) {
      const r = alertOn(sRng, entities, relations, 'degraded', 'device', null, null, 25);
      if (r) faultSteps.push({ at: 25, events: [{ type: 'entity:state', entityId: fw.id, state: 'degraded' }, r.ev] });
    }
    if (app) {
      const r = alertOn(sRng, entities, relations, 'fault', 'app', null, null, 45);
      if (r) faultSteps.push({ at: 45, events: [{ type: 'entity:state', entityId: app.id, state: 'offline' }, r.ev] });
    }
    if (task) {
      const r = alertOn(sRng, entities, relations, 'fault', 'task', null, null, 60);
      if (r) faultSteps.push({ at: 60, events: [{ type: 'entity:state', entityId: task.id, state: 'degraded' }, r.ev] });
    }
    // 恢复
    faultSteps.push({
      at: 85,
      events: [
        { type: 'entity:state', entityId: room!.id, state: 'online' },
        { type: 'entity:state', entityId: fw!.id, state: 'online' },
        { type: 'entity:state', entityId: app!.id, state: 'online' },
        { type: 'entity:state', entityId: task!.id, state: 'online' },
        ...faultSteps.flatMap((s) => s.events.filter((e) => e.type === 'alert:raise').map((e) => ({ type: 'alert:clear' as const, alertId: (e as { alert: { id: string } }).alert.id }))),
      ],
    });
    faultSteps.push(
      noticeStep(NOTICE_TEMPLATES[1]!, 2, 'fault'),
      noticeStep(NOTICE_TEMPLATES[5]!, 40, 'fault'),
      noticeStep(NOTICE_TEMPLATES[6]!, 88, 'fault'),
    );
  }

  // 3. 攻击告警
  const attackSteps: { at: number; events: SimEvent[] }[] = [];
  {
    const fw = entities.find((e) => e.layer === 'device' && e.kind === 'firewall');
    const vps = entities.find((e) => e.layer === 'device' && e.kind === 'vps' && e.zone === 'global-public');
    const monitor = entities.find((e) => e.layer === 'app' && e.kind === 'security-monitor');
    const thr = entities.find((e) => e.layer === 'app' && e.kind === 'threat-response');
    const analysis = entities.find((e) => e.layer === 'app' && e.kind === 'data-analysis');
    if (fw) {
      const r = alertOn(sRng, entities, relations, 'attack', 'device', null, 'firewall', 8);
      const rels = relations.filter((x) => x.from === fw.id || x.to === fw.id).slice(0, 3);
      if (r) attackSteps.push({
        at: 8,
        events: [
          { type: 'entity:state', entityId: fw.id, state: 'busy' },
          r.ev,
          ...rels.map((x) => ({ type: 'relation:kind' as const, relationId: x.id, kind: 'alert' as const })),
        ],
      });
    }
    if (monitor) {
      const r = alertOn(sRng, entities, relations, 'fault', 'app', null, 'security-monitor', 15);
      if (r) attackSteps.push({ at: 15, events: [{ type: 'entity:state', entityId: monitor.id, state: 'busy' }, r.ev] });
    }
    if (vps) {
      const r = alertOn(sRng, entities, relations, 'offline', 'device', 'global-public', 'vps', 25);
      if (r) attackSteps.push({ at: 25, events: [{ type: 'entity:state', entityId: vps.id, state: 'offline' }, r.ev] });
    }
    if (thr) attackSteps.push({ at: 30, events: [{ type: 'entity:state', entityId: thr.id, state: 'busy' }] });
    if (analysis) {
      const r = alertOn(sRng, entities, relations, 'blocked', 'app', null, 'data-analysis', 40);
      if (r) attackSteps.push({ at: 40, events: [{ type: 'entity:state', entityId: analysis.id, state: 'busy' }, r.ev] });
    }
    // 处置恢复
    attackSteps.push({
      at: 80,
      events: [
        { type: 'entity:state', entityId: fw!.id, state: 'online' },
        { type: 'entity:state', entityId: vps!.id, state: 'online' },
        { type: 'entity:state', entityId: monitor!.id, state: 'online' },
        { type: 'entity:state', entityId: thr!.id, state: 'online' },
        { type: 'entity:state', entityId: analysis!.id, state: 'online' },
        ...attackSteps.flatMap((s) => s.events.filter((e) => e.type === 'alert:raise').map((e) => ({ type: 'alert:clear' as const, alertId: (e as { alert: { id: string } }).alert.id }))),
        ...attackSteps.flatMap((s) => s.events.filter((e) => e.type === 'relation:kind').map((e) => ({ type: 'relation:kind' as const, relationId: (e as { relationId: string }).relationId, kind: 'data' as const }))),
      ],
    });
    attackSteps.push(
      noticeStep(NOTICE_TEMPLATES[3]!, 2, 'attack'),
      noticeStep(NOTICE_TEMPLATES[7]!, 35, 'attack'),
    );
  }

  // 4. 跨层故障链：机房离线 → 设备离线 → 应用故障 → 任务阻塞
  const chainSteps: { at: number; events: SimEvent[] }[] = [];
  {
    const room = entities.find((e) => e.layer === 'geo' && e.kind === 'idc');
    const roomDevices = room
      ? relations.filter((r) => r.scope === 'cross' && r.crossType === 'deploy' && r.from === room.id).map((r) => r.to)
      : [];
    const roomApps = roomDevices
      .flatMap((did) => relations.filter((r) => r.scope === 'cross' && r.crossType === 'run' && r.from === did).map((r) => r.to))
      .slice(0, 3);
    const roomTasks = roomApps
      .flatMap((aid) => relations.filter((r) => r.scope === 'cross' && r.crossType === 'bear' && r.from === aid).map((r) => r.to))
      .slice(0, 2);

    const nameOf = (id: string): string => entities.find((e) => e.id === id)?.name ?? id;
    const kindLabelOf = (id: string): string => entities.find((e) => e.id === id)?.kindLabel ?? '';
    const offlineTpl = ALERT_TEMPLATES.find((x) => x.kind === 'offline' && x.layer === 'device')!;
    const appFaultTpl = ALERT_TEMPLATES.find((x) => x.kind === 'fault' && x.layer === 'app')!;
    const taskFaultTpl = ALERT_TEMPLATES.find((x) => x.kind === 'fault' && x.layer === 'task')!;

    const devEvents: SimEvent[] = [];
    for (const did of roomDevices.slice(0, 4)) {
      devEvents.push(
        { type: 'entity:state', entityId: did, state: 'offline' },
        { type: 'alert:raise', alert: buildAlert(offlineTpl, did, nameOf(did), kindLabelOf(did), 22) },
      );
    }
    const appEvents: SimEvent[] = [];
    for (const aid of roomApps) {
      appEvents.push(
        { type: 'entity:state', entityId: aid, state: 'offline' },
        { type: 'alert:raise', alert: buildAlert(appFaultTpl, aid, nameOf(aid), kindLabelOf(aid), 35) },
      );
    }
    const taskEvents: SimEvent[] = [];
    for (const tid of roomTasks) {
      taskEvents.push(
        { type: 'entity:state', entityId: tid, state: 'degraded' },
        { type: 'alert:raise', alert: buildAlert(taskFaultTpl, tid, nameOf(tid), kindLabelOf(tid), 48) },
      );
    }

    if (room) {
      const r = alertOn(sRng, entities, relations, 'offline', 'geo', null, null, 12);
      if (r) chainSteps.push({ at: 12, events: [{ type: 'entity:state', entityId: room.id, state: 'offline' }, r.ev] });
    }
    if (devEvents.length > 0) chainSteps.push({ at: 22, events: devEvents });
    if (appEvents.length > 0) chainSteps.push({ at: 35, events: appEvents });
    if (taskEvents.length > 0) chainSteps.push({ at: 48, events: taskEvents });
    // 恢复（逆序）
    chainSteps.push({
      at: 90,
      events: [
        { type: 'entity:state', entityId: room!.id, state: 'online' },
        ...roomDevices.map((did) => ({ type: 'entity:state' as const, entityId: did, state: 'online' as const })),
        ...roomApps.map((aid) => ({ type: 'entity:state' as const, entityId: aid, state: 'online' as const })),
        ...roomTasks.map((tid) => ({ type: 'entity:state' as const, entityId: tid, state: 'online' as const })),
        ...chainSteps.flatMap((s) => s.events.filter((e) => e.type === 'alert:raise').map((e) => ({ type: 'alert:clear' as const, alertId: (e as { alert: { id: string } }).alert.id }))),
      ],
    });
    chainSteps.push(
      noticeStep(NOTICE_TEMPLATES[1]!, 2, 'chain'),
      noticeStep(NOTICE_TEMPLATES[5]!, 55, 'chain'),
      noticeStep(NOTICE_TEMPLATES[6]!, 92, 'chain'),
    );
  }

  const mk = (id: string, name: string, description: string, steps: { at: number; events: SimEvent[] }[]): Scenario => ({
    id,
    name,
    description,
    duration: 120,
    loop: true,
    steps,
  });

  return [
    mk('normal', '正常运转', '系统平稳运行，仅有少量常规提示信息与指标波动。', normalSteps),
    mk('fault', '故障演练', '机房离线、设备降级、应用故障依次发生并处置恢复的演练过程。', faultSteps),
    mk('attack', '攻击告警', '边界防火墙遭受攻击、境内境外节点联动告警、安全处置闭环演示。', attackSteps),
    mk('chain', '跨层故障链', '机房离线沿 部署→运行→承载 关联逐层传导，展示跨层关联的价值。', chainSteps),
  ];
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2);
  const seed = Number(args[0] ?? 20260828) >>> 0;
  const outArg = args.indexOf('--out');
  const outPath =
    outArg >= 0 && args[outArg + 1]
      ? args[outArg + 1]!
      : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/data/dataset.json');

  rng = mulberry32(seed);

  const entities: Entity[] = [
    ...buildGeoEntities(rng),
    ...buildDeviceEntities(rng),
    ...buildAppEntities(rng),
    ...buildTaskEntities(rng),
  ];
  const relations = buildRelations(entities);
  const scenarios = buildScenarios(entities, relations);

  const dataset: Dataset = {
    meta: {
      version: 3,
      seed,
      // 由种子推导的稳定生成时间，保证同 seed 输出逐字节一致
      generatedAt: new Date(1720000000000 + seed * 86400000).toISOString(),
      entityCount: entities.length,
      relationCount: relations.length,
    },
    entities,
    relations,
    scenarios,
  };

  const result = validateDataset(dataset);
  const byLayer: Record<string, number> = {};
  for (const e of entities) byLayer[e.layer] = (byLayer[e.layer] ?? 0) + 1;

  console.log(`实体: ${entities.length}  ${JSON.stringify(byLayer)}`);
  console.log(`关系: ${relations.length}（层间 ${relations.filter((r) => r.scope === 'cross').length}）`);
  console.log(`剧本: ${scenarios.map((s) => s.name).join(' / ')}`);
  console.log(`校验: ${result.ok ? '通过' : `失败\n  - ${result.errors.join('\n  - ')}`}`);

  if (!result.ok) {
    console.error('数据集校验失败，未写入输出。');
    process.exit(1);
  }

  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(dataset, null, 1));
  console.log(`已写入: ${outPath} (${(JSON.stringify(dataset).length / 1024).toFixed(1)} KB)`);
}

main();
