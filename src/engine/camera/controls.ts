/**
 * OrbitControls 包装：阻尼旋转/平移/缩放 + 角度/距离约束。
 * 飞行过渡（CameraFlight）期间锁定交互，防止相机状态被用户输入撕裂。
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export interface CameraControls {
  controls: OrbitControls;
  update(dt: number): void;
  setLocked(locked: boolean): void;
  setTarget(v: THREE.Vector3): void;
  dispose(): void;
}

export function createCameraControls(
  camera: THREE.PerspectiveCamera,
  domElement: HTMLElement,
): CameraControls {
  const controls = new OrbitControls(camera, domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 8;
  controls.maxDistance = 175;
  // 相机不得钻到地图平面以下
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.minPolarAngle = Math.PI * 0.03;
  controls.rotateSpeed = 0.75;
  controls.zoomSpeed = 1.1;
  controls.panSpeed = 0.9;
  controls.screenSpacePanning = false;

  return {
    controls,
    update(dt: number) {
      controls.update(dt);
    },
    setLocked(locked: boolean) {
      controls.enabled = !locked;
    },
    setTarget(v: THREE.Vector3) {
      controls.target.copy(v);
    },
    dispose() {
      controls.dispose();
    },
  };
}
