class_name Sim
extends RefCounted
## The rules of a stage, with no drawing and no sound: it only needs to be told what time it is.
##
## One attack engine serves everything that attacks: devices on the path, monsters, guardians
## and the boss all schedule the same attack definitions, so what is learned on the way is
## literally what the boss uses.
##
## Lengths are pixels here. Stage data is written in U (the distance walked in one beat)
## and scaled on load.

const DASH_TIME := 0.16
const DASH_COOLDOWN := 0.25
## Invulnerability of a dash that was not on the beat: only the instant of the press.
const SHORT_IFRAME := 0.05
## Steps the player stays scattered after being hit or falling (two beats).
const REFORM_STEPS := 8
const SLICE := 1.0 / 120.0
const MAX_CATCH_UP := 0.25

const ATTACK_RANGE_U := {"drum": 0.6, "hat": 3.3, "bass": 1.8}
const ATTACK_DAMAGE := {"drum": 10.0, "hat": 3.0, "bass": 2.0}
const WEAK_MULT := 2.0
const OTHER_MULT := 0.5
const OPEN_MULT := 1.5
const CLOSED_MULT := 0.5

var meter := Meter.new()
var map := ShapeMap.new()
## Pixels per U. 1U is the distance walked in one beat, and also the length of a dash.
var u := 120.0
var dash_u := 1.0
var input_offset_ms := 0.0
var god := false

# ── the player ──
var pos := Vector2.ZERO
var face := Vector2.RIGHT
var max_lives := 3
var lives := 3
var owned: Array = []
var equipped := ""
## { t, dur, vel, just, step } while dashing, else empty.
var dash := {}
var iframe := 0.0
var cooldown := 0.0
## { from, until } while scattered, else empty.
var reform := {}
var checkpoint := Vector2.ZERO
var streak := 0
## Attacks cannot hurt before this step: one beat of grace after re-forming.
var grace_until := 0

# ── the stage ──
var attacks := {}
var emitters: Array = []
var parts: Array = []
var checkpoints: Array = []
var gates: Array = []
var encounters: Array = []
## Plates that light when the player stands on them for a bar holding the right instrument.
var plates: Array = []
var flags := {}
var active: Array = []
var pending: Array = []
var _save := {}

var time := 0.0
var step := -1
var started := false
## Things that happened since the last drain: the view and the sound read these.
var events: Array = []
## (layer, step) -> bool: is that layer of the song sounding on that step? Used by the bass attack.
var layer_sounding := Callable()

# ───────── time ─────────

func walk_speed() -> float:
	return u / meter.sec_per_beat()

## Advance to song time `t`. `input` is { move: Vector2, dash_at: float (song time of the press, or -1), switch: int }.
func step_to(t: float, input: Dictionary) -> void:
	var sps := meter.sec_per_step()
	if not started:
		started = true
		time = t
		step = floori(t / sps + 1e-9)
		checkpoint = pos
		_take_save()
		return
	# Presses count even if the clock has not moved since the last frame.
	var sw := int(input.get("switch", 0))
	if sw != 0:
		switch_instrument(sw)
	if float(input.get("dash_at", -1.0)) >= 0.0:
		_try_dash(input.get("move", Vector2.ZERO), float(input["dash_at"]))
	if t <= time:
		return
	var sim_from := maxf(time, t - MAX_CATCH_UP)
	while time < t - 1e-9:
		var next_step_t := (step + 1) * sps
		var tn := minf(t, minf(next_step_t, sim_from if time < sim_from else time + SLICE))
		if tn > sim_from:
			_advance(tn - maxf(time, sim_from), input.get("move", Vector2.ZERO))
		time = tn
		if time >= next_step_t - 1e-9:
			step += 1
			_on_step(step)

# ───────── the player ─────────

func is_ground(p: Vector2) -> bool:
	if map.is_ground(p):
		return true
	for g in gates:
		if g["open"] and ShapeMap.contains(g["shape"], p):
			return true
	return false

func switch_instrument(dir: int) -> void:
	if owned.is_empty() or equipped == "":
		return
	equipped = owned[posmod(owned.find(equipped) + dir, owned.size())]

## A dash always goes, and always the same distance. Its timing decides only how safe it is:
## on the beat ("just") it is invulnerable for its whole length; otherwise only for an instant,
## so the player has to actually leave the attack.
func _try_dash(move: Vector2, pressed_at: float) -> void:
	if not dash.is_empty() or cooldown > 0.0 or not reform.is_empty():
		return
	var j := meter.judge(pressed_at - input_offset_ms / 1000.0)
	# Off the beat there is no dash at all.
	if j["grade"] == "miss":
		cooldown = 0.08
		events.append({"type": "fizzle", "offset_ms": j["offset_ms"]})
		return
	var dir := move.normalized() if move.length() > 0.01 else face
	# Just exists only against an attack: the press is on the beat, and an attack lands on that beat where the player stands.
	# Pressed a moment early, the attack is still on its way; a moment late, its hit is waiting to be confirmed.
	var just := false
	if j["grade"] == "perfect" and grace_until <= int(j["step"]):
		var hs: int = j["step"]
		for p in pending:
			if p["hit_step"] == hs:
				just = true
		if step < hs:
			for a in active:
				var since: int = hs - int(a["hit_step"])
				if (since == 0 or (since > 0 and since <= int(a["hold"]) and since % meter.steps_per_beat == 0)) and hits(a, pos):
					just = true
	var from := pos
	dash = {"t": 0.0, "dur": DASH_TIME, "vel": dir * dash_u * u / DASH_TIME, "just": just, "step": j["step"]}
	iframe = maxf(iframe, SHORT_IFRAME)
	cooldown = DASH_COOLDOWN
	events.append({"type": "dash", "grade": j["grade"], "just": just, "offset_ms": j["offset_ms"], "from": from, "to": from + dir * dash_u * u})
	if just:
		pending = pending.filter(func(p): return p["hit_step"] != j["step"])
		_absorb()

func _advance(dt: float, move: Vector2) -> void:
	iframe = maxf(0.0, iframe - dt)
	cooldown = maxf(0.0, cooldown - dt)
	if reform.is_empty():
		if move.length() > 0.01:
			face = move.normalized()
		if not dash.is_empty():
			pos += dash["vel"] * minf(dt, dash["dur"] - dash["t"])
			dash["t"] += dt
			if dash["t"] >= dash["dur"] - 1e-9:
				dash = {}
		elif move.length() > 0.01:
			pos += face * walk_speed() * dt
		# No walls: stepping off the ground is a fall. A dash carries the player over gaps.
		if dash.is_empty() and not is_ground(pos):
			_hurt("fall")
			return
		for c in checkpoints:
			if pos.distance_to(c["pos"]) <= c["r"]:
				checkpoint = c["pos"]
		for part in parts:
			if not part["taken"] and pos.distance_to(part["pos"]) <= 0.35 * u and _guard_cleared(part):
				_take(part)
	for p in pending:
		if p["due"] <= time:
			_hurt("hit")
			break

func _guard_cleared(part: Dictionary) -> bool:
	var guard: String = part.get("guard", "")
	if guard == "":
		return true
	for e in encounters:
		if e["id"] == guard:
			return e["cleared"]
	return true

## Taking an instrument is the save point: lives come back and this moment is kept.
func _take(part: Dictionary) -> void:
	part["taken"] = true
	owned.append(part["layer"])
	if equipped == "":
		equipped = part["layer"]
	lives = max_lives
	checkpoint = part["pos"]
	_open_gates()
	_take_save()
	events.append({"type": "part", "layer": part["layer"], "pos": part["pos"]})

func _open_gates() -> void:
	for g in gates:
		if g["open"]:
			continue
		var req: Dictionary = g["requires"]
		var ok := true
		if req.has("parts") and owned.size() < int(req["parts"]):
			ok = false
		if req.has("flag") and not flags.get(req["flag"], false):
			ok = false
		if req.has("layer") and not owned.has(req["layer"]):
			ok = false
		for f in req.get("flags", []):
			if not flags.get(f, false):
				ok = false
		if ok:
			g["open"] = true
			events.append({"type": "gate", "id": g["id"]})

func _take_save() -> void:
	_save = {
		"pos": checkpoint, "owned": owned.duplicate(), "equipped": equipped, "flags": flags.duplicate(),
		"taken": parts.map(func(p): return p["taken"]),
		"gates": gates.map(func(g): return g["open"]),
		"emitters": emitters.map(func(e): return [e["hp"], e["broken"], e["pos"]]),
		"encounters": encounters.map(func(e): return [e["cleared"]]),
		"plates": plates.map(func(p): return p["lit"]),
	}

func _absorb() -> void:
	streak += 1
	events.append({"type": "absorb", "streak": streak})

## Lose a life and scatter. With lives left, re-form at the last checkpoint; with none, go back to the save.
func _hurt(kind: String) -> void:
	if god or not reform.is_empty():
		return
	var from := pos
	pending.clear()
	active = active.filter(func(a): return a["src_kind"] in ["device", "monster"])
	streak = 0
	dash = {}
	lives -= 1
	var over := lives <= 0
	if over:
		_restore_save()
	else:
		pos = checkpoint
	for e in encounters:
		if e["running"]:
			e["running"] = false          # the phrase starts over when the player walks back in
			e["streak_ok"] = false
			for pl in plates:
				if pl["encounter"] == e["id"]:
					pl["lit"] = false
					pl["count"] = 0
	reform = {"from": from, "until": step + REFORM_STEPS}
	events.append({"type": "gameover" if over else "hurt", "kind": kind, "from": from, "to": pos, "lives": lives})

func _restore_save() -> void:
	pos = _save["pos"]
	checkpoint = pos
	owned = (_save["owned"] as Array).duplicate()
	equipped = _save["equipped"]
	flags = (_save["flags"] as Dictionary).duplicate()
	lives = max_lives
	for i in parts.size():
		parts[i]["taken"] = _save["taken"][i]
	for i in gates.size():
		gates[i]["open"] = _save["gates"][i]
	for i in emitters.size():
		emitters[i]["hp"] = _save["emitters"][i][0]
		emitters[i]["broken"] = _save["emitters"][i][1]
		emitters[i]["pos"] = _save["emitters"][i][2]
	for i in encounters.size():
		var e: Dictionary = encounters[i]
		e["cleared"] = _save["encounters"][i][0]
		e["index"] = 0
		e["repeat"] = 0
		e["running"] = false
		if not e["cleared"]:
			e["emitter_ref"]["hp"] = e["emitter_ref"]["max_hp"]
	for i in plates.size():
		plates[i]["lit"] = _save["plates"][i] and plates[i]["encounter"] == ""
		plates[i]["count"] = 0
	active.clear()

# ───────── attacks ─────────

## Is point p inside an attack instance?
func hits(inst: Dictionary, p: Vector2) -> bool:
	var s: Dictionary = inst["def"]["shape"]
	var o: Vector2 = inst["origin"]
	match s["kind"]:
		"circle":
			return p.distance_to(o) <= s["r"]
		"ring":
			var d := p.distance_to(o)
			return d >= s["r0"] and d <= s["r1"]
		"beam":
			var q := (p - o).rotated(-inst["rot"])
			return q.x >= 0.0 and q.x <= s.get("len", 100000.0) and absf(q.y) <= s["w"] / 2.0
		"zone":
			var z := (p - o).rotated(-inst["rot"])
			return absf(z.x) <= s["w"] / 2.0 and absf(z.y) <= s["h"] / 2.0
	return false

func _spawn(em: Dictionary, ev: Dictionary, at_step: int) -> void:
	var def: Dictionary = attacks[ev["attack"]]
	var origin: Vector2 = em["pos"]
	# Nothing takes aim at a player who is not there.
	if String(ev.get("anchor", def.get("anchor", "self"))) == "target" and not reform.is_empty():
		return
	match String(ev.get("anchor", def.get("anchor", "self"))):
		"target":
			origin = pos
		"fixed":
			origin = em["pos"] + Vector2(ev.get("x", 0.0), ev.get("y", 0.0)) * u
	active.append({
		"def": def, "id": ev["attack"], "origin": origin, "rot": deg_to_rad(float(ev.get("rot", 0.0))),
		"start": at_step, "hit_step": at_step + int(def["tele"]), "hold": int(def.get("hold", 0)),
		"layer": def.get("layer", "lead"), "src": em["id"], "src_kind": em["kind"], "src_pos": em["pos"],
	})

## An attack lands. The player is safe if outside it, or inside a just dash.
## Otherwise the hit is confirmed a moment later, so a just dash pressed slightly late still answers it.
func _strike(inst: Dictionary, s: int) -> void:
	events.append({"type": "strike", "inst": inst, "step": s})
	if god or not reform.is_empty() or s < grace_until or not hits(inst, pos):
		return
	if not dash.is_empty() and dash["just"]:
		return                      # already answered when the dash was pressed
	if iframe > 0.0:
		return
	pending.append({"hit_step": s, "due": s * meter.sec_per_step() + (meter.perfect_ms + maxf(0.0, input_offset_ms)) / 1000.0 + 0.02})

func _schedule(em: Dictionary, events_list: Array, local: int, s: int) -> void:
	for ev in events_list:
		if int(ev["at"]) - int(attacks[ev["attack"]]["tele"]) == local:
			_spawn(em, ev, s)

func _on_step(s: int) -> void:
	if not reform.is_empty() and s >= int(reform["until"]):
		reform = {}
		grace_until = s + meter.steps_per_beat      # one beat to find your feet
	var spb := meter.steps_per_beat
	_step_encounters(s)
	for em in emitters:
		if em["broken"] or em["kind"] in ["guardian", "boss"]:
			continue
		# A device may follow a layer of the song instead of a pattern: it strikes on each beat that layer sounds.
		var follow: Dictionary = em.get("follow", {})
		if not follow.is_empty():
			var tele: int = int(attacks[follow["attack"]]["tele"])
			if posmod(s + tele, spb) == 0 and layer_sounding.is_valid() and layer_sounding.call(follow["layer"], s + tele):
				_spawn(em, {"attack": follow["attack"], "rot": em.get("rot", 0.0)}, s)
			continue
		# Some only act when the player is near (a monster does not shoot across the field).
		if em.has("range") and pos.distance_to(em["pos"]) > float(em["range"]) * u:
			continue
		var pat: Dictionary = em["pattern"]
		var total := int(pat["length"]) + int(pat.get("rest", 0))
		_schedule(em, pat["events"], posmod(s - int(em.get("phase", 0)), total), s)
		var motion: Dictionary = em.get("motion", {})
		# A monster is a device that moves: one step toward the player on its beat. It is an obstacle, not prey.
		if motion.get("kind", "") == "approach" and posmod(s, int(motion.get("every", spb))) == 0 and reform.is_empty():
			var d := pos - (em["pos"] as Vector2)
			var room := d.length() - float(motion.get("min", 1.0)) * u      # never closer than its minimum
			if room > 0.001 and d.length() < float(motion.get("sight", 8.0)) * u:
				em["pos"] += d.normalized() * minf(float(motion.get("by", 0.5)) * u, room)
	for inst in active:
		var since: int = s - int(inst["hit_step"])
		# A held attack strikes again on every beat while it lasts.
		if since == 0 or (since > 0 and since <= inst["hold"] and since % spb == 0):
			_strike(inst, s)
	active = active.filter(func(a): return s < int(a["hit_step"]) + int(a["hold"]))
	_step_plates()
	_auto_attack(s)

# ───────── plates ─────────

func _step_plates() -> void:
	for pl in plates:
		if pl["lit"]:
			continue
		var enc := _encounter_by_id(pl["encounter"])
		var live: bool = enc.is_empty() or enc["running"]
		if live and reform.is_empty() and equipped == pl["layer"] and pos.distance_to(pl["pos"]) <= pl["r"]:
			pl["count"] += 1
			if pl["count"] >= meter.steps_per_bar():
				pl["lit"] = true
				if pl["flag"] != "":
					flags[pl["flag"]] = true
					_open_gates()
				events.append({"type": "plate", "id": pl["id"], "layer": pl["layer"], "pos": pl["pos"]})
		else:
			pl["count"] = 0

func _encounter_by_id(id: String) -> Dictionary:
	for e in encounters:
		if e["id"] == id:
			return e
	return {}

func _solved(e: Dictionary) -> bool:
	for pl in plates:
		if pl["encounter"] == e["id"] and not pl["lit"]:
			return false
	return true

# ───────── guardians and the boss ─────────

func _step_encounters(s: int) -> void:
	var bar := meter.steps_per_bar()
	for e in encounters:
		if e["cleared"]:
			continue
		var inside: bool = reform.is_empty() and pos.distance_to(e["center"]) <= e["r"]
		if not e["running"]:
			if inside and posmod(s, bar) == 0:
				e["running"] = true
				e["phrase_start"] = s
				e["streak_ok"] = false
				streak = 0
				events.append({"type": "encounter", "id": e["id"], "phrase": e["phrases"][e["index"]]["id"]})
			else:
				continue
		var ph: Dictionary = e["phrases"][e["index"]]
		var em: Dictionary = e["emitter_ref"]
		var adv: Dictionary = ph.get("advance", {})
		if adv.has("answered") and streak >= int(adv["answered"]):
			e["streak_ok"] = true
		var last: bool = e["index"] == e["phrases"].size() - 1
		var met: bool = (adv.has("hpBelow") and em["hp"] <= float(adv["hpBelow"]) * em["max_hp"] + 1e-6) or (adv.has("answered") and e["streak_ok"]) or (adv.has("solved") and _solved(e))
		# The last phrase ends the moment its condition is met; earlier ones change on the phrase line.
		if last and met:
			_clear(e)
			continue
		if s - int(e["phrase_start"]) >= int(ph["bars"]) * bar:
			if met:
				e["index"] += 1
				e["repeat"] = 0
				e["streak_ok"] = false
			else:
				e["repeat"] += 1
			e["phrase_start"] = s
			ph = e["phrases"][e["index"]]
			events.append({"type": "phrase", "id": ph["id"], "repeat": e["repeat"], "advanced": met})
		_schedule(em, ph["events"], s - int(e["phrase_start"]), s)

func _clear(e: Dictionary) -> void:
	e["cleared"] = true
	e["running"] = false
	e["emitter_ref"]["broken"] = true
	active = active.filter(func(a): return a["src"] != e["emitter_ref"]["id"])
	if e.get("flag", "") != "":
		flags[e["flag"]] = true
	_open_gates()
	events.append({"type": "cleared", "id": e["id"], "kind": e["kind"]})

func _encounter_of(em: Dictionary) -> Dictionary:
	for e in encounters:
		if e["emitter_ref"] == em:
			return e
	return {}

# ───────── the player's attack ─────────

## Temporary: the equipped instrument attacks by itself, on its own rhythm, at whatever is nearest.
func _auto_attack(s: int) -> void:
	if equipped == "" or not reform.is_empty():
		return
	var spb := meter.steps_per_beat
	var fires := false
	match equipped:
		"drum": fires = posmod(s, spb) == 0
		"hat": fires = posmod(s, spb) == spb / 2
		"bass": fires = layer_sounding.is_valid() and layer_sounding.call("bass", s)
	if not fires:
		return
	var best := {}
	var best_d := INF
	for em in emitters:
		if em["broken"] or float(em["max_hp"]) <= 0.0:
			continue
		var enc := _encounter_of(em)
		if not enc.is_empty() and not enc["running"]:
			continue
		var d := pos.distance_to(em["pos"]) - float(em["body"])
		if d < best_d:
			best_d = d
			best = em
	if best.is_empty():
		return
	var reach: float = ATTACK_RANGE_U[equipped] * u
	var hit := best_d <= reach
	if hit:
		_damage(best, ATTACK_DAMAGE[equipped], s)
	events.append({"type": "attack", "layer": equipped, "from": pos, "to": best["pos"], "hit": hit})

func _damage(em: Dictionary, amount: float, s: int) -> void:
	var mult := 1.0
	var floor_hp := 0.0
	var enc := _encounter_of(em)
	if not enc.is_empty():
		var ph: Dictionary = enc["phrases"][enc["index"]]
		var weak: String = ph.get("weakTo", "")
		if weak != "":
			mult = WEAK_MULT if weak == equipped else OTHER_MULT
		var open: Array = ph.get("openBars", [])
		if not open.is_empty():
			mult *= OPEN_MULT if open.has((s - int(enc["phrase_start"])) / meter.steps_per_bar()) else CLOSED_MULT
		if ph.get("shield", false) and not _solved(enc):
			mult = 0.0
		# Health cannot drop past the gate of the current phrase.
		floor_hp = float(ph.get("advance", {}).get("hpBelow", 0.0)) * em["max_hp"]
	elif em.get("weakTo", "") != "":
		mult = WEAK_MULT if em["weakTo"] == equipped else OTHER_MULT
	em["hp"] = maxf(floor_hp, em["hp"] - amount * mult)
	if em["hp"] <= 0.0 and enc.is_empty():
		em["broken"] = true
		active = active.filter(func(a): return a["src"] != em["id"])
		if em.get("onBreak", "") != "":
			flags[em["onBreak"]] = true
			_open_gates()
		events.append({"type": "broken", "id": em["id"], "pos": em["pos"]})

# ───────── loading ─────────

## Build a stage from data written in U.
static func from_stage(d: Dictionary) -> Sim:
	var s := Sim.new()
	s.meter = Meter.from_dict(d.get("meter", {}))
	s.u = float(d.get("walkPxPerSec", 220.0)) * s.meter.sec_per_beat()
	s.dash_u = float(d.get("dashU", 1.0))
	s.max_lives = int(d.get("lives", 3))
	s.lives = s.max_lives
	var k := s.u
	for g in d["map"].get("ground", []):
		s.map.ground.append(ShapeMap.scaled(g, k))
	for h in d["map"].get("holes", []):
		s.map.holes.append(ShapeMap.scaled(h, k))
	s.pos = Vector2(d["start"][0], d["start"][1]) * k
	for id in d.get("attacks", {}):
		var a: Dictionary = (d["attacks"][id] as Dictionary).duplicate(true)
		var sh: Dictionary = a["shape"]
		for key in sh:
			if key != "kind":
				sh[key] = float(sh[key]) * k
		s.attacks[id] = a
	for c in d.get("checkpoints", []):
		s.checkpoints.append({"pos": Vector2(c["x"], c["y"]) * k, "r": float(c.get("r", 0.8)) * k})
	for e in d.get("emitters", []):
		var em: Dictionary = (e as Dictionary).duplicate(true)
		em["pos"] = Vector2(e["x"], e["y"]) * k
		em["max_hp"] = float(e.get("hp", 0.0))
		em["hp"] = em["max_hp"]
		em["broken"] = false
		em["body"] = float(e.get("body", 0.25)) * k
		em["pattern"] = e.get("pattern", {"length": 16, "events": []})
		s.emitters.append(em)
	for p in d.get("parts", []):
		s.parts.append({"layer": p["layer"], "pos": Vector2(p["x"], p["y"]) * k, "guard": p.get("guard", ""), "taken": false})
	for pl in d.get("plates", []):
		s.plates.append({"id": pl["id"], "layer": pl["layer"], "pos": Vector2(pl["x"], pl["y"]) * k, "r": float(pl.get("r", 0.33)) * k,
			"flag": pl.get("flag", ""), "encounter": pl.get("encounter", ""), "lit": false, "count": 0})
	for g in d.get("gates", []):
		s.gates.append({"id": g["id"], "shape": ShapeMap.scaled(g["shape"], k), "requires": g.get("requires", {}), "open": false})
	for e in d.get("encounters", []):
		var ref := {}
		for em in s.emitters:
			if em["id"] == e["emitter"]:
				ref = em
		s.encounters.append({
			"id": e["id"], "kind": e.get("kind", "guardian"), "emitter_ref": ref,
			"center": Vector2(e["x"], e["y"]) * k, "r": float(e["r"]) * k, "phrases": e["phrases"], "flag": e.get("flag", ""),
			"index": 0, "repeat": 0, "phrase_start": 0, "running": false, "cleared": false, "streak_ok": false,
		})
	s._open_gates()
	s.events.clear()
	return s
