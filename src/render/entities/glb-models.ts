/**
 * GLB 实体模型替换管线（P6）：
 * - 配置 public/data/models.json：{ "models": { "<类型>": "<相对 data/ 的 .glb 路径>" } }；
 * - 页面启动后异步加载，加载成功的类型由 entityMeshes.attachGlbModels 切换渲染：
 *   隐藏对应实例化槽位（槽位不变式保持）、每实体克隆模型场景并按半径/布局缩放；
 * - 文件缺失/解析失败/路径非法：该类型静默回退程序化几何体（console.warn 提示）。
 * 操作手册见 docs/06-展示样式调整操作手册.md §3。
 */
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Dataset } from '../../shared/types';
import type { EntityMeshRegistry } from './entity-meshes';

/** models.json 解析：models 必须为对象，值为安全相对路径（拒绝绝对路径/.. /非法字符） */
export function parseModelConfig(raw: unknown): Record<string, string> {
  if (typeof raw !== 'object' || raw === null) return {};
  const src = (raw as { models?: unknown }).models;
  if (typeof src !== 'object' || src === null) return {};
  const out: Record<string, string> = {};
  for (const [kind, path] of Object.entries(src as Record<string, unknown>)) {
    if (typeof path !== 'string' || path.trim() === '') continue;
    if (path.startsWith('/') || path.includes('..') || !/^[A-Za-z0-9_\-./]+$/.test(path)) continue;
    out[kind] = path;
  }
  return out;
}

export interface GlbLoadResult {
  /** 成功加载并切换渲染的类型 */
  kinds: string[];
  /** 加载失败回退程序化几何体的类型 */
  failed: string[];
}

/**
 * 读取 models.json 并按配置加载 GLB 模型（每类型一次加载，实体级克隆）。
 * 无配置/坏配置/数据集未使用的类型一律跳过，不阻断启动。
 */
export async function loadGlbModels(
  dataset: Dataset,
  entityMeshes: EntityMeshRegistry,
  base = 'data/',
): Promise<GlbLoadResult> {
  const kinds: string[] = [];
  const failed: string[] = [];
  let config: Record<string, string> = {};
  try {
    config = parseModelConfig((await (await fetch(`${base}models.json`)).json()) as unknown);
  } catch {
    return { kinds, failed }; // models.json 缺失/坏 JSON：全部保持程序化几何体
  }
  const loader = new GLTFLoader();
  for (const [kind, path] of Object.entries(config)) {
    if (dataset.entities.every((e) => e.kind !== kind)) continue; // 数据集未使用该类型
    try {
      const gltf = await loader.loadAsync(`${base}${path}`);
      entityMeshes.attachGlbModels(kind, gltf.scene);
      kinds.push(kind);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[GLB] 模型加载失败，类型「${kind}」回退程序化几何体：`, err);
      failed.push(kind);
    }
  }
  return { kinds, failed };
}
