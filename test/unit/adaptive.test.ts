/**
 * 自适应区域布局护栏（P5 子区域方案）：
 * - 密集区（≥ DENSE_THRESHOLD）按类型分组构成子区域带，带 z 首尾相接不重叠；
 * - 深度受限时 fitFactor 同步缩小实体尺寸与间距（0.45 ≤ f ≤ 1），二分收敛不振荡；
 * - 非密集区沿用网格/树布局且不产生子区域。
 * 背景：任务层"业务网"73 实体原布局深度过大、遮挡严重，按类型分带后需保证
 * 布局稳定（同配置重跑结果一致）且实体始终落在自身子区域带内。
 */
import { describe, expect, it } from 'vitest';
import { layoutAdaptive, type AdaptiveEntity } from '../../src/shared/layout/adaptive';

const mk = (n: number, kinds: string[]): AdaptiveEntity[] =>
  Array.from({ length: n }, (_, i) => ({ id: `e-${i}`, kind: kinds[i % kinds.length]!, radius: 0.5 }));

const BOUNDS = { x0: -7.5, x1: 7.5, depth: 20 };

describe('layoutAdaptive：密集区按类型分带', () => {
  const kinds = ['production', 'sales', 'after-sales', 'ops'];

  it('实体数达到阈值时按类型分组构成子区域', () => {
    const entities = mk(73, kinds);
    const out = layoutAdaptive(entities, BOUNDS, { mode: 'tree', kindOrder: kinds });
    expect(out.subs.length).toBe(kinds.length);
    for (const s of out.subs) {
      expect(s.ids.length).toBeGreaterThan(0);
      for (const id of s.ids) {
        expect(entities.find((x) => x.id === id)!.kind).toBe(s.kind);
      }
    }
  });

  it('子区域按 kindOrder 稳定排序且 z 带互不重叠', () => {
    const entities = mk(40, ['ops', 'production']);
    const out = layoutAdaptive(entities, BOUNDS, { mode: 'grid', kindOrder: ['production', 'ops'] });
    expect(out.subs.map((s) => s.kind)).toEqual(['production', 'ops']);
    for (let i = 0; i < out.subs.length; i++) {
      expect(out.subs[i]!.z0).toBeLessThan(out.subs[i]!.z1);
      if (i + 1 < out.subs.length) {
        expect(out.subs[i]!.z1).toBeLessThan(out.subs[i + 1]!.z0);
      }
    }
  });

  it('每个实体恰好布局一次且落在自身子区域带内', () => {
    const entities = mk(50, kinds);
    const out = layoutAdaptive(entities, BOUNDS, { mode: 'grid', kindOrder: kinds });
    expect(out.positions.size).toBe(entities.length);
    const seen = new Set<string>();
    for (const s of out.subs) {
      for (const id of s.ids) {
        expect(seen.has(id)).toBe(false);
        seen.add(id);
        const p = out.positions.get(id)!;
        expect(p.x).toBeGreaterThan(BOUNDS.x0);
        expect(p.x).toBeLessThan(BOUNDS.x1);
        expect(p.z).toBeGreaterThanOrEqual(s.z0);
        expect(p.z).toBeLessThan(s.z1);
      }
    }
    expect(seen.size).toBe(entities.length);
  });

  it('天然深度超限时 fitFactor 缩小实体与间距（scaleFactor < 1 且 ≥ 0.45）', () => {
    const entities = mk(73, kinds);
    const tight = { x0: -7.5, x1: 7.5, depth: 12 };
    const out = layoutAdaptive(entities, tight, { mode: 'tree', kindOrder: kinds });
    expect(out.scaleFactor).toBeLessThan(1);
    expect(out.scaleFactor).toBeGreaterThanOrEqual(0.45);
    expect(out.depth).toBeLessThanOrEqual(tight.depth + 1e-6);
  });

  it('深度充裕时保持原尺寸（scaleFactor = 1，深度 = 天然深度）', () => {
    const entities = mk(40, kinds);
    const out = layoutAdaptive(entities, { x0: -7.5, x1: 7.5, depth: 60 }, { mode: 'grid', kindOrder: kinds });
    expect(out.scaleFactor).toBe(1);
    // 4 类各 10 个：列数 floor(13/2.2)=5 → 每类 2 行 → 8 行 × 2.2 + 3 间隙 × 0.8
    expect(out.depth).toBeCloseTo(8 * 2.2 + 3 * 0.8, 6);
  });

  it('同配置重跑结果逐点一致（布局确定性）', () => {
    const entities = mk(73, kinds);
    const a = layoutAdaptive(entities, BOUNDS, { mode: 'grid', kindOrder: kinds });
    const b = layoutAdaptive(entities, BOUNDS, { mode: 'grid', kindOrder: kinds });
    expect(a.scaleFactor).toBe(b.scaleFactor);
    expect(a.depth).toBe(b.depth);
    for (const e of entities) {
      expect(a.positions.get(e.id)).toEqual(b.positions.get(e.id));
    }
  });
});

describe('layoutAdaptive：非密集区沿用网格/树', () => {
  it('实体数低于阈值不产生子区域，深度充裕不缩放', () => {
    const entities = mk(20, ['production']);
    const out = layoutAdaptive(entities, { x0: 0, x1: 15, depth: 30 }, { mode: 'grid' });
    expect(out.subs).toEqual([]);
    expect(out.positions.size).toBe(20);
    expect(out.scaleFactor).toBe(1);
  });

  it('深度受限时缩小间距与实体尺寸（grid）', () => {
    const entities = mk(30, ['production']);
    const out = layoutAdaptive(entities, { x0: 0, x1: 15, depth: 6 }, { mode: 'grid' });
    expect(out.scaleFactor).toBeLessThan(1);
    expect(out.depth).toBeLessThanOrEqual(6 + 1e-6);
    for (const p of out.positions.values()) {
      expect(p.x).toBeGreaterThan(0);
      expect(p.x).toBeLessThan(15);
    }
  });

  it('空区域返回最小深度且无实体', () => {
    const out = layoutAdaptive([], { x0: 0, x1: 15, depth: 4 }, { mode: 'grid' });
    expect(out.positions.size).toBe(0);
    expect(out.depth).toBeGreaterThanOrEqual(6);
    expect(out.subs).toEqual([]);
  });
});
