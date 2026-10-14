/**
 * 相机飞行：位置 + 目标点双三次缓动插值。
 * 飞行期间锁定 OrbitControls；前 40% 相机启航、后 60% 用于配合场景淡化（由 view-sync 编排）。
 */
import * as THREE from 'three';
import type { CameraControls } from './controls';

export interface FlightState {
  /** 已飞行进度 0..1（进行中为 [0,1)，结束为 1） */
  progress: number;
  get isActive(): boolean;
}

const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

export class CameraFlight {
  private active = false;
  private t = 0;
  private duration = 1;
  private startPos = new THREE.Vector3();
  private endPos = new THREE.Vector3();
  private startTarget = new THREE.Vector3();
  private endTarget = new THREE.Vector3();
  private onDone: (() => void) | null = null;
  private lockedBefore = true;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly controls: CameraControls,
  ) {}

  get isActive(): boolean {
    return this.active;
  }

  get progress(): number {
    return this.active ? Math.min(this.t / this.duration, 1) : 1;
  }

  /** 取消当前飞行（立即吸附到终点） */
  cancel(): void {
    if (!this.active) return;
    this.active = false;
    this.camera.position.copy(this.endPos);
    this.controls.setTarget(this.endTarget);
    this.controls.setLocked(this.lockedBefore);
    this.onDone?.();
    this.onDone = null;
  }

  flyTo(
    endPos: THREE.Vector3,
    endTarget: THREE.Vector3,
    duration = 1.4,
    onDone?: () => void,
  ): void {
    this.startPos.copy(this.camera.position);
    this.startTarget.copy(this.controls.controls.target);
    this.endPos.copy(endPos);
    this.endTarget.copy(endTarget);
    this.duration = Math.max(duration, 0.01);
    this.t = 0;
    // 仅首次进入时锁定：lockedBefore 记录“锁定前是否已锁”（locked 语义，与 setLocked 一致）。
    // 中断已有飞行时不重复捕获/加锁——否则会保存到飞行中的 enabled=false，结束后错误还原为永久锁定。
    if (!this.active) {
      this.lockedBefore = !this.controls.controls.enabled;
      this.controls.setLocked(true);
    }
    this.active = true;
    this.onDone = onDone ?? null;
  }

  update(dt: number): void {
    if (!this.active) return;
    this.t += dt;
    const k = easeInOutCubic(Math.min(this.t / this.duration, 1));
    this.camera.position.lerpVectors(this.startPos, this.endPos, k);
    this.controls.controls.target.lerpVectors(this.startTarget, this.endTarget, k);
    this.controls.update(0);
    if (this.t >= this.duration) {
      this.active = false;
      this.controls.setLocked(this.lockedBefore);
      const cb = this.onDone;
      this.onDone = null;
      cb?.();
    }
  }
}
