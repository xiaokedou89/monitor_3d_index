/**
 * 种子化伪随机数（mulberry32）。
 * 全系统禁用 Math.random，保证同 seed 数据逐字节一致、仿真可确定性重放。
 */

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 生成 [min, max) 均匀随机整数 */
export function randInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min));
}

/** 生成 [min, max) 均匀随机浮点数 */
export function randFloat(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min);
}

/** 从数组中随机取一个元素 */
export function randPick<T>(rng: Rng, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

/** 从数组中随机取 n 个不重复元素（n <= arr.length） */
export function randPickN<T>(rng: Rng, arr: readonly T[], n: number): T[] {
  const copy = [...arr];
  const out: T[] = [];
  for (let i = 0; i < n && copy.length > 0; i++) {
    const idx = Math.floor(rng() * copy.length);
    out.push(copy.splice(idx, 1)[0]!);
  }
  return out;
}

/** 洗牌（Fisher-Yates，原地） */
export function shuffle<T>(rng: Rng, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}
