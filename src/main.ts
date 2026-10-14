/**
 * 3D 展示管控系统 — 启动装配：
 * 数据（Dataset 校验 + LiveStore + 本地仿真数据源）→ 渲染（地图/实体/区域板/连线/告警FX/标签）
 * → 交互（相机控制 + 拾取 + ViewSync 编排）→ UI（P4 布局：HUD/消息状态区/动态消息窗体/
 * 分层缩略图窗口/详情窗口/实体控制窗口/帮助/智能助手/设置面板/导览）。
 * 唯一渲染循环：renderer.setAnimationLoop → viewSync.tick + composer.render。
 */
import './ui/styles.css';
import * as THREE from 'three';
import type { Dataset, LayerId } from './shared/types';
import { validateDataset } from './shared/schema';
import { ZONE_LABELS } from './shared/types';
import { kindDef } from './shared/kinds';
import { LAYER_HEIGHTS } from './shared/layout/layer';
import { createRenderer } from './engine/renderer';
import { EntityIndex } from './engine/entity-index';
import { LiveStore } from './shared/sim/store';
import { SimLocalDataSource } from './shared/datasource/sim-local';
import { AppStore } from './ui/store/app-store';
import { DisplaySettingsStore } from './ui/store/display-settings';
import { createCameraControls } from './engine/camera/controls';
import { createViewSync } from './engine/view-sync';
import { buildEntityMeshes } from './render/entities/entity-meshes';
import { loadGlbModels } from './render/entities/glb-models';
import { buildZoneBoxes } from './render/entities/zone-boxes';
import { buildEdgeRenderer } from './render/edges/edge-renderer';
import { buildEdgeIdMesh, createEdgePicker } from './render/edges/id-buffer';
import { createPicker } from './interaction/picking';
import { CanvasAtlas } from './render/labels/atlas';
import { LabelManager } from './render/labels/label-manager';
import { createAlertFx } from './render/alerts/fx';
import { buildMapGroup, loadMapData } from './render/map/map-mesh';
import { PerfMonitor } from './perf/stats';
import { createHud } from './ui/hud';
import { createDetailPanel } from './ui/detail-panel';
import { MessageHistory } from './ui/message-history';
import { createStatsBoard } from './ui/stats-board';
import { createMessageWindow } from './ui/message-window';
import { createControlWindow } from './ui/control-window';
import { createHelpWindow } from './ui/help-window';
import { createAssistantWindow } from './ui/assistant';
import { createCornerBtns } from './ui/corner-btns';
import { createToaster } from './ui/toast';
import { createMinimap } from './ui/minimap';
import { createSettingsPanel } from './ui/settings-panel';
import { createTour } from './demo/tour';

const LAYER_TITLES: Record<LayerId, string> = {
  geo: '地域分布层',
  device: '设备分布层',
  app: '应用分布层',
  task: '任务分布层',
};

function mustId(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`缺少容器 #${id}`);
  return node;
}

async function bootstrap(): Promise<void> {
  // ---- 数据层 ----
  // ============> step: 读取元数据
  const dataset = (await (await fetch('data/dataset.json')).json()) as Dataset;
  console.log('源dataset数据')
  console.log(dataset)
  const validation = validateDataset(dataset);
  if (!validation.ok) {
    throw new Error(`数据集校验失败：\n${validation.errors.join('\n')}`);
  }
  const store = new LiveStore(dataset);
  const appStore = new AppStore();
  const index = new EntityIndex(dataset);
  // localStorage 持久化，读取时逐字段归一化；区域尺寸默认值 = EntityIndex 初始天然布局
  const settingsStore = new DisplaySettingsStore(undefined, index.initialLayoutConfig());

  // ---- 渲染层 ----
  // ============> step: 创建渲染器、相机、场景、渲染管道、setSize回调函数
  const rb = createRenderer(mustId('scene-root'));
  const { renderer, composer, scene, camera, setSize } = rb;

  // ============> step: 读取地图数据
  const mapData = await loadMapData();
  // ============> step: 构建最底层的地图底图模型
  const map = buildMapGroup(mapData);
  scene.add(map.group);

  // ============> step: 构建添加节点项
  const entityMeshes = buildEntityMeshes(dataset, index);
  scene.add(entityMeshes.group);

  // ---- GLB 模型替换管线（P6，异步不阻断启动）：models.json 配置 → 按类型加载；
  // 文件缺失/加载失败自动回退程序化几何体，操作手册见 docs/06-展示样式调整操作手册.md §3 ----
  loadGlbModels(dataset, entityMeshes)
    .then((r) => {
      if (r.kinds.length > 0 || r.failed.length > 0) {
        // eslint-disable-next-line no-console
        console.info(
          `[GLB] 模型加载完成：${r.kinds.length > 0 ? r.kinds.join('/') : '无'}${r.failed.length > 0 ? `，回退：${r.failed.join('/')}` : ''}`,
        );
      }
    })
    .catch((err) => {
      console.warn('[GLB] 加载管线异常（保持程序化几何体）：', err);
    });
  // ============> step: 构建设备、应用、任务层底图
  const zoneBoxes = buildZoneBoxes(['device', 'app', 'task'], index, (layer, zone) =>
    dataset.entities.filter((e) => e.layer === layer && e.zone === zone).map((e) => e.id),
  );
  scene.add(zoneBoxes.group);

  // ============> step: 连线节点关系线
  const edgeRenderer = buildEdgeRenderer(dataset, index, store);
  scene.add(edgeRenderer.group);
  const idMesh = buildEdgeIdMesh(edgeRenderer.data);
  scene.add(idMesh.mesh);

  const alertFx = createAlertFx();
  scene.add(alertFx.group);

  const atlas = new CanvasAtlas();
  const labelManager = new LabelManager(scene, atlas);

  // ---- 标签：landmark + 实体 ----
  for (const layer of ['geo', 'device', 'app', 'task'] as const) {
    labelManager.add(
      `landmark-layer-${layer}`,
      LAYER_TITLES[layer],
      new THREE.Vector3(-34, LAYER_HEIGHTS[layer] + (layer === 'geo' ? 0.8 : 1.2), 0),
      { landmark: true, style: { fontSize: 16, fontWeight: 700 } },
    );
  }
  for (const z of zoneBoxes.zones) {
    labelManager.add(
      `landmark-zone-${z.layer}-${z.zone}`,
      ZONE_LABELS[z.zone],
      new THREE.Vector3(z.center.x, z.y + 0.55, z.z0 - 1.15),
      { landmark: true },
    );
  }
  labelManager.add('landmark-south-sea', '南海诸岛', new THREE.Vector3(22, 0.25, 15.75), { landmark: true });
  for (const e of dataset.entities) {
    const p = index.positionOf(e.id);
    labelManager.add(e.id, e.name, new THREE.Vector3(p.x, p.y + index.radiusOf(e.id) + 0.55, p.z));
  }
  atlas.flush(); // 批量创建结束后一次上传图集页

  // ---- 交互层 ----
  const controls = createCameraControls(camera, renderer.domElement);
  controls.setTarget(new THREE.Vector3(0, 7.5, 0));

  const edgePicker = createEdgePicker(renderer, scene, edgeRenderer.data.order, idMesh.material);
  const picker = createPicker(camera, renderer.domElement, entityMeshes, edgePicker, {
    targets: () => zoneBoxes.pickTargets(),
    mapGroup: map.group,
  });

  let minimapUpdate: ((cam: THREE.PerspectiveCamera, s: ReturnType<AppStore['get']>) => void) | null = null;
  const viewSync = createViewSync({
    scene, camera, renderer, domElement: renderer.domElement,
    dataset, index, store, appStore, settingsStore,
    entityMeshes, map, zoneBoxes, edgeRenderer, labelManager, alertFx, controls, picker,
    bloom: rb.bloom,
    bloomSupported: rb.bloomSupported,
    edgeIdMaterial: idMesh.material,
    onMinimapFrame: (cam, s) => minimapUpdate?.(cam, s),
  });

  // ---- UI 层（P4 布局：左列消息三区 + 底部详情/控制窗口 + 右上角帮助/助手） ----
  const toaster = createToaster(mustId('toast-root'));
  const panelRoot = (id: string): HTMLElement => {
    const node = mustId(id);
    node.classList.add('panel');
    return node;
  };

  // 消息历史先行入账：LiveStore 按注册序通知，本订阅必须先于状态区/消息窗体的订阅注册
  const history = new MessageHistory();
  store.subscribe((envs) => {
    if (envs.length === 0) {
      history.reset(); // 剧本切换 resetToInitial 的空事件流 = 清空消息历史的信号
      return;
    }
    for (const { ev, t } of envs) {
      if (ev.type === 'alert:raise') history.recordAlert(ev.alert, t);
      else if (ev.type === 'alert:clear') {
        history.clearAlert(store.state.alerts[ev.alertId]?.category ?? 'system');
      } else if (ev.type === 'notice:push') history.recordNotice(ev.notice, t);
    }
  });

  const settingsPanel = createSettingsPanel({
    root: mustId('settings-panel'),
    appStore,
    settingsStore,
    bloomSupported: rb.bloomSupported,
    subsOf: (layer, zone) =>
      index.subsOf(layer, zone).map((s) => ({ kind: s.kind, label: kindDef(s.kind).label })),
    entityNameOf: (id) => dataset.entities.find((e) => e.id === id)?.name ?? null,
    dataset,
    store,
    setScenario: (id) => viewSync.setScenario(id),
    startTour: () => tour.start(),
  });

  createHud({
    root: mustId('hud'),
    dataset, store, appStore,
    focusLayer: (l) => viewSync.focusLayer(l),
    expandZone: (l, z) => viewSync.expandZone(l, z),
    collapseExpansion: () => viewSync.collapseExpansion(),
    toggleSettings: () => settingsPanel.toggle(),
  });
  createDetailPanel({ root: panelRoot('detail-panel'), dataset, store, appStore, index });
  createControlWindow({ root: panelRoot('control-window'), dataset, store, appStore, toaster });
  createStatsBoard({ root: panelRoot('stats-board'), history, appStore, store });
  createMessageWindow({ root: panelRoot('message-window'), store, appStore });

  const minimap = createMinimap({
    root: panelRoot('minimap-window'),
    dataset, index, appStore,
    focusLayer: (l) => viewSync.focusLayer(l),
    expandZone: (l, z) => viewSync.expandZone(l, z),
    collapseExpansion: () => viewSync.collapseExpansion(),
  });
  minimapUpdate = minimap.update;

  createCornerBtns({ root: mustId('corner-btns'), appStore });
  createHelpWindow({ root: panelRoot('help-window'), appStore });
  createAssistantWindow({ root: panelRoot('assistant-window'), appStore });

  const tour = createTour(appStore, viewSync);

  // ---- 仿真数据源（本地引擎，100ms 节拍） ----
  const dataSource = new SimLocalDataSource({ store });
  dataSource.start();

  // ---- 性能监控（F3 或 ?debug=1） ----
  const perf = new PerfMonitor();
  perf.bindRendererInfo(renderer.info);
  if (new URLSearchParams(window.location.search).has('debug')) {
    perf.show();
    // 调试钩子：暴露渲染管线内部状态供 E2E/排查使用
    (window as unknown as { __sceneDbg?: unknown }).__sceneDbg = {
      scene, camera, composer, renderer, store, index, appStore, settingsStore, edgeRenderer,
      picker, alertFx, labelManager, entityMeshes, bloom: rb.bloom, map, zoneBoxes, controls,
      /** 视图编排（E2E 相机飞行完成等待：flight.isActive 为 false 时点击才不会被门控吞掉） */
      viewSync,
      /** 场景背景色 hex（E2E 样式主题验证用） */
      sceneColor: () => (scene.background as THREE.Color).getHexString(),
      /** 实体世界坐标 → 画布 CSS 像素（E2E 点击定位用） */
      projectToScreen: (id: string) => {
        const p = index.positionOf(id);
        const v = new THREE.Vector3(p.x, p.y, p.z).project(camera);
        const rect = renderer.domElement.getBoundingClientRect();
        return { x: rect.left + (v.x * 0.5 + 0.5) * rect.width, y: rect.top + (-v.y * 0.5 + 0.5) * rect.height };
      },
      /** 任意世界坐标 → 画布 CSS 像素（P5 区域拾取面投影点击用） */
      projectPoint: (x: number, y: number, z: number) => {
        camera.updateMatrixWorld();
        const v = new THREE.Vector3(x, y, z).project(camera);
        const rect = renderer.domElement.getBoundingClientRect();
        return { x: rect.left + (v.x * 0.5 + 0.5) * rect.width, y: rect.top + (-v.y * 0.5 + 0.5) * rect.height };
      },
      /** 视线与层平面夹角（度，P3 视角微调验证用） */
      cameraPolarDeg: () => {
        const t = controls.controls.target;
        const p = camera.position;
        return THREE.MathUtils.radToDeg(Math.atan2(p.y - t.y, Math.hypot(p.x - t.x, p.z - t.z)));
      },
      /** 视线方位角（度，绕目标点 0=+z 轴） */
      cameraAzimuthDeg: () => {
        const t = controls.controls.target;
        const p = camera.position;
        return THREE.MathUtils.radToDeg(Math.atan2(p.x - t.x, p.z - t.z));
      },
      /** 区域拾取（P5）：当前聚焦层下的屏幕点命中区域或 null */
      pickRegion: (x: number, y: number) => picker.pickRegion(x, y, appStore.get().focus),
      /** 标签 id → 文本快照（P7 标签排查核对用） */
      labelTexts: () => labelManager.labelTexts(),
    };
  }
  // ---- 渲染循环 ----
  // composer 每 pass 内部调用 renderer.render 会触发 info 自动重置，
  // 改为手动重置以统计全管线 draw calls。
  renderer.info.autoReset = false;
  let lastMs = performance.now();
  renderer.setAnimationLoop(() => {
    const nowMs = performance.now();
    const dt = Math.min((nowMs - lastMs) / 1000, 0.1);
    lastMs = nowMs;
    renderer.info.reset();
    viewSync.tick(dt, nowMs / 1000);
    perf.tick(nowMs);
    composer.render();
  });

  // ---- 自适应 ----
  const onResize = (): void => {
    const container = renderer.domElement.parentElement;
    const w = container?.clientWidth ?? window.innerWidth;
    const h = container?.clientHeight ?? window.innerHeight;
    setSize(w, h);
    labelManager.setViewport(renderer.domElement.clientHeight, camera.fov);
    edgePicker.resize(renderer.domElement.clientWidth, renderer.domElement.clientHeight);
  };
  window.addEventListener('resize', onResize);
  onResize();

  // eslint-disable-next-line no-console
  console.info(
    `[3D 展示管控系统] 就绪：实体 ${dataset.entities.length}，关系 ${dataset.relations.length}，剧本 ${dataset.scenarios.length}。`,
  );
}

bootstrap().catch((err) => {
  console.error('启动失败：', err);
  document.body.innerHTML = `<div style="color:#fecaca;font-family:monospace;padding:24px;white-space:pre-wrap">启动失败\n${String(err)}</div>`;
});
