extends Node2D
## The stage, drawn and heard. All rules live in Sim; this reads the keys, tells Sim the song time,
## and turns what happened into pictures and sound.

## Palettes are swapped per chapter or stage group; the structure never changes (src/render/theme.ts).
const PALETTES := {
	"rust": ["f1e9d8", "232524", "c4291c", ["c4291c", "e0662a", "8a1f33"], ["2f6470", "6f9a8f", "3d4a6b"]],
	"mid": ["efe3c2", "0d0d12", "d63a24", ["d63a24", "ea7a3c", "9c2740"], ["2c6a66", "7fb3a6", "35507a"]],
	"navy": ["12303f", "f3ede0", "ff4b5c", ["ff4b5c", "ff8a4a", "c93a7a"], ["4fd1c5", "b5f0e0", "5aa9ff"]],
	"ochre": ["ead7ad", "1a1a1a", "b3261e", ["b3261e", "d05a1e", "6e1622"], ["1f4d4d", "5e8a7a", "2b3552"]],
}
## How an attack's echo spreads, by the layer it rides on. Lengths are in beats and pixels.
const ECHO := {
	"hat": {"dist": 16.0, "lines": 1, "life": 0.6, "alpha": 0.8, "w": 1.2, "gap": 0.15},
	"drum": {"dist": 95.0, "lines": 2, "life": 1.3, "alpha": 0.7, "w": 1.3, "gap": 0.2},
	"lead": {"dist": 70.0, "lines": 2, "life": 1.1, "alpha": 0.7, "w": 1.3, "gap": 0.2},
	"pad": {"dist": 70.0, "lines": 2, "life": 1.1, "alpha": 0.7, "w": 1.3, "gap": 0.2},
	"bass": {"dist": 0.0, "lines": 0, "life": 3.4, "alpha": 0.17, "w": 0.0, "gap": 0.0},
}
const PLAYER_R := 10.0
var PAL := {}
const LAYERS: Array[String] = ["tick", "drum", "hat", "bass", "lead", "pad"]
const EDGE_STEP := 12.0
const CELL := 480.0

var stage := {}
var sim: Sim
var song: Song
var mixer: LayerMixer
var state := "idle"            # idle -> baking -> playing
var bake_queue: Array[String] = []
var bass_on := {}
var edges := {}                # cell -> [[point, inward normal]]
var pfx: Array = []            # the player's effects: { kind, at (step), ... }
var echoes: Array = []         # what an attack leaves behind: { inst, at, fronts }
var flashes: Array = []        # the hit itself: { inst, at }
var bass_line := {"until": -1.0, "to": Vector2.ZERO}
var grains: Array = []
var cam := Vector2.ZERO
var zoom := 1.0
var runs: Array = []           # the edge as long lines: [bounding box, points]
var _boxes: Array = []         # [rect, shape, is_hole] for a quick "is this ground"
var _buckets := {}
var _ground_cache := {}
var dash_at := -1.0
var switch_dir := 0
var params := {}
var _push := 0.0

func _ready() -> void:
	if OS.has_feature("web"):
		var q := str(JavaScriptBridge.eval("location.search.slice(1)", true))
		for pair in q.split("&", false):
			var kv := pair.split("=")
			params[kv[0]] = kv[1].uri_decode() if kv.size() > 1 else "1"
	else:
		for a in OS.get_cmdline_user_args():
			var kv := a.trim_prefix("--").split("=")
			params[kv[0]] = kv[1] if kv.size() > 1 else "1"
	var pal: Array = PALETTES.get(params.get("palette", ""), PALETTES["rust"])
	PAL = {"bg": Color(pal[0]), "ink": Color(pal[1]), "danger": Color(pal[2]),
		"enemy": {"drum": Color(pal[3][0]), "hat": Color(pal[3][1]), "bass": Color(pal[3][2]), "lead": Color(pal[3][0]), "pad": Color(pal[3][0])},
		"player": {"drum": Color(pal[4][0]), "hat": Color(pal[4][1]), "bass": Color(pal[4][2])}}
	var id: String = params.get("stage", "stage-01")
	stage = JSON.parse_string(FileAccess.get_file_as_string("res://data/stages/%s.json" % id))
	sim = Sim.from_stage(stage)
	Beat.set_meter(stage.get("meter", {}))
	song = Song.generate(int(params.get("seed", stage.get("seed", 7))), 2)
	for n in song.layers["bass"]:
		for i in int(n["len"]):
			bass_on[posmod(int(n["step"]) + i, song.loop_steps)] = true
	sim.layer_sounding = func(layer: String, s: int) -> bool: return layer == "bass" and bass_on.has(posmod(s, song.loop_steps))
	# Workbench: start anywhere, holding anything.  ?at=x,y (U)  ?parts=drum,hat  ?god=1
	if params.has("at"):
		var xy: PackedStringArray = str(params["at"]).split(",")
		sim.pos = Vector2(float(xy[0]), float(xy[1])) * sim.u
	for p in str(params.get("parts", "")).split(",", false):
		if not sim.owned.has(p):
			sim.owned.append(p)
			sim.equipped = sim.owned[0]
			for part in sim.parts:
				if part["layer"] == p:
					part["taken"] = true
	sim._open_gates()
	sim.events.clear()
	sim.god = params.has("god")
	cam = sim.pos
	mixer = LayerMixer.new()
	add_child(mixer)
	_build_edges()
	# The grains the player breaks into. Fixed, so the scatter looks the same every time (same numbers as the web build).
	var seed_v := [7]            # in a box: a lambda keeps its own copy of a plain number
	var rnd := func() -> float:
		seed_v[0] = (seed_v[0] * 16807) % 2147483647
		return seed_v[0] / 2147483647.0
	for i in 130:
		var r := 8.0 * sqrt((i + 0.5) / 130.0)
		var a := i * 2.39996
		var dir: float = a + (rnd.call() - 0.5) * 1.1
		var g := {"o": Vector2(r * cos(a), r * sin(a)), "d": Vector2(cos(dir), sin(dir))}
		g["far"] = 18.0 + rnd.call() * 62.0 + r * 3.0
		g["size"] = 0.8 + rnd.call() * 1.5
		g["lag"] = rnd.call() * 0.35
		g["spin"] = (rnd.call() - 0.5) * 2.2
		g["drift"] = rnd.call() * TAU
		g["tw"] = rnd.call() < 0.36
		g["sub"] = 2 if rnd.call() < 0.5 else 4
		g["slot"] = int(floor(rnd.call() * 4.0))
		g["amp"] = 0.9 + rnd.call() * 1.5
		grains.append(g)

# ───────── input ─────────

func _unhandled_input(e: InputEvent) -> void:
	var now := Time.get_ticks_usec()
	var pressed: bool = (e is InputEventKey and e.pressed and not e.echo) or (e is InputEventMouseButton and e.pressed)
	if not pressed:
		return
	if state == "idle":
		state = "baking"
		bake_queue = LAYERS.duplicate()
		return
	if state != "playing":
		return
	if e is InputEventMouseButton:
		dash_at = Beat.heard_time_at(now)
	elif e is InputEventKey:
		match e.keycode:
			KEY_SPACE, KEY_SHIFT, KEY_J: dash_at = Beat.heard_time_at(now)
			KEY_Q: switch_dir = -1
			KEY_E: switch_dir = 1
			KEY_BRACKETLEFT: Beat.input_offset_ms -= 5.0
			KEY_BRACKETRIGHT: Beat.input_offset_ms += 5.0
			KEY_MINUS: zoom = maxf(0.2, zoom - 0.1)      # workbench only: look at the map from further away
			KEY_EQUAL: zoom = minf(1.0, zoom + 0.1)

func _move() -> Vector2:
	var v := Vector2.ZERO
	if Input.is_physical_key_pressed(KEY_A) or Input.is_physical_key_pressed(KEY_LEFT): v.x -= 1
	if Input.is_physical_key_pressed(KEY_D) or Input.is_physical_key_pressed(KEY_RIGHT): v.x += 1
	if Input.is_physical_key_pressed(KEY_W) or Input.is_physical_key_pressed(KEY_UP): v.y -= 1
	if Input.is_physical_key_pressed(KEY_S) or Input.is_physical_key_pressed(KEY_DOWN): v.y += 1
	return v.normalized()

# ───────── frame ─────────

func _process(delta: float) -> void:
	if state == "baking":
		if bake_queue.is_empty():
			mixer.bake_shots()
			mixer.start()
			Beat.start(mixer.heard_time)
			state = "playing"
		else:
			mixer.bake(song, bake_queue.pop_front(), Beat.bpm, {})
	elif state == "playing":
		sim.input_offset_ms = Beat.input_offset_ms
		sim.step_to(Beat.heard_time(), {"move": _move(), "dash_at": dash_at, "switch": switch_dir})
		dash_at = -1.0
		switch_dir = 0
		_drain()
		_mix()
		cam = sim.pos.round()
	var sf := Beat.step_f() if Beat.running else 0.0
	echoes = echoes.filter(func(e): return (sf - e["at"]) / 4.0 < ECHO[e["inst"]["layer"]]["life"] + 0.8)
	flashes = flashes.filter(func(f): return sf - f["at"] < 2.6)
	pfx = pfx.filter(func(f): return sf - f["at"] < (f["dur"] + 0.5 if f["kind"] == "dust" else 6.0))
	_push += delta
	if _push > 0.2 and OS.has_feature("web"):
		_push = 0.0
		JavaScriptBridge.eval("window.__rmg = %s; window.__rmg.wall = performance.now();" % JSON.stringify(_report()), true)
	queue_redraw()

func _now() -> float:
	return Beat.heard_time() if Beat.running else 0.0

func _report() -> Dictionary:
	var running := ""
	for e in sim.encounters:
		if e["running"]:
			running = "%s/%s" % [e["id"], e["phrases"][e["index"]]["id"]]
	return {"state": state, "scene": "game", "step": Beat.step_f() if Beat.running else -1.0, "pos": [sim.pos.x / sim.u, sim.pos.y / sim.u],
		"lives": sim.lives, "owned": sim.owned, "equipped": sim.equipped, "encounter": running, "flags": sim.flags.keys(),
		"active": sim.active.size(), "fps": Engine.get_frames_per_second(), "audio": mixer.backend,
		"reforming": not sim.reform.is_empty(), "latencyMs": mixer.delay_ms() if state == "playing" else 0.0}

func _mix() -> void:
	var fighting := false
	for e in sim.encounters:
		fighting = fighting or e["running"]
	for id in ["drum", "hat", "bass"]:
		mixer.target[id] = 0.85 if sim.owned.has(id) else 0.0
	mixer.target["tick"] = 0.0 if sim.owned.has("drum") else 0.4
	mixer.target["lead"] = 0.8 if fighting else 0.0
	mixer.target["pad"] = 0.6 if sim.owned.size() >= 2 else 0.0

## What happened in the rules becomes effects. Times are in steps, as in the web build.
func _drain() -> void:
	var sf := Beat.step_f()
	var eq: Color = PAL["player"].get(sim.equipped, PAL["player"]["drum"])
	for ev in sim.events:
		match ev["type"]:
			"dash":
				pfx.append({"kind": "dash", "at": sf, "a": ev["from"], "b": ev["to"], "strong": true})
				if ev["just"]:
					mixer.shot("perfect")
			"absorb":
				pfx.append({"kind": "ring", "at": sf, "pos": sim.pos, "color": eq})
			"strike":
				var inst: Dictionary = ev["inst"]
				if (inst["origin"] as Vector2).distance_to(sim.pos) > 1100.0:
					continue
				var kind: String = inst["def"]["shape"]["kind"]
				var first: bool = int(ev["step"]) == int(inst["hit_step"])
				if first:
					flashes.append({"inst": inst, "at": float(ev["step"])})
					if kind != "zone":
						echoes.append({"inst": inst, "at": float(ev["step"]), "fronts": _fronts(inst)})
				# A held zone leaves its wash when it finally lets go.
				if kind == "zone" and int(ev["step"]) >= int(inst["hit_step"]) + int(inst["hold"]):
					echoes.append({"inst": inst, "at": float(ev["step"]), "fronts": []})
			"attack":
				match ev["layer"]:
					"drum": pfx.append({"kind": "drum", "at": sf, "pos": ev["from"]})
					"hat": pfx.append({"kind": "hat", "at": sf, "a": ev["from"], "b": _reach(ev)})
					"bass": bass_line = {"until": sf + 1.4, "to": _reach(ev)}
			"hurt", "gameover":
				mixer.shot("miss")
				pfx.append({"kind": "dust", "at": sf, "from": ev["from"], "to": ev["to"], "dur": float(Sim.REFORM_STEPS)})
				pfx.append({"kind": "ring", "at": sf, "pos": ev["from"], "color": PAL["danger"]})
				pfx.append({"kind": "ring", "at": sf + Sim.REFORM_STEPS, "pos": ev["to"], "color": eq})
			"part", "plate":
				pfx.append({"kind": "ring", "at": sf, "pos": sim.pos, "color": PAL["player"][ev["layer"]]})
			"gate":
				_build_edges()
			"broken":
				pfx.append({"kind": "ring", "at": sf, "pos": ev["pos"], "color": PAL["ink"]})
	sim.events.clear()

## A whiff is still shown, reaching only as far as the instrument can.
func _reach(ev: Dictionary) -> Vector2:
	var a: Vector2 = ev["from"]
	var b: Vector2 = ev["to"]
	return b if ev["hit"] else a + (b - a).limit_length(Sim.ATTACK_RANGE_U[ev["layer"]] * sim.u)

# ───────── the edge of the ground ─────────

## Sample every shape's outline and keep the points that really are the border between ground and nothing.
func _build_edges() -> void:
	edges.clear()
	_boxes.clear()
	_buckets.clear()
	_ground_cache.clear()
	var shapes: Array = []
	for sh in sim.map.ground:
		shapes.append([sh, false])
	for sh in sim.map.holes:
		shapes.append([sh, true])
	for g in sim.gates:
		if g["open"]:
			shapes.append([g["shape"], false, true])
	var outlines: Array = []
	for it in shapes:
		var pts: Array = ShapeMap.outline(it[0], EDGE_STEP)
		var box := Rect2(pts[0][0], Vector2.ZERO)
		for pn in pts:
			box = box.expand(pn[0])
		_boxes.append([box.grow(2.0), it[0], it[1], it.size() > 2])
		outlines.append(pts)
	runs.clear()
	for pts in outlines:
		var run := PackedVector2Array()
		for pn in pts:
			var p: Vector2 = pn[0]
			var n: Vector2 = pn[1]
			var a := sim.is_ground(p + n * 2.0)
			var b := sim.is_ground(p - n * 2.0)
			var keep := a != b
			if keep and not run.is_empty() and p.distance_to(run[run.size() - 1]) > EDGE_STEP * 2.5:
				_end_run(run)
				run = PackedVector2Array()
			if keep:
				run.append(p)
				var cell := Vector2i((p / CELL).floor())
				if not edges.has(cell):
					edges[cell] = []
				edges[cell].append([p, -n if b else n])       # the normal kept points into the ground
			elif not run.is_empty():
				_end_run(run)
				run = PackedVector2Array()
		_end_run(run)

func _end_run(run: PackedVector2Array) -> void:
	if run.size() < 2:
		return
	var box := Rect2(run[0], Vector2.ZERO)
	for q in run:
		box = box.expand(q)
	runs.append([box, run])

## Is this point ground? Same answer as the rules give, but quick: only nearby shapes are asked, and answers are remembered.
func ground(p: Vector2) -> bool:
	var key := Vector2i((p / 6.0).floor())
	if _ground_cache.has(key):
		return _ground_cache[key]
	var bk := Vector2i((p / 240.0).floor())
	if not _buckets.has(bk):
		var cell := Rect2(Vector2(bk) * 240.0, Vector2(240, 240))
		var list: Array = []
		for b in _boxes:
			if (b[0] as Rect2).intersects(cell, true):
				list.append(b)
		_buckets[bk] = list
	var q := (Vector2(key) + Vector2(0.5, 0.5)) * 6.0
	var on := false
	var holed := false
	var bridged := false
	for b in _buckets[bk]:
		if ShapeMap.contains(b[1], q):
			if b[3]: bridged = true
			elif b[2]: holed = true
			else: on = true
	var res := bridged or (on and not holed)
	_ground_cache[key] = res
	return res

# ───────── echoes ─────────

## Points on an attack's edge and the way each travels. A point that meets the edge of the ground bounces off it.
func _fronts(inst: Dictionary) -> Array:
	var s: Dictionary = inst["def"]["shape"]
	var o: Vector2 = inst["origin"]
	var raw: Array = []
	var circle := func(r: float, sg: float) -> Array:
		var f: Array = []
		for i in 97:
			var d := Vector2.from_angle(i / 96.0 * TAU)
			f.append([o + d * r, d * sg])
		return f
	match s["kind"]:
		"circle":
			raw.append(circle.call(s["r"], 1.0))
		"ring":
			raw.append(circle.call(s["r1"], 1.0))
			raw.append(circle.call(s["r0"], -1.0))
		"beam":
			var x := Vector2.from_angle(inst["rot"])
			var y := Vector2(-x.y, x.x)
			for sg in [1.0, -1.0]:
				var f: Array = []
				var t := 0.0
				while t <= minf(s.get("len", 1100.0), 1100.0):
					f.append([o + x * t - y * sg * s["w"] / 2.0, -y * sg])
					t += 7.0
				raw.append(f)
	var e: Dictionary = ECHO[inst["layer"]]
	var far: float = 2.0 + e["dist"] * (1.0 + e["lines"] * 0.12) + 4.0
	var out: Array = []
	for f in raw:
		var g: Array = []
		for pv in f:
			var p: Vector2 = pv[0]
			var v: Vector2 = pv[1]
			if not ground(p):
				g.append(null)                      # a break in the line
				continue
			var hit := INF
			var v2 := v
			var d := 4.0
			while d <= far:
				if not ground(p + v * d):
					hit = d - 4.0
					var h := p + v * hit
					var n := Vector2.ZERO           # which way is ground, from the place it met the edge
					for i in 12:
						var dir := Vector2.from_angle(i * TAU / 12.0)
						if ground(h + dir * 9.0):
							n += dir
					if n.length() > 0.01:
						n = n.normalized()
						v2 = v - 2.0 * minf(0.0, v.dot(n)) * n
					else:
						v2 = -v
					break
				d += 4.0
			g.append([p, v, hit, v2])
		out.append(g)
	return out

# ───────── drawing ─────────
# A port of src/render/renderer.ts. The rules of the look:
#  - the ground has no colour: it is the background, bounded by one thin line
#  - a filled plane is a sound happening now; a telegraph is the same plane, growing, its opacity rising in 16th steps
#  - lines are what a sound leaves behind: echoes spread from a hit and bounce off the edge
#  - the red family is the enemy, the blue family is the player
#  - deadly ground shows as dots, only near the player

func _ease_out(t: float) -> float:
	return 1.0 - pow(1.0 - t, 3.0)

func _col(c: Color, a: float) -> Color:
	return Color(c.r, c.g, c.b, clampf(a, 0.0, 1.0))

func _draw() -> void:
	var size := get_viewport_rect().size
	draw_rect(Rect2(Vector2.ZERO, size), PAL["bg"])
	if state != "playing":
		var c := size / 2.0
		if state == "idle":
			_disc(c, 46.0, PAL["ink"])
			draw_colored_polygon(PackedVector2Array([c + Vector2(-12, -18), c + Vector2(20, 0), c + Vector2(-12, 18)]), PAL["bg"])
		else:
			var done := LAYERS.size() - bake_queue.size()
			draw_arc(c, 46.0, -PI / 2, -PI / 2 + TAU * done / LAYERS.size(), 48, PAL["ink"], 3.0, true)
		return
	var sf := Beat.step_f()
	var pulse := exp(-Beat.beat_phase() * 5.0)
	draw_set_transform(size / 2.0 - cam * zoom, 0.0, Vector2(zoom, zoom))
	var view := Rect2(cam - size / 2.0 / zoom, size / zoom).grow(60.0)
	_draw_things(sf, pulse, view)
	_draw_field(sf, view)
	_draw_ground(view)
	_draw_emitters(sf, pulse, view)
	_draw_player_fx(sf)
	_draw_player(sf, pulse)
	draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
	_draw_hud(pulse)

## Pickups, plates, checkpoints, closed ways. Everything here moves on the beat.
func _draw_things(sf: float, pulse: float, view: Rect2) -> void:
	var ink: Color = PAL["ink"]
	var beat_u := fposmod(sf / 4.0, 1.0)
	for c in sim.checkpoints:
		if view.has_point(c["pos"]):
			var q: Vector2 = c["pos"]
			var h := 10.5
			var pts := [q + Vector2(-h, -h), q + Vector2(h, -h), q + Vector2(h, h), q + Vector2(-h, h)]
			for i in 4:
				draw_dashed_line(pts[i], pts[(i + 1) % 4], _col(ink, 0.35), 1.0, 2.0, true)
	for pl in sim.plates:
		if not view.has_point(pl["pos"]):
			continue
		var enc := sim._encounter_by_id(pl["encounter"])
		if not enc.is_empty() and not (enc["running"] and enc["phrases"][enc["index"]].get("shield", false)):
			continue                              # the boss's plates show only in the phrase that needs them
		var col: Color = PAL["player"][pl["layer"]]
		_disc(pl["pos"], pl["r"], _col(col, 0.5 if pl["lit"] else 0.1))
		draw_arc(pl["pos"], pl["r"], 0, TAU, 48, col, 1.25, true)
		if not pl["lit"] and pl["count"] > 0:
			draw_arc(pl["pos"], pl["r"] + 7.0, -PI / 2, -PI / 2 + TAU * pl["count"] / 16.0, 32, col, 4.0, true)
	for g in sim.gates:
		# A closed way shows what it is waiting for, as small marks.
		if g["open"]:
			continue
		var req: Dictionary = g["requires"]
		var marks: Array = []
		for f in req.get("flags", []):
			var layer := str(f).trim_prefix("plate-")
			marks.append([layer, sim.flags.get(f, false)])
		if req.has("layer"):
			marks.append([req["layer"], sim.owned.has(req["layer"])])
		var q: Vector2 = Vector2(g["shape"].get("x", 0.0), g["shape"].get("y", 0.0))
		if not view.has_point(q):
			continue
		for i in marks.size():
			var mq := q + Vector2((i - (marks.size() - 1) / 2.0) * 9.0, 0)
			if marks[i][1]:
				_disc(mq, 3.0, PAL["player"].get(marks[i][0], ink))
			else:
				draw_arc(mq, 3.0, 0, TAU, 16, _col(ink, 0.35), 1.0, true)
	for part in sim.parts:
		if part["taken"] or not view.has_point(part["pos"]):
			continue
		var col: Color = PAL["player"][part["layer"]]
		var free: bool = sim._guard_cleared(part)
		var k := 1.0 if free else 0.35
		_disc(part["pos"], 11.0 * (1.0 + 0.1 * pulse), _col(col, k))
		draw_arc(part["pos"], 14.0 + 14.0 * _ease_out(beat_u), 0, TAU, 48, _col(col, 0.5 * (1.0 - beat_u) * k), 1.0, true)

## Telegraphs, hits, held zones and echoes.
func _draw_field(sf: float, view: Rect2) -> void:
	var big := view.grow(520.0)
	# Telegraph: the plane spreads steadily; its opacity climbs one step per 16th.
	for a in sim.active:
		if not big.has_point(a["origin"]):
			continue
		var col: Color = PAL["enemy"].get(a["layer"], PAL["enemy"]["lead"])
		if sf < float(a["hit_step"]):
			var span: float = float(a["hit_step"] - a["start"])
			var pr := clampf((sf - float(a["start"])) / span, 0.0, 1.0)
			var k := minf(span, floorf(pr * span) + 1.0)
			_fill(a, 1.0, _col(col, 0.1))
			_fill(a, pr, _col(col, 0.16 + 0.44 * (k / span)))
			_outline(a, _col(col, 0.5), 1.25)
		elif int(a["hold"]) > 0:
			# Held zones do not just sit there: they dip, then climb again toward the next beat, when they strike again.
			var u := fposmod((sf - float(a["hit_step"])) / 4.0, 1.0)
			var k := floorf(u * 4.0) + 1.0
			_fill(a, 1.0, _col(col, 1.0 if u < 0.1 else 0.34 + 0.12 * k))
			_outline(a, _col(col, 0.9), 1.5)
	# The hit itself: the plane, full, then gone.
	for f in flashes:
		var x: float = (sf - f["at"]) / 4.0
		var inst: Dictionary = f["inst"]
		if x < 0.0 or x > 0.6 or (inst["def"]["shape"]["kind"] == "zone" and x > 0.05):
			continue
		_fill(inst, 1.0, _col(PAL["enemy"].get(inst["layer"], PAL["enemy"]["lead"]), 1.0 if x < 0.1 else 0.88 * (1.0 - clampf((x - 0.1) / 0.5, 0.0, 1.0))))
	# Echoes.
	for e in echoes:
		var inst: Dictionary = e["inst"]
		var E: Dictionary = ECHO[inst["layer"]]
		var age: float = (sf - e["at"]) / 4.0
		if age < 0.0:
			continue
		var col: Color = PAL["enemy"].get(inst["layer"], PAL["enemy"]["lead"])
		var s: Dictionary = inst["def"]["shape"]
		if s["kind"] == "zone":
			# Bass leaves no lines: the whole area stays as a very faint tint whose edge dissolves outward.
			var bass: Dictionary = ECHO["bass"]
			var te: float = age / bass["life"]
			if te >= 1.0:
				continue
			var d := 16.0 + pow(te, 0.9) * 260.0
			var al: float = bass["alpha"] * minf(1.0, te / 0.12) * pow(1.0 - te, 1.4)
			var hw: float = s["w"] / 2.0
			var hh: float = s["h"] / 2.0
			draw_colored_polygon(_rect(inst["origin"], inst["rot"], -hw, hw, -hh, hh), _col(col, al))
			for i in range(1, 11):
				var o := d * i / 10.0
				draw_colored_polygon(_rect(inst["origin"], inst["rot"], -hw - o, hw + o, -hh - o, hh + o), _col(col, al * pow(1.0 - i / 11.0, 1.6) / 2.2))
			continue
		if E["lines"] == 0:
			continue
		for k in int(E["lines"]):
			var te: float = (age - k * E["gap"]) / E["life"]
			if te <= 0.0 or te >= 1.0:
				continue
			var d: float = 2.0 + _ease_out(te) * E["dist"] * (1.0 + k * 0.12)
			var lc := _col(col, E["alpha"] * pow(1.0 - te, 1.4))
			var lw: float = E["w"] * (1.0 - te * 0.35)
			for f in e["fronts"]:
				var run := PackedVector2Array()
				for pv in f:
					var q := Vector2.ZERO
					var ok: bool = pv != null
					if ok:
						q = pv[0] + pv[1] * d if d <= pv[2] else pv[0] + pv[1] * pv[2] + pv[3] * (d - pv[2])
						ok = run.is_empty() or q.distance_to(run[run.size() - 1]) < 26.0
					if ok and pv != null:
						run.append(q)
					else:
						if run.size() > 1:
							draw_polyline(run, lc, lw, true)
						run = PackedVector2Array()
						if pv != null:
							run.append(q)
				if run.size() > 1:
					draw_polyline(run, lc, lw, true)

func _draw_ground(view: Rect2) -> void:
	var ink: Color = PAL["ink"]
	var p := sim.pos
	var hidden := not sim.reform.is_empty()
	const REACH := 120.0
	# The boundary itself: one thin line in the ordinary colour.
	var line := _col(ink, 0.75)
	for r in runs:
		if view.intersects(r[0], true):
			draw_polyline(r[1], line, 1.0, true)
	# Near the player, two faint lines appear just inside it.
	var c0 := Vector2i(((p - Vector2(REACH, REACH)) / CELL).floor())
	var c1 := Vector2i(((p + Vector2(REACH, REACH)) / CELL).floor())
	var half := EDGE_STEP * 0.5 + 0.6
	for cx in range(c0.x, c1.x + 1):
		for cy in range(c0.y, c1.y + 1):
			for pn in edges.get(Vector2i(cx, cy), []):
				var e: Vector2 = pn[0]
				var n: Vector2 = pn[1]
				var tan := Vector2(-n.y, n.x) * half
				var d := e.distance_to(p)
				if d < REACH and not hidden:
					var k := pow(1.0 - d / REACH, 1.6)
					for i in [1, 2]:
						draw_line(e + n * i * 5.0 - tan, e + n * i * 5.0 + tan, _col(ink, 0.5 * k / i), 1.0, true)
	# Deadly ground: dots, only where the player is close to it.
	if hidden:
		return
	const R := 150.0
	const GX := 16.0
	const GY := 13.9
	var j := floori((p.y - R) / GY)
	while j * GY <= p.y + R:
		var i := floori((p.x - R) / GX)
		while i * GX <= p.x + R:
			var q := Vector2(i * GX + (GX / 2.0 if (j & 1) != 0 else 0.0), j * GY)
			var k := pow(clampf(1.0 - q.distance_to(p) / R, 0.0, 1.0), 1.5)
			if k >= 0.03 and not ground(q):
				_disc(q, 0.5 + 3.2 * k, _col(PAL["danger"], 0.8 * k))
			i += 1
		j += 1

## Everything that attacks is drawn like the web build's boss: an ink disc with a red quarter. Size tells them apart.
func _draw_emitters(sf: float, pulse: float, view: Rect2) -> void:
	var ink: Color = PAL["ink"]
	for em in sim.emitters:
		if em["broken"] or em.get("hidden", false) or not view.has_point(em["pos"]):
			continue
		var q: Vector2 = em["pos"]
		var enc := sim._encounter_of(em)
		if enc.is_empty():
			if em["kind"] == "device":
				draw_arc(q, 12.0, 0, TAU, 32, _col(ink, 0.6), 1.0, true)
				draw_arc(q, 4.0, 0, TAU, 16, _col(ink, 0.6), 1.0, true)
			else:
				var mr := 9.0 * (1.0 + 0.09 * pulse)
				_disc(q, mr, ink)
				draw_colored_polygon(_wedge(q, mr), PAL["enemy"]["drum"])
			continue
		var br: float = em["body"]
		var ph: Dictionary = enc["phrases"][enc["index"]]
		var awake: bool = enc["running"]
		var open: bool = awake and (ph.get("openBars", []) as Array).has(int((floorf(sf) - enc["phrase_start"]) / 16.0))
		var r := (br - 8.0) * (1.0 + 0.09 * pulse)
		# Health: a thick arc. A notch marks where this phrase ends.
		draw_arc(q, br + 9.0, 0, TAU, 64, _col(ink, 0.18), 6.0, true)
		draw_arc(q, br + 9.0, -PI / 2, -PI / 2 + TAU * em["hp"] / maxf(1.0, em["max_hp"]), 64, ink, 6.0, true)
		var gate: float = float(ph.get("advance", {}).get("hpBelow", 0.0))
		if gate > 0.0:
			var a := -PI / 2 + TAU * gate
			draw_line(q + Vector2.from_angle(a) * (br + 4.0), q + Vector2.from_angle(a) * (br + 14.0), PAL["bg"], 2.5, true)
		if awake and ph.get("shield", false) and not sim._solved(enc):
			for i in 24:
				draw_arc(q, br + 20.0, i * TAU / 24.0, i * TAU / 24.0 + TAU / 24.0 * 0.38, 4, ink, 1.25, true)
		# The instrument this phrase is weak to, in the player's colour.
		if ph.get("weakTo", "") != "":
			_disc(q + Vector2(0, -br - 24.0), 3.5, PAL["player"][ph["weakTo"]])
		# Dodges answered in a row, for a guardian that can be passed that way.
		var need := int(ph.get("advance", {}).get("answered", 0))
		for i in need:
			var mq := q + Vector2((i - (need - 1) / 2.0) * 10.0, br + 26.0)
			if awake and i < sim.streak:
				_disc(mq, 3.0, ink)
			else:
				draw_arc(mq, 3.0, 0, TAU, 16, _col(ink, 0.45), 1.0, true)
		if open:
			draw_arc(q, r, 0, TAU, 48, ink, 2.0, true)
		else:
			_disc(q, r, ink)
		draw_colored_polygon(_wedge(q, r), _col(PAL["enemy"]["drum"], 0.9 if open else 1.0))

func _wedge(q: Vector2, r: float) -> PackedVector2Array:
	var pts := PackedVector2Array([q])
	for i in 13:
		pts.append(q + Vector2.from_angle(-PI / 2 + PI / 2 * i / 12.0) * r)
	return pts

func _draw_player_fx(sf: float) -> void:
	var p := sim.pos
	var eq: Color = PAL["player"].get(sim.equipped, PAL["player"]["drum"])
	for f in pfx:
		var age: float = (sf - f["at"]) / 4.0       # beats
		if age < 0.0:
			continue
		match f["kind"]:
			"dash":
				if age > 1.2:
					continue
				var a: Vector2 = f["a"]
				var b: Vector2 = f["b"]
				var dv := b - a
				var L := maxf(1.0, dv.length())
				var ux := dv / L
				var uy := Vector2(-ux.y, ux.x)
				var k := age / 1.2
				var st := 1.0 if f["strong"] else 0.45
				draw_arc(a, 12.0 + 34.0 * st * _ease_out(k), 0, TAU, 48, _col(eq, 0.8 * st * pow(1.0 - k, 1.5)), 1.5 - k, true)
				for i in range(1, 6):
					var t := i / 6.0
					_disc(a + dv * t, PLAYER_R * 0.8 * (0.55 + 0.45 * t), _col(eq, 0.34 * st * t * pow(1.0 - clampf(age / 0.7, 0.0, 1.0), 1.2)))
				if L > 30.0:
					for o in [-9.0, 0.0, 9.0]:
						draw_line(a + uy * o + ux * 6.0, b + uy * o - ux * 14.0, _col(eq, 0.55 * st * (1.0 - clampf(age / 0.6, 0.0, 1.0))), 1.0, true)
			"drum":
				if age > 0.9:
					continue
				var k := age / 0.9
				var R: float = Sim.ATTACK_RANGE_U["drum"] * sim.u * _ease_out(clampf(age / 0.25, 0.0, 1.0))
				var col: Color = PAL["player"]["drum"]
				_disc(f["pos"], R, _col(col, 0.22 * pow(1.0 - k, 2.0)))
				draw_arc(f["pos"], R + 10.0 * k, 0, TAU, 48, _col(col, 0.9 * pow(1.0 - k, 1.3)), 2.2 - 1.4 * k, true)
			"hat":
				if age > 0.6:
					continue
				var a: Vector2 = f["a"]
				var b: Vector2 = f["b"]
				var L := maxf(1.0, (b - a).length())
				var ux := (b - a) / L
				var col: Color = PAL["player"]["hat"]
				if age < 0.22:
					var head := minf(L, L * (age / 0.22))
					var tail := maxf(0.0, head - 38.0)
					draw_line(a + ux * tail, a + ux * head, _col(col, 0.95), 2.0, true)
				else:
					var k := (age - 0.22) / 0.38
					for an in [-1.1, 0.0, 1.1]:
						var dir := (-ux).rotated(an)
						draw_line(b + dir * 4.0, b + dir * (6.0 + 12.0 * k), _col(col, 0.8 * (1.0 - k)), 1.2, true)
			"ring":
				if age > 0.9:
					continue
				draw_arc(f["pos"], 12.0 + 40.0 * _ease_out(age / 0.9), 0, TAU, 48, _col(f["color"], 0.9 * pow(1.0 - age / 0.9, 1.4)), 2.0 - 1.4 * (age / 0.9), true)
			"dust":
				_dust(f["from"], f["to"], age, f["dur"] / 4.0, sf / 4.0)
	# The bass attack is a held string, trembling for as long as the note sounds.
	if sf < bass_line["until"] and sim.equipped == "bass" and sim.reform.is_empty():
		var on := clampf((bass_line["until"] - sf) / 1.2, 0.0, 1.0)
		var dv: Vector2 = bass_line["to"] - p
		var L := maxf(1.0, dv.length())
		var uy := Vector2(-dv.y, dv.x) / L
		for st in [[5.0, 0.85, 1.6], [9.0, 0.4, 1.0], [13.0, 0.22, 1.0]]:
			var pts := PackedVector2Array()
			for i in 41:
				var u := i / 40.0
				var o: float = sin(u * 16.0 - sim.time * 9.0) * st[0] * sin(u * PI)
				pts.append(p + dv * u + uy * o)
			draw_polyline(pts, _col(PAL["player"]["bass"], st[1] * on), st[2], true)

## The player as dust. Scatter and gather are one movement: fast out, slowing,
## then gathering speed and arriving fast. It never stands still.
func _dust(from: Vector2, to: Vector2, age: float, dur: float, beat: float) -> void:
	var ink: Color = PAL["ink"]
	for g in grains:
		var u := clampf(age / (dur * (1.0 + g["lag"] * 0.22) / 1.09), 0.0, 1.0)
		var out := (1.0 - pow(1.0 - clampf(u / 0.55, 0.0, 1.0), 4.0)) * 1.45
		var pull := pow(u, 2.6)
		var pos: float = beat * g["sub"]
		var tick := 0.0
		if g["tw"] and int(floor(pos)) % int(g["sub"]) == int(g["slot"]) % int(g["sub"]):
			var x := pos - floorf(pos)
			var bump := sin((x / 0.22) * PI / 2.0) if x < 0.22 else exp(-(x - 0.22) * 5.5)
			tick = bump * g["amp"] * minf(1.0, out) * (1.0 - pull)
		var d: Vector2 = g["d"]
		var fpos: Vector2 = from + g["o"] + d * g["far"] * out + Vector2(cos(beat * 2.4 + g["drift"]), sin(beat * 2.0 + g["drift"])) * 2.2 * minf(1.0, out) + d * tick
		var tpos: Vector2 = to + g["o"]
		var v := (fpos - tpos).rotated(g["spin"] * pull * (1.0 - pull) * 0.55)
		var loose := minf(1.0, out) * (1.0 - pull)
		_disc(tpos + v * (1.0 - pull), g["size"] * (1.0 - 0.22 * loose), _col(ink, 1.0 - 0.4 * loose))

func _draw_player(sf: float, pulse: float) -> void:
	if not sim.reform.is_empty():
		return        # scattered: the dust is the player
	var p := sim.pos
	var ink: Color = PAL["ink"]
	var a := 0.4 if (sim.iframe > 0.0 or sim.step < sim.grace_until) and sim.dash.is_empty() and int(floor(sf * 2.0)) % 2 == 0 else 1.0
	if sim.equipped != "":
		draw_arc(p, PLAYER_R + 4.0, 0, TAU, 40, _col(PAL["player"][sim.equipped], a), 1.5, true)
	else:
		draw_arc(p, PLAYER_R + 4.0, 0, TAU, 40, _col(ink, a), 1.0, true)
	_disc(p, PLAYER_R * 0.8 * (1.0 + 0.12 * pulse), _col(ink, a))

## Screen space: lives and the instruments in hand. No words.
func _draw_hud(pulse: float) -> void:
	var ink: Color = PAL["ink"]
	for i in sim.max_lives:
		var q := Vector2(30.0 + i * 16.0, 30.0)
		if i < sim.lives:
			_disc(q, 4.5, ink)
		else:
			draw_arc(q, 4.5, 0, TAU, 24, _col(ink, 0.45), 1.25, true)
	var order := ["drum", "hat", "bass"]
	for i in 3:
		var id: String = order[i]
		var owned := sim.owned.has(id)
		var eq := sim.equipped == id
		var q := Vector2(31.0 + i * 20.0, 56.0)
		if owned:
			_disc(q, 6.5 + pulse if eq else 5.0, PAL["player"][id])
		else:
			draw_arc(q, 5.0, 0, TAU, 24, _col(ink, 0.35), 1.25, true)
		if eq:
			draw_line(q + Vector2(-6, 12), q + Vector2(6, 12), _col(ink, 0.8), 1.25, true)

# ───────── shapes ─────────

func _rect(o: Vector2, rot: float, x0: float, x1: float, y0: float, y1: float) -> PackedVector2Array:
	var x := Vector2.from_angle(rot)
	var y := Vector2(-x.y, x.x)
	return PackedVector2Array([o + x * x0 + y * y0, o + x * x1 + y * y0, o + x * x1 + y * y1, o + x * x0 + y * y1])

## Fill an attack's plane. grow (0..1) is how far it has spread from where it starts.
func _fill(inst: Dictionary, grow: float, col: Color) -> void:
	var s: Dictionary = inst["def"]["shape"]
	var o: Vector2 = inst["origin"]
	match s["kind"]:
		"circle":
			_disc(o, maxf(0.5, s["r"] * grow), col)
		"ring":
			var w: float = (s["r1"] - s["r0"]) * grow
			if w > 0.3:
				draw_arc(o, s["r0"] + w / 2.0, 0, TAU, 128, col, w, false)
		"beam":
			var L: float = minf(s.get("len", 1100.0), 1100.0) * grow
			if L > 0.5:
				draw_colored_polygon(_rect(o, inst["rot"], 0.0, L, -s["w"] / 2.0, s["w"] / 2.0), col)
		"zone":
			# Zones spread from the side nearest whatever made them.
			var rel: Vector2 = (o - (inst.get("src_pos", o) as Vector2)).rotated(-inst["rot"])
			var hw: float = s["w"] / 2.0
			var w: float = s["w"] * grow
			if w > 0.5:
				if rel.x >= 0.0:
					draw_colored_polygon(_rect(o, inst["rot"], -hw, -hw + w, -s["h"] / 2.0, s["h"] / 2.0), col)
				else:
					draw_colored_polygon(_rect(o, inst["rot"], hw - w, hw, -s["h"] / 2.0, s["h"] / 2.0), col)

func _outline(inst: Dictionary, col: Color, width: float) -> void:
	var s: Dictionary = inst["def"]["shape"]
	var o: Vector2 = inst["origin"]
	match s["kind"]:
		"circle":
			draw_arc(o, s["r"], 0, TAU, 96, col, width, true)
		"ring":
			draw_arc(o, s["r1"], 0, TAU, 128, col, width, true)
			draw_arc(o, s["r0"], 0, TAU, 96, col, width, true)
		"beam":
			var pts := _rect(o, inst["rot"], 0.0, minf(s.get("len", 1100.0), 1100.0), -s["w"] / 2.0, s["w"] / 2.0)
			pts.append(pts[0])
			draw_polyline(pts, col, width, true)
		"zone":
			var pts := _rect(o, inst["rot"], -s["w"] / 2.0, s["w"] / 2.0, -s["h"] / 2.0, s["h"] / 2.0)
			pts.append(pts[0])
			draw_polyline(pts, col, width, true)

## A filled circle with a smooth rim, as the canvas draws it.
func _disc(q: Vector2, r: float, col: Color) -> void:
	draw_circle(q, r, col, true, -1.0, true)
