/**
 * 性能监控面板：FPS / 帧时间 / draw calls / 三角形数。
 * 仅在 URL 带 ?debug=1 或按 F3 时显示。
 */
import type * as THREE from 'three';

export interface PerfStats {
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
}

export class PerfMonitor {
  private el: HTMLElement;
  private panel: HTMLElement;
  private frames = 0;
  private lastTime = performance.now();
  private fps = 0;
  private frameMs = 0;
  private rendererInfo: THREE.WebGLInfo | null = null;

  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'perf-monitor';
    this.el.style.cssText = [
      'position:fixed;left:12px;bottom:12px;z-index:1000;',
      'font:11px/1.6 ui-monospace,Consolas,monospace;',
      'color:#6ee7ff;background:rgba(4,16,32,.78);',
      'border:1px solid rgba(110,231,255,.25);border-radius:6px;',
      'padding:6px 10px;pointer-events:none;display:none;white-space:pre;',
      'backdrop-filter:blur(4px);',
    ].join('');
    this.panel = this.el;
    document.body.appendChild(this.el);
    this.bindToggle();
  }

  private bindToggle(): void {
    const toggle = (e: KeyboardEvent) => {
      if (e.key === 'F3') {
        e.preventDefault();
        this.el.style.display = this.el.style.display === 'none' ? 'block' : 'none';
      }
    };
    window.addEventListener('keydown', toggle);
  }

  /** 绑定 renderer.info，每帧采样 draw calls / triangles。 */
  bindRendererInfo(info: THREE.WebGLInfo): void {
    this.rendererInfo = info;
  }

  /** 主循环每帧调用。 */
  tick(now: number): void {
    this.frames++;
    const dt = now - this.lastTime;
    if (dt >= 500) {
      this.fps = (this.frames * 1000) / dt;
      this.frameMs = dt / this.frames;
      this.frames = 0;
      this.lastTime = now;
      this.render();
    }
  }

  private render(): void {
    const info = this.rendererInfo;
    this.panel.textContent =
      `FPS ${this.fps.toFixed(0)}  帧 ${this.frameMs.toFixed(2)}ms` +
      (info ? `\ndraw ${info.render.calls}  tris ${(info.render.triangles / 1000).toFixed(0)}k` : '');
  }

  show(): void {
    this.el.style.display = 'block';
  }
}
