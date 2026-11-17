/** Every number the game can be tuned by. Nothing else hardcodes these. */
export interface Tunables {
  bpm: number; loopBars: number;
  perfectMs: number; nearMs: number; audioOffsetMs: number; inputOffsetMs: number;
  playerSpeed: number; playerRadius: number;
  dashPerfect: number; dashNear: number; dashMiss: number; dashTime: number;
  iframePerfect: number; iframeNear: number; iframeMiss: number; dodgeCooldown: number;
  playerHp: number; hitInvuln: number;
  bossHp: number; weakMult: number; otherMult: number; callOpenMult: number; callClosedMult: number;
  dmgDrum: number; dmgHat: number; dmgBass: number;
  rangeDrum: number; rangeHat: number; rangeBass: number;
  hatGapStart: number; hatGapLen: number;
  harmonyMax: number; muffleBars: number;
}

export function defaultTunables(): Tunables {
  return {
    bpm: 110, loopBars: 2,
    perfectMs: 60, nearMs: 120, audioOffsetMs: 0, inputOffsetMs: 0,
    playerSpeed: 220, playerRadius: 10,
    dashPerfect: 170, dashNear: 120, dashMiss: 50, dashTime: 0.16,
    iframePerfect: 0.30, iframeNear: 0.18, iframeMiss: 0.03, dodgeCooldown: 0.25,
    playerHp: 3, hitInvuln: 1.0,
    bossHp: 900, weakMult: 2, otherMult: 0.5, callOpenMult: 1.5, callClosedMult: 0.5,
    dmgDrum: 10, dmgHat: 3, dmgBass: 2,
    rangeDrum: 70, rangeHat: 400, rangeBass: 220,
    hatGapStart: 0.68, hatGapLen: 0.2,
    harmonyMax: 3, muffleBars: 2,
  };
}
