/**
 * WebGL 渲染器 + 后处理管线（半分辨率 Bloom + 输出 pass）。
 * 关键质损点：composer RT 开启 4x MSAA（默认无抗锯齿，全场景会严重锯齿）。
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { PALETTE } from '../shared/palette';
import { CAMERA_PRESETS } from './camera/presets';

/**
 * 软件渲染器（SwiftShader/llvmpipe 等）上 UnrealBloomPass 的半浮点 RT 采样
 * 会产生垃圾值导致全屏白（实测 ANGLE/SwiftShader）。检测到软渲染时跳过 bloom，
 * 保证测试环境与低配演示机画面正确；真实 GPU 保留完整效果。
 */
function isSoftwareRenderer(renderer: THREE.WebGLRenderer): boolean {
  const gl = renderer.getContext();
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
  return /swiftshader|llvmpipe|software|microsoft basic/i.test(name);
}

export interface RendererBundle {
  renderer: THREE.WebGLRenderer;
  composer: EffectComposer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  bloom: UnrealBloomPass;
  /** bloom 是否受当前渲染器支持（软渲染环境强制禁用，设置面板据此提示） */
  bloomSupported: boolean;
  setSize: (w: number, h: number) => void;
  dispose: () => void;
}

export function createRenderer(container: HTMLElement): RendererBundle {
  const renderer = new THREE.WebGLRenderer({
    antialias: false, // 由 composer RT MSAA 提供
    powerPreference: 'high-performance',
    stencil: false,
    // 保留绘制缓冲：E2E 截图/软渲染环境下合成器读回必需（轻微性能代价，可接受）
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);
  renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.bg);
  scene.fog = new THREE.FogExp2(PALETTE.bg, 0.0016);

  // fov 62（原 50）：总览机位视野加宽，让 A 布局"欧洲最左/美洲最右"的世界轮廓背景
  // 在画面内可见——1:1 地理比例下欧洲伊比利亚 x≈−103（z≈−5 处视锥半宽 ≈123 入画）、
  // 美洲西岸 x≈109~128（加州/下加州入画），50° 时均完全出画。
  const camera = new THREE.PerspectiveCamera(62, 1, 0.5, 400);
  camera.position.copy(CAMERA_PRESETS.overview.position);
  // 主渲染可见通道：0（常规）+ 2（聚焦时被"排除拾取"的淡化层，仍须渲染）。
  // 通道 1 专属连线 id-buffer 拾取（edge-id-mesh），主渲染不得可见。
  camera.layers.enable(2);

  const composer = new EffectComposer(renderer);
  // MSAA：EffectComposer 默认输出 RT 无采样，必须显式开启
  composer.renderTarget1.samples = 4;

  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  const bloom = new UnrealBloomPass(new THREE.Vector2(1024, 1024), 0.05, 0.55, 0.82);
  // 软渲染下 bloom 强制禁用（设置面板仍可保存意图，硬件环境生效）
  const bloomSupported = !isSoftwareRenderer(renderer);
  bloom.enabled = bloomSupported;
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const setSize = (w: number, h: number): void => {
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    composer.setSize(w, h);
    composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  };
  setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight);

  return {
    renderer,
    composer,
    scene,
    camera,
    bloom,
    bloomSupported,
    setSize,
    dispose: () => {
      composer.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
