/**
 * Canvas 文字图集（多页，1024² @ 2x DPR 保证 CJK 清晰）：
 * 所有标签文字预烘焙到共享图集页，Sprite 按 UV 子矩形引用。
 * 单页满（~110 个标签）自动开新页 —— 全部标签仍共享少量纹理采样器。
 * 颜色不烘焙进图集（白色绘制），由 Sprite 的 material.color 乘算。
 */
import * as THREE from 'three';

export interface AtlasGlyph {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  /** 逻辑像素宽高（图集像素 / dpr，用于 Sprite 宽高比） */
  w: number;
  h: number;
  /** 所属图集页纹理 */
  texture: THREE.CanvasTexture;
}

export interface LabelStyle {
  fontSize?: number;
  fontWeight?: number;
  glowColor?: string;
}

const DEFAULT_STYLE: Required<LabelStyle> = {
  fontSize: 15,
  fontWeight: 500,
  glowColor: 'rgba(56,189,248,0.9)',
};

class AtlasPage {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly texture: THREE.CanvasTexture;
  cursorX = 0;
  cursorY = 0;
  rowH = 0;
  /** 首次 flush 后新增字形需要立即重传（启动期批量创建走 flush 一次上传） */
  flushed = false;

  constructor(size: number) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = size;
    this.canvas.height = size;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('无法创建 2D canvas 上下文');
    this.ctx = ctx;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.anisotropy = 4;
    // flipY 保持默认 true：下方 v 坐标按 canvas 行序自上而下换算
  }

  dispose(): void {
    this.texture.dispose();
  }
}

export class CanvasAtlas {
  readonly pages: AtlasPage[];
  private readonly cache = new Map<string, AtlasGlyph>();

  constructor(
    private readonly size = 1024,
    private readonly dpr = 2,
  ) {
    this.pages = [new AtlasPage(this.size)];
  }

  get texture(): THREE.CanvasTexture {
    return this.pages[0]!.texture;
  }

  /** 添加（或复用缓存）文本字形，返回图集 UV + 逻辑尺寸 + 所属页纹理 */
  add(text: string, style: LabelStyle = {}): AtlasGlyph {
    const s: Required<LabelStyle> = { ...DEFAULT_STYLE, ...style };
    const key = `${text}|${s.fontSize}|${s.fontWeight}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    const scale = this.dpr;
    const px = Math.ceil(s.fontSize * scale);
    const font = `${s.fontWeight} ${px}px "Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", sans-serif`;
    const pad = 3 * scale;

    // 量取字形尺寸（用当前页上下文设置字体即可量度）
    let page = this.pages[this.pages.length - 1]!;
    page.ctx.font = font;
    page.ctx.textBaseline = 'middle';
    const metrics = page.ctx.measureText(text);
    const gw = Math.ceil(Math.min(metrics.width + pad * 2, this.size));
    const gh = Math.ceil(px * 1.35 + pad * 2);

    if (page.cursorX + gw > this.size) {
      page.cursorX = 0;
      page.cursorY += page.rowH;
      page.rowH = 0;
    }
    if (page.cursorY + gh > this.size) {
      page = new AtlasPage(this.size);
      page.ctx.font = font;
      page.ctx.textBaseline = 'middle';
      this.pages.push(page);
    }

    const x = page.cursorX;
    const y = page.cursorY;
    page.ctx.shadowColor = s.glowColor;
    page.ctx.shadowBlur = 5 * scale;
    page.ctx.fillStyle = '#ffffff';
    page.ctx.fillText(text, x + pad, y + gh / 2);
    page.ctx.shadowBlur = 0;

    page.cursorX += gw + 1;
    page.rowH = Math.max(page.rowH, gh);

    const glyph: AtlasGlyph = {
      u0: x / this.size,
      v0: 1 - (y + gh) / this.size,
      u1: (x + gw) / this.size,
      v1: 1 - y / this.size,
      w: gw / scale,
      h: gh / scale,
      texture: page.texture,
    };
    this.cache.set(key, glyph);
    // 批量创建期不逐个重传整页（~450 个标签 × 1024² 上传代价高），
    // flush() 统一上传一次；flush 之后再新增的字形立即重传。
    if (page.flushed) page.texture.needsUpdate = true;
    return glyph;
  }

  /** 批量创建完标签后调用：把各页 canvas 一次性上传 GPU */
  flush(): void {
    for (const p of this.pages) {
      p.texture.needsUpdate = true;
      p.flushed = true;
    }
  }

  dispose(): void {
    for (const p of this.pages) p.dispose();
    this.pages.length = 0;
    this.cache.clear();
  }
}
