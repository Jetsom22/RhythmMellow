#!/usr/bin/env python3
"""Writes data/stages/stage-01.json from docs/level/stage-01.md (level session, 2nd draft).
Lengths are in U (1U = the distance walked in one beat). Angles are degrees, y points down.
Attack sizes and beats are the validation build's boss patterns, unchanged."""
import json, math, os

PX = 1 / 120.0
def pol(r, a): return [round(r * math.cos(math.radians(a)), 3), round(r * math.sin(math.radians(a)), 3)]
def at(r, a): x, y = pol(r, a); return {"x": x, "y": y}

ZONES = {"drum": 150, "hat": 270, "bass": 30}          # centre angle of each instrument's zone
HALF = 56                                              # half-width of a zone; the rest is cliff

attacks = {
    "circle":   {"shape": {"kind": "circle", "r": 70 * PX}, "tele": 8, "anchor": "target", "layer": "lead"},
    "circle-1": {"shape": {"kind": "circle", "r": 70 * PX}, "tele": 4, "anchor": "target", "layer": "lead"},
    "around":   {"shape": {"kind": "circle", "r": 120 * PX}, "tele": 8, "layer": "lead"},
    "ring-1":   {"shape": {"kind": "ring", "r0": 40 * PX, "r1": 150 * PX}, "tele": 4, "layer": "drum"},
    "ring-2":   {"shape": {"kind": "ring", "r0": 150 * PX, "r1": 260 * PX}, "tele": 4, "layer": "drum"},
    "ring-3":   {"shape": {"kind": "ring", "r0": 260 * PX, "r1": 400 * PX}, "tele": 4, "layer": "drum"},
    "beam":     {"shape": {"kind": "beam", "w": 70 * PX, "len": 5.0}, "tele": 4, "layer": "hat"},
    "zone":     {"shape": {"kind": "zone", "w": 150 * PX, "h": 150 * PX}, "tele": 8, "hold": 8, "layer": "bass"},
    "half":     {"shape": {"kind": "zone", "w": 384 * PX, "h": 512 * PX}, "tele": 8, "hold": 4, "layer": "bass"},
    "tide":     {"shape": {"kind": "zone", "w": 3.4, "h": 1.0}, "tele": 4, "layer": "bass"},
}

def sweep(bar): return [{"at": bar * 16 + 4 * (i + 1), "attack": "ring-%d" % (i + 1)} for i in range(3)]
def beams(step, angles): return [{"at": step, "attack": "beam", "rot": a} for a in angles]
def circles(steps, attack="circle"): return [{"at": s, "attack": attack} for s in steps]

ground = [{"kind": "circle", "x": 0, "y": 0, "r": 14.0}]
holes = [{"kind": "sector", "x": 0, "y": 0, "r0": 4.6, "r1": 7.0, "a0": 0, "a1": 360}]
emitters, parts, plates, gates, checkpoints, encounters = [], [], [], [], [], []
checkpoints.append({"x": 0, "y": 10.5, "r": 1.0})

# The centre: start, two note monsters, three plates, the bridge to the boss.
for i, a in enumerate([52, 128]):
    emitters.append({"id": "note-%d" % i, "kind": "monster", **at(10.0, a + (2 if i else -2)), "body": 0.22, "range": 6.0,
        "motion": {"kind": "approach", "every": 4, "by": 0.5, "min": 2.5, "sight": 6.0},
        "pattern": {"length": 32, "rest": 32, "phase": 32 * i, "events": circles([8, 16, 24])}})
for layer, a in ZONES.items():
    plates.append({"id": "plate-" + layer, "layer": layer, **at(9.0, a), "r": 40 * PX, "flag": "plate-" + layer})
gates.append({"id": "boss-bridge", "shape": {"kind": "rect", "x": 0, "y": 5.8, "w": 1.6, "h": 2.8},
    "requires": {"flags": ["plate-drum", "plate-hat", "plate-bass"]}})
checkpoints.append({"x": 0, "y": 7.8, "r": 0.8})

def device(id, r, a, pattern, **extra):
    emitters.append({"id": id, "kind": "device", **at(r, a), "body": 0.2, "pattern": pattern, **extra})

RING_BAR = {"length": 16, "rest": 16, "events": sweep(0)}
BEAM_BAR = {"length": 16, "rest": 16, "events": beams(4, [0, 180]) + beams(8, [90, 270]) + beams(12, [0, 180])}
ZONE_BAR = {"length": 16, "rest": 16, "events": [{"at": 8, "attack": "zone"}]}

for layer, c in ZONES.items():
    ground.append({"kind": "sector", "x": 0, "y": 0, "r0": 13.5, "r1": 30.0, "a0": c - HALF, "a1": c + HALF})
    pat = {"drum": RING_BAR, "hat": BEAM_BAR, "bass": ZONE_BAR}[layer]
    # Entrance: one device, with room to walk around it.
    device(layer + "-in", 14.5, c, pat)
    # Middle: the same device again, only the place and the starting beat change. Pools of cliff between them.
    if layer == "drum":
        spots = [(18.0, c - 22, 0), (18.0, c + 22, 8), (22.0, c + 4, 0), (21.5, c + 30, 8)]
        pools = [(19.5, c, 1.6), (17.0, c - 40, 1.4), (20.8, c + 17, 1.2), (20.5, c - 30, 1.2)]
    elif layer == "hat":
        spots = [(17.5, c - 18, 0), (19.5, c + 14, 16), (21.5, c - 6, 8)]
        pools = [(18.5, c + 40, 1.5), (20.5, c - 38, 1.5)]
    else:
        spots = [(16.3, c - 30, 0), (16.3, c + 30, 16), (22.3, c - 16, 8), (22.3, c + 16, 24)]
        pools = []
    for i, (r, a, phase) in enumerate(spots):
        device("%s-mid-%d" % (layer, i), r, a, {**pat, "phase": phase})
    for r, a, rad in pools:
        x, y = pol(r, a); holes.append({"kind": "circle", "x": x, "y": y, "r": rad})
    if layer == "bass":
        # A marsh across the zone with three causeways. The tide strikes a causeway on each beat the bass sounds.
        holes.append({"kind": "sector", "x": 0, "y": 0, "r0": 17.8, "r1": 20.8, "a0": c - HALF, "a1": c + HALF})
        for i, a in enumerate([c - 34, c, c + 34]):
            x0, y0 = pol(17.6, a); x1, y1 = pol(21.0, a)
            ground_after = {"kind": "capsule", "x1": x0, "y1": y0, "x2": x1, "y2": y1, "r": 0.5}
            gates.append({"id": "causeway-%d" % i, "shape": ground_after, "requires": {}})
            x, y = pol(19.3, a)
            emitters.append({"id": "tide-%d" % i, "kind": "device", "x": x, "y": y, "body": 0.0, "hidden": True, "rot": a,
                "follow": {"layer": "bass", "attack": "tide"}})
    checkpoints.append({**at(19.8 if layer != "bass" else 21.6, c + (8 if layer == "drum" else 0)), "r": 0.8})
    # Mixed: a device and a note monster together.
    device(layer + "-mix", 23.0, c + 24, {**pat, "phase": 8})
    emitters.append({"id": layer + "-note", "kind": "monster", **at(23.5, c + 10), "body": 0.22, "range": 6.0,
        "motion": {"kind": "approach", "every": 4, "by": 0.5, "min": 2.5, "sight": 6.0},
        "pattern": {"length": 32, "rest": 32, "events": circles([8, 16, 24])}})
    checkpoints.append({**at(21.4, c - 22), "r": 0.8})
    # Inside: the guardian and the instrument. Three just dashes in a row pass it without an instrument.
    gx, gy = pol(26.0, c - 24)   # clear of every device on the way in
    phrase = {
        "drum": {"id": "seung-drum", "bars": 4, "events": sweep(0) + sweep(2), "openBars": [1, 3], "weakTo": "hat"},
        "hat": {"id": "seung-hat", "bars": 2, "weakTo": "drum", "events": beams(4, [0, 180]) + beams(8, [90, 270]) + beams(12, [0, 180])
            + beams(20, [45, 135, 225, 315]) + beams(24, [0, 90, 180, 270]) + circles([28])},
        "bass": {"id": "bass-guard", "bars": 4, "events": [{"at": 8, "attack": "zone", "anchor": "target"}, {"at": 24, "attack": "circle"},
            {"at": 40, "attack": "zone", "anchor": "target"}, {"at": 56, "attack": "circle"}]},
    }[layer]
    phrase["advance"] = {"hpBelow": 0, "answered": 3}
    emitters.append({"id": layer + "-guardian", "kind": "guardian", "x": gx, "y": gy, "hp": 120, "body": 0.24})
    encounters.append({"id": layer + "-guard", "kind": "guardian", "emitter": layer + "-guardian", "x": gx, "y": gy, "r": 4.0,
        "flag": layer + "-passed", "phrases": [phrase]})
    parts.append({"layer": layer, **at(27.5, c + 16), "guard": layer + "-guard"})
    # Having the instrument opens a bridge over the cliff to the next zone: round the field, never back the way you came.
    x, y = pol(26.5, c + 60)
    gates.append({"id": layer + "-shortcut", "shape": {"kind": "rect", "x": x, "y": y, "w": 3.0, "h": 6.5, "rot": c + 60},
        "requires": {"layer": layer}})

# The boss: the validation build's five phrases.
PADS = [(-230, 110, "drum"), (0, -170, "hat"), (230, 110, "bass")]
for x, y, layer in PADS:
    plates.append({"id": "pad-" + layer, "layer": layer, "x": x * PX, "y": y * PX, "r": 40 * PX, "encounter": "boss"})
def over_pad(step, i): return {"at": step, "attack": "zone", "anchor": "fixed", "x": PADS[i][0] * PX, "y": PADS[i][1] * PX}
emitters.append({"id": "boss", "kind": "boss", "x": 0, "y": 0, "hp": 900, "body": 0.3})
encounters.append({"id": "boss", "kind": "boss", "emitter": "boss", "x": 0, "y": 0, "r": 4.6, "flag": "boss-down", "phrases": [
    {"id": "gi-solo", "bars": 4, "events": circles([8, 16, 24]), "openBars": [2, 3], "advance": {"hpBelow": 0.85}},
    {"id": "seung-drum", "bars": 4, "events": sweep(0) + sweep(2), "openBars": [1, 3], "weakTo": "hat", "advance": {"hpBelow": 0.65}},
    {"id": "seung-hat", "bars": 2, "weakTo": "drum", "advance": {"hpBelow": 0.45}, "events": beams(4, [0, 180]) + beams(8, [90, 270])
        + beams(12, [0, 180]) + beams(20, [45, 135, 225, 315]) + beams(24, [0, 90, 180, 270]) + circles([28])},
    {"id": "jeon-resolve", "bars": 4, "shield": True, "advance": {"solved": True}, "events": [{"at": 8, "attack": "around"}, over_pad(16, 0),
        over_pad(32, 1), {"at": 40, "attack": "around"}, over_pad(48, 2)]},
    {"id": "gyeol-tutti", "bars": 4, "advance": {"hpBelow": 0}, "events": sweep(0) + beams(20, [0, 180]) + beams(24, [90, 270])
        + beams(28, [45, 135, 225, 315]) + circles([36, 40, 44], "circle-1")
        + [{"at": 48, "attack": "half", "anchor": "fixed", "x": -192 * PX, "y": 0}, {"at": 56, "attack": "half", "anchor": "fixed", "x": 192 * PX, "y": 0}]},
]})

stage = {"id": "stage-01", "name": "첫 스테이지", "meter": {"bpm": 110, "stepsPerBeat": 4, "beatsPerBar": 4}, "seed": 7, "lives": 3,
    "start": [0, 10.5], "map": {"ground": ground, "holes": holes}, "attacks": attacks, "emitters": emitters, "parts": parts,
    "plates": plates, "gates": gates, "checkpoints": checkpoints, "encounters": encounters}
out = os.path.join(os.path.dirname(__file__), "..", "data", "stages", "stage-01.json")
json.dump(stage, open(out, "w"), ensure_ascii=False, indent=1)
print(len(emitters), "emitters,", len(holes), "holes,", len(gates), "gates")
