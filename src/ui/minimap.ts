/**
 * 缩略图（P4 窗口化，2D canvas，15Hz 节流重绘）：
 * - 4 层带（地域/设备/应用/任务）× 4 分区矩形 + 类型色实体点；
 * - 聚焦层高亮、非聚焦层带淡化；展开区域虚线框标注；
 * - 当前视口在地域层带上的投影矩形（相机射线求交）；
 * - 点击层带 = 聚焦该层；点击分区 = 展开/收起该区域（地域层仅聚焦）；
 * - 标题栏：总览按钮（选中全局区域 + 回总览视角）、缩小停靠按钮。
 */
import * as THREE from 'three';
import type { Dataset, LayerId, ZoneId } from '../shared/types';
import { ZONES } from '../shared/types';
import { ZONE_COLORS, LAYER_COLORS } from '../shared/palette';
import { kindDef } from '../shared/kinds';
import { EntityIndex } from '../engine/entity-index';
import type { AppState, AppStore } from './store/app-store';
import { el } from './dom';

export interface MinimapDeps {
  root: HTMLElement;
  dataset: Dataset;
  index: EntityIndex;
  appStore: AppStore;
  focusLayer(layer: LayerId | 'all'): void;
  expandZone(layer: LayerId, zone: ZoneId): void;
  collapseExpansion(): void;
}

const BANDS: LayerId[] = ['task', 'app', 'device', 'geo']; // 自顶向下
const BAND_H = 58;
const BAND_GAP = 6;
const PAD = 8;
const CANVAS_W = 208;
const CANVAS_H = PAD * 2 + BANDS.length * BAND_H + (BANDS.length - 1) * BAND_GAP;

const VIEW_PROJ = new THREE.Vector3();
const RAY_DIR = new THREE.Vector3();
const PLANE_NORMAL = new THREE.Vector3(0, 1, 0);

export function createMinimap(deps: MinimapDeps): { update(camera: THREE.PerspectiveCamera, state: AppState): void } {
  const { root, dataset, index, appStore } = deps;
  const canvas = el('canvas', { id: 'minimap', width: String(CANVAS_W), height: String(CANVAS_H) });
  canvas.style.width = `${CANVAS_W}px`;
  canvas.style.height = `${CANVAS_H}px`;
  let docked = false;
  const body = el('div', { class: 'minimap-body' }, canvas);
  const panel = el('div', { class: 'panel minimap-panel' },
    el('div', { class: 'minimap-title' },
      el('span', { text: '分层缩略图' }),
      el('span', { class: 'minimap-actions' },
        el('button', {
          class: 'btn small',
          'data-minimap-overview': '',
          title: '总览：选中全局区域并回到全局视角',
          text: '总览',
          onclick: () => {
            appStore.set({ selection: { kind: 'region', region: { type: 'global' } } });
            deps.focusLayer('all');
          },
        }),
        el('button', {
          class: 'btn small',
          'data-minimap-min': '',
          title: docked ? '还原缩略图' : '缩小停靠（仅保留标题栏）',
          text: docked ? '⤢' : '—',
          onclick: () => {
            docked = !docked;
            body.classList.toggle('hidden', docked);
          },
        }),
      ),
    ),
    body,
  );
  root.append(panel);
  const ctx = canvas.getContext('2d')!;

  // 世界坐标 → 层带内像素
  const bandOf = (layer: LayerId): { x0: number; y0: number; w: number; h: number } => {
    const i = BANDS.indexOf(layer);
    const y0 = PAD + i * (BAND_H + BAND_GAP);
    return { x0: PAD, y0, w: CANVAS_W - PAD * 2, h: BAND_H };
  };

  /** 该层全部区域 x 范围（平面尺寸配置可调整，非固定 ±30）；地域层带随地图布局 A/B 变化 */
  const worldXRange = (layer: LayerId): { x0: number; w: number } => {
    if (layer === 'geo') {
      const r = index.geoBandRange();
      return { x0: r.x0, w: r.x1 - r.x0 };
    }
    let total = 0;
    for (const zone of ZONES) {
      const b = index.zoneBoundsOf(layer, zone);
      total += b.x1 - b.x0;
    }
    return { x0: -total / 2, w: total };
  };

  const worldToBand = (x: number, z: number, layer: LayerId): { x: number; y: number } => {
    const b = bandOf(layer);
    const depth = index.layoutInfo[layer] ? maxDepth(layer) : 20;
    const range = worldXRange(layer);
    const px = b.x0 + ((x - range.x0) / range.w) * b.w;
    const py = b.y0 + b.h / 2 + (z / Math.max(depth + 6, 8)) * (b.h / 2);
    return { x: px, y: py };
  };

  const maxDepth = (layer: LayerId): number => {
    let d = 8;
    for (const v of Object.values(index.layoutInfo[layer])) d = Math.max(d, Number(v) || 0);
    return d;
  };

  /** 视口在层平面上的投影矩形（返回 null 表示无有效投影） */
  const projectViewport = (
    camera: THREE.PerspectiveCamera,
    planeY: number,
  ): { x0: number; x1: number; z0: number; z1: number } | null => {
    const corners = [new THREE.Vector2(-1, -1), new THREE.Vector2(1, -1), new THREE.Vector2(1, 1), new THREE.Vector2(-1, 1)];
    const pts: THREE.Vector3[] = [];
    for (const ndc of corners) {
      VIEW_PROJ.set(ndc.x, ndc.y, 0.5).unproject(camera);
      RAY_DIR.copy(VIEW_PROJ).sub(camera.position).normalize();
      const denom = RAY_DIR.dot(PLANE_NORMAL);
      if (Math.abs(denom) < 1e-6) continue; // 与平面平行
      const t = (planeY - camera.position.y) / denom;
      if (t < 0) continue; // 相机背离平面
      pts.push(new THREE.Vector3().copy(camera.position).addScaledVector(RAY_DIR, t));
    }
    if (pts.length < 3) return null;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of pts) {
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
      z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z);
    }
    return { x0, x1, z0, z1 };
  };

  let camera: THREE.PerspectiveCamera | null = null;
  let lastState: AppState = appStore.get();
  let lastDraw = 0;

  const draw = (now: number): void => {
    if (now - lastDraw < 66) return; // 15Hz 节流
    lastDraw = now;
    const state = lastState;
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    for (const layer of BANDS) {
      const b = bandOf(layer);
      const dimmed = state.focus !== 'all' && state.focus !== layer;
      ctx.globalAlpha = dimmed ? 0.42 : 1;

      // 分区矩形（平面尺寸配置可调整，实时取 index 范围）；地域层无分区，只画实体点
      if (layer !== 'geo') {
        for (const zone of ZONES) {
          const { x0, x1 } = index.zoneBoundsOf(layer, zone);
          const range = worldXRange(layer);
          const px0 = b.x0 + ((x0 - range.x0) / range.w) * b.w;
          const px1 = b.x0 + ((x1 - range.x0) / range.w) * b.w;
          ctx.strokeStyle = ZONE_COLORS[zone];
          ctx.lineWidth = 1;
          ctx.strokeRect(px0 + 1, b.y0 + 1, px1 - px0 - 2, b.h - 2);
        }
      }

      // 展开虚线框
      if (state.expansion?.layer === layer) {
        const { x0, x1 } = index.zoneBoundsOf(layer, state.expansion.zone);
        const range = worldXRange(layer);
        const px0 = b.x0 + ((x0 - range.x0) / range.w) * b.w;
        const px1 = b.x0 + ((x1 - range.x0) / range.w) * b.w;
        ctx.save();
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = LAYER_COLORS[layer];
        ctx.lineWidth = 1.5;
        ctx.strokeRect(px0 - 2, b.y0 - 2, px1 - px0 + 4, b.h + 4);
        ctx.restore();
      }

      // 区域选中高亮（P5）：网=分区矩形、子区域=带、层=整条层带、全局=整个缩略图
      const selRegion = state.selection?.kind === 'region' ? state.selection.region : null;
      if (selRegion && selRegion.type !== 'global' && selRegion.layer === layer) {
          const range = worldXRange(layer);
          const zToY = (z: number): number => worldToBand(0, z, layer).y;
          let hx0 = b.x0, hx1 = b.x0 + b.w, hy0 = b.y0, hy1 = b.y0 + b.h;
          if (selRegion!.type === 'zone' || selRegion!.type === 'sub') {
            const { x0, x1, z0, z1 } = index.zoneBoundsOf(selRegion!.layer, selRegion!.zone);
            hx0 = b.x0 + ((x0 - range.x0) / range.w) * b.w;
            hx1 = b.x0 + ((x1 - range.x0) / range.w) * b.w;
            if (selRegion!.type === 'sub') {
              const sub = index.subsOf(selRegion!.layer, selRegion!.zone).find((s) => s.kind === selRegion!.kind);
              if (sub) {
                const cz = (z0 + z1) / 2;
                hy0 = zToY(cz + sub.z0);
                hy1 = zToY(cz + sub.z1);
              }
            }
          }
          ctx.save();
          ctx.fillStyle = 'rgba(34,211,238,0.18)';
          ctx.fillRect(hx0, hy0, hx1 - hx0, hy1 - hy0);
          ctx.strokeStyle = '#22d3ee';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(hx0, hy0, hx1 - hx0, hy1 - hy0);
          ctx.restore();
      }

      // 实体点（实时取位置：布局配置变更后点位同步）
      for (const e of dataset.entities) {
        if (e.layer !== layer) continue;
        const p = index.positionOf(e.id);
        const dot = worldToBand(p.x, p.z, layer);
        if (dot.x < b.x0 || dot.x > b.x0 + b.w || dot.y < b.y0 || dot.y > b.y0 + b.h) continue;
        ctx.fillStyle = kindDef(e.kind).color;
        ctx.fillRect(dot.x - 1, dot.y - 1, 2, 2);
      }

      // 聚焦层带边框
      if (!dimmed) {
        ctx.strokeStyle = LAYER_COLORS[layer];
        ctx.lineWidth = 1.5;
        ctx.strokeRect(b.x0 - 1, b.y0 - 1, b.w + 2, b.h + 2);
        ctx.font = '10px "Noto Sans CJK SC", sans-serif';
        ctx.fillStyle = LAYER_COLORS[layer];
        ctx.textAlign = 'left';
        ctx.fillText(layerLabel(layer), b.x0 + 4, b.y0 + 12);
      }

      // 视口投影（地域层）
      if (layer === 'geo' && camera) {
        const proj = projectViewport(camera, 0);
        if (proj) {
          const p0 = worldToBand(proj.x0, proj.z0, layer);
          const p1 = worldToBand(proj.x1, proj.z1, layer);
          ctx.fillStyle = 'rgba(224,242,254,0.14)';
          ctx.fillRect(Math.min(p0.x, p1.x), Math.min(p0.y, p1.y), Math.abs(p1.x - p0.x), Math.abs(p1.y - p0.y));
        }
      }
      ctx.globalAlpha = 1;
    }

    // 全局区域选中（P5）：整个缩略图青色描边
    if (state.selection?.kind === 'region' && state.selection.region.type === 'global') {
      ctx.save();
      ctx.strokeStyle = '#22d3ee';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(PAD - 1, PAD - 1, CANVAS_W - PAD * 2 + 2, CANVAS_H - PAD * 2 + 2);
      ctx.restore();
    }
  };

  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const state = appStore.get();
    for (const layer of BANDS) {
      const b = bandOf(layer);
      if (x < b.x0 || x > b.x0 + b.w || y < b.y0 || y > b.y0 + b.h) continue;
      if (state.focus !== layer) {
        deps.focusLayer(layer);
        return;
      }
      // 已聚焦该层：命中分区则切换展开
      if (layer !== 'geo') {
        const range = worldXRange(layer);
        for (const zone of ZONES) {
          const { x0, x1 } = index.zoneBoundsOf(layer, zone);
          const px0 = b.x0 + ((x0 - range.x0) / range.w) * b.w;
          const px1 = b.x0 + ((x1 - range.x0) / range.w) * b.w;
          if (x >= px0 && x <= px1) {
            if (state.expansion?.layer === layer && state.expansion.zone === zone) deps.collapseExpansion();
            else deps.expandZone(layer, zone);
            return;
          }
        }
      }
      return;
    }
  });

  const layerLabel = (layer: LayerId): string =>
    layer === 'geo' ? '地域' : layer === 'device' ? '设备' : layer === 'app' ? '应用' : '任务';

  return {
    update(cam, state) {
      camera = cam;
      lastState = state;
      draw(performance.now());
    },
  };
}
