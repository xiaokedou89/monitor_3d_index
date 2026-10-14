/**
 * 相机机位预设：全局总览 + 各层聚焦机位。
 * 机位保证该层四分区全幅入画（60 宽层带 @ fov50° 需距离 ≥66）。
 * 聚焦机位的视线俯仰角（与层平面夹角）可配置（显示设置"聚焦视角俯仰角"，
 * 默认 45°；早期版本为固定 10° 左右的浅角，实体互相遮挡严重）。
 */
import * as THREE from 'three';
import type { LayerId } from '../../shared/types';
import { LAYER_HEIGHTS } from '../../shared/layout/layer';

export interface CameraPreset {
  position: THREE.Vector3;
  target: THREE.Vector3;
}

const layerPreset = (layer: LayerId, distance: number, heightOffset: number): CameraPreset => ({
  position: new THREE.Vector3(0, LAYER_HEIGHTS[layer] + heightOffset, distance),
  target: new THREE.Vector3(0, LAYER_HEIGHTS[layer], 0),
});

export const CAMERA_PRESETS: Record<LayerId | 'overview', CameraPreset> = {
  overview: { position: new THREE.Vector3(0, 52, 98), target: new THREE.Vector3(0, 7.5, 0) },
  geo: layerPreset('geo', 68, 14),
  device: layerPreset('device', 66, 12),
  app: layerPreset('app', 66, 12),
  task: layerPreset('task', 66, 12),
};

/** 聚焦机位横向距离：60 宽层带 @ fov50° 需 ≥66（层带全幅入画） */
export const FOCUS_FIT_DISTANCE = 66;

/**
 * 按俯仰角生成聚焦机位：目标在层平面中心，视线与平面的夹角 = angleDeg。
 * 相机位置 = 目标 + (0, tan(angle)·d, d)，d 为横向距离（保证层带全幅入画）。
 */
export function focusPreset(layer: LayerId, angleDeg: number, distance = FOCUS_FIT_DISTANCE): CameraPreset {
  const clamped = Math.max(5, Math.min(85, angleDeg));
  const height = Math.tan(THREE.MathUtils.degToRad(clamped)) * distance;
  return {
    position: new THREE.Vector3(0, LAYER_HEIGHTS[layer] + height, distance),
    target: new THREE.Vector3(0, LAYER_HEIGHTS[layer], 0),
  };
}

/** 展开子平面机位：目标为平面中心，距离按平面尺度 */
export function expansionPreset(center: THREE.Vector3): CameraPreset {
  return {
    position: new THREE.Vector3(center.x, center.y + 13, center.z + 26),
    target: center.clone(),
  };
}

/** 单个实体特写机位（详情面板聚焦用，不改变原朝向逻辑，仅作近距离观察） */
export function entityPreset(position: THREE.Vector3): CameraPreset {
  const dir = position.clone().sub(new THREE.Vector3(0, position.y, 0)).normalize();
  const dist = 14;
  return {
    position: new THREE.Vector3(
      position.x + dir.x * dist * 0.55,
      position.y + 7,
      position.z + dir.z * dist * 0.55 + dist * 0.45,
    ),
    target: position.clone(),
  };
}
