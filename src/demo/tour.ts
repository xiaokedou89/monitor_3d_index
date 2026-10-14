/**
 * 一键演示导览：脚本化相机路径 + 定时剧本/聚焦/展开触发。
 * 每一步：展示说明卡片 → 执行编排动作 → 等待相机到位 → 停留 → 下一步。
 * 用户可随时"跳过导览"或点击"结束"。
 */
import type { ZoneId } from '../shared/types';
import type { AppStore } from '../ui/store/app-store';
import type { ViewSync } from '../engine/view-sync';
import { el } from '../ui/dom';

interface TourCtx {
  appStore: AppStore;
  viewSync: ViewSync;
  overlay: HTMLElement;
}

interface TourStep {
  title: string;
  description: string;
  run(ctx: TourCtx): void;
  /** 停留时长（秒） */
  dwell: number;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const waitFlight = async (ctx: TourCtx): Promise<void> => {
  let guard = 0;
  while (ctx.viewSync.flight.isActive && guard++ < 600) await sleep(50);
};

export function createTour(appStore: AppStore, viewSync: ViewSync): { start(): void; stop(): void } {
  const overlay = document.getElementById('tour-overlay');
  if (!overlay) throw new Error('缺少 #tour-overlay 容器');

  let running = false;
  let stopped = false;

  const card = el('div', { class: 'panel tour-card' });
  const titleEl = el('h3', {});
  const descEl = el('p', {});
  const skipBtn = el('button', { class: 'btn', text: '跳过导览', onclick: () => stop() });
  card.append(titleEl, descEl, skipBtn);

  const steps: TourStep[] = [
    {
      title: '① 全局总览',
      description: '系统以四个水平层带展示整网拓扑：底部为平面地图（地域分布层），向上依次为设备分布层、应用分布层、任务分布层。旋转/缩放/平移可自由观察。',
      dwell: 6,
      run: (ctx) => {
        ctx.appStore.set({ focus: 'all' });
        ctx.viewSync.setScenario(null);
      },
    },
    {
      title: '② 地域分布层',
      description: '地域层包含机房、云机房与组织机构。中国地图采用国家发布标准地图数据（含台湾省/香港/澳门与南海诸岛附图、十段线）。',
      dwell: 6,
      run: (ctx) => ctx.viewSync.focusLayer('geo'),
    },
    {
      title: '③ 设备分布层',
      description: '设备层按企业网/业务网/公网境内/公网境外四个逻辑区域排布 10 类设备。蓝色连线为控制关系（关键控制加粗流动），黄色为数据关系（粗细∝流量）。',
      dwell: 7,
      run: (ctx) => ctx.viewSync.focusLayer('device'),
    },
    {
      title: '④ 密集区域展开',
      description: '点击区域或缩略图可将密集区域展开为浮空子平面（按类型分栏布局），原区域以高亮框保持空间指向；收起后恢复原位。',
      dwell: 7,
      run: (ctx) => {
        ctx.viewSync.focusLayer('device');
        ctx.viewSync.expandZone('device', 'enterprise' as ZoneId);
      },
    },
    {
      title: '⑤ 层间关联',
      description: '层间关联（部署/运行/承载/隶属）默认隐藏，可切换为仅两层间、全部显示或选中实体相关三种粒度。',
      dwell: 7,
      run: (ctx) => {
        ctx.viewSync.collapseExpansion();
        ctx.appStore.set({ crossLinks: { mode: 'all' } });
      },
    },
    {
      title: '⑥ 剧本：攻击告警',
      description: '启动"攻击告警"剧本：边界防火墙遭受攻击 → 监控服务繁忙 → VPS 离线 → 威胁处置介入。告警实体出现光晕/扩散环特效，相关数据流变为红色告警语义。',
      dwell: 10,
      run: (ctx) => {
        ctx.appStore.set({ crossLinks: { mode: 'all' } });
        ctx.viewSync.setScenario('attack');
      },
    },
    {
      title: '⑦ 告警处置',
      description: '点击告警列表查看详情与处置建议，点击"定位实体"选中告警对象，可在详情面板中执行管理操作（起停设备、配置防火墙、下发命令）。',
      dwell: 8,
      run: () => undefined,
    },
    {
      title: '⑧ 导览结束',
      description: '您已了解全部核心功能：四层拓扑、层间关联、聚焦淡化、区域展开、缩略图联动、实时告警与实体管控。可继续自由探索。',
      dwell: 6,
      run: (ctx) => {
        ctx.viewSync.setScenario(null);
        ctx.viewSync.focusLayer('all');
        ctx.appStore.set({ crossLinks: { mode: 'none' } });
      },
    },
  ];

  const showCard = (step: TourStep): void => {
    titleEl.textContent = step.title;
    descEl.textContent = step.description;
  };

  const start = async (): Promise<void> => {
    if (running) return;
    running = true;
    stopped = false;
    overlay.classList.remove('hidden');
    overlay.innerHTML = '';
    overlay.append(card);
    try {
      for (const step of steps) {
        if (stopped) break;
        showCard(step);
        step.run({ appStore, viewSync, overlay });
        await waitFlight({ appStore, viewSync, overlay });
        for (let i = 0; i < step.dwell * 10 && !stopped; i++) await sleep(100);
      }
    } finally {
      stop();
    }
  };

  const stop = (): void => {
    stopped = true;
    running = false;
    overlay.classList.add('hidden');
  };

  return { start, stop };
}
