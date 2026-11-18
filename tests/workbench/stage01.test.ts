import { describe, expect, it } from 'vitest';
import raw from '../../data/stages/stage-01.json?raw';
import { appearanceTable, check, compareWithValidationBuild } from '../../src/workbench/checker';
import { loadStage } from '../../src/workbench/stage';

const st = loadStage(raw);

describe('stage-01 data', () => {
  it('keeps the boss patterns of the validation build', () => {
    expect(compareWithValidationBuild(st)).toEqual([]);
  });

  it('passes every check', () => {
    const failed = check(st).filter(f => !f.ok).map(f => `${f.title}\n  ${f.lines.join('\n  ')}`);
    expect(failed).toEqual([]);
  });

  it('meets every boss attack alone first', () => {
    const t = appearanceTable(st);
    expect(t.map(r => r.kind).sort()).toEqual(['beam', 'circle', 'ring', 'zone']);
    for (const r of t) expect(r.first.length).toBeGreaterThan(0);
  });
});
