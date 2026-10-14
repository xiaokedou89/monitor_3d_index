/**
 * 键盘观测视点控制（P3）：仅在聚焦某层（focus !== 'all'）的观察状态下生效。
 * - J 缩小视线与平面的夹角（压向平面）/ K 增大夹角（抬向俯视）
 * - H 向左扭头 / L 向右扭头（绕目标点水平旋转）
 * - W 前移 / S 后移 / A 左移 / D 右移（相机相对水平方向）/ Q 上移 / E 下移
 * 按住按键连续运动（速度 = 步进值 × 10/秒），步进值在显示设置"视角控制"配置。
 * 约束：飞行过渡中、OrbitControls 锁定、输入框聚焦时不响应；
 * 极角钳制到 OrbitControls 极角范围（不钻入平面以下、不越过天顶）。
 *
 * 球坐标换算拆成纯函数（sphericalOf/fromSpherical/clampSpherical）导出，
 * 供单元测试直接验证角度语义与钳制行为。
 */
import * as THREE from 'three';
import type { CameraControls } from '../engine/camera/controls';
import type { AppStore } from '../ui/store/app-store';
import type { DisplaySettingsStore } from '../ui/store/display-settings';

export interface KeyboardCameraDeps {
  appStore: AppStore;
  camera: THREE.PerspectiveCamera;
  controls: CameraControls;
  settingsStore: DisplaySettingsStore;
  /** 相机飞行过渡中（飞行锁定 OrbitControls，键盘输入会被飞行覆盖） */
  isFlying(): boolean;
}

export interface KeyboardCamera {
  /** 每帧推进（在渲染循环中调用，dt 秒） */
  tick(dt: number): void;
  dispose(): void;
}

/** 球坐标：radius=到目标点距离，theta=与 +Y 的极角（0=天顶，π/2=水平），phi=方位角 atan2(x,z) */
export interface Spherical {
  radius: number;
  theta: number;
  phi: number;
}

/** OrbitControls 默认极角约束（与 engine/camera/controls.ts 一致） */
export const POLAR_LIMITS = { minTheta: Math.PI * 0.03, maxTheta: Math.PI * 0.49 } as const;
export const RADIUS_LIMITS = { minR: 8, maxR: 175 } as const;

const clamp01 = (v: number): number => Math.min(1, Math.max(-1, v));

/** 直角坐标偏移（camera.position − target）→ 球坐标 */
export function sphericalOf(offset: { x: number; y: number; z: number }): Spherical {
  const radius = Math.hypot(offset.x, offset.y, offset.z);
  return {
    radius,
    theta: Math.acos(clamp01(offset.y / Math.max(radius, 1e-6))),
    phi: Math.atan2(offset.x, offset.z),
  };
}

/** 球坐标 → 直角坐标偏移 */
export function fromSpherical(s: Spherical): { x: number; y: number; z: number } {
  const sinT = Math.sin(s.theta);
  return {
    x: s.radius * sinT * Math.sin(s.phi),
    y: s.radius * Math.cos(s.theta),
    z: s.radius * sinT * Math.cos(s.phi),
  };
}

/** 钳制：极角（不钻平面下/不过天顶）+ 半径（不飞出场景） */
export function clampSpherical(
  s: Spherical,
  limits: { minTheta: number; maxTheta: number; minR: number; maxR: number } = {
    ...POLAR_LIMITS,
    ...RADIUS_LIMITS,
  },
): Spherical {
  return {
    radius: Math.min(limits.maxR, Math.max(limits.minR, s.radius)),
    theta: Math.min(limits.maxTheta, Math.max(limits.minTheta, s.theta)),
    phi: s.phi,
  };
}

const UP = new THREE.Vector3(0, 1, 0);
const EDIT_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
const KEYS = new Set(['j', 'k', 'h', 'l', 'w', 'a', 's', 'd', 'q', 'e']);
/** 按住时速度 = 步进值 × 10/秒（单击约为一次步进） */
const HOLD_RATE = 10;

export function createKeyboardCamera(deps: KeyboardCameraDeps): KeyboardCamera {
  const { appStore, camera, controls, settingsStore, isFlying } = deps;
  const oc = controls.controls;
  const pressed = new Set<string>();

  const inEditor = (e: KeyboardEvent): boolean => {
    const t = e.target as HTMLElement | null;
    return !!t && (EDIT_TAGS.has(t.tagName) || t.isContentEditable);
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (inEditor(e) || e.key === 'F3') return; // F3 为性能面板开关（perf/stats）
    const key = e.key.toLowerCase();
    if (!KEYS.has(key)) return;
    e.preventDefault();
    pressed.add(key);
  };

  const onKeyUp = (e: KeyboardEvent): void => {
    pressed.delete(e.key.toLowerCase());
  };
  const onBlur = (): void => {
    pressed.clear();
  };

  // 临时向量复用（零分配）
  const offset = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const moveVec = new THREE.Vector3();
  const nextPos = new THREE.Vector3();

  const tick = (dt: number): void => {
    if (dt <= 0 || pressed.size === 0) return;
    if (appStore.get().focus === 'all' || isFlying() || !oc.enabled) return;

    const s = settingsStore.get();
    const angleStep = THREE.MathUtils.degToRad(s.cameraAngleStepDeg) * HOLD_RATE * dt;
    const move = s.cameraMoveStep * HOLD_RATE * dt;

    offset.copy(camera.position).sub(oc.target);
    const sp = sphericalOf(offset);
    let rotated = false;

    // 俯仰：J 夹角缩小（压向平面，theta 增大）/ K 夹角增大（抬向俯视）
    if (pressed.has('j') || pressed.has('k')) {
      sp.theta += (pressed.has('j') ? 1 : -1) * angleStep;
      rotated = true;
    }
    // 扭头：H 向左（绕目标点沿相机左侧绕行）/ L 向右
    if (pressed.has('h') || pressed.has('l')) {
      sp.phi += (pressed.has('h') ? -1 : 1) * angleStep;
      rotated = true;
    }
    if (rotated) {
      const clamped = clampSpherical(sp, {
        minTheta: oc.minPolarAngle,
        maxTheta: oc.maxPolarAngle,
        minR: RADIUS_LIMITS.minR,
        maxR: RADIUS_LIMITS.maxR,
      });
      const p = fromSpherical(clamped);
      nextPos.set(p.x, p.y, p.z);
      camera.position.copy(oc.target).add(nextPos);
    }

    // 平移：相机相对水平方向（前=视线水平投影，右=前×上），Q/E 升降
    moveVec.set(0, 0, 0);
    if (pressed.has('w') || pressed.has('s') || pressed.has('a') || pressed.has('d')) {
      forward.copy(camera.getWorldDirection(forward)).projectOnPlane(UP).normalize();
      if (forward.lengthSq() > 1e-6) {
        right.crossVectors(forward, UP).normalize();
        if (pressed.has('w')) moveVec.addScaledVector(forward, move);
        if (pressed.has('s')) moveVec.addScaledVector(forward, -move);
        if (pressed.has('a')) moveVec.addScaledVector(right, -move);
        if (pressed.has('d')) moveVec.addScaledVector(right, move);
      }
    }
    if (pressed.has('q')) moveVec.y += move;
    if (pressed.has('e')) moveVec.y -= move;
    if (moveVec.lengthSq() > 0) {
      camera.position.add(moveVec);
      oc.target.add(moveVec);
    }

    controls.update(0); // 同步 OrbitControls 内部球坐标（delta=0 无阻尼漂移）
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  return {
    tick,
    dispose: () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    },
  };
}
