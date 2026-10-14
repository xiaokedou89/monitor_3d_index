/**
 * 告警特效池：光晕四边形 / 扩散环 / 发光点 三类 InstancedMesh（各 256 槽）。
 * 全部脉冲/扩散动画在 shader 内完成（uTime 驱动），零逐帧分配，三类共 3 个 draw call。
 * 槽位语义：aLife=0 空闲 / 1 活跃 / -1 释放渐隐中（uFade 秒后由 CPU 回收）。
 */
import * as THREE from 'three';
import type { AlertLevel } from '../../shared/types';
import { ALERT_LEVEL_COLORS } from '../../shared/palette';

const POOL_SIZE = 256;
const FADE_SECONDS = 0.6;

/**
 * 光点特效半径基线（世界单位，spawn 时写入 aRadius；设置面板的"光晕范围"
 * 倍率经 uScale 在 shader 内乘算，无需重写实例属性即可实时调节）。
 * 默认大幅收敛：旧版光晕半径 2.4r+1.0（r≈0.8 时直径≈5.8 世界单位），
 * 大量告警时光斑互相叠加（加色混合）、再经 bloom 放大，形成笼罩全局的
 * 厚光晕；收紧后光晕直径 ≈2r 世界单位（面积约为旧版 1/7），光点本体
 * （POINT_RADIUS）与实体轮廓保持清晰可辨。
 */
export const glowRadiusFor = (radius: number): number => radius * 0.9 + 0.35;
export const ringRadiusFor = (radius: number): number => radius * 1.1 + 0.45;
export const POINT_RADIUS = 0.35;

/** 特效池（几何共享：aCenter/aColor/aBirth/aPhase/aLife/aRadius） */
class FxPool {
  readonly mesh: THREE.InstancedMesh;
  readonly material: THREE.ShaderMaterial;
  readonly center: THREE.InstancedBufferAttribute;
  readonly color: THREE.InstancedBufferAttribute;
  readonly birth: THREE.InstancedBufferAttribute;
  readonly phase: THREE.InstancedBufferAttribute;
  readonly life: THREE.InstancedBufferAttribute;
  readonly radius: THREE.InstancedBufferAttribute;
  /** 释放渐隐中的槽位 → 剩余秒数（CPU 回收用） */
  private releasing = new Map<number, number>();
  private cursor = 0;

  constructor(
    uniforms: {
      uTime: { value: number };
      uFade: { value: number };
      uScale: { value: number };
      uIntensity: { value: number };
    },
    fragmentShader: string,
  ) {
    const geometry = new THREE.PlaneGeometry(1, 1);
    this.center = new THREE.InstancedBufferAttribute(new Float32Array(POOL_SIZE * 3), 3);
    this.color = new THREE.InstancedBufferAttribute(new Float32Array(POOL_SIZE * 3), 3);
    this.birth = new THREE.InstancedBufferAttribute(new Float32Array(POOL_SIZE), 1);
    this.phase = new THREE.InstancedBufferAttribute(new Float32Array(POOL_SIZE), 1);
    this.life = new THREE.InstancedBufferAttribute(new Float32Array(POOL_SIZE), 1);
    this.radius = new THREE.InstancedBufferAttribute(new Float32Array(POOL_SIZE), 1);
    // 注意：必须显式传属性名——THREE.InstancedBufferAttribute.name 默认为空串，
    // 曾导致六个实例属性全部注册到 '' 键上互相覆盖（geometry.attributes 只剩
    // 最后一个），shader 取不到 aLife 等属性而拿到 WebGL 默认值 0，全部顶点
    // 被 aLife==0 分支移出裁剪空间——告警特效从未真正渲染过（回归单测见
    // test/unit/fx.test.ts「实例属性以 shader 属性名注册」）。
    const instancedAttrs: Array<[string, THREE.InstancedBufferAttribute]> = [
      ['aCenter', this.center],
      ['aColor', this.color],
      ['aBirth', this.birth],
      ['aPhase', this.phase],
      ['aLife', this.life],
      ['aRadius', this.radius],
    ];
    for (const [name, attr] of instancedAttrs) {
      attr.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute(name, attr);
    }

    this.material = new THREE.ShaderMaterial({
      uniforms: { ...uniforms },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        attribute vec3 aCenter;
        attribute vec3 aColor;
        attribute float aBirth;
        attribute float aPhase;
        attribute float aLife;
        attribute float aRadius;
        uniform float uTime;
        uniform float uFade;
        uniform float uScale;
        varying vec2 vUv;
        varying vec3 vColor;
        varying float vAge;
        varying float vPhase;
        varying float vK;
        void main() {
          vUv = uv;
          vColor = aColor;
          vAge = uTime - aBirth;
          vPhase = aPhase;
          vK = aLife > 0.0 ? 1.0 : (aLife < 0.0 ? clamp(1.0 - (uTime - aBirth) / uFade, 0.0, 1.0) : 0.0);
          if (aLife == 0.0 || vK <= 0.0) {
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
            return;
          }
          vec4 mv = modelViewMatrix * vec4(aCenter, 1.0);
          mv.xyz += vec3(position.xy * aRadius * uScale, 0.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader,
    });

    const matrix = new THREE.Matrix4();
    this.mesh = new THREE.InstancedMesh(geometry, this.material, POOL_SIZE);
    this.mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    for (let i = 0; i < POOL_SIZE; i++) this.mesh.setMatrixAt(i, matrix);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
  }

  /** 分配一个空闲槽（写满后覆盖最旧——正常情况下远不会满） */
  alloc(): number {
    const lifeArr = this.life.array as Float32Array;
    for (let probe = 0; probe < POOL_SIZE; probe++) {
      const slot = (this.cursor + probe) % POOL_SIZE;
      if (lifeArr[slot] === 0) {
        this.cursor = (slot + 1) % POOL_SIZE;
        return slot;
      }
    }
    this.cursor = (this.cursor + 1) % POOL_SIZE;
    return this.cursor;
  }

  write(slot: number, pos: THREE.Vector3, color: THREE.Color, radius: number, now: number): void {
    const c = this.center.array as Float32Array;
    const col = this.color.array as Float32Array;
    const l = this.life.array as Float32Array;
    const b = this.birth.array as Float32Array;
    const p = this.phase.array as Float32Array;
    const r = this.radius.array as Float32Array;
    c[slot * 3] = pos.x;
    c[slot * 3 + 1] = pos.y;
    c[slot * 3 + 2] = pos.z;
    col[slot * 3] = color.r;
    col[slot * 3 + 1] = color.g;
    col[slot * 3 + 2] = color.b;
    b[slot] = now;
    p[slot] = (slot * 2.39996) % (Math.PI * 2);
    r[slot] = radius;
    l[slot] = 1;
    this.center.needsUpdate = true;
    this.color.needsUpdate = true;
    this.birth.needsUpdate = true;
    this.phase.needsUpdate = true;
    this.life.needsUpdate = true;
    this.radius.needsUpdate = true;
  }

  updateCenter(slot: number, pos: THREE.Vector3): void {
    const c = this.center.array as Float32Array;
    c[slot * 3] = pos.x;
    c[slot * 3 + 1] = pos.y;
    c[slot * 3 + 2] = pos.z;
    this.center.needsUpdate = true;
  }

  /** 标记渐隐释放；tick() 在渐隐结束后回收 */
  release(slot: number, now: number): void {
    (this.birth.array as Float32Array)[slot] = now;
    (this.life.array as Float32Array)[slot] = -1;
    this.birth.needsUpdate = true;
    this.life.needsUpdate = true;
    this.releasing.set(slot, FADE_SECONDS);
  }

  tick(dt: number): void {
    for (const [slot, remain] of this.releasing) {
      const next = remain - dt;
      if (next <= 0) {
        (this.life.array as Float32Array)[slot] = 0;
        this.life.needsUpdate = true;
        this.releasing.delete(slot);
      } else {
        this.releasing.set(slot, next);
      }
    }
  }
}

export interface AlertFx {
  group: THREE.Group;
  /** 渲染参数（显示设置面板实时调节）：光晕范围倍率 uScale / 光晕强度倍率 uIntensity */
  uniforms: {
    uScale: THREE.IUniform<number>;
    uIntensity: THREE.IUniform<number>;
  };
  /** 光晕范围倍率（设置面板取值 0.2–2.0，1.0 = 默认基线） */
  setGlowScale(v: number): void;
  /** 光晕强度倍率（设置面板取值 0–2.0，1.0 = 默认基线） */
  setGlowIntensity(v: number): void;
  spawn(entityId: string, position: THREE.Vector3, level: AlertLevel, radius: number): void;
  release(entityId: string): void;
  /** 释放全部占用槽位（剧本切换重置用） */
  clear(): void;
  updatePosition(entityId: string, position: THREE.Vector3): void;
  tick(dt: number, now: number): void;
  dispose(): void;
}

const GLOW_FRAG = /* glsl */ `
  varying vec2 vUv; varying vec3 vColor; varying float vAge; varying float vPhase; varying float vK;
  uniform float uIntensity;
  void main() {
    float d = length(vUv * 2.0 - 1.0);
    float core = exp(-d * d * 5.0);
    // 基线亮度收敛（均值 0.7、峰值 1.0，低于旧版 0.9/1.25）：
    // 峰值恰达 1.0，避免大面积 >1 的输出经 bloom 扩散成厚光晕
    float pulse = 0.65 + 0.35 * sin(vAge * 4.0 + vPhase);
    gl_FragColor = vec4(vColor * (0.7 + 0.3 * pulse) * uIntensity, core * pulse * vK);
  }
`;

const RING_FRAG = /* glsl */ `
  varying vec2 vUv; varying vec3 vColor; varying float vAge; varying float vPhase; varying float vK;
  uniform float uIntensity;
  void main() {
    float period = 2.2;
    float t = fract(vAge / period);
    float r = t;
    float dd = abs(length(vUv * 2.0 - 1.0) - r);
    float ring = smoothstep(0.12, 0.0, dd);
    float fade = 1.0 - t;
    gl_FragColor = vec4(vColor * 1.3 * uIntensity, ring * fade * vK * (0.6 + 0.4 * sin(vAge * 3.0 + vPhase)));
  }
`;

const POINT_FRAG = /* glsl */ `
  varying vec2 vUv; varying vec3 vColor; varying float vAge; varying float vPhase; varying float vK;
  uniform float uIntensity;
  void main() {
    float d = length(vUv * 2.0 - 1.0);
    float core = smoothstep(0.4, 0.0, d);
    float pulse = 0.6 + 0.4 * sin(vAge * 6.0 + vPhase);
    gl_FragColor = vec4(vColor * (1.0 + pulse) * uIntensity, core * pulse * vK);
  }
`;

export function createAlertFx(): AlertFx {
  const group = new THREE.Group();
  group.name = 'alert-fx';
  const sharedUniforms = {
    uTime: { value: 0 },
    uFade: { value: FADE_SECONDS },
    /** 光晕范围倍率（显示设置面板调节，shader 内乘算 aRadius） */
    uScale: { value: 1 },
    /** 光晕强度倍率（显示设置面板调节，shader 内乘算颜色） */
    uIntensity: { value: 1 },
  };
  const glow = new FxPool(sharedUniforms, GLOW_FRAG);
  const ring = new FxPool(sharedUniforms, RING_FRAG);
  const point = new FxPool(sharedUniforms, POINT_FRAG);
  glow.mesh.name = 'alert-glow';
  ring.mesh.name = 'alert-ring';
  point.mesh.name = 'alert-point';
  group.add(glow.mesh, ring.mesh, point.mesh);

  /** 实体 → 已分配槽位（同实体多告警共用一组特效） */
  const occupied = new Map<string, { glow: number; ring: number; point: number }>();

  return {
    group,

    uniforms: {
      uScale: sharedUniforms.uScale,
      uIntensity: sharedUniforms.uIntensity,
    },

    setGlowScale(v) {
      sharedUniforms.uScale.value = v;
    },

    setGlowIntensity(v) {
      sharedUniforms.uIntensity.value = v;
    },

    spawn(entityId, position, level, radius) {
      const existing = occupied.get(entityId);
      if (existing) {
        // 已有特效：仅刷新位置与颜色（层级取最高优先）
        const color = new THREE.Color(ALERT_LEVEL_COLORS[level]);
        glow.write(existing.glow, position, color, glowRadiusFor(radius), sharedUniforms.uTime.value);
        ring.write(existing.ring, position, color, ringRadiusFor(radius), sharedUniforms.uTime.value);
        point.write(existing.point, position, color, POINT_RADIUS, sharedUniforms.uTime.value);
        return;
      }
      const color = new THREE.Color(ALERT_LEVEL_COLORS[level]);
      const now = sharedUniforms.uTime.value;
      const slots = {
        glow: glow.alloc(),
        ring: ring.alloc(),
        point: point.alloc(),
      };
      glow.write(slots.glow, position, color, glowRadiusFor(radius), now);
      ring.write(slots.ring, position, color, ringRadiusFor(radius), now);
      point.write(slots.point, position, color, POINT_RADIUS, now);
      occupied.set(entityId, slots);
    },

    release(entityId) {
      const slots = occupied.get(entityId);
      if (!slots) return;
      const now = sharedUniforms.uTime.value;
      glow.release(slots.glow, now);
      ring.release(slots.ring, now);
      point.release(slots.point, now);
      occupied.delete(entityId);
    },

    clear() {
      const now = sharedUniforms.uTime.value;
      for (const slots of occupied.values()) {
        glow.release(slots.glow, now);
        ring.release(slots.ring, now);
        point.release(slots.point, now);
      }
      occupied.clear();
    },

    updatePosition(entityId, position) {
      const slots = occupied.get(entityId);
      if (!slots) return;
      glow.updateCenter(slots.glow, position);
      ring.updateCenter(slots.ring, position);
      point.updateCenter(slots.point, position);
    },

    tick(dt, now) {
      sharedUniforms.uTime.value = now;
      glow.tick(dt);
      ring.tick(dt);
      point.tick(dt);
    },

    dispose() {
      for (const pool of [glow, ring, point]) {
        pool.mesh.geometry.dispose();
        pool.material.dispose();
      }
    },
  };
}
