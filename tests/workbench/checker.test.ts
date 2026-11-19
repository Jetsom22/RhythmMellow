import { describe, expect, it } from 'vitest';
import { StageData } from '../../src/core/stage/sim';
import { check } from '../../src/workbench/checker';
import { loadModel } from '../../src/workbench/model';

const stages = import.meta.glob<StageData>('../../src/data/stages/*.json', { eager: true, import: 'default' });
const stage01 = stages['../../src/data/stages/stage-01.json'];

/** Change a copy of stage-01 and return the checks that now fail. */
function failsAfter(change: (d: StageData) => void): string[] {
  const d: StageData = JSON.parse(JSON.stringify(stage01));
  change(d);
  return check(loadModel(d)).filter(f => !f.ok).map(f => f.id);
}
const em = (d: StageData, id: string) => d.emitters!.find(e => e.id === id)!;

describe('each level-design check catches its problem', () => {
  it('a boss phrase unlike the validation build', () => {
    expect(failsAfter(d => { d.encounters!.find(e => e.kind === 'boss')!.phrases[0].events[0].at = 12; })).toContain('same-as-validation');
  });
  it('a hit off the kick and snare beats', () => {
    expect(failsAfter(d => { em(d, 'drum-in').pattern!.phase = 2; })).toContain('on-beat');
  });
  it('a device over the void', () => {
    expect(failsAfter(d => { const e = em(d, 'hat-in'); e.x = 0; e.y = -40; })).toContain('on-ground');
  });
  it('two instrument areas joined without the centre', () => {
    expect(failsAfter(d => { d.map.ground.push({ kind: 'sector', x: 0, y: 0, r0: 15, r1: 29, a0: 80, a1: 100 }); })).toContain('cliffs');
  });
  it('an attack the road never shows before the boss', () => {
    expect(failsAfter(d => { d.emitters = d.emitters!.filter(e => !(e.pattern?.events ?? []).some(ev => ev.attack === 'zone') && !e.follow); })).toContain('road-first');
  });
  it('an attack first met next to another', () => {
    expect(failsAfter(d => { const e = em(d, 'note-0'), h = em(d, 'hat-in'); e.x = h.x; e.y = h.y + 2; })).toContain('first-alone');
  });
  it('an order of collecting that gets stuck', () => {
    expect(failsAfter(d => { d.gates!.push({ id: 'wall', shape: { kind: 'circle', x: 0, y: 0, r: 0.01 }, requires: {} }); d.map.holes!.push({ kind: 'sector', x: 0, y: 0, r0: 13.6, r1: 17, a0: 214, a1: 326 }); })).toContain('any-order');
  });
  it('a guardian passed some other way than one loop of its pattern', () => {
    expect(failsAfter(d => { for (const p of d.encounters!.find(e => e.id === 'hat-guard')!.phrases) p.advance = { hpBelow: 0 }; })).toContain('dodge-pass');
    expect(failsAfter(d => { for (const p of d.encounters!.find(e => e.id === 'hat-guard')!.phrases) p.advance = { survived: true, answered: 3 }; })).toContain('dodge-pass');
  });
});
