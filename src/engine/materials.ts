/**
 * 材质工厂：为内建材质注入分层淡化 uniform（uLayerDim）与实例隐藏属性（aActive）。
 * - 每层共享一个 uLayerDim uniform 对象，聚焦过渡时只需改一处；
 * - aActive 为实例级属性：0 = 顶点移出裁剪空间（展开子平面时隐藏原区域实体），
 *   槽位保持不变 —— 本系统的第一号数据一致性原则。
 */
import * as THREE from 'three';
import type { LayerId } from '../shared/types';

/** 每层共享的淡化 uniform（0=正常，1=最大淡化） */
export const layerDimUniforms: Record<LayerId, { value: number }> = {
  geo: { value: 0 },
  device: { value: 0 },
  app: { value: 0 },
  task: { value: 0 },
};

/** 非层归属材质（地图底板/区域板等）共用的淡化 uniform */
export const globalDimUniform = { value: 0 };

const VERT_INJECT = /* glsl */ `
uniform float uLayerDim;
attribute float aActive;
varying float vLayerDim;
`;

const VERT_ACTIVE = /* glsl */ `
vLayerDim = uLayerDim;
if (aActive < 0.5) {
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;

const FRAG_DECL = /* glsl */ `varying float vLayerDim;`;

/**
 * 注入基础层淡化到任意内建材质。
 * @param material 目标材质
 * @param dimUniform 共享 uniform 对象
 * @param options.dimColor 是否同时压暗颜色（适合发光体）
 */
export function injectLayerDim(
  material: THREE.MeshBasicMaterial | THREE.MeshStandardMaterial,
  dimUniform: { value: number },
  options: { dimColor?: boolean } = {},
): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uLayerDim = dimUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_INJECT}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${VERT_ACTIVE}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_DECL}`)
      .replace(
        '#include <opaque_fragment>',
        `${options.dimColor === false ? '' : 'diffuseColor.rgb *= mix(1.0, 0.30, vLayerDim);\n'}`
        + 'diffuseColor.a *= mix(1.0, 0.15, vLayerDim);\n' // 层间分离时大幅透明化非聚焦层
        + '#include <opaque_fragment>',
      );
  };
  material.customProgramCacheKey = () => 'mc-layerdim-2';
}

/** 材质通用参数 */
const COMMON: THREE.MeshBasicMaterialParameters = {
  transparent: true,
  depthWrite: true, // 四层互不重叠的平板，无 alpha 排序问题
};

export function layerEntityMaterial(layer: LayerId): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ ...COMMON });
  injectLayerDim(m, layerDimUniforms[layer]);
  return m;
}

export function globalMaterial(): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ ...COMMON });
  injectLayerDim(m, globalDimUniform);
  return m;
}
