import { it, expect } from 'vitest';
import { mulberry32 } from '../src/core/rng';

it('is deterministic per seed and stays in [0,1)', () => {
  const a = mulberry32(42), b = mulberry32(42), c = mulberry32(43);
  const xs = Array.from({ length: 100 }, () => a());
  const ys = Array.from({ length: 100 }, () => b());
  const zs = Array.from({ length: 100 }, () => c());
  expect(xs).toEqual(ys);
  expect(xs).not.toEqual(zs);
  expect(xs.every(v => v >= 0 && v < 1)).toBe(true);
});
