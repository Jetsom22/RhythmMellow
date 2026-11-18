extends RefCounted
## Checks for the stage rules (Sim). Run through tools/run_tests.gd.

const BEAT := 60.0 / 110.0
const STEP := BEAT / 4.0
var t: Object

func stage(extra: Dictionary = {}) -> Dictionary:
	var d := {
		"meter": {"bpm": 110}, "lives": 3, "start": [0, 0],
		"map": {"ground": [{"kind": "circle", "x": 0, "y": 0, "r": 10}], "holes": [{"kind": "rect", "x": 5, "y": 0, "w": 0.7, "h": 6}]},
		"attacks": {
			"big": {"shape": {"kind": "circle", "r": 3}, "tele": 4, "anchor": "self", "layer": "drum"},
			"ring": {"shape": {"kind": "ring", "r0": 1.0, "r1": 1.9}, "tele": 4, "anchor": "self", "layer": "drum"},
			"zone": {"shape": {"kind": "zone", "w": 2, "h": 2}, "tele": 4, "hold": 8, "anchor": "self", "layer": "bass"},
		},
	}
	d.merge(extra, true)
	return d

## A sim already started at bar 2 (step 32), so every test begins on a bar line.
func make(extra: Dictionary = {}) -> Sim:
	var s := Sim.from_stage(stage(extra))
	s.step_to(32 * STEP, {})
	s.events.clear()
	return s

func run(s: Sim, until: float, input: Dictionary = {}) -> Array:
	var out: Array = []
	var first := true
	while s.time < until - 1e-9:
		var frame := {"move": input.get("move", Vector2.ZERO)}
		if first and input.has("dash_at"):
			frame["dash_at"] = input["dash_at"]
		first = false
		s.step_to(minf(until, s.time + 1.0 / 60.0), frame)
		out.append_array(s.events)
		s.events.clear()
	return out

func of(events: Array, type: String) -> Array:
	return events.filter(func(e): return e["type"] == type)

func run_all(tests: Object) -> void:
	t = tests
	var device := func(attack: String, at: int = 8) -> Dictionary:
		return {"emitters": [{"id": "dev", "kind": "device", "x": 0, "y": 0, "pattern": {"length": 16, "rest": 16, "events": [{"at": at, "attack": attack}]}}]}

	# ── the ground ──
	var m := ShapeMap.new()
	m.ground = [{"kind": "circle", "x": 0.0, "y": 0.0, "r": 100.0}, {"kind": "capsule", "x1": 100.0, "y1": 0.0, "x2": 300.0, "y2": 0.0, "r": 20.0},
		{"kind": "sector", "x": 0.0, "y": 0.0, "r0": 200.0, "r1": 300.0, "a0": 80.0, "a1": 100.0}, {"kind": "rect", "x": 0.0, "y": -300.0, "w": 100.0, "h": 40.0, "rot": 45.0}]
	m.holes = [{"kind": "circle", "x": 0.0, "y": 0.0, "r": 20.0}]
	t.check("ground: inside a circle", m.is_ground(Vector2(50, 0)))
	t.check("ground: a hole is not ground", not m.is_ground(Vector2(5, 5)))
	t.check("ground: along a capsule", m.is_ground(Vector2(250, 15)) and not m.is_ground(Vector2(250, 25)))
	t.check("ground: a ring slice", m.is_ground(Vector2(0, 250)) and not m.is_ground(Vector2(-250, 0)) and not m.is_ground(Vector2(0, 150)))
	t.check("ground: a turned rectangle", m.is_ground(Vector2(30, -270)) and not m.is_ground(Vector2(45, -315)))
	t.check("ground: nothing out in the open", not m.is_ground(Vector2(900, 900)))

	# ── walking and dashing ──
	var s := make()
	t.check("1U is the distance walked in one beat: 120 px at 110 bpm", t.near(s.u, 120.0, 0.001), str(s.u))
	run(s, s.time + BEAT, {"move": Vector2.RIGHT})
	t.check("one beat of walking covers 1U", t.near(s.pos.x, 120.0, 1.0), str(s.pos))
	s = make()
	var fizz := run(s, s.time + 0.3, {"dash_at": s.time + 0.2})
	t.check("off the beat, the dash does not happen", of(fizz, "dash").is_empty() and of(fizz, "fizzle").size() == 1 and s.pos == Vector2.ZERO)
	for case in [["on the beat", 0.0], ["a little off the beat", 0.09]]:
		s = make()
		var x0 := s.pos.x
		var ev := run(s, s.time + 0.3, {"dash_at": s.time + case[1]})
		t.check("a dash %s travels exactly 1U" % case[0], t.near(s.pos.x - x0, 120.0, 0.5), str(s.pos.x - x0))
	s = make()
	var empty := run(s, s.time + 0.3, {"dash_at": s.time})
	t.check("with no attack there is no just, however well timed the dash", not of(empty, "dash")[0]["just"] and of(empty, "absorb").is_empty() and not s.dash.get("just", false))
	s = make()
	s.pos = Vector2(4.5 * 120.0, 0)
	var crossing := run(s, s.time + 0.3, {"dash_at": s.time + 0.09})
	t.check("a dash carries the player over a gap, just or not", of(crossing, "hurt").is_empty() and s.pos.x > 5.35 * 120.0, str(s.pos))
	s = make()
	s.pos = Vector2(4.5 * 120.0, 0)
	var fall := run(s, s.time + 0.5, {"move": Vector2.RIGHT})
	t.check("walking off the ground is a fall and costs a life", of(fall, "hurt").size() == 1 and of(fall, "hurt")[0]["kind"] == "fall" and s.lives == 2)
	t.check("after a fall the player re-forms at the checkpoint", s.pos == Vector2.ZERO and not s.reform.is_empty())
	var until: int = s.reform["until"]
	run(s, (until - 1) * STEP, {"move": Vector2.RIGHT, "dash_at": s.time})
	t.check("scattered for two beats: no moving, no dashing", s.pos == Vector2.ZERO and s.reform["until"] - (s.step - (s.step - 0)) > 0 and s.dash.is_empty())
	run(s, (until + 2) * STEP, {"move": Vector2.RIGHT})
	t.check("then the player moves again", s.reform.is_empty() and s.pos.x > 10.0, str(s.pos))

	# ── attacks ──
	s = make(device.call("big"))
	var hit := run(s, (32 + 8) * STEP + 0.3)
	t.check("standing in an attack when it lands costs a life", of(hit, "hurt").size() == 1 and s.lives == 2)
	t.check("the attack is announced one beat ahead", of(hit, "strike")[0]["step"] == 40 and of(hit, "strike")[0]["inst"]["start"] == 36)
	s = make(device.call("big"))
	run(s, 40 * STEP - 0.03)
	var just := run(s, 40 * STEP + 0.4, {"dash_at": 40 * STEP - 0.02})
	t.check("on the beat, inside the attack: that is a just", of(just, "dash")[0]["just"])
	t.check("a just dash is invulnerable for its whole length", of(just, "hurt").is_empty() and of(just, "absorb").size() == 1 and s.lives == 3)
	s = make(device.call("big"))
	run(s, 40 * STEP - 0.2)
	var late := run(s, 40 * STEP + 0.4, {"dash_at": 40 * STEP - 0.19})
	t.check("pressing off the beat does nothing: still inside, still hit", of(late, "hurt").size() == 1 and of(late, "dash").is_empty())
	s = make(device.call("ring"))
	s.pos = Vector2(1.5 * 120.0, 0)
	run(s, 40 * STEP - 0.11)
	var out := run(s, 40 * STEP + 0.4, {"dash_at": 40 * STEP - 0.10, "move": Vector2.RIGHT})
	t.check("a dash that is close but not just is still safe if it carries the player out of the attack", of(out, "hurt").is_empty() and of(out, "absorb").is_empty(), str(s.pos))
	s = make(device.call("big"))
	run(s, 40 * STEP + 0.03)
	var after := run(s, 40 * STEP + 0.4, {"dash_at": 40 * STEP + 0.04})
	t.check("a just dash pressed a moment late still answers the hit", of(after, "hurt").is_empty() and of(after, "absorb").size() == 1)
	s = make(device.call("zone"))
	s.god = true
	var held := run(s, 56 * STEP)
	t.check("a held attack strikes on every beat while it lasts", of(held, "strike").map(func(e): return e["step"]) == [40, 44, 48], str(of(held, "strike").map(func(e): return e["step"])))
	s = make(device.call("big"))
	s.pos = Vector2(4 * 120.0, 0)
	t.check("outside the attack nothing happens", of(run(s, 44 * STEP), "hurt").is_empty())

	# ── a monster ──
	s = make({"emitters": [{"id": "mon", "kind": "monster", "x": 3, "y": 0, "motion": {"kind": "approach", "every": 4, "by": 0.5, "min": 1.0}, "pattern": {"length": 16, "events": []}}]})
	run(s, 36 * STEP + 0.01)
	t.check("a monster steps toward the player on the beat", t.near(s.emitters[0]["pos"].x, 2.5 * 120.0, 0.5), str(s.emitters[0]["pos"]))
	run(s, 60 * STEP)
	t.check("and stops short of the player", s.emitters[0]["pos"].x >= 1.0 * 120.0 - 0.5, str(s.emitters[0]["pos"]))

	# ── lives and saving ──
	var with_part := {"parts": [{"layer": "drum", "x": 2, "y": 0}], "checkpoints": [{"x": -2, "y": 0, "r": 0.5}]}
	s = make(with_part)
	s.lives = 1
	var got := run(s, s.time + 2.2 * BEAT, {"move": Vector2.RIGHT})
	t.check("taking an instrument restores every life", of(got, "part").size() == 1 and s.lives == 3 and s.owned == ["drum"] and s.equipped == "drum")
	s.pos = Vector2(4.6 * 120.0, 0)
	var e1 := run(s, s.time + 1.0, {"move": Vector2.RIGHT})
	t.check("with lives left, a fall returns to the last checkpoint", of(e1, "hurt").size() == 1 and t.near(s.pos.x, 2 * 120.0, 0.5) and s.lives == 2)
	s.lives = 1
	s.reform = {}
	s.pos = Vector2(4.6 * 120.0, 0)
	var e2 := run(s, s.time + 1.0, {"move": Vector2.RIGHT})
	t.check("with no lives left, the stage returns to the save: the instrument is kept and lives are full", of(e2, "gameover").size() == 1 and s.owned == ["drum"] and s.lives == 3 and t.near(s.pos.x, 2 * 120.0, 0.5))
	s = make(with_part)
	s.lives = 1
	s.pos = Vector2(4.6 * 120.0, 0)
	run(s, s.time + 1.0, {"move": Vector2.RIGHT})
	t.check("before any instrument, the save is the start", s.pos == Vector2.ZERO and s.owned.is_empty() and s.lives == 3)

	# ── a guardian ──
	var guarded := {
		"parts": [{"layer": "hat", "x": 0, "y": 2, "guard": "g"}],
		"emitters": [{"id": "gem", "kind": "guardian", "x": 0, "y": 0, "hp": 30, "body": 0.3}],
		"encounters": [{"id": "g", "kind": "guardian", "emitter": "gem", "x": 0, "y": 0, "r": 4, "flag": "g-done",
			"phrases": [{"id": "p", "bars": 1, "events": [{"at": 4, "attack": "big"}, {"at": 8, "attack": "big"}, {"at": 12, "attack": "big"}], "advance": {"hpBelow": 0, "answered": 3}}]}],
		"gates": [{"id": "bridge", "shape": {"kind": "rect", "x": 12, "y": 0, "w": 4, "h": 1}, "requires": {"flag": "g-done"}}],
	}
	s = make(guarded)
	s.pos = Vector2(0, 2 * 120.0)
	run(s, s.time + 0.2)
	t.check("a guarded instrument cannot be taken yet", s.owned.is_empty())
	t.check("a closed gate is not ground", not s.is_ground(Vector2(12 * 120.0, 0)))
	s = make(guarded)
	s.pos = Vector2(1.2 * 120.0, 0)
	var ev_g: Array = []
	for k in 3:
		var beat_t := (48 + 4 + 4 * k) * STEP          # the encounter starts on the next bar line (step 48)
		ev_g.append_array(run(s, beat_t - 0.03))
		ev_g.append_array(run(s, beat_t + 0.3, {"dash_at": beat_t - 0.02, "move": Vector2.LEFT if k % 2 == 0 else Vector2.RIGHT}))
	t.check("the fight begins on a bar line", of(ev_g, "encounter").size() == 1)
	t.check("three just dashes in a row pass a guardian without any instrument", of(ev_g, "cleared").size() == 1 and of(ev_g, "hurt").is_empty(), "absorbs %d" % of(ev_g, "absorb").size())
	t.check("passing it sets its flag and opens the gate", s.flags.get("g-done", false) and s.is_ground(Vector2(12 * 120.0, 0)))
	s = make(guarded)
	s.god = true
	s.owned = ["drum"]
	s.equipped = "drum"
	s.pos = Vector2(0.7 * 120.0, 0)
	var fight := run(s, 90 * STEP)
	t.check("with an instrument, a guardian can also be beaten", of(fight, "cleared").size() == 1 and of(fight, "attack").size() >= 3)
	s = make(guarded)
	s.god = true
	s.pos = Vector2(1.2 * 120.0, 0)
	var stall := of(run(s, 100 * STEP), "phrase")
	t.check("an unmet phrase repeats, counting up", stall.size() >= 2 and stall[0]["repeat"] == 1 and stall[1]["repeat"] == 2 and not stall[0]["advanced"], str(stall))
	s = make(guarded)
	s.pos = Vector2(1.2 * 120.0, 0)
	run(s, 52 * STEP + 0.4)
	t.check("being hit in a fight sends the player to the checkpoint and stops the phrase", s.lives == 2 and not s.encounters[0]["running"])

	# ── the player's attack ──
	s = make(device.call("big"))
	t.check("no instrument, no attack", of(run(s, 48 * STEP), "attack").is_empty())
	s = make({"emitters": [{"id": "pot", "kind": "device", "x": 0.6, "y": 0, "hp": 20, "body": 0.2, "onBreak": "pot", "pattern": {"length": 16, "events": []}}],
		"gates": [{"id": "b", "shape": {"kind": "rect", "x": 12, "y": 0, "w": 4, "h": 1}, "requires": {"flag": "pot"}}]})
	s.owned = ["drum"]
	s.equipped = "drum"
	var smash := run(s, 44 * STEP)
	t.check("the drum attacks on every beat and breaks a breakable device", of(smash, "broken").size() == 1 and s.emitters[0]["broken"], str(of(smash, "attack").size()))
	t.check("breaking it can open a gate", s.is_ground(Vector2(12 * 120.0, 0)))
	s = make({"gates": [{"id": "b", "shape": {"kind": "rect", "x": 12, "y": 0, "w": 4, "h": 1}, "requires": {"parts": 1}}], "parts": [{"layer": "bass", "x": 1, "y": 0}]})
	run(s, s.time + 1.2 * BEAT, {"move": Vector2.RIGHT})
	t.check("a gate can open on the number of instruments held", s.is_ground(Vector2(12 * 120.0, 0)))

	# ── plates and devices that follow the song ──
	var plated := {"plates": [{"id": "pd", "layer": "drum", "x": 1, "y": 0, "flag": "pd"}],
		"gates": [{"id": "b", "shape": {"kind": "rect", "x": 12, "y": 0, "w": 4, "h": 1}, "requires": {"flags": ["pd"]}}]}
	s = make(plated)
	s.pos = Vector2(120, 0)
	run(s, s.time + 5 * BEAT)
	t.check("a plate stays dark without its instrument", not s.plates[0]["lit"])
	s.owned = ["drum", "hat"]
	s.equipped = "hat"
	run(s, s.time + 5 * BEAT)
	t.check("or with the wrong instrument in hand", not s.plates[0]["lit"])
	s.equipped = "drum"
	run(s, s.time + 3 * BEAT)
	t.check("it needs a whole bar", not s.plates[0]["lit"])
	var lit := run(s, s.time + 1.5 * BEAT)
	t.check("standing on it for a bar with the right instrument lights it and opens what waits for it", of(lit, "plate").size() == 1 and s.is_ground(Vector2(12 * 120.0, 0)))
	s = make({"emitters": [{"id": "dike", "kind": "device", "x": 0, "y": 0, "follow": {"layer": "bass", "attack": "big"}}]})
	s.god = true
	s.layer_sounding = func(_layer: String, st: int) -> bool: return posmod(st, 16) < 8
	var tide := of(run(s, 64 * STEP + 0.01), "strike").map(func(e): return e["step"])
	t.check("a device can follow a layer of the song: it strikes on the beats that layer sounds", tide == [48, 52, 64], str(tide))
	var boss := {"plates": [{"id": "bp", "layer": "drum", "x": 1, "y": 0, "encounter": "boss"}],
		"emitters": [{"id": "b", "kind": "boss", "x": 0, "y": 0, "hp": 100, "body": 0.3}],
		"encounters": [{"id": "boss", "kind": "boss", "emitter": "b", "x": 0, "y": 0, "r": 4, "phrases": [
			{"id": "jeon", "bars": 1, "events": [], "shield": true, "advance": {"solved": true}},
			{"id": "gyeol", "bars": 1, "events": [], "advance": {"hpBelow": 0}}]}]}
	s = make(boss)
	s.owned = ["drum"]
	s.equipped = "drum"
	s.pos = Vector2(0.5 * 120.0, 0)
	run(s, 64 * STEP)
	t.check("a shielded phrase takes no damage until its plates are lit", s.emitters[0]["hp"] == 100.0 and s.encounters[0]["index"] == 0)
	s.pos = Vector2(120, 0)
	var solved := run(s, 100 * STEP)
	t.check("lighting the plates moves the fight on", s.plates[0]["lit"] and of(solved, "phrase").any(func(e): return e["id"] == "gyeol" and e["advanced"]))

	# ── the first stage, as data ──
	var data: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://data/stages/stage-01.json"))
	s = Sim.from_stage(data)
	var off: Array = []
	if not s.is_ground(s.pos): off.append("start")
	for c in s.checkpoints:
		if not s.is_ground(c["pos"]): off.append("checkpoint %s" % (c["pos"] / s.u))
	for part in s.parts:
		if not s.is_ground(part["pos"]): off.append("part " + part["layer"])
	for pl in s.plates:
		if not s.is_ground(pl["pos"]): off.append("plate " + pl["id"])
	for em in s.emitters:
		if not em.get("hidden", false) and not s.is_ground(em["pos"]): off.append("emitter " + em["id"])
	for e in s.encounters:
		for ph in e["phrases"]:
			for ev in ph["events"]:
				if not s.attacks.has(ev["attack"]) or not s.meter.is_strike_step(int(ev["at"])): off.append("%s %s@%d" % [ph["id"], ev["attack"], ev["at"]])
	for em in s.emitters:
		for ev in em["pattern"]["events"]:
			if not s.attacks.has(ev["attack"]) or not s.meter.is_strike_step(int(ev["at"])): off.append("%s %s@%d" % [em["id"], ev["attack"], ev["at"]])
	t.check("stage 1: everything stands on ground and every attack lands on a beat", off.is_empty(), str(off))
	t.check("stage 1: the boss stage is cut off until the three plates are lit", not s.is_ground(Vector2(0, 5.8) * s.u) and s.is_ground(Vector2.ZERO))
	for f in ["plate-drum", "plate-hat", "plate-bass"]:
		s.flags[f] = true
	s._open_gates()
	t.check("stage 1: then the bridge is there", s.is_ground(Vector2(0, 5.8) * s.u))
	t.check("stage 1: zones are cut apart by cliff until an instrument opens the way round", not s.is_ground(Vector2.from_angle(deg_to_rad(210)) * 26.5 * s.u))
	s.owned = ["drum"]
	s._open_gates()
	t.check("stage 1: holding the drum bridges drum to hat", s.is_ground(Vector2.from_angle(deg_to_rad(210)) * 26.5 * s.u))
	# Flood from the start over walkable ground (with every way open): can each instrument, plate and the boss be reached?
	s.owned = ["drum", "hat", "bass"]
	s._open_gates()
	var cell := 0.5 * s.u
	var seen := {Vector2i((s.pos / cell).round()): true}
	var todo: Array = seen.keys()
	while not todo.is_empty():
		var c: Vector2i = todo.pop_back()
		for dxy in [Vector2i(1, 0), Vector2i(-1, 0), Vector2i(0, 1), Vector2i(0, -1)]:
			var n: Vector2i = c + dxy
			if not seen.has(n) and s.is_ground(Vector2(n) * cell):
				seen[n] = true
				todo.append(n)
	var lost: Array = []
	for part in s.parts:
		if not seen.has(Vector2i((part["pos"] / cell).round())): lost.append(part["layer"])
	for pl in s.plates:
		if not seen.has(Vector2i((pl["pos"] / cell).round())): lost.append(pl["id"])
	t.check("stage 1: every instrument, every plate and the boss can be walked to", lost.is_empty() and seen.has(Vector2i.ZERO), str(lost))

	# ── no death loops ──
	s = make({"emitters": [{"id": "mon", "kind": "monster", "x": 2, "y": 0, "pattern": {"length": 8, "events": [{"at": 4, "attack": "aim"}]}}],
		"attacks": {"aim": {"shape": {"kind": "circle", "r": 0.6}, "tele": 4, "anchor": "target", "layer": "lead"}}})
	var loop := run(s, 32 * STEP + 8 * BEAT)
	t.check("standing still under a monster costs one life per re-forming, never a chain", of(loop, "hurt").size() <= 3 and of(loop, "gameover").is_empty(), str(of(loop, "hurt").size()))
	var first_hurt: int = -1
	var aimed_while_gone := false
	s = make({"emitters": [{"id": "mon", "kind": "monster", "x": 2, "y": 0, "pattern": {"length": 8, "events": [{"at": 4, "attack": "aim"}]}}],
		"attacks": {"aim": {"shape": {"kind": "circle", "r": 0.6}, "tele": 4, "anchor": "target", "layer": "lead"}}})
	while s.time < 32 * STEP + 6 * BEAT:
		s.step_to(s.time + 1.0 / 60.0, {})
		if not s.reform.is_empty():
			for a in s.active:
				if int(a["start"]) > int(s.reform["until"]) - Sim.REFORM_STEPS:
					aimed_while_gone = true
	t.check("nothing takes aim while the player is scattered", not aimed_while_gone)

	s = make(device.call("big"))
	s.pos = Vector2(4 * 120.0, 0)
	run(s, 40 * STEP - 0.03)
	var beside := run(s, 40 * STEP + 0.3, {"dash_at": 40 * STEP - 0.02})
	t.check("on the beat but outside the attack is not a just", not of(beside, "dash")[0]["just"] and of(beside, "absorb").is_empty())

	# ── the two judgements are separate ──
	s = make(device.call("big"))
	run(s, 40 * STEP - 0.11)
	var early := run(s, 40 * STEP + 0.4, {"dash_at": 40 * STEP - 0.10})
	t.check("inside the dash time but outside the just time: the dash happens, it is not a just, and standing in the attack still hurts",
		of(early, "dash").size() == 1 and not of(early, "dash")[0]["just"] and of(early, "absorb").is_empty())
	var m2 := Meter.from_dict({"bpm": 110, "dashMs": 80, "justMs": 30})
	t.check("both times come from the stage data", m2.dash_ms == 80.0 and m2.just_ms == 30.0 and m2.judge(0.07)["dash"] and not m2.judge(0.09)["dash"])
