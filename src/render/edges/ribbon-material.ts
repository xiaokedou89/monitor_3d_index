/**
 * 连线 ribbon 着色器：
 * - 顶点：屏幕空间最小像素宽补偿 + 关键控制连线宽度脉冲；
 * - 片元：三色语义 palette（控制蓝/数据黄/告警红）、
 *   关键控制与告警数据流为动态虚线流动、分层淡化。
 * 全部连线合并为单 BufferGeometry 单 draw call。
 */
import * as THREE from 'three';
import { hexToRgb, PALETTE } from '../../shared/palette';

export interface RibbonUniforms {
  uTime: THREE.IUniform<number>;
  uSpeed: THREE.IUniform<number>;
  uMinPx: THREE.IUniform<number>;
  /** 流动动画开关（0 冻结 / 1 流动，显示设置面板） */
  uFlowOn: THREE.IUniform<number>;
  /** 关键控制连线宽度脉冲开关（0/1，显示设置面板） */
  uPulseOn: THREE.IUniform<number>;
  uViewport: THREE.IUniform<THREE.Vector2>;
  uPalette: THREE.IUniform<THREE.Color[]>;
}

/**
 * 连线最小像素宽（直径下限），ribbon 与 id-buffer 两材质共用。
 * 取 1.2px：保证细边在任意距离可见/可拾取，同时避免地板过宽——
 * 远距离（总览）时 844 条边全部被地板撑到同一宽度，会在视觉上
 * 形成"光晕笼罩全局"的线团，掩盖流量对比与实体分布。
 */
export const EDGE_MIN_PX = 1.2;

export function createRibbonMaterial(): THREE.ShaderMaterial {
  const uniforms: RibbonUniforms = {
    uTime: { value: 0 },
    uSpeed: { value: 0.35 },
    uMinPx: { value: EDGE_MIN_PX },
    uFlowOn: { value: 1 },
    uPulseOn: { value: 1 },
    uViewport: { value: new THREE.Vector2(1, 1) },
    uPalette: {
      value: [
        new THREE.Color(...hexToRgb(PALETTE.edgeControl)),
        new THREE.Color(...hexToRgb(PALETTE.edgeData)),
        new THREE.Color(...hexToRgb(PALETTE.edgeAlert)),
      ],
    },
  };

  const material = new THREE.ShaderMaterial({
    uniforms: uniforms as unknown as { [uniform: string]: THREE.IUniform },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    vertexShader: /* glsl */ `
      attribute float aSide;
      attribute float aFlow;
      attribute vec3 aTangent;
      attribute float aType;
      attribute float aWidthW;
      attribute float aImportance;
      attribute float aPhase;
      attribute float aDim;
      attribute float aVisible;

      uniform float uTime;
      uniform float uMinPx;
      uniform float uPulseOn;
      uniform vec2 uViewport;

      varying float vFlow;
      varying float vType;
      varying float vImportance;
      varying float vDim;

      void main() {
        if (aVisible < 0.5) {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          vFlow = 0.0; vType = 0.0; vImportance = 0.0; vDim = 1.0;
          return;
        }
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        float dist = max(-mvPos.z, 0.001);
        vec3 vTan = normalize(mat3(modelViewMatrix) * aTangent);
        vec3 viewDir = normalize(-mvPos.xyz);
        vec3 sideDir = normalize(cross(vTan, viewDir));

        float pxPerUnit = uViewport.y * 0.5 * projectionMatrix[1][1] / dist;
        float halfWpx = max(aWidthW * pxPerUnit, uMinPx * 0.5);
        float halfW = halfWpx / pxPerUnit;
        // 关键控制连线：宽度脉冲（动态效果，uPulseOn 开关）
        halfW *= 1.0 + 0.22 * aImportance * uPulseOn * (0.5 + 0.5 * sin(uTime * 3.0 + aPhase));

        mvPos.xyz += sideDir * (aSide * halfW);
        gl_Position = projectionMatrix * mvPos;
        vFlow = aFlow;
        vType = aType;
        vImportance = aImportance;
        vDim = aDim;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uSpeed;
      uniform float uFlowOn;
      uniform vec3 uPalette[3];

      varying float vFlow;
      varying float vType;
      varying float vImportance;
      varying float vDim;

      void main() {
        // 虚线语义：关键控制 / 告警数据流 → 动态流动虚线
        float dash = 1.0;
        if (vType > 1.5) dash = 0.5;
        else if (vType < 0.5 && vImportance > 0.5) dash = 0.55;
        float f = fract(vFlow - uTime * uSpeed * uFlowOn);
        if (f > dash) discard;

        vec3 col;
        if (vType < 0.5) col = uPalette[0];
        else if (vType < 1.5) col = uPalette[1];
        else col = uPalette[2];

        // 关键控制提亮
        col = mix(col, vec3(1.0), 0.18 * vImportance);
        // 分层淡化
        col *= mix(1.0, 0.20, vDim);
        float alpha = mix(0.95, 0.28, vDim);
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });

  return material;
}

/**
 * id-buffer 拾取用材质：按边索引编码平色。
 * 顶点阶段与主 ribbon 相同的屏幕空间最小像素宽补偿（不含关键脉冲），
 * 保证拾取几何与视觉几何一致——否则细边在屏幕上可见却拾不中。
 */
export function createEdgeIdMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMinPx: { value: EDGE_MIN_PX },
      uViewport: { value: new THREE.Vector2(1, 1) },
    },
    vertexShader: /* glsl */ `
      attribute float aSide;
      attribute vec3 aTangent;
      attribute float aWidthW;
      attribute float aVisible;
      attribute vec3 aColorId;

      uniform float uMinPx;
      uniform vec2 uViewport;

      varying vec3 vColorId;
      void main() {
        if (aVisible < 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vColorId = vec3(0.0); return; }
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        float dist = max(-mvPos.z, 0.001);
        vec3 vTan = normalize(mat3(modelViewMatrix) * aTangent);
        vec3 viewDir = normalize(-mvPos.xyz);
        vec3 sideDir = normalize(cross(vTan, viewDir));
        float pxPerUnit = uViewport.y * 0.5 * projectionMatrix[1][1] / dist;
        float halfWpx = max(aWidthW * pxPerUnit, uMinPx * 0.5);
        mvPos.xyz += sideDir * (aSide * (halfWpx / pxPerUnit));
        gl_Position = projectionMatrix * mvPos;
        vColorId = aColorId;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColorId;
      void main() { gl_FragColor = vec4(vColorId, 1.0); }
    `,
    depthWrite: true,
    depthTest: true,
  });
}
