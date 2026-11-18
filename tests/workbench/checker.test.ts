import { describe, expect, it } from 'vitest';
import raw from '../../data/stages/stage-01.json?raw';
import { check } from '../../src/workbench/checker';
import { StageData, loadStage } from '../../src/workbench/stage';

/** Change a copy of stage-01 and return the ids of the checks that now fail. */
function failsAfter(change: (d: StageData) => void): string[] {
  const d: StageData = JSON.parse(raw);
  change(d);
  return check(loadStage(d)).filter(f => !f.ok).map(f => f.id);
}

describe('the checker catches what it is meant to catch', () => {
  it('a boss pattern that differs from the validation build', () => {
    expect(failsAfter(d => { d.patterns['seung-drum'].hits![1].shape = { type: 'ring', inner: 150, outer: 200 }; })).toContain('same-as-validation');
  });

  it('a hit off the kick and snare beats', () => {
    expect(failsAfter(d => { d.patterns['gi-solo'].hits![0].step = 10; })).toContain('on-beat');
  });

  it('a device standing over a chasm', () => {
    expect(failsAfter(d => { d.emitters.find(e => e.id === 'drum-middle-1')!.at = { r: 19.4, deg: 150 }; })).toContain('on-ground');
  });

  it('a missing cliff between two instrument areas', () => {
    expect(failsAfter(d => { d.field.holes = d.field.holes.filter(h => h.id !== 'cliff-bass-drum'); })).toContain('cliffs');
  });

  it('a cliff narrow enough to dash across', () => {
    expect(failsAfter(d => { const c = d.field.holes.find(h => h.id === 'cliff-drum-hat')!; if (c.type === 'path') c.width = 0.9; })).toContain('cliffs');
  });

  it('an attack met first among others', () => {
    // without the single beam device at the entrance, beams are first met in the middle next to other things
    expect(failsAfter(d => {
      d.emitters = d.emitters.filter(e => !e.id.startsWith('hat-entrance') && !e.id.startsWith('hat-middle'));
    })).toContain('first-alone');
  });

  it('an attack the boss uses but the road never shows', () => {
    expect(failsAfter(d => { d.emitters = d.emitters.filter(e => e.pattern !== 'zone-device'); })).toContain('road-first');
  });

  it('an order of collecting that gets stuck', () => {
    expect(failsAfter(d => { d.routes.find(r => r.from === 'center' && r.to === 'hat-entrance')!.requires = { parts: ['drum'] }; })).toContain('any-order');
  });

  it('a guardian that cannot be passed without an instrument', () => {
    expect(failsAfter(d => { d.emitters.find(e => e.id === 'hat-guardian')!.pass = ['defeat']; })).toContain('dodge-pass');
  });
});
