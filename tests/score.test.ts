import { describe, it, expect } from 'vitest';
import { harmony, notesOf, RULE_PARAMS, sceneFor, sceneSteps, scoreFromText, scoreToText, SCORE_LAYERS } from '../src/core/music/score';
import { demoScore } from '../src/core/music/scoreLibrary';

describe('score', () => {
  const score = demoScore();

  it('gives the same notes for the same seed, and others for another', () => {
    expect(notesOf(score, 'phase 1', 'bass')).toEqual(notesOf(demoScore(), 'phase 1', 'bass'));
    expect(notesOf({ ...score, seed: 8 }, 'phase 1', 'bass')).not.toEqual(notesOf(score, 'phase 1', 'bass'));
  });

  it('keeps kick and snare where the meter puts them, in every scene', () => {
    for (const scene of Object.keys(score.scenes)) {
      const drum = notesOf(score, scene, 'drum');
      for (let bar = 0; bar < score.scenes[scene].bars; bar++) {
        for (const s of score.meter.kick) expect(drum.some(n => n.voice === 'kick' && n.vel > 0.7 && n.step === bar * 16 + s)).toBe(true);
        for (const s of score.meter.snare) expect(drum.some(n => n.voice === 'snare' && n.step === bar * 16 + s)).toBe(true);
      }
      // Nothing else is ever put on a snare's step.
      expect(drum.filter(n => n.voice === 'snare').every(n => score.meter.snare.includes(n.step % 16))).toBe(true);
    }
  });

  it('moves kick and snare when the meter moves them', () => {
    const other = { ...score, meter: { ...score.meter, kick: [0, 3, 6, 10], snare: [12] } };
    const drum = notesOf(other, 'intro', 'drum');
    expect(drum.filter(n => n.voice === 'kick' && n.step < 16).map(n => n.step)).toEqual([0, 3, 6, 10]);
    expect(drum.filter(n => n.voice === 'snare' && n.step < 16).map(n => n.step)).toEqual([12]);
  });

  it('keeps every note inside its scene and inside the scale', () => {
    const { root, scale } = harmony(score);
    const pcs = scale.map(d => (root + d) % 12);
    for (const scene of Object.keys(score.scenes)) for (const layer of SCORE_LAYERS) {
      for (const n of notesOf(score, scene, layer)) {
        expect(n.step).toBeGreaterThanOrEqual(0);
        expect(n.step).toBeLessThan(sceneSteps(score, scene));
        if (n.voice === 'note') expect(pcs).toContain(((n.midi % 12) + 12) % 12);
      }
    }
  });

  it('re-rolls one part without touching the others', () => {
    const rolled = demoScore();
    rolled.parts['lead line'].roll = 1;
    expect(notesOf(rolled, 'explore', 'lead')).not.toEqual(notesOf(score, 'explore', 'lead'));
    expect(notesOf(rolled, 'explore', 'bass')).toEqual(notesOf(score, 'explore', 'bass'));
    expect(notesOf(rolled, 'explore', 'drum')).toEqual(notesOf(score, 'explore', 'drum'));
  });

  it('plays the same part the same way in every scene that uses it', () => {
    const bar = (scene: string) => notesOf(score, scene, 'pad').filter(n => n.step < 16);
    expect(bar('explore')).toEqual(bar('phase 1'));
  });

  it('has every layer sounding in every scene of the built-in score', () => {
    for (const scene of Object.keys(score.scenes)) for (const layer of SCORE_LAYERS) expect(notesOf(score, scene, layer).length).toBeGreaterThan(0);
  });

  it('only points at parts, instruments and scenes that exist', () => {
    for (const [id, scene] of Object.entries(score.scenes)) {
      if (scene.next) expect(score.scenes[scene.next], `${id}.next`).toBeDefined();
      for (const layer of SCORE_LAYERS) {
        const t = scene.tracks[layer]!;
        expect(score.parts[t.part], `${id}/${layer} part`).toBeDefined();
        expect(RULE_PARAMS[score.parts[t.part].rule]).toBeDefined();
        for (const name of typeof t.inst === 'string' ? [t.inst] : Object.values(t.inst)) expect(score.instruments[name], `${id}/${layer} ${name}`).toBeDefined();
      }
    }
    for (const scene of Object.values(score.states)) expect(score.scenes[scene]).toBeDefined();
  });

  it('survives being saved and loaded', () => {
    const again = scoreFromText(scoreToText(score))!;
    expect(again).toEqual(score);
    expect(notesOf(again, 'drop', 'bass')).toEqual(notesOf(score, 'drop', 'bass'));
    expect(scoreFromText('not a score')).toBeNull();
    expect(scoreFromText('{}')).toBeNull();
  });

  it('maps game states to scenes', () => {
    expect(sceneFor(score, 'boss.shift')).toBe('build');
    expect(sceneFor(score, 'no such state')).toBe('explore');
  });
});
