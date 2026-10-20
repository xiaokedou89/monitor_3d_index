/**
 * 智能助手（P4，右上角 💬 打开）：离线演示问答助手。
 * 无后端：关键词匹配本地知识库（answerFor 纯函数，可单测）；
 * 窗口为对话窗体，预置欢迎语，输入问题即时返回匹配答案。
 */
import type { AppStore } from './store/app-store';
import { clear, el } from './dom';

export interface AssistantAnswer {
  title: string;
  body: string;
}

/** 地图数据合规声明（演示数据来源与生产替换要求，须随文档/界面传播） */
const COMPLIANCE =
  '演示用地图数据取自 DataV.GeoAtlas；生产环境请替换为自然资源部标准地图服务（bzdt.ch.mnr.gov.cn）发布的标准地图并标注审图号。';

interface QaEntry {
  keys: string[];
  title: string;
  body: string;
}

const KB: QaEntry[] = [
  {
    keys: ['布局', '世界地图', '美洲', '欧洲', '美国'],
    title: '地图布局 A/B',
    body:
      '地域层地图支持两种显示布局，在 设置 → 布局设置 → 地图布局 切换：\n' +
      '· A 布局（默认）：以中国为中心，欧洲在最左端、美洲在最右端，与美国机房的连线在观察范围内；\n' +
      '· B 布局：世界地图常规布局（中国在最右端）。\n' +
      'A/B 布局均保持 1:1 地理比例（美洲区做 +360° 经度平移，不压缩）。\n' +
      COMPLIANCE,
  },
  {
    keys: ['设置', '显示设置', '布局设置', '演示设置', '泛光', '光晕', '分离'],
    title: '设置入口（3 个 tab）',
    body:
      '顶栏 ⚙ 设置 打开设置面板，分三个 tab：\n' +
      '· 显示设置：标签/连线/泛光/光晕/视角控制步进等显示参数；\n' +
      '· 布局设置：层间分离距离、区域尺寸与偏移、地图布局 A/B、布局预设；\n' +
      '· 演示设置：剧本、倍速、暂停、一键导览、层间关联显示模式。',
  },
  {
    keys: ['告警', '警告', '警报'],
    title: '告警机制',
    body:
      '告警分 4 级（严重/重要/次要/提示）与 4 类（系统/安全/实体/链路）。\n' +
      '· 活动告警在 3D 实体上显示光晕特效，连线按告警数据语义变红；\n' +
      '· 左侧动态消息窗体实时滚动展示，点击条目展开详情与处置建议；\n' +
      '· 左侧消息状态区按类别计数并绘制 10 分钟折线，📜 打开该类历史列表（含已清除告警）。',
  },
  {
    keys: ['连线', '关系', '连接'],
    title: '连线语义',
    body:
      '连线按语义配色：控制（蓝，关键控制加粗流动）/ 数据（黄，粗细∝流量）/ 告警数据（红，流动虚线）。\n' +
      '点击连线查看端点、语义、实时流量与关联告警；层间关联（部署/运行/承载）默认隐藏，可在演示设置中三档开关。',
  },
  {
    keys: ['聚焦', '视角', '观察', '夹角'],
    title: '聚焦观察与视角微调',
    body:
      '点击层签或缩略图层带聚焦该层：相机拉近、其他层淡化。\n' +
      '拉近后视线与平面夹角默认 45°（显示设置可配）；聚焦状态下键盘微调视角：\n' +
      'J/K 缩小/增大夹角，H/L 向左/向右扭头，W/S/A/D/Q/E 前后左右上下移动，步进值可在显示设置中配置。',
  },
  {
    keys: ['键盘', '快捷键', '按键'],
    title: '键盘操作',
    body:
      '聚焦某层（总览除外）后生效：\n' +
      '· J/K：缩小 / 增大视线与平面夹角；\n' +
      '· H/L：向左 / 向右扭头；\n' +
      '· W/S：前 / 后移动，A/D：左 / 右移动，Q/E：下 / 上移动。\n' +
      '旋转与移动的步进值在 设置 → 显示设置 中可配置。',
  },
  {
    keys: ['展开', '区域', '子区域', '网'],
    title: '区域与展开',
    body:
      '设备/应用/任务层各分 4 个网（逻辑区域）：聚焦该层后点击区域展开按钮或缩略图分区可展开为上层浮空子平面。\n' +
      '层、网、子区域均可在 3D 中点击选中：详情窗口展示区域实体/属性/配置，缩略图同步高亮；布局设置打开时点击网/子区域直接切换配置目标（位置/配色/透明度）。',
  },
  {
    keys: ['数据', '地图数据', '合规', '审图号', '地图'],
    title: '地图数据与合规',
    body: `${COMPLIANCE}\n地图源数据管理见 部署运维手册（docs/04）。`,
  },
  {
    keys: ['标签', '文字', '名字', '标注'],
    title: '标签内容排查',
    body:
      '每个实体标签 = 数据集 entities 的 name 字段（kindLabel 为类型标签），landmark 标签在 main.ts 装配处定义。\n' +
      '完整排查方法（逐标签核对数据集、投影位置、图集渲染）见 部署运维手册 §9「实体标签排查」。',
  },
  {
    keys: ['详情', '窗口', '面板'],
    title: '窗口布局',
    body:
      '左侧上：消息状态展示区；左侧中：动态消息窗体；左侧下：分层缩略图；\n' +
      '底部中：详情窗口（选中实体/连线/区域）；底部右：实体控制窗口（实体操作 + 区域批量操作）；\n' +
      '右上角：智能助手（💬）与帮助（❓）按钮。',
  },
  {
    keys: ['剧本', '演示', '导览'],
    title: '演示设置',
    body:
      '设置 → 演示设置：切换 4 个仿真剧本（正常运转/故障演练/攻击告警/跨层故障链）、调节倍速、暂停仿真、一键导览（脚本化相机路径 + 定时剧本触发）。',
  },
  {
    keys: ['部署', '构建', '发布'],
    title: '部署要点',
    body:
      'npm run build 产物 dist/ 可静态部署（支持任意静态服务器；示例 SSE 服务见 server/）。\n' +
      `${COMPLIANCE}`,
  },
];

const FALLBACK: AssistantAnswer = {
  title: '离线演示助手',
  body:
    '可尝试询问：地图布局、设置、告警、连线、聚焦视角、键盘操作、区域展开、详情窗口、剧本演示、标签排查、部署等。\n' +
    COMPLIANCE,
};

/** 关键词匹配：任一关键词命中问题即返回对应条目（首个命中优先） */
export function answerFor(question: string): AssistantAnswer {
  const q = question.toLowerCase();
  for (const entry of KB) {
    if (entry.keys.some((k) => q.includes(k.toLowerCase()))) {
      return { title: entry.title, body: entry.body };
    }
  }
  return FALLBACK;
}

export interface AssistantWindowDeps {
  root: HTMLElement;
  appStore: AppStore;
}

export interface AssistantWindow {
  dispose(): void;
}

const GREETING: AssistantAnswer = {
  title: '你好，我是智能助手',
  body: '离线演示问答：可询问地图布局、设置入口、告警、连线、键盘操作、区域展开、标签排查等。',
};

export function createAssistantWindow(deps: AssistantWindowDeps): AssistantWindow {
  const { root, appStore } = deps;

  const chatList = el('div', { class: 'chat-list' });
  const push = (a: AssistantAnswer, who: 'bot' | 'user'): void => {
    chatList.append(el('div', { class: `chat-msg ${who}`, 'data-chat-msg': who },
      el('div', { class: 'chat-title', text: who === 'bot' ? a.title : a.body }),
      who === 'bot' ? el('div', { class: 'chat-body', text: a.body }) : '',
    ));
    chatList.scrollTop = chatList.scrollHeight;
  };

  const send = (): void => {
    const q = input.value.trim();
    if (!q) return;
    push({ title: '提问', body: q }, 'user');
    push(answerFor(q), 'bot');
    input.value = '';
  };

  const input = el('input', {
    type: 'text',
    class: 'settings-input',
    placeholder: '输入问题，例如：如何切换地图布局？',
    'data-assistant-input': '',
    onkeydown: (e: KeyboardEvent) => {
      if (e.key === 'Enter') send();
    },
  });
  const sendBtn = el('button', { class: 'btn small', 'data-assistant-send': '', text: '发送', onclick: send });

  const render = (): void => {
    clear(root);
    const open = appStore.get().assistantOpen;
    root.classList.toggle('hidden', !open);
    if (!open) return;
    root.append(
      el('div', { class: 'panel-title' },
        el('span', { text: '智能助手' }),
        el('button', { class: 'close-btn', text: '✕', onclick: () => appStore.set({ assistantOpen: false }) }),
      ),
      chatList,
      el('div', { class: 'chat-input-row' }, input, sendBtn),
    );
    // 打开时若对话为空，推送欢迎语
    if (chatList.childElementCount === 0) push(GREETING, 'bot');
  };

  const unsub = appStore.subscribe(() => render());

  render();
  return {
    dispose() {
      unsub();
    },
  };
}
