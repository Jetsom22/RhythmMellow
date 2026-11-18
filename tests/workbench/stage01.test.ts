import { describe, expect, it } from 'vitest';
import { StageData } from '../../src/core/stage/sim';
import { appearanceTable, check, compareWithValidationBuild } from '../../src/workbench/checker';
import { loadModel } from '../../src/workbench/model';

const stages = import.meta.glob<StageData>('../../src/data/stages/*.json', { eager: true, import: 'default' });
const stage01 = stages['../../src/data/stages/stage-01.json'];

describe('stage-01 in the level workbench', () => {
  const m = loadModel(stage01);

  it('keeps the boss of the validation build', () => {
    expect(compareWithValidationBuild(m)).toEqual([]);
  });

  it('passes every level-design check', () => {
    const failed = check(m).filter(f => !f.ok).map(f => `${f.title}\n  ${f.lines.join('\n  ')}`);
    expect(failed).toEqual([]);
  });

  it('shows every boss attack on the road, partly alone', () => {
    const t = appearanceTable(m);
    expect(t.map(r => r.kind).sort()).toEqual(['beam', 'circle', 'ring', 'zone']);
    for (const r of t) expect(Math.max(...r.emitters.map(e => e.alonePct))).toBeGreaterThan(0);
  });
});
