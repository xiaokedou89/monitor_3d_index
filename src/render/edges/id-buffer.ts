/**
 * 连线 id-buffer 拾取：
 * - id 网格：与 ribbon 共享 position/aVisible/index，顶点着色器做同样的
 *   最小像素宽补偿（保证拾取几何与视觉几何一致），aColorId 编码边索引；
 * - 拾取时相机 layers 仅启用通道 1，渲染一帧到离屏 RT，读回像素解码 relationId。
 * 实体的拾取走 raycast（picking.ts），互不干扰。
 */
import * as THREE from 'three';
import { createEdgeIdMaterial } from './ribbon-material';
import type { RibbonGeometryData } from './ribbon';

export interface EdgeIdMesh {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  dispose(): void;
}

export function buildEdgeIdMesh(data: RibbonGeometryData): EdgeIdMesh {
  const geometry = new THREE.BufferGeometry();
  // 与 ribbon 共享底层数组：位置/显隐/索引更新自动同步；
  // 切线/侧向/宽度供顶点着色器做同样的最小像素宽补偿
  geometry.setAttribute('position', data.geometry.getAttribute('position'));
  geometry.setAttribute('aVisible', data.geometry.getAttribute('aVisible'));
  geometry.setAttribute('aTangent', data.geometry.getAttribute('aTangent'));
  geometry.setAttribute('aSide', data.geometry.getAttribute('aSide'));
  geometry.setAttribute('aWidthW', data.geometry.getAttribute('aWidthW'));

  const totalVerts = data.position.count;
  const colorId = new Float32Array(totalVerts * 3);
  data.order.forEach((relId, edgeIndex) => {
    const r = data.ranges.get(relId)!;
    const cr = (edgeIndex & 255) / 255;
    const cg = ((edgeIndex >> 8) & 255) / 255;
    for (let v = 0; v < r.vCount; v++) {
      const vi = (r.vStart + v) * 3;
      colorId[vi] = cr;
      colorId[vi + 1] = cg;
      colorId[vi + 2] = 0;
    }
  });
  geometry.setAttribute('aColorId', new THREE.Float32BufferAttribute(colorId, 3));
  geometry.setIndex(data.geometry.getIndex()!);

  const material = createEdgeIdMaterial();
  material.side = THREE.DoubleSide;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'edge-id-mesh';
  mesh.frustumCulled = false;
  mesh.layers.set(1); // 仅 id 拾取通道

  return {
    mesh,
    material,
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}

export interface EdgePicker {
  /** 拾取画布 CSS 像素坐标处的连线，返回 relationId 或 null */
  pick(camera: THREE.Camera, clientX: number, clientY: number): string | null;
  resize(width: number, height: number): void;
  dispose(): void;
}

export function createEdgePicker(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  order: string[],
  idMaterial: THREE.ShaderMaterial,
): EdgePicker {
  let rt: THREE.WebGLRenderTarget | null = null;
  let w = 0;
  let h = 0;
  const pixel = new Uint8Array(4);

  const ensure = (width: number, height: number): void => {
    if (rt && w === width && h === height) return;
    rt?.dispose();
    w = width;
    h = height;
    rt = new THREE.WebGLRenderTarget(width, height, { depthBuffer: true });
    // 拾取材质与主 ribbon 一致的最小像素宽补偿需要视口尺寸（设备像素）
    idMaterial.uniforms.uViewport!.value.set(width, height);
  };

  return {
    pick(camera, clientX, clientY) {
      const dpr = renderer.getPixelRatio();
      const pw = Math.ceil(w * dpr);
      const ph = Math.ceil(h * dpr);
      ensure(pw, ph);
      if (!rt) return null;

      const prevMask = camera.layers.mask;
      camera.layers.disableAll();
      camera.layers.enable(1);
      const prevTarget = renderer.getRenderTarget();
      renderer.setRenderTarget(rt);
      renderer.render(scene, camera);
      renderer.setRenderTarget(prevTarget);
      camera.layers.mask = prevMask;

      const px = Math.min(pw - 1, Math.max(0, Math.floor(clientX * dpr)));
      const py = Math.min(ph - 1, Math.max(0, Math.floor(ph - clientY * dpr)));
      renderer.readRenderTargetPixels(rt, px, py, 1, 1, pixel);
      const edgeIndex = pixel[0]! + pixel[1]! * 256;
      return edgeIndex < order.length ? order[edgeIndex]! : null;
    },

    resize(width, height) {
      w = width;
      h = height;
    },

    dispose() {
      rt?.dispose();
      rt = null;
    },
  };
}
