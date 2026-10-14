/**
 * ViewSync：AppState → 场景变更的唯一入口 + 每帧编排中枢。
 * - 分层聚焦：uLayerDim 阻尼过渡 + 相机飞行 + 标签可见性策略；
 * - 层间关联三档开关：按策略批量切换连线显隐（告警语义强制可见）；
 * - 区域展开：预生成布局 → 实体/连线/标签/告警FX 锚点整体切换 + 浮空子平面；
 * - 选中：实体高亮环 / 连线加粗；悬停：实例色高亮；
 * - 告警联动：LiveStore 订阅 → FX 池 / 实体着色 / 连线语义与宽度刷新。
 */
import * as THREE from 'three';
import type {
  Alert,
  Dataset,
  EntityState,
  LayerId,
  Relation,
  SimEventEnvelope,
  ZoneId,
} from '../shared/types';
import { ALERT_LEVEL_COLORS, ENTITY_STATE_COLORS, LAYER_COLORS } from '../shared/palette';
import type { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { DisplaySettingsStore, type DisplaySettings, type LayoutConfig, type StyleConfig } from '../ui/store/display-settings';
import { EXPANSION_OFFSET, EXPANSION_PLANE, LAYER_HEIGHTS } from '../shared/layout/layer';
import { layerDimUniforms } from '../engine/materials';
import { kindDef } from '../shared/kinds';
import { EntityIndex } from '../engine/entity-index';
import { CameraFlight } from '../engine/camera/flight';
import type { CameraControls } from '../engine/camera/controls';
import { CAMERA_PRESETS, expansionPreset, focusPreset } from '../engine/camera/presets';
import type { MapLayoutId } from '../shared/geo';
import { buildSelectionRing, type EntityMeshRegistry } from '../render/entities/entity-meshes';
import type { ZoneBoxRegistry } from '../render/entities/zone-boxes';
import type { MapGeometryBundle } from '../render/map/map-mesh';
import type { EdgeRegistry } from '../render/edges/edge-renderer';
import type { LabelManager } from '../render/labels/label-manager';
import type { AlertFx } from '../render/alerts/fx';
import type { LiveStore } from '../shared/sim/store';
import { AppStore, type AppState } from '../ui/store/app-store';
import { ZONES } from '../shared/types';
import { layoutTargetOf, regionKey, type RegionId } from '../shared/regions';
import { attachGestures } from '../interaction/gesture';
import { createKeyboardCamera } from '../interaction/keyboard-camera';
import type { Picker } from '../interaction/picking';

const DIM_FULL = 0.75;
const DIM_DAMP = 4.2;
const HOVER_COLOR = '#7dd3fc';
const SELECT_COLOR = '#22d3ee';

const ALERT_SEVERITY: Record<string, number> = { critical: 4, major: 3, minor: 2, info: 1 };

export interface ViewSyncDeps {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  domElement: HTMLElement;
  dataset: Dataset;
  index: EntityIndex;
  store: LiveStore;
  appStore: AppStore;
  /** 显示参数（持久化），变更实时应用到渲染管线 */
  settingsStore: DisplaySettingsStore;
  entityMeshes: EntityMeshRegistry;
  /** 地域层地图（层间分离时随 geo 层整体垂直移动；setPalette 供风格样式模板） */
  map: MapGeometryBundle;
  zoneBoxes: ZoneBoxRegistry;
  edgeRenderer: EdgeRegistry;
  labelManager: LabelManager;
  alertFx: AlertFx;
  controls: CameraControls;
  /** 实体 raycast + 连线 id-buffer 拾取器（main.ts 装配） */
  picker: Picker;
  /** 泛光 pass（设置面板实时调参） */
  bloom: UnrealBloomPass;
  /** bloom 是否受当前渲染器支持（软渲染强制禁用） */
  bloomSupported: boolean;
  /** 连线 id 拾取材质：uMinPx 须与视觉材质同步（拾取几何 = 视觉几何） */
  edgeIdMaterial: THREE.ShaderMaterial;
  /** 缩略图刷新钩子（ui/minimap 注入，内部节流） */
  onMinimapFrame?: (camera: THREE.PerspectiveCamera, state: AppState) => void;
}

export interface ViewSync {
  flight: CameraFlight;
  tick(dt: number, now: number): void;
  focusLayer(layer: LayerId | 'all'): void;
  expandZone(layer: LayerId, zone: ZoneId): void;
  collapseExpansion(): void;
  setScenario(id: string | null): void;
  dispose(): void;
}

interface ExpansionInfo {
  layer: LayerId;
  zone: ZoneId;
  ids: string[];
  center: THREE.Vector3;
}

export function createViewSync(deps: ViewSyncDeps): ViewSync {
  const {
    scene, camera, renderer, domElement, dataset, index, store, appStore, settingsStore,
    entityMeshes, map, zoneBoxes, edgeRenderer, labelManager, alertFx, controls, picker,
    bloom, bloomSupported, edgeIdMaterial,
  } = deps;

  const flight = new CameraFlight(camera, controls);

  // 键盘观测视点控制（P3）：仅聚焦态生效，跟随渲染循环 tick
  const keyboardCamera = createKeyboardCamera({
    appStore,
    camera,
    controls,
    settingsStore,
    isFlying: () => flight.isActive,
  });

  // ---- 选中环 ----
  const ring = buildSelectionRing(SELECT_COLOR);
  scene.add(ring);

  // ---- 展开子平面视觉 ----
  const expansionGroup = new THREE.Group();
  expansionGroup.name = 'expansion-plane';
  expansionGroup.visible = false;
  scene.add(expansionGroup);
  let expansionPlateMaterial: THREE.MeshBasicMaterial;
  let expansionBorderMaterial: THREE.LineBasicMaterial;
  {
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(EXPANSION_PLANE.width, EXPANSION_PLANE.depth),
      (expansionPlateMaterial = new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0.08,
        depthWrite: false,
        side: THREE.DoubleSide,
      })),
    );
    plate.rotation.x = -Math.PI / 2;
    plate.position.y = 0.02;
    plate.renderOrder = 1;
    expansionGroup.add(plate);
    const { width: W, depth: D } = EXPANSION_PLANE;
    const border = new THREE.LineLoop(
      new THREE.BufferGeometry().setAttribute(
        'position',
        new THREE.Float32BufferAttribute([-W / 2, 0.04, -D / 2, W / 2, 0.04, -D / 2, W / 2, 0.04, D / 2, -W / 2, 0.04, D / 2], 3),
      ),
      (expansionBorderMaterial = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.85, depthWrite: false })),
    );
    expansionGroup.add(border);
  }

  // ---- 淡化状态 ----
  const dimCurrent: Record<LayerId, number> = { geo: 0, device: 0, app: 0, task: 0 };
  const dimTarget: Record<LayerId, number> = { geo: 0, device: 0, app: 0, task: 0 };
  let lastAppliedDim = { geo: 0, device: 0, app: 0, task: 0 };

  // ---- 层间分离状态（聚焦某层时其余层上下推开 + 大幅透明化，见显示设置"层间分离"） ----
  const LAYER_ORDER: readonly LayerId[] = ['geo', 'device', 'app', 'task'];
  const shiftCurrent: Record<LayerId, number> = { geo: 0, device: 0, app: 0, task: 0 };
  const shiftTarget: Record<LayerId, number> = { geo: 0, device: 0, app: 0, task: 0 };
  let lastAppliedShift = { geo: 0, device: 0, app: 0, task: 0 };

  /** 由 focus + "层间分离距离"计算各层目标位移（目标层上方各层上移、下方各层下移） */
  const updateShiftTargets = (): void => {
    const sep = display.focusSeparation;
    const focusIdx = focus === 'all' ? -1 : LAYER_ORDER.indexOf(focus);
    for (let i = 0; i < LAYER_ORDER.length; i++) {
      const layer = LAYER_ORDER[i]!;
      shiftTarget[layer] = focusIdx < 0 || i === focusIdx ? 0 : i < focusIdx ? -sep : sep;
    }
  };

  /** 层分离位移扇出：实体/地图/区域板/连线/标签/告警FX/展开平面全部同步 */
  const applyShiftFanout = (): void => {
    for (const layer of LAYER_ORDER) {
      index.setLayerShift(layer, shiftCurrent[layer]);
      zoneBoxes.setLayerOffset(layer, shiftCurrent[layer]);
    }
    map.group.position.y = shiftCurrent.geo;
    entityMeshes.updateMatrices(dataset.entities.map((e) => e.id));
    edgeRenderer.updatePositions(dataset.relations.map((r) => r.id));
    for (const e of dataset.entities) {
      const pos = index.positionOf(e.id);
      labelManager.setPosition(e.id, new THREE.Vector3(pos.x, pos.y + index.radiusOf(e.id) + 0.55, pos.z));
      if (store.alertsOf(e.id).length > 0) alertFx.updatePosition(e.id, pos);
    }
    // 层标题 / 区域名 / 南海诸岛标注跟随所在层位移
    for (const layer of LAYER_ORDER) {
      labelManager.setPosition(
        `landmark-layer-${layer}`,
        new THREE.Vector3(-34, LAYER_HEIGHTS[layer] + (layer === 'geo' ? 0.8 : 1.2) + shiftCurrent[layer], 0),
      );
    }
    for (const z of zoneBoxes.zones) {
      labelManager.setPosition(
        `landmark-zone-${z.layer}-${z.zone}`,
        new THREE.Vector3(z.center.x, z.y + 0.55 + shiftCurrent[z.layer], z.z0 - 1.15),
      );
    }
    labelManager.setPosition('landmark-south-sea', new THREE.Vector3(22, 0.25 + shiftCurrent.geo, 15.75));
    // 子区域标签跟随本层位移与区域整体 dz 偏移
    for (const layer of LAYER_ORDER) {
      for (const zone of ZONES) {
        const bounds = index.zoneBoundsOf(layer, zone);
        const centerZ = (bounds.z0 + bounds.z1) / 2;
        for (const sub of index.subsOf(layer, zone)) {
          labelManager.setPosition(
            `sub-${layer}-${zone}-${sub.kind}`,
            new THREE.Vector3(bounds.x0 - 1.4, LAYER_HEIGHTS[layer] + 0.5 + shiftCurrent[layer], centerZ + sub.z0),
          );
        }
      }
    }
    if (expansionInfo) {
      expansionGroup.position.y = expansionInfo.center.y + shiftCurrent[expansionInfo.layer];
    }
  };

  // ---- 交互状态 ----
  let hoverId: string | null = null;
  let expansionInfo: ExpansionInfo | null = null;
  let expansionIntro = 0;
  const stateTint = new Map<string, string | null>();
  const alertTint = new Map<string, { color: string; count: number; severity: number }>();

  // ---- 实体着色（悬停 > 告警 > 状态） ----
  const repaint = (id: string): void => {
    if (id === hoverId) {
      entityMeshes.setInstanceColor(id, HOVER_COLOR);
      return;
    }
    const alert = alertTint.get(id);
    if (alert && display.alertTintOn) {
      entityMeshes.setInstanceColor(id, alert.color);
      return;
    }
    const st = stateTint.get(id);
    if (st) entityMeshes.setInstanceColor(id, st);
    else entityMeshes.setInstanceColor(id, '', true);
  };

  const tintByState = (id: string, state: EntityState): void => {
    if (stateTint.get(id) === ENTITY_STATE_COLORS[state] && stateTint.has(id)) return;
    stateTint.set(id, state === 'online' ? null : ENTITY_STATE_COLORS[state]);
    repaint(id);
  };

  // ---- 显示参数（DisplaySettingsStore → 渲染管线实时应用） ----
  let display = settingsStore.get();
  let focus: LayerId | 'all' = 'all';

  /** 风格样式：背景/雾/分区底板/地图配色（样式模板选择/应用即时生效） */
  const applyStyle = (style: StyleConfig): void => {
    scene.background = new THREE.Color(style.bgColor);
    scene.fog!.color.set(style.bgColor);
    zoneBoxes.setPlateStyle(style.plateColor, style.plateOpacity, style.plateZoneTint);
    map.setPalette({ topTint: style.mapTopTint, border: style.mapBorder, wall: style.mapWall });
  };

  const applyDisplay = (prev: DisplaySettings, next: DisplaySettings): void => {
    // 泛光：软渲染环境（bloomSupported=false）强制禁用，开关意图仍持久化
    bloom.enabled = next.bloomOn && bloomSupported;
    bloom.strength = next.bloomStrength;
    bloom.radius = next.bloomRadius;
    bloom.threshold = next.bloomThreshold;
    // 连线：最小像素宽视觉/拾取双材质同步；流动与脉冲开关
    edgeRenderer.uniforms.uMinPx.value = next.edgeMinPx;
    edgeIdMaterial.uniforms.uMinPx!.value = next.edgeMinPx;
    edgeRenderer.uniforms.uFlowOn.value = next.edgeFlowOn ? 1 : 0;
    edgeRenderer.uniforms.uPulseOn.value = next.edgePulseOn ? 1 : 0;
    // 标签全局开关
    labelManager.setEnabled(next.labelsOn);
    // 层间分离距离变更：聚焦中立即重算目标位移
    if (prev.focusSeparation !== next.focusSeparation) updateShiftTargets();
    // 聚焦俯仰角变更（P3）：聚焦某层时按新夹角重新取景
    if (prev.focusPitchDeg !== next.focusPitchDeg && focus !== 'all') {
      const preset = focusPreset(focus, next.focusPitchDeg);
      flight.flyTo(preset.position, preset.target, 0.8);
    }
    // 世界地图展示布局切换（P1）：世界轮廓网格显隐 + 地域实体重投影
    if (prev.mapLayout !== next.mapLayout) applyMapLayout(next.mapLayout);
    // 区域布局配置变更：重布局 + 扇出 + 折叠（预设应用/滑块调节均走此路径）
    if (prev.layout !== next.layout) applyLayout(next.layout);
    // 风格样式变更：背景/雾/分区底板/地图配色
    if (prev.style !== next.style) applyStyle(next.style);
    // 告警发光特效：范围/强度经 shader 乘算实时生效，总开关走 group 显隐
    alertFx.setGlowScale(next.alertGlowScale);
    alertFx.setGlowIntensity(next.alertGlowIntensity);
    alertFx.group.visible = next.alertFxOn;
    // 实体告警着色：开关切换时重绘全部受染实体
    if (prev.alertTintOn !== next.alertTintOn) {
      for (const id of alertTint.keys()) repaint(id);
    }
  };
  applyDisplay(display, display);
  applyStyle(display.style); // 启动即应用持久化样式（prev===next 时 applyDisplay 跳过 style 分支）
  const unsubSettings = settingsStore.subscribe((next) => {
    const prev = display;
    display = next;
    applyDisplay(prev, next);
  });

  // ---- 连线可见性策略 ----
  /** 聚焦态连线拾取门控：仅总览态或端点涉及聚焦层的连线可选中 */
  const edgePickableInFocus = (relId: string, focus: LayerId | 'all'): boolean => {
    if (focus === 'all') return true;
    const layers = edgeRenderer.layersOf.get(relId);
    if (!layers) return true; // 层信息缺失时保持可拾取（不引入回归）
    return layers.includes(focus);
  };

  const relationVisible = (rel: Relation, cl: AppState['crossLinks']): boolean => {
    if (rel.scope === 'intra') return true;
    if (store.kindOf(rel.id, rel.kind) === 'alert') return true; // 告警语义强制可见
    switch (cl.mode) {
      case 'none':
        return false;
      case 'all':
        return true;
      case 'pair': {
        if (!cl.pair) return false;
        const layers = edgeRenderer.layersOf.get(rel.id);
        if (!layers) return false;
        const [a, b] = layers;
        return (a === cl.pair[0] && b === cl.pair[1]) || (a === cl.pair[1] && b === cl.pair[0]);
      }
      case 'entity':
        return cl.entityId === rel.from || cl.entityId === rel.to;
    }
  };

  const applyEdgeVisibility = (): void => {
    const cl = appStore.get().crossLinks;
    const show: string[] = [];
    const hide: string[] = [];
    for (const rel of dataset.relations) {
      (relationVisible(rel, cl) ? show : hide).push(rel.id);
    }
    edgeRenderer.setVisible(show, true);
    edgeRenderer.setVisible(hide, false);
  };

  const applyEdgeVisibilityFor = (relId: string): void => {
    const rel = edgeRenderer.relationById.get(relId);
    if (!rel) return;
    edgeRenderer.setVisible([relId], relationVisible(rel, appStore.get().crossLinks));
  };

  // ---- 分层聚焦 ----
  /** 子区域折叠隐藏的实体 id（仅显示活跃实体时被隐藏） */
  let collapsedHidden = new Set<string>();

  /** 标签可见策略：聚焦层全显/总览仅地域层，且排除折叠隐藏实体 */
  const applyLabelPolicy = (): void => {
    for (const e of dataset.entities) {
      labelManager.setBaseVisible(
        e.id,
        (focus === 'all' ? e.layer === 'geo' : e.layer === focus) && !collapsedHidden.has(e.id),
      );
    }
  };

  const applyFocus = (next: LayerId | 'all'): void => {
    if (focus === next) return;
    focus = next;
    updateShiftTargets();
    for (const layer of ['geo', 'device', 'app', 'task'] as const) {
      dimTarget[layer] = next === 'all' || next === layer ? 0 : DIM_FULL;
      // 非聚焦层排除拾取（layers 通道 2：仍渲染，仅 Raycaster 不命中）
      entityMeshes.setPickable(layer, next === 'all' || next === layer);
      // 区域拾取同样随聚焦层门控（P5）
      zoneBoxes.setPickable(layer, next === 'all' || next === layer);
    }
    applyLabelPolicy();
    // 聚焦机位俯仰角可配置（默认 45°，P3）：总览机位不变
    const preset = next === 'all' ? CAMERA_PRESETS.overview : focusPreset(next, display.focusPitchDeg);
    flight.flyTo(preset.position, preset.target, 1.5);
  };

  // ---- 区域布局（P5：平面尺寸/子区域微调/折叠/布局预设） ----
  /** 折叠过滤：折叠子区域仅显示活跃实体（在线或带活动告警），其余 aActive 隐藏 */
  const applyCollapse = (layout: LayoutConfig): void => {
    const hidden = new Set<string>();
    for (const [key, sub] of Object.entries(layout.subOverrides)) {
      if (!sub.collapsed) continue;
      for (const id of index.subIdsByKey(key)) {
        const active = store.stateOf(id) === 'online' || store.alertsOf(id).length > 0;
        if (!active) hidden.add(id);
      }
    }
    const toHide: string[] = [];
    const toShow: string[] = [];
    for (const id of hidden) if (!collapsedHidden.has(id)) toHide.push(id);
    for (const id of collapsedHidden) if (!hidden.has(id)) toShow.push(id);
    entityMeshes.setActive(toHide, false);
    entityMeshes.setActive(toShow, true);
    collapsedHidden = hidden;
    applyLabelPolicy();
  };

  /** 子区域标签集合管理（布局变化时增删；z 跟随区域中心即整体 dz 偏移） */
  const subLabels = new Set<string>();
  const syncSubLabels = (): void => {
    const wanted = new Set<string>();
    for (const layer of ['device', 'app', 'task'] as const) {
      for (const zone of ZONES) {
        const bounds = index.zoneBoundsOf(layer, zone);
        const centerZ = (bounds.z0 + bounds.z1) / 2;
        for (const sub of index.subsOf(layer, zone)) {
          const key = `sub-${layer}-${zone}-${sub.kind}`;
          wanted.add(key);
          const pos = new THREE.Vector3(bounds.x0 - 1.4, LAYER_HEIGHTS[layer] + 0.5, centerZ + sub.z0);
          if (subLabels.has(key)) labelManager.setPosition(key, pos);
          else labelManager.add(key, kindDef(sub.kind).label, pos, { landmark: true });
        }
      }
    }
    for (const key of subLabels) if (!wanted.has(key)) labelManager.remove(key);
    subLabels.clear();
    for (const k of wanted) subLabels.add(k);
  };

  /** 实体标签锚点（中心上方：半径 + 0.55） */
  const labelPosOf = (id: string): THREE.Vector3 => {
    const p = index.positionOf(id);
    return new THREE.Vector3(p.x, p.y + index.radiusOf(id) + 0.55, p.z);
  };

  /** 布局配置应用：区域尺寸重布局 → 微调叠加 → 区域板/分界线/子区域标签 → 扇出 → 折叠 */
  const applyLayout = (layout: LayoutConfig): void => {
    const affected = new Set<string>();
    for (const layer of ['device', 'app', 'task'] as const) {
      const sizes = layout.zoneSizes[layer];
      if (!sizes) continue;
      for (const id of index.setZoneSizes(layer, sizes)) affected.add(id);
      for (const zone of ZONES) {
        const bounds = index.zoneBoundsOf(layer, zone);
        zoneBoxes.resizeZone(layer, zone, bounds);
        zoneBoxes.setSubs(layer, zone, index.subsOf(layer, zone));
      }
    }
    for (const id of index.applyOverrides(layout.entityOverrides, layout.subOverrides, layout.zoneOverrides)) {
      affected.add(id);
    }
    // 区域整体偏移/配色覆盖（P5）：区域板跟随偏移，配色/透明度覆盖
    for (const layer of ['device', 'app', 'task'] as const) {
      for (const zone of ZONES) {
        const ov = index.zoneOverrideOf(layer, zone);
        if (ov) zoneBoxes.setZoneOverrideStyle(layer, zone, ov.color, ov.opacity);
        else zoneBoxes.setZoneOverrideStyle(layer, zone, undefined, undefined);
      }
    }
    syncSubLabels();
    // 扇出：实例矩阵/关联连线/标签/告警FX（同展开扇出模式）
    entityMeshes.updateMatrices([...affected]);
    const affectedSet = new Set(affected);
    const touched = dataset.relations
      .filter((r) => affectedSet.has(r.from) || affectedSet.has(r.to))
      .map((r) => r.id);
    edgeRenderer.updatePositions(touched);
    for (const id of affected) {
      labelManager.setPosition(id, labelPosOf(id));
      if (store.alertsOf(id).length > 0) alertFx.updatePosition(id, index.positionOf(id));
    }
    applyCollapse(layout);
  };
  // 启动时应用已持久化的布局（与 EntityIndex 初始天然布局一致时为幂等重算）
  applyLayout(display.layout);

  // ---- 选中 ----
  /** 当前区域高亮目标（切换/清除选中时先撤销旧高亮） */
  let prevRegion: RegionId | null = null;

  /** 区域高亮开关（zone-boxes 内部维护状态，布局重建后自动重放） */
  const setRegionHighlight = (r: RegionId | null, selected: boolean): void => {
    if (!r) return;
    switch (r.type) {
      case 'global':
        break;
      case 'layer':
        zoneBoxes.setLayerSelected(r.layer, selected);
        break;
      case 'zone':
        zoneBoxes.setZoneSelected(r.layer, r.zone, selected);
        break;
      case 'sub':
        zoneBoxes.setSubSelected(r.layer, r.zone, r.kind, selected);
        break;
    }
  };

  const applySelection = (sel: AppState['selection']): void => {
    if (sel?.kind === 'relation') {
      edgeRenderer.setWidthOverride(sel.id);
      ring.visible = false;
      if (prevRegion) setRegionHighlight(prevRegion, false);
      prevRegion = null;
      return;
    }
    edgeRenderer.setWidthOverride(null);
    if (!sel) {
      ring.visible = false;
      if (prevRegion) setRegionHighlight(prevRegion, false);
      prevRegion = null;
      return;
    }
    if (sel.kind === 'region') {
      // 区域选中（P5）：区域板/子区域带/层轮廓高亮，不走实体选中环
      ring.visible = false;
      const next = sel.region;
      if (prevRegion && regionKey(prevRegion) !== regionKey(next)) setRegionHighlight(prevRegion, false);
      setRegionHighlight(next, true);
      prevRegion = next;
      return;
    }
    // 实体选中：撤销区域高亮
    if (prevRegion) setRegionHighlight(prevRegion, false);
    prevRegion = null;
    const pos = index.positionOf(sel.id);
    ring.position.set(pos.x, pos.y + 0.15, pos.z);
    ring.scale.setScalar(index.radiusOf(sel.id) * 1.9 + 0.35);
    ring.visible = true;
  };

  /** 世界地图展示布局（P1）：世界轮廓 A/B 网格显隐 + 地域层实体重投影 + 扇出 */
  const applyMapLayout = (layout: MapLayoutId): void => {
    map.setMapLayout(layout);
    const affected = index.setMapLayout(layout);
    if (affected.length === 0) return;
    entityMeshes.updateMatrices(affected);
    const affectedSet = new Set(affected);
    const touched = dataset.relations
      .filter((r) => affectedSet.has(r.from) || affectedSet.has(r.to))
      .map((r) => r.id);
    edgeRenderer.updatePositions(touched);
    for (const id of affected) {
      labelManager.setPosition(id, labelPosOf(id));
      if (store.alertsOf(id).length > 0) alertFx.updatePosition(id, index.positionOf(id));
    }
    // 选中环/选中实体跟随重投影（选中地域实体时锚点已变）
    const sel = appStore.get().selection;
    if (sel?.kind === 'entity') applySelection(sel);
  };
  // 启动即应用持久化的地图布局（A 布局默认：美洲位于中国以东）
  applyMapLayout(display.mapLayout);

  // ---- 展开 ----
  const updateExpansionAnchors = (affected: string[]): void => {
    if (affected.length === 0) return;
    entityMeshes.updateMatrices(affected);
    const affectedSet = new Set(affected);
    const touched = dataset.relations
      .filter((r) => affectedSet.has(r.from) || affectedSet.has(r.to))
      .map((r) => r.id);
    edgeRenderer.updatePositions(touched);
    for (const id of affected) {
      labelManager.setPosition(id, index.positionOf(id));
      if (store.alertsOf(id).length > 0) alertFx.updatePosition(id, index.positionOf(id));
    }
  };

  const expandZone = (layer: LayerId, zone: ZoneId): void => {
    if (expansionInfo) collapseExpansion();
    const zoneInfo = zoneBoxes.zones.find((z) => z.layer === layer && z.zone === zone);
    if (!zoneInfo || zoneInfo.entityIds.length === 0) return;
    const ids = zoneInfo.entityIds;
    const entities = ids.map((id) => ({ id, kind: store.entity(id)?.kind ?? '', radius: index.radiusOf(id) }));
    const layout = EntityIndex.expandedLayout(entities);
    const bounds = index.zoneBoundsOf(layer, zone);
    const center = new THREE.Vector3(
      (bounds.x0 + bounds.x1) / 2,
      LAYER_HEIGHTS[layer] + EXPANSION_OFFSET,
      (bounds.z0 + bounds.z1) / 2, // 区域整体 dz 偏移后展开平面中心同步
    );
    const abs = new Map<string, { x: number; z: number }>();
    for (const [id, p] of layout.positions) abs.set(id, { x: center.x + p.x, z: center.z + p.z });

    const affected = index.applyExpansion(ids, abs, center.y);
    // 展开期间若本层正处于层分离位移中，展开平面同样偏移（anchorY=planeY 后重放位移）
    if (shiftCurrent[layer] !== 0) index.setLayerShift(layer, shiftCurrent[layer], true);
    updateExpansionAnchors(affected);

    expansionPlateMaterial.color.set(LAYER_COLORS[layer]);
    expansionBorderMaterial.color.set(LAYER_COLORS[layer]);
    expansionGroup.position.copy(center);
    expansionGroup.position.y += shiftCurrent[layer];
    expansionGroup.visible = true;
    expansionIntro = 0;

    expansionInfo = { layer, zone, ids, center };
    appStore.set({ expansion: { layer, zone } });
    const preset = expansionPreset(center);
    flight.flyTo(preset.position, preset.target, 1.3);
  };

  const collapseExpansion = (): void => {
    const info = expansionInfo;
    if (!info) return;
    expansionInfo = null;
    const affected = index.restoreExpansion(info.ids);
    updateExpansionAnchors(affected);
    expansionGroup.visible = false;
    appStore.set({ expansion: null });
    const preset = focus === 'all' ? CAMERA_PRESETS.overview : focusPreset(focus, display.focusPitchDeg);
    flight.flyTo(preset.position, preset.target, 1.2);
  };

  // ---- 剧本切换 ----
  const setScenario = (id: string | null): void => {
    store.resetToInitial();
    store.engine.loadScenario(id);
    alertFx.clear();
    alertTint.clear();
    stateTint.clear();
    for (const e of dataset.entities) entityMeshes.setInstanceColor(e.id, '', true);
    edgeRenderer.updateKinds(dataset.relations.map((r) => r.id));
    edgeRenderer.updateWidths(dataset.relations.map((r) => r.id));
    applyEdgeVisibility();
    appStore.set({ scenarioId: id });
  };

  // ---- 仿真事件订阅 → 视图联动 ----
  const unsubStore = store.subscribe((envs: SimEventEnvelope[]) => {
    const widthIds = new Set<string>();
    const kindIds = new Set<string>();
    for (const { ev } of envs) {
      switch (ev.type) {
        case 'alert:raise': {
          const a: Alert = ev.alert;
          alertFx.spawn(a.entityId, index.positionOf(a.entityId), a.level, index.radiusOf(a.entityId));
          const prev = alertTint.get(a.entityId);
          const severity = ALERT_SEVERITY[a.level] ?? 1;
          if (!prev || severity >= prev.severity) {
            alertTint.set(a.entityId, { color: ALERT_LEVEL_COLORS[a.level], count: (prev?.count ?? 0) + 1, severity });
          } else {
            prev.count++;
          }
          repaint(a.entityId);
          break;
        }
        case 'alert:clear': {
          const alert = store.state.alerts[ev.alertId];
          if (!alert) break;
          const eid = alert.entityId;
          const t = alertTint.get(eid);
          if (t) {
            t.count--;
            if (t.count <= 0) {
              alertTint.delete(eid);
              alertFx.release(eid);
            }
          }
          repaint(eid);
          break;
        }
        case 'relation:volume':
          widthIds.add(ev.relationId);
          break;
        case 'relation:kind':
          kindIds.add(ev.relationId);
          applyEdgeVisibilityFor(ev.relationId);
          break;
        case 'entity:state':
          tintByState(ev.entityId, ev.state);
          break;
        case 'stat:update':
          break;
      }
    }
    if (widthIds.size > 0) edgeRenderer.updateWidths([...widthIds]);
    if (kindIds.size > 0) edgeRenderer.updateKinds([...kindIds]);
  });

  // ---- AppStore 订阅 ----
  let prevSelection: AppState['selection'] = appStore.get().selection;
  let prevCrossLinks: AppState['crossLinks'] = appStore.get().crossLinks;
  const unsubApp = appStore.subscribe((state) => {
    if (state.focus !== focus) applyFocus(state.focus);
    if (state.selection !== prevSelection) {
      prevSelection = state.selection;
      applySelection(state.selection);
      // mode=entity：选中实体变化即时刷新"选中实体专属"跨层边
      const cl = appStore.get().crossLinks;
      if (cl.mode === 'entity' && state.selection?.kind === 'entity' && cl.entityId !== state.selection.id) {
        appStore.set({ crossLinks: { mode: 'entity', entityId: state.selection.id } });
      }
    }
    if (state.crossLinks !== prevCrossLinks) {
      prevCrossLinks = state.crossLinks;
      applyEdgeVisibility();
    }
  });

  // ---- 手势 ----
  const detachGestures = attachGestures(domElement, {
    onClick(e) {
      if (flight.isActive) return;
      const entityId = picker.pickEntity(e.clientX, e.clientY);
      if (entityId) {
        appStore.set({ selection: { kind: 'entity', id: entityId } });
        return;
      }
      const relId = picker.pickEdge(e.clientX, e.clientY);
      // 聚焦态连线拾取门控（P5）：非聚焦层连线对点击透明，
      // 与实体/区域拾取约定一致（聚焦某层时仅该层及跨层到本层的连线可命中）
      if (relId && edgePickableInFocus(relId, focus)) {
        appStore.set({ selection: { kind: 'relation', id: relId } });
        return;
      }
      // 区域拾取（P5）：层/网/子区域/地图=地域层；命中后选中并聚焦所属层
      const region = picker.pickRegion(e.clientX, e.clientY, focus);
      if (region) {
        appStore.set({ selection: { kind: 'region', region } });
        if (region.type !== 'global' && region.layer !== focus) {
          appStore.set({ focus: region.layer });
        }
        // 布局设置 tab 打开时，点击网/子区域切换配置目标（P5-4 3D 联动）
        const st = appStore.get();
        if (st.settingsOpen && st.settingsTab === 'layout') {
          const target = layoutTargetOf(region);
          if (target) appStore.set({ layoutTarget: target });
        }
        return;
      }
      appStore.set({ selection: null });
    },
    onHover(e) {
      if (flight.isActive) return;
      const id = picker.pickEntity(e.clientX, e.clientY);
      if (id === hoverId) return;
      if (hoverId) repaint(hoverId);
      hoverId = id;
      domElement.style.cursor = id ? 'pointer' : '';
      if (id) repaint(id);
    },
  });

  // ---- 每帧编排 ----
  const dimStep = (layer: LayerId, dt: number): void => {
    const cur = dimCurrent[layer];
    const next = cur + (dimTarget[layer] - cur) * (1 - Math.exp(-DIM_DAMP * dt));
    if (Math.abs(next - cur) < 0.0004) {
      dimCurrent[layer] = dimTarget[layer];
      layerDimUniforms[layer].value = dimTarget[layer];
      return;
    }
    dimCurrent[layer] = next;
    layerDimUniforms[layer].value = next;
  };

  const size = new THREE.Vector2();

  const tick = (dt: number, now: number): void => {
    flight.update(dt);
    keyboardCamera.tick(dt);
    if (controls.controls.enabled) controls.update(dt);

    for (const layer of ['geo', 'device', 'app', 'task'] as const) dimStep(layer, dt);
    const moved = Math.max(
      Math.abs(dimCurrent.geo - lastAppliedDim.geo),
      Math.abs(dimCurrent.device - lastAppliedDim.device),
      Math.abs(dimCurrent.app - lastAppliedDim.app),
      Math.abs(dimCurrent.task - lastAppliedDim.task),
    );
    if (moved > 0.006) {
      edgeRenderer.applyDim(dimCurrent);
      // 区域板发光边框随层淡化透明化（底板由 uLayerDim shader 淡化）
      for (const layer of LAYER_ORDER) zoneBoxes.setLayerFade(layer, dimCurrent[layer] / DIM_FULL);
      lastAppliedDim = { ...dimCurrent };
    }

    // 层间分离位移阻尼 + 扇出
    for (const layer of LAYER_ORDER) {
      const cur = shiftCurrent[layer];
      const next = cur + (shiftTarget[layer] - cur) * (1 - Math.exp(-DIM_DAMP * dt));
      shiftCurrent[layer] = Math.abs(next - cur) < 0.0004 ? shiftTarget[layer] : next;
    }
    const shiftMoved = Math.max(
      Math.abs(shiftCurrent.geo - lastAppliedShift.geo),
      Math.abs(shiftCurrent.device - lastAppliedShift.device),
      Math.abs(shiftCurrent.app - lastAppliedShift.app),
      Math.abs(shiftCurrent.task - lastAppliedShift.task),
    );
    if (shiftMoved > 0.002) {
      applyShiftFanout();
      lastAppliedShift = { ...shiftCurrent };
    }

    // 连线动画 uniform
    const u = edgeRenderer.uniforms;
    u.uTime.value = now;
    renderer.getSize(size);
    u.uViewport.value.set(size.x * renderer.getPixelRatio(), size.y * renderer.getPixelRatio());

    // 选中环跟随（展开切换时锚点已变）
    const sel = appStore.get().selection;
    if (sel?.kind === 'entity' && ring.visible) {
      const pos = index.positionOf(sel.id);
      ring.position.set(pos.x, pos.y + 0.15, pos.z);
    }

    // 展开子平面入场
    if (expansionInfo && expansionIntro < 0.35) {
      expansionIntro += dt;
      const k = Math.min(expansionIntro / 0.35, 1);
      expansionGroup.scale.setScalar(0.85 + 0.15 * k);
    }

    labelManager.update(camera);
    alertFx.tick(dt, now);
    deps.onMinimapFrame?.(camera, appStore.get());
  };

  const dispose = (): void => {
    unsubStore();
    unsubApp();
    unsubSettings();
    keyboardCamera.dispose();
    detachGestures();
    picker.dispose();
    scene.remove(ring);
    ring.geometry.dispose();
    (ring.material as THREE.Material).dispose();
  };

  // ---- 初始策略：总览 → 仅地域层标签可见、层间关联隐藏 ----
  applyLabelPolicy();
  applyEdgeVisibility();

  return {
    flight,
    tick,
    focusLayer: (layer) => appStore.set({ focus: layer }),
    expandZone,
    collapseExpansion,
    setScenario,
    dispose,
  };
}
