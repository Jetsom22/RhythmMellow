import { describe, it, expect } from 'vitest';
import { stepGame } from '../src/core/game/sim';
import { isSolid } from '../src/core/game/world';
import { switchInstrument, equip } from '../src/core/game/player';
import { CHASM_ROOM, GRID, OPEN_ROOM, gameOn, idle, run } from './helpers';

describe('movement', () => {
  it('moves at playerSpeed', () => {
    const s = gameOn(OPEN_ROOM);
    const x0 = s.player.x;
    run(s, 1.5, { moveX: 1 });
    expect(s.player.x - x0).toBeCloseTo(s.tun.playerSpeed * 0.5, 0);
  });
  it('normalizes diagonal movement', () => {
    const s = gameOn(OPEN_ROOM);
    const { x, y } = s.player;
    run(s, 1.25, { moveX: 1, moveY: 1 });
    expect(Math.hypot(s.player.x - x, s.player.y - y)).toBeCloseTo(s.tun.playerSpeed * 0.25, 0);
  });
  it('stops at walls', () => {
    const s = gameOn(OPEN_ROOM);
    run(s, 4, { moveY: -1 });
    expect(s.player.y).toBeGreaterThanOrEqual(32 + s.tun.playerRadius - 0.01);
    expect(isSolid(s.world, s.player.x, s.player.y - s.tun.playerRadius + 0.5)).toBe(false);
  });
  it('survives a long frame hitch: no wall tunnelling and no skipped steps', () => {
    const s = gameOn(OPEN_ROOM);
    s.player.x = 590;
    expect(s.step).toBe(8);
    stepGame(s, idle({ moveX: 1 }), 1.5, GRID);
    expect(s.player.x).toBeLessThanOrEqual(608 - s.tun.playerRadius + 0.01);
    expect(s.step).toBe(12);
    stepGame(s, idle({ moveX: 1 }), 4.0, GRID);
    expect(s.player.x).toBeLessThanOrEqual(608 - s.tun.playerRadius + 0.01);
    expect(s.step).toBe(32);
  });
});

describe('beat dodge', () => {
  it('reports the grade of a press', () => {
    const s = gameOn(OPEN_ROOM);
    const ev = run(s, 1.4, { dodgeAt: 1.0 }).filter(e => e.type === 'dodge');
    expect(ev).toEqual([{ type: 'dodge', grade: 'perfect', offsetMs: expect.closeTo(0, 3), beat: 2 }]);
    expect(s.dodgeLog).toHaveLength(1);
  });
  it('covers the dash distance for each grade', () => {
    for (const [at, t0, dist] of [[1.0, 1.0, 'dashPerfect'], [1.1, 1.1, 'dashNear'], [1.25, 1.25, 'dashMiss']] as const) {
      const s = gameOn(OPEN_ROOM, t0);
      const x0 = s.player.x;
      run(s, t0 + 0.2, { dodgeAt: at });   // no move input: dash along facing (+x)
      expect(s.player.x - x0).toBeCloseTo(s.tun[dist], -0.5);
    }
  });
  it('grants invulnerability by grade', () => {
    const s = gameOn(OPEN_ROOM);
    stepGame(s, idle({ dodgeAt: 1.0 }), 1.01, GRID);
    expect(s.player.iframe).toBeGreaterThan(s.tun.iframePerfect - 0.02);
  });
  it('crosses a chasm on a good dodge', () => {
    const s = gameOn(CHASM_ROOM);
    s.player.x = 150;
    const ev = run(s, 1.4, { dodgeAt: 1.0 });
    expect(ev.some(e => e.type === 'respawn')).toBe(false);
    expect(s.player.x).toBeGreaterThan(224);
  });
  it('falls back to the respawn point on a missed dodge over a chasm', () => {
    const s = gameOn(CHASM_ROOM, 1.25);
    const home = { ...s.player.respawn };
    s.player.x = 150;
    const ev = run(s, 1.7, { dodgeAt: 1.25 });
    expect(ev.filter(e => e.type === 'respawn')).toHaveLength(1);
    expect({ x: s.player.x, y: s.player.y }).toEqual(home);
    expect(s.player.hp).toBe(s.tun.playerHp);
  });
  it('falls when walking onto a chasm', () => {
    const s = gameOn(CHASM_ROOM);
    const ev = run(s, 2.0, { moveX: 1 });
    expect(ev.some(e => e.type === 'respawn')).toBe(true);
  });
  it('ignores a second dodge during the cooldown', () => {
    const s = gameOn(OPEN_ROOM);
    stepGame(s, idle({ dodgeAt: 1.0 }), 1.02, GRID);
    const ev = stepGame(s, idle({ dodgeAt: 1.03 }), 1.04, GRID);
    expect(ev.filter(e => e.type === 'dodge')).toHaveLength(0);
    expect(s.dodgeLog).toHaveLength(1);
  });
  it('accepts a dodge again after the cooldown', () => {
    const s = gameOn(OPEN_ROOM);
    run(s, 1.4, { dodgeAt: 1.0 });
    const ev = run(s, 1.6, { dodgeAt: 1.5 });
    expect(ev.filter(e => e.type === 'dodge')).toHaveLength(1);
  });
});

describe('instrument switching', () => {
  it('does nothing with no instruments', () => {
    const s = gameOn(OPEN_ROOM);
    switchInstrument(s.player, 1);
    expect(s.player.equipped).toBeNull();
    expect(() => stepGame(s, idle({ switchDir: 1 }), 1.02, GRID)).not.toThrow();
  });
  it('stays on the only instrument', () => {
    const s = gameOn(OPEN_ROOM);
    s.player.owned = ['hat']; s.player.equipped = 'hat';
    switchInstrument(s.player, 1);
    expect(s.player.equipped).toBe('hat');
  });
  it('cycles both ways and wraps', () => {
    const s = gameOn(OPEN_ROOM);
    s.player.owned = ['drum', 'hat', 'bass']; s.player.equipped = 'drum';
    stepGame(s, idle({ switchDir: 1 }), 1.02, GRID);
    expect(s.player.equipped).toBe('hat');
    switchInstrument(s.player, -1); switchInstrument(s.player, -1);
    expect(s.player.equipped).toBe('bass');
  });
  it('equips directly only what is owned', () => {
    const s = gameOn(OPEN_ROOM);
    s.player.owned = ['drum']; s.player.equipped = 'drum';
    equip(s.player, 'bass');
    expect(s.player.equipped).toBe('drum');
    stepGame(s, idle({ switchTo: 'drum' }), 1.02, GRID);
    expect(s.player.equipped).toBe('drum');
  });
});
