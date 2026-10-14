/**
 * 区域板：设备/应用/任务层的四个矩形逻辑区域（企业网/业务网/公网境内/公网境外）
 * 半透明底板 + 发光边框 + 区域角标。深度按该区域布局深度动态适配。
 * P5：平面尺寸可配置（显示设置"区域布局"），尺寸变更经 resizeZone 重建底板/边框；
 * 密集区子区域（带）以分界线绘制（setSubs）。
 *
 * P5 区域选择：
 * - 底板（zone-plate）带 userData.region，子区域/层标题另有不可见拾取面（sub-pick/layer-pick）；
 * - setZoneSelected：选中网时底板透明度 ×0.4 + 青色边框；setSubSelected：子区域带青色框；
 *   setLayerSelected：层整体轮廓框；高亮状态在 resizeZone/setSubs 重建后自动重放；
 * - setZoneOverrideStyle：区域整体配色/透明度覆盖（布局设置"区域整体配置"）。
 * 拾取开关 setPickable 与实体拾取同 layers 通道约定（0 可拾取 / 2 不可拾取）。
 */
import * as THREE from 'three';
import type { LayerId, ZoneId } from '../../shared/types';
import { ZONES, ZONE_LABELS } from '../../shared/types';
import type { RegionId } from '../../shared/regions';
import { LAYER_HEIGHTS } from '../../shared/layout/layer';
import { ZONE_COLORS } from '../../shared/palette';
import { injectLayerDim, layerDimUniforms } from '../../engine/materials';
import type { EntityIndex, ZoneBounds } from '../../engine/entity-index';
import type { AdaptiveSub } from '../../shared/layout/adaptive';

export interface ZoneBoxInfo {
  layer: LayerId;
  zone: ZoneId;
  /** 世界坐标范围 */
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  y: number;
  /** 区域中心（标签锚点） */
  center: THREE.Vector3;
  /** 区域实体 id 列表 */
  entityIds: string[];
}

export interface ZoneBoxRegistry {
  group: THREE.Group;
  /** 全部区域信息（缩略图/展开交互用） */
  zones: ZoneBoxInfo[];
  /** 平面尺寸变更：按新范围重建底板/边框并更新区域信息 */
  resizeZone: (layer: LayerId, zone: ZoneId, bounds: ZoneBounds) => void;
  /** 子区域分界线（密集带；非密集区传空数组清除） */
  setSubs: (layer: LayerId, zone: ZoneId, subs: AdaptiveSub[]) => void;
  /** 层分离：该层区域板/边框整体垂直移动 dy（见显示设置"层间分离"） */
  setLayerOffset(layer: LayerId, dy: number): void;
  /** 层分离：该层发光边框按淡化量 faded（0–1）透明化（底板由 uLayerDim 统一淡化） */
  setLayerFade(layer: LayerId, faded: number): void;
  /** 风格样式：分区底板配色（基色/不透明度/是否按区域色着色，边框保持区域语义色） */
  setPlateStyle: (color: string, opacity: number, zoneTint: boolean) => void;
  /** P5：区域整体配色/透明度覆盖（color/opacity 任一缺省跟随风格样式；均缺省清除覆盖） */
  setZoneOverrideStyle(layer: LayerId, zone: ZoneId, color?: string, opacity?: number): void;
  /** P5：网（区域）选中高亮（底板透明度 ×0.4 + 青色边框） */
  setZoneSelected(layer: LayerId, zone: ZoneId, selected: boolean): void;
  /** P5：子区域（密集带）选中高亮（青色带框） */
  setSubSelected(layer: LayerId, zone: ZoneId, kind: string, selected: boolean): void;
  /** P5：层选中高亮（层整体轮廓框） */
  setLayerSelected(layer: LayerId, selected: boolean): void;
  /** P5：区域拾取目标分组（每次调用实时收集：sub=子区域拾取面（优先），zone=底板+层标题拾取面） */
  pickTargets: () => { sub: THREE.Object3D[]; zone: THREE.Object3D[] };
  /** P5：层拾取开关（聚焦时仅当前层区域可选中） */
  setPickable(layer: LayerId, pickable: boolean): void;
}

/** 边框基础/最大淡化不透明度 */
const BORDER_OPACITY = 0.4;
const BORDER_OPACITY_FADED = 0.08;
/** 区域板抬升（避免与实体/地图 z-fighting） */
const PLATE_DROP = 0.12;
/** 边框抬升 */
const BORDER_DROP = 0.1;
/** 选中高亮色（与 view-sync SELECT_COLOR 一致） */
const SELECT_COLOR = '#22d3ee';
/** 子区域拾取面在底板之上的抬升 */
const SUB_QUAD_LIFT = 0.03;
/** 层标题拾取面（landmark-layer-* 标签锚点附近） */
const LAYER_PICK_CENTER_X = -34;
const LAYER_PICK_W = 7;
const LAYER_PICK_H = 2;

export function buildZoneBoxes(
  layers: LayerId[],
  index: EntityIndex,
  entityIdsByZone: (layer: LayerId, zone: ZoneId) => string[],
): ZoneBoxRegistry {
  const group = new THREE.Group();
  group.name = 'zone-boxes';
  const zones: ZoneBoxInfo[] = [];

  /** 每层一个子组：层分离时整体移动，避免逐对象重算 */
  const layerGroups: Partial<Record<LayerId, THREE.Group>> = {};
  const borderMats: Partial<Record<LayerId, THREE.LineBasicMaterial[]>> = {};
  const lastFade: Partial<Record<LayerId, number>> = {};

  interface ZoneVisual {
    plate: THREE.Mesh;
    border: THREE.LineLoop;
    subLines: THREE.LineSegments | null;
    /** 子区域拾取面（与当前子区域带一一对应） */
    subPicks: THREE.Mesh[];
    info: ZoneBoxInfo;
  }
  const visuals = new Map<string, ZoneVisual>();
  const vKey = (layer: LayerId, zone: ZoneId): string => `${layer}:${zone}`;

  // ---- P5 状态：风格样式 / 区域覆盖 / 选中高亮 / 拾取开关 ----
  let style = { color: '#3b82f6', opacity: 0.05, zoneTint: true };
  const zoneOverrides = new Map<string, { color?: string; opacity?: number }>();
  const selectedZones = new Set<string>();
  const selectedSubs = new Set<string>();
  const selectedLayers = new Set<LayerId>();
  const pickableLayers = new Set<LayerId>(['geo', 'device', 'app', 'task']);
  /** 每层标题拾取面 / 层选中轮廓线 / 该层区域最近一次子区域定义 */
  const layerPicks: Partial<Record<LayerId, THREE.Mesh>> = {};
  const layerHighlights = new Map<LayerId, THREE.LineLoop>();
  const subHighlights = new Map<string, THREE.LineLoop>();
  const lastSubs = new Map<string, AdaptiveSub[]>();

  const plateGeometry = (x0: number, x1: number, d: number): THREE.PlaneGeometry => {
    const geo = new THREE.PlaneGeometry(x1 - x0, d);
    geo.setAttribute('aActive', new THREE.BufferAttribute(new Float32Array(4).fill(1), 1));
    return geo;
  };

  /** 不可见拾取面材质：透明 + 不写颜色/深度（几何体参与 raycast，视觉零痕迹） */
  const pickMaterial = (): THREE.MeshBasicMaterial =>
    new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
      colorWrite: false,
      side: THREE.DoubleSide,
    });

  /** 分区底板材质（每层每区一个，风格样式按区着色需独立材质；共享淡化 uniform） */
  const plateMats: Array<{ layer: LayerId; zone: ZoneId; mat: THREE.MeshBasicMaterial }> = [];

  /** 区域中心 z（含整体 dz 偏移；子区域 z 值为区域中心相对坐标，绝对位置 = 中心 + 相对值） */
  const centerZOf = (info: ZoneBoxInfo): number => (info.z0 + info.z1) / 2;

  // ---- 材质刷新（风格样式 → 区域覆盖 → 选中高亮逐级叠加） ----
  const refreshPlate = (layer: LayerId, zone: ZoneId): void => {
    const entry = plateMats.find((p) => p.layer === layer && p.zone === zone);
    if (!entry) return;
    const ov = zoneOverrides.get(vKey(layer, zone));
    const color = ov?.color ?? (style.zoneTint ? ZONE_COLORS[zone] : style.color);
    const opacity = ov?.opacity ?? style.opacity;
    const selected = selectedZones.has(vKey(layer, zone));
    entry.mat.color.set(color);
    entry.mat.opacity = opacity * (selected ? 0.4 : 1);
  };

  const fadeOpacityOf = (layer: LayerId): number =>
    BORDER_OPACITY + (BORDER_OPACITY_FADED - BORDER_OPACITY) * (lastFade[layer] ?? 0);

  const refreshBorder = (layer: LayerId, zone: ZoneId): void => {
    const v = visuals.get(vKey(layer, zone));
    if (!v) return;
    const mat = v.border.material as THREE.LineBasicMaterial;
    const selected = selectedZones.has(vKey(layer, zone));
    mat.color.set(selected ? SELECT_COLOR : ZONE_COLORS[zone]);
    mat.opacity = selected ? 0.9 : fadeOpacityOf(layer);
  };

  /** 子区域带绝对 z 范围（含区域 dz 偏移） */
  const bandZ = (info: ZoneBoxInfo, s: AdaptiveSub): { z0: number; z1: number } => {
    const c = centerZOf(info);
    return { z0: c + s.z0, z1: c + s.z1 };
  };

  /** 子区域选中框重建（带定义变更后重放） */
  const rebuildSubHighlight = (layer: LayerId, zone: ZoneId, kind: string): void => {
    const key = `${layer}:${zone}:${kind}`;
    const old = subHighlights.get(key);
    if (old) {
      old.geometry.dispose();
      (old.material as THREE.Material).dispose();
      layerGroups[layer]!.remove(old);
      subHighlights.delete(key);
    }
    if (!selectedSubs.has(key)) return;
    const v = visuals.get(vKey(layer, zone));
    const s = lastSubs.get(vKey(layer, zone))?.find((b) => b.kind === kind);
    if (!v || !s) return;
    const { z0, z1 } = bandZ(v.info, s);
    const y = LAYER_HEIGHTS[layer] - BORDER_DROP - 0.02;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [v.info.x0 + 0.2, y, z0, v.info.x1 - 0.2, y, z0, v.info.x1 - 0.2, y, z1, v.info.x0 + 0.2, y, z1],
        3,
      ),
    );
    const line = new THREE.LineLoop(
      geo,
      new THREE.LineBasicMaterial({ color: SELECT_COLOR, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    line.raycast = () => {}; // 高亮线不参与拾取
    layerGroups[layer]!.add(line);
    subHighlights.set(key, line);
  };

  /** 层选中轮廓线重建（区域尺寸/偏移变更后重放） */
  const rebuildLayerHighlight = (layer: LayerId): void => {
    const old = layerHighlights.get(layer);
    if (old) {
      old.geometry.dispose();
      (old.material as THREE.Material).dispose();
      layerGroups[layer]!.remove(old);
      layerHighlights.delete(layer);
    }
    if (!selectedLayers.has(layer)) return;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const z of zones) {
      if (z.layer !== layer) continue;
      x0 = Math.min(x0, z.x0); x1 = Math.max(x1, z.x1);
      z0 = Math.min(z0, z.z0); z1 = Math.max(z1, z.z1);
    }
    if (x0 === Infinity) return;
    const y = LAYER_HEIGHTS[layer] - BORDER_DROP - 0.03;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1], 3),
    );
    const line = new THREE.LineLoop(
      geo,
      new THREE.LineBasicMaterial({ color: SELECT_COLOR, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    line.raycast = () => {};
    layerGroups[layer]!.add(line);
    layerHighlights.set(layer, line);
  };

  for (const layer of layers) {
    const y = LAYER_HEIGHTS[layer];
    const layerGroup = new THREE.Group();
    layerGroup.name = `zone-boxes-${layer}`;
    layerGroups[layer] = layerGroup;
    group.add(layerGroup);
    borderMats[layer] = [];

    for (const zone of ZONES) {
      const bounds = index.zoneBoundsOf(layer, zone);
      const ids = entityIdsByZone(layer, zone);
      const { x0, x1, z0, z1 } = bounds;

      const material = new THREE.MeshBasicMaterial({
        color: ZONE_COLORS[zone],
        transparent: true,
        opacity: 0.05,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      injectLayerDim(material, layerDimUniforms[layer]);
      plateMats.push({ layer, zone, mat: material });

      const plate = new THREE.Mesh(plateGeometry(x0, x1, bounds.d), material);
      plate.rotation.x = -Math.PI / 2;
      plate.position.set((x0 + x1) / 2, y - PLATE_DROP, 0);
      plate.userData.layer = layer;
      plate.userData.zone = zone;
      plate.userData.region = { type: 'zone', layer, zone } satisfies RegionId;
      plate.name = `zone-plate-${layer}-${zone}`;
      layerGroup.add(plate);

      // 发光边框
      const borderGeo = new THREE.BufferGeometry();
      borderGeo.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(
          [x0, y - BORDER_DROP, z0, x1, y - BORDER_DROP, z0, x1, y - BORDER_DROP, z1, x0, y - BORDER_DROP, z1],
          3,
        ),
      );
      const borderMat = new THREE.LineBasicMaterial({
        color: ZONE_COLORS[zone],
        transparent: true,
        opacity: BORDER_OPACITY,
        depthWrite: false,
      });
      borderMats[layer]!.push(borderMat);
      const border = new THREE.LineLoop(borderGeo, borderMat);
      border.raycast = () => {}; // 细线不参与拾取（底板/拾取面承接）
      border.userData.zone = zone;
      border.userData.layer = layer;
      layerGroup.add(border);

      const info: ZoneBoxInfo = {
        layer,
        zone,
        x0,
        x1,
        z0,
        z1,
        y,
        center: new THREE.Vector3((x0 + x1) / 2, y, 0),
        entityIds: ids,
      };
      zones.push(info);
      visuals.set(vKey(layer, zone), { plate, border, subLines: null, subPicks: [], info });
    }

    // 层标题拾取面（landmark-layer-* 标签锚点处，点击选中该层）
    const pick = new THREE.Mesh(new THREE.PlaneGeometry(LAYER_PICK_W, LAYER_PICK_H), pickMaterial());
    pick.rotation.x = -Math.PI / 2;
    pick.position.set(LAYER_PICK_CENTER_X, y + (layer === 'geo' ? 0.9 : 1.0), 0);
    pick.userData.region = { type: 'layer', layer } satisfies RegionId;
    pick.name = `layer-pick-${layer}`;
    layerGroup.add(pick);
    layerPicks[layer] = pick;
  }

  const resizeZone = (layer: LayerId, zone: ZoneId, bounds: ZoneBounds): void => {
    const v = visuals.get(vKey(layer, zone));
    if (!v) return;
    const y = LAYER_HEIGHTS[layer];
    const { x0, x1, z0, z1 } = bounds;
    v.plate.geometry.dispose();
    v.plate.geometry = plateGeometry(x0, x1, bounds.d);
    v.plate.position.set((x0 + x1) / 2, y - PLATE_DROP, 0);
    v.border.geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [x0, y - BORDER_DROP, z0, x1, y - BORDER_DROP, z0, x1, y - BORDER_DROP, z1, x0, y - BORDER_DROP, z1],
        3,
      ),
    );
    Object.assign(v.info, { x0, x1, z0, z1 });
    v.info.center.set((x0 + x1) / 2, y, 0);
    setSubs(layer, zone, []); // 尺寸变更后分界线/拾取面按新范围重绘（由 view-sync 随后 setSubs）
    rebuildLayerHighlight(layer); // 层轮廓线随尺寸变更重放
  };

  /** 子区域分界线 + 拾取面：每带前缘一条细线（半透区域色）+ 一条透明拾取带 */
  const setSubs = (layer: LayerId, zone: ZoneId, subs: AdaptiveSub[]): void => {
    const v = visuals.get(vKey(layer, zone));
    if (!v) return;
    if (v.subLines) {
      v.subLines.geometry.dispose();
      (v.subLines.material as THREE.Material).dispose();
      layerGroups[layer]!.remove(v.subLines);
      v.subLines = null;
    }
    for (const q of v.subPicks) {
      q.geometry.dispose();
      (q.material as THREE.Material).dispose();
      layerGroups[layer]!.remove(q);
    }
    v.subPicks = [];
    lastSubs.set(vKey(layer, zone), subs);
    if (subs.length === 0) return;
    const y = LAYER_HEIGHTS[layer];
    const pts: number[] = [];
    for (const s of subs) {
      const { z0, z1 } = bandZ(v.info, s);
      pts.push(v.info.x0 + 0.2, y - BORDER_DROP - 0.01, z0, v.info.x1 - 0.2, y - BORDER_DROP - 0.01, z0);
      // 透明拾取面：覆盖整个带的宽深（略内缩避免与相邻带重叠）
      const pick = new THREE.Mesh(
        new THREE.PlaneGeometry(Math.max(v.info.x1 - v.info.x0 - 0.4, 0.5), Math.max(z1 - z0 - 0.15, 0.3)),
        pickMaterial(),
      );
      pick.rotation.x = -Math.PI / 2;
      pick.position.set((v.info.x0 + v.info.x1) / 2, y - PLATE_DROP + SUB_QUAD_LIFT, z0 + (z1 - z0) / 2);
      pick.userData.region = { type: 'sub', layer, zone, kind: s.kind } satisfies RegionId;
      pick.name = `sub-pick-${layer}-${zone}-${s.kind}`;
      pick.layers.set(pickableLayers.has(layer) ? 0 : 2);
      layerGroups[layer]!.add(pick);
      v.subPicks.push(pick);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const line = new THREE.LineSegments(
      geo,
      new THREE.LineBasicMaterial({ color: ZONE_COLORS[zone], transparent: true, opacity: 0.28, depthWrite: false }),
    );
    line.raycast = () => {};
    line.name = `zone-subs-${layer}-${zone}`;
    line.userData.layer = layer;
    layerGroups[layer]!.add(line);
    v.subLines = line;
    // 子区域选中框随带定义重放
    for (const key of selectedSubs) {
      if (!key.startsWith(`${layer}:${zone}:`)) continue;
      rebuildSubHighlight(layer, zone, key.slice(`${layer}:${zone}:`.length));
    }
  };

  return {
    group,
    zones,
    resizeZone,
    setSubs,
    setLayerOffset: (layer, dy) => {
      const g = layerGroups[layer];
      if (g) g.position.y = dy;
    },
    setLayerFade: (layer, faded) => {
      if (lastFade[layer] === faded) return;
      lastFade[layer] = faded;
      for (const zone of ZONES) refreshBorder(layer, zone);
    },
    setPlateStyle: (color, opacity, zoneTint) => {
      style = { color, opacity, zoneTint };
      for (const { layer, zone } of plateMats) refreshPlate(layer, zone);
    },
    setZoneOverrideStyle: (layer, zone, color, opacity) => {
      const key = vKey(layer, zone);
      if (color === undefined && opacity === undefined) {
        zoneOverrides.delete(key);
      } else {
        zoneOverrides.set(key, { ...zoneOverrides.get(key), ...(color !== undefined ? { color } : {}), ...(opacity !== undefined ? { opacity } : {}) });
      }
      refreshPlate(layer, zone);
    },
    setZoneSelected: (layer, zone, selected) => {
      const key = vKey(layer, zone);
      if (selected) selectedZones.add(key);
      else selectedZones.delete(key);
      refreshPlate(layer, zone);
      refreshBorder(layer, zone);
    },
    setSubSelected: (layer, zone, kind, selected) => {
      const key = `${layer}:${zone}:${kind}`;
      if (selected) selectedSubs.add(key);
      else selectedSubs.delete(key);
      rebuildSubHighlight(layer, zone, kind);
    },
    setLayerSelected: (layer, selected) => {
      if (selected) selectedLayers.add(layer);
      else selectedLayers.delete(layer);
      rebuildLayerHighlight(layer);
    },
    pickTargets: () => ({
      sub: [...visuals.values()].flatMap((v) => v.subPicks),
      // 仅装配层（device/app/task）有层拾取面；geo 层拾取由地图网格承接（命中=地域层）
      zone: [
        ...[...visuals.values()].map((v) => v.plate),
        ...Object.values(layerPicks).filter((p) => p !== undefined),
      ],
    }),
    setPickable: (layer, pickable) => {
      if (pickable) pickableLayers.add(layer);
      else pickableLayers.delete(layer);
      const mask = pickable ? 0 : 2;
      for (const [key, v] of visuals) {
        if (!key.startsWith(`${layer}:`)) continue;
        v.plate.layers.set(mask);
        for (const q of v.subPicks) q.layers.set(mask);
      }
      layerPicks[layer]?.layers.set(mask);
    },
  };
}

/** 区域标签文案（缩略图/展开按钮共用） */
export function zoneLabel(zone: ZoneId): string {
  return ZONE_LABELS[zone];
}
