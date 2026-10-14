/**
 * 标签管理器：共享图集 Sprite 标签。
 * - 每标签一个 Sprite（共享图集纹理、独立 material.color 乘算着色）；
 * - LOD：投影高度 < 阈值自动隐藏（landmark 标签豁免）；
 * - raycast=noop 点击穿透；depthTest=false 始终可见；
 * - 可见性策略（聚焦层全显/其他层仅 landmark）由 view-sync 经 setBaseVisible 控制。
 */
import * as THREE from 'three';
import { CanvasAtlas, type LabelStyle, type AtlasGlyph } from './atlas';

/** 世界单位 ↔ 逻辑像素（参考距离 ~40 时 15px 字 ≈ 0.54 世界单位） */
const WORLD_PER_PX = 1 / 28;
/** LOD：投影高度低于该像素数时隐藏 */
const MIN_VISIBLE_PX = 7;

interface LabelEntry {
  sprite: THREE.Sprite;
  glyph: AtlasGlyph;
  baseVisible: boolean;
  landmark: boolean;
  tint: THREE.Color | null;
  yScale: number;
}

export class LabelManager {
  private readonly group = new THREE.Group();
  private readonly entries = new Map<string, LabelEntry>();
  /** 标签 id → 文本内容（P7 标签排查：E2E 核对标签与数据集一致性用） */
  private readonly texts = new Map<string, string>();
  private viewportH = 1;
  private fovHalfTan = Math.tan(THREE.MathUtils.degToRad(50 / 2));
  /** 全局开关（显示设置面板）：关闭后全部标签隐藏（含 landmark），重开按策略 + LOD 恢复 */
  private enabled = true;

  constructor(
    scene: THREE.Scene,
    private readonly atlas: CanvasAtlas,
  ) {
    this.group.name = 'label-group';
    this.group.renderOrder = 10;
    scene.add(this.group);
  }

  setViewport(heightPx: number, fovDeg: number): void {
    this.viewportH = Math.max(1, heightPx);
    this.fovHalfTan = Math.tan(THREE.MathUtils.degToRad(fovDeg / 2));
  }

  /** 全局标签开关（显示设置面板"显示实体标签"） */
  setEnabled(v: boolean): void {
    this.enabled = v;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  add(
    id: string,
    text: string,
    position: THREE.Vector3,
    opts: { style?: LabelStyle; landmark?: boolean } = {},
  ): void {
    if (this.entries.has(id)) {
      console.warn(`[LabelManager] 重复标签 id: ${id}`);
      return;
    }
    const glyph = this.atlas.add(text, opts.style);
    const geo = new THREE.PlaneGeometry(1, 1);
    const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
    uv.setXY(0, glyph.u0, glyph.v0);
    uv.setXY(1, glyph.u1, glyph.v0);
    uv.setXY(2, glyph.u1, glyph.v1);
    uv.setXY(3, glyph.u0, glyph.v1);
    uv.needsUpdate = true;

    const material = new THREE.SpriteMaterial({
      map: glyph.texture,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
    const sprite = new THREE.Sprite(material);
    // 关键：必须把 per-glyph UV 几何体赋给 Sprite——three 的 Sprite 默认使用模块级
    // 共享几何体（UV 覆盖整张图集页），漏掉此行会导致所有标签都渲染整页文字拼盘
    //（曾表现为"每个标签内容都是机房列表"）。
    sprite.geometry = geo;
    sprite.scale.set(glyph.w * WORLD_PER_PX, glyph.h * WORLD_PER_PX, 1);
    sprite.position.copy(position);
    sprite.raycast = () => undefined; // 点击穿透
    sprite.userData.labelId = id;
    this.group.add(sprite);

    this.entries.set(id, {
      sprite,
      glyph,
      baseVisible: opts.landmark === true,
      landmark: opts.landmark === true,
      tint: null,
      yScale: glyph.h * WORLD_PER_PX,
    });
    this.texts.set(id, text);
  }

  setPosition(id: string, v: THREE.Vector3): void {
    this.entries.get(id)?.sprite.position.copy(v);
  }

  /** 移除标签（布局变更时子区域标签增删用） */
  remove(id: string): void {
    const e = this.entries.get(id);
    if (!e) return;
    this.group.remove(e.sprite);
    e.sprite.material.dispose();
    e.sprite.geometry.dispose();
    this.entries.delete(id);
    this.texts.delete(id);
  }

  /** 标签 id → 文本（快照，供 E2E/排查核对） */
  labelTexts(): Record<string, string> {
    return Object.fromEntries(this.texts);
  }

  setBaseVisible(id: string, visible: boolean): void {
    const e = this.entries.get(id);
    if (e) e.baseVisible = visible;
  }

  setTint(id: string, colorHex: string | null): void {
    const e = this.entries.get(id);
    if (!e) return;
    e.tint = colorHex ? new THREE.Color(colorHex) : null;
    (e.sprite.material as THREE.SpriteMaterial).color.copy(e.tint ?? new THREE.Color(0xffffff));
  }

  /** 每帧 LOD：按投影高度隐藏/显示（baseVisible 为策略前提） */
  update(camera: THREE.Camera): void {
    const camPos = camera.position;
    for (const e of this.entries.values()) {
      if (!this.enabled) {
        e.sprite.visible = false;
        continue;
      }
      if (!e.baseVisible) {
        e.sprite.visible = false;
        continue;
      }
      if (e.landmark) {
        e.sprite.visible = true;
        continue;
      }
      const dist = Math.max(camPos.distanceTo(e.sprite.position), 0.001);
      const pxPerUnit = (this.viewportH * 0.5) / (this.fovHalfTan * dist);
      e.sprite.visible = e.yScale * pxPerUnit >= MIN_VISIBLE_PX;
    }
  }

  clear(): void {
    for (const e of this.entries.values()) {
      this.group.remove(e.sprite);
      e.sprite.material.dispose();
      e.sprite.geometry.dispose();
    }
    this.entries.clear();
  }
}
