"""Monster test field: src/data/stages/lab-monster.json.

Not a stage of the game. A small field to try monster designs by hand, side by side:
  A  chases, slams the ground around itself with the drum boss's first ring, hurts on touch, can be broken
  B  chases, aims a circle at the player's spot, hurts on touch, can be broken
  C  the monster of stage-01 as it is now, for comparison

Open: index.html?stage=lab-monster&parts=drum,hat,bass   (the parts start in hand, so the instruments fight back)
All lengths in U (1U = one beat of walking).
"""
import json
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "src/data/stages/lab-monster.json"
PX = 1 / 120

attacks = {
    # The drum boss's first ring (40-150px), one beat of telegraph: the same size and timing as in the boss pattern.
    "slam": {"shape": {"kind": "ring", "r0": 40 * PX, "r1": 150 * PX}, "tele": 4, "layer": "drum"},
    # The boss's circle (radius 70px) on the player's spot, two beats of telegraph.
    "circle": {"shape": {"kind": "circle", "r": 70 * PX}, "tele": 8, "anchor": "target", "layer": "lead"},
}

monsters = [
    {   # A: steps after the player, stops for a beat, slams on beats 2 and 4 (the snare)
        "id": "A-ring", "kind": "monster", "x": -5.0, "y": -1.5, "hp": 30, "body": 0.12,
        "touch": True, "respawn": 2, "range": 2.0,
        "motion": {"kind": "chase", "by": 0.8, "min": 0.7, "sight": 6.0},
        "pattern": {"length": 16, "events": [{"at": 4, "attack": "slam"}, {"at": 12, "attack": "slam"}]},
    },
    {   # B: chases at a little distance, marks the player's spot every bar (hit on beat 3)
        "id": "B-circle", "kind": "monster", "x": 5.0, "y": -1.5, "hp": 30, "body": 0.12,
        "touch": True, "respawn": 2, "range": 5.0,
        "motion": {"kind": "chase", "by": 0.8, "min": 1.2, "sight": 6.0},
        "pattern": {"length": 16, "events": [{"at": 8, "attack": "circle"}]},
    },
    {   # C: stage-01's note monster, unchanged
        "id": "C-now", "kind": "monster", "x": 0.0, "y": -7.0, "body": 0.22, "range": 6.0,
        "motion": {"kind": "approach", "every": 4, "by": 0.5, "min": 2.5, "sight": 6.0},
        "pattern": {"length": 32, "rest": 32, "phase": 0,
                    "events": [{"at": 8, "attack": "circle"}, {"at": 16, "attack": "circle"}, {"at": 24, "attack": "circle"}]},
    },
]

stage = {
    "id": "lab-monster",
    "name": "몬스터 시험장",
    "meter": {"bpm": 110, "stepsPerBeat": 4, "beatsPerBar": 4, "dashMs": 120, "justMs": 60},
    "seed": 7,
    "lives": 9,
    "start": [0.0, 6.5],
    "map": {
        "ground": [{"kind": "circle", "x": 0, "y": 0, "r": 10.5}],
        # a pit in the middle: a chasing monster walks around its edge, never into it
        "holes": [{"kind": "circle", "x": 0, "y": 1.2, "r": 1.4}],
    },
    "attacks": attacks,
    "emitters": monsters,
    "checkpoints": [{"x": 0.0, "y": 6.5, "r": 0.8}, {"x": -3.0, "y": 3.0, "r": 0.8}, {"x": 3.0, "y": 3.0, "r": 0.8}],
}

OUT.write_text(json.dumps(stage, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("wrote", OUT)
