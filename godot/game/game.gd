extends Node2D
## The stage, drawn and heard. All rules live in Sim; this reads the keys, tells Sim the song time,
## and turns what happened into pictures and sound.

const PAL := {
	"bg": Color("f1e9d8"), "ink": Color("232524"),
	# The player's family is cool, the enemy's is warm; instruments differ inside each family.
	"player": {"": Color("232524"), "drum": Color("2f6470"), "hat": Color("6f9a8f"), "bass": Color("3d4a6b")},
	"enemy": {"drum": Color("c4291c"), "hat": Color("d9662b"), "bass": Color("8a1f33"), "lead": Color("b23a2a"), "pad": Color("8a1f33")},
}
const LAYERS: Array[String] = ["tick", "drum", "hat", "bass", "lead", "pad"]
const EDGE_STEP := 14.0
const CELL := 480.0

var stage := {}
var sim: Sim
var song: Song
var mixer: LayerMixer
var state := "idle"            # idle -> baking -> playing
var bake_queue: Array[String] = []
var bass_on := {}
var edges := {}                # cell -> [[point, inward normal]]
var fx: Array = []             # { kind, pos, t0, ... } short-lived pictures
var grains: Array = []
var cam := Vector2.ZERO
var zoom := 0.8
var dash_at := -1.0
var switch_dir := 0
var last_grade := {}
var banner := {}
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
	var rnd := RandomNumberGenerator.new()
	rnd.seed = 11
	for i in 46:
		grains.append({"dir": Vector2.from_angle(rnd.randf() * TAU), "far": 0.35 + rnd.randf() * 0.65, "size": 1.6 + rnd.randf() * 2.2,
			"shake": rnd.randf() < 0.3, "ph": rnd.randf() * TAU})

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
			KEY_MINUS: zoom = maxf(0.25, zoom - 0.1)
			KEY_EQUAL: zoom = minf(1.4, zoom + 0.1)

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
		var want := sim.pos
		for e in sim.encounters:
			if e["running"]:
				want = sim.pos.lerp(e["center"], 0.45)       # keep the fight in frame
		cam = cam.lerp(want, minf(1.0, delta * 6.0))
	var now := _now()
	fx = fx.filter(func(f): return now - f["t0"] < f["life"])
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
		"active": sim.active.size(), "fps": Engine.get_frames_per_second(), "audio": mixer.backend, "last": last_grade,
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

func _drain() -> void:
	var now := _now()
	var beat := Beat.sec_per_step() * Beat.steps_per_beat
	for ev in sim.events:
		match ev["type"]:
			"dash":
				last_grade = {"grade": ev["grade"], "offset_ms": ev["offset_ms"], "t0": now}
				last_grade["just"] = ev["just"]
				if ev["just"]:
					mixer.shot("perfect")
				fx.append({"kind": "dash", "from": ev["from"], "to": ev["to"], "just": ev["just"], "t0": now, "life": beat * 0.9})
			"strike":
				var inst: Dictionary = ev["inst"]
				fx.append({"kind": "echo", "inst": inst, "t0": now, "life": beat * (2.0 if inst["layer"] == "bass" else 1.2)})
			"absorb":
				fx.append({"kind": "absorb", "pos": sim.pos, "t0": now, "life": beat})
			"attack":
				fx.append({"kind": "attack", "from": ev["from"], "to": ev["to"], "layer": ev["layer"], "hit": ev["hit"], "t0": now, "life": beat * 0.6})
			"hurt", "gameover":
				mixer.shot("miss")
				fx.append({"kind": "dust", "from": ev["from"], "to": ev["to"], "t0": now, "life": beat * 2.0})
				if ev["type"] == "gameover":
					banner = {"text": "BACK TO THE LAST INSTRUMENT", "t0": now}
			"part":
				fx.append({"kind": "bloom", "pos": ev["pos"], "layer": ev["layer"], "t0": now, "life": beat * 4.0})
				banner = {"text": "%s  ·  LIVES RESTORED  ·  SAVED" % str(ev["layer"]).to_upper(), "t0": now}
			"plate":
				fx.append({"kind": "bloom", "pos": ev["pos"], "layer": ev["layer"], "t0": now, "life": beat * 4.0})
			"gate":
				_build_edges()
			"cleared":
				banner = {"text": "STAGE CLEAR" if ev["kind"] == "boss" else "PASSED", "t0": now}
			"broken":
				fx.append({"kind": "bloom", "pos": ev["pos"], "layer": "", "t0": now, "life": beat * 2.0})
	sim.events.clear()

# ───────── the edge of the ground ─────────

## Sample every shape's outline and keep the points that really are the border between ground and nothing.
func _build_edges() -> void:
	edges.clear()
	var shapes: Array = sim.map.ground + sim.map.holes
	for g in sim.gates:
		if g["open"]:
			shapes.append(g["shape"])
	for sh in shapes:
		for pn in ShapeMap.outline(sh, EDGE_STEP):
			var p: Vector2 = pn[0]
			var n: Vector2 = pn[1]
			var a := sim.is_ground(p + n * 3.0)
			var b := sim.is_ground(p - n * 3.0)
			if a == b:
				continue
			var cell := Vector2i((p / CELL).floor())
			if not edges.has(cell):
				edges[cell] = []
			edges[cell].append([p, -n if b else n])       # the normal kept points into the ground

# ───────── drawing ─────────

func _draw() -> void:
	var size := get_viewport_rect().size
	var font := ThemeDB.fallback_font
	draw_rect(Rect2(Vector2.ZERO, size), PAL["bg"])
	if state != "playing":
		var c := size / 2.0
		if state == "idle":
			draw_circle(c, 46.0, PAL["ink"])
			draw_colored_polygon(PackedVector2Array([c + Vector2(-12, -18), c + Vector2(20, 0), c + Vector2(-12, 18)]), PAL["bg"])
			_text(font, c + Vector2(0, 92), "PRESS ANY KEY", 16, PAL["ink"], true)
		else:
			var done := LAYERS.size() - bake_queue.size()
			draw_arc(c, 46.0, -PI / 2, -PI / 2 + TAU * done / LAYERS.size(), 48, PAL["ink"], 3.0, true)
		return
	var now := _now()
	var step := Beat.step_f()
	var beat := Beat.sec_per_step() * Beat.steps_per_beat
	var pulse := exp(-Beat.beat_phase() * 5.0)
	draw_set_transform(size / 2.0 - cam * zoom, 0.0, Vector2(zoom, zoom))
	var view := Rect2(cam - size / 2.0 / zoom, size / zoom).grow(80.0)
	var ink: Color = PAL["ink"]
	var p := sim.pos
	var hidden := not sim.reform.is_empty()

	# Deadly ground: dots that only show near the player.
	var reach := 1.9 * sim.u
	var gs := 26.0
	if not hidden:
		var gx0 := floori((p.x - reach) / gs)
		var gy0 := floori((p.y - reach) / gs)
		for gx in range(gx0, gx0 + int(2 * reach / gs) + 2):
			for gy in range(gy0, gy0 + int(2 * reach / gs) + 2):
				var q := Vector2(gx, gy) * gs + (Vector2(gs / 2.0, 0) if gy % 2 != 0 else Vector2.ZERO)
				var d := q.distance_to(p)
				if d < reach and not sim.is_ground(q):
					var k := 1.0 - d / reach
					draw_circle(q, 1.0 + 3.2 * k * k, Color(PAL["enemy"]["drum"], 0.75 * k))

	# The edge: one thin ordinary line; near the player, one or two fainter lines inside it.
	var c0 := Vector2i((view.position / CELL).floor())
	var c1 := Vector2i((view.end / CELL).floor())
	for cx in range(c0.x, c1.x + 1):
		for cy in range(c0.y, c1.y + 1):
			for pn in edges.get(Vector2i(cx, cy), []):
				var e: Vector2 = pn[0]
				var n: Vector2 = pn[1]
				var tan := Vector2(-n.y, n.x) * (EDGE_STEP * 0.5 + 0.5)
				draw_line(e - tan, e + tan, Color(ink, 0.7), 1.4)
				var d := e.distance_to(p)
				if d < reach and not hidden:
					var k := 1.0 - d / reach
					draw_line(e + n * 9.0 - tan, e + n * 9.0 + tan, Color(ink, 0.32 * k), 1.0)
					draw_line(e + n * 18.0 - tan, e + n * 18.0 + tan, Color(ink, 0.16 * k), 1.0)

	# Things on the ground.
	for c in sim.checkpoints:
		if view.has_point(c["pos"]):
			var on := sim.checkpoint.distance_to(c["pos"]) < 1.0
			_diamond(c["pos"], 9.0, Color(ink, 0.8 if on else 0.3), on)
	for pl in sim.plates:
		if not view.has_point(pl["pos"]):
			continue
		var col: Color = PAL["player"][pl["layer"]]
		draw_arc(pl["pos"], pl["r"], 0, TAU, 48, Color(col, 0.9), 1.6, true)
		if pl["lit"]:
			draw_circle(pl["pos"], pl["r"] - 5.0, Color(col, 0.55 + 0.2 * pulse))
		elif pl["count"] > 0:
			draw_arc(pl["pos"], pl["r"] - 6.0, -PI / 2, -PI / 2 + TAU * pl["count"] / Beat.steps_per_bar(), 32, col, 4.0, true)
		_glyph(pl["pos"], pl["layer"], 9.0, Color(col, 0.9), false)
	for g in sim.gates:
		# A way that is not there yet: a faint dotted trace.
		if not g["open"]:
			for pn in ShapeMap.outline(g["shape"], 30.0):
				if view.has_point(pn[0]):
					draw_circle(pn[0], 1.3, Color(ink, 0.28))
	for part in sim.parts:
		if part["taken"] or not view.has_point(part["pos"]):
			continue
		var col: Color = PAL["player"][part["layer"]]
		var free: bool = sim._guard_cleared(part)
		_glyph(part["pos"], part["layer"], 17.0 * (1.0 + 0.12 * pulse), Color(col, 1.0 if free else 0.45), free)
		draw_arc(part["pos"], 30.0 + 4.0 * pulse, 0, TAU, 48, Color(col, 0.5 if free else 0.25), 1.2, true)

	# Attacks: the plane spreads out to its full shape while its opacity climbs one step per sixteenth.
	for inst in sim.active:
		var tele: float = float(inst["hit_step"] - inst["start"])
		var prog := clampf((step - float(inst["start"])) / tele, 0.0, 1.0)
		var col: Color = PAL["enemy"].get(inst["layer"], PAL["enemy"]["lead"])
		if step < float(inst["hit_step"]):
			var stepped := floorf(prog * tele) / tele
			_shape(inst, 1.0, Color(col, 0.55), false)
			_shape(inst, ease(prog, 0.6), Color(col, 0.10 + 0.34 * stepped), true)
		else:
			# Held: it dips after each strike and steps back up to the next beat, when it strikes again.
			var into := fposmod(step - float(inst["hit_step"]), float(Beat.steps_per_beat)) / Beat.steps_per_beat
			_shape(inst, 1.0, Color(col, 0.22 + 0.5 * floorf(into * 4.0) / 4.0), true)
			_shape(inst, 1.0, Color(col, 0.8), false)

	# Emitters.
	for em in sim.emitters:
		if em["broken"] or em.get("hidden", false) or not view.has_point(em["pos"]):
			continue
		_emitter(em, pulse)

	# Short-lived pictures.
	for f in fx:
		var k: float = clampf((now - f["t0"]) / f["life"], 0.0, 1.0)
		match f["kind"]:
			"echo":
				var inst: Dictionary = f["inst"]
				var col: Color = PAL["enemy"].get(inst["layer"], PAL["enemy"]["lead"])
				if k < 0.25:
					_shape(inst, 1.0, Color(col, 0.85 * (1.0 - k / 0.25)), true)
				if inst["layer"] == "bass":
					_shape_grown(inst, 60.0 * k, Color(col, 0.10 * (1.0 - k)), true)      # a faint wash that keeps spreading
				else:
					var lines := 1 if inst["layer"] == "hat" else 2
					for i in lines:
						var kk := clampf(k * 1.3 - i * 0.22, 0.0, 1.0)
						if kk > 0.0 and kk < 1.0:
							_shape_grown(inst, (26.0 if inst["layer"] == "hat" else 70.0) * kk, Color(col, 0.5 * (1.0 - kk)), false)
			"dash":
				var col: Color = PAL["player"][sim.equipped]
				draw_line(f["from"], f["to"], Color(col, 0.5 * (1.0 - k)), 12.0 * (1.0 - k), true)
				if f["just"]:
					draw_arc(f["to"], 16.0 + 46.0 * ease(k, 0.4), 0, TAU, 48, Color(col, 0.9 * (1.0 - k)), 2.0, true)
			"absorb":
				for i in 2:
					draw_arc(f["pos"], 20.0 + (60.0 + 30.0 * i) * ease(k, 0.4), 0, TAU, 48, Color(PAL["player"][sim.equipped], 0.7 * (1.0 - k)), 1.5, true)
			"attack":
				var col: Color = PAL["player"][f["layer"]]
				var a: Vector2 = f["from"]
				var b: Vector2 = f["to"]
				if not f["hit"]:
					b = a + (b - a).limit_length(Sim.ATTACK_RANGE_U[f["layer"]] * sim.u)
				match f["layer"]:
					"drum": draw_arc(a, 26.0 + 50.0 * ease(k, 0.4), (b - a).angle() - 0.9, (b - a).angle() + 0.9, 20, Color(col, 0.9 * (1.0 - k)), 5.0 * (1.0 - k) + 1.0, true)
					"hat": draw_line(a.lerp(b, k * 0.6), a.lerp(b, minf(1.0, k * 0.6 + 0.4)), Color(col, 0.9 * (1.0 - k)), 2.0, true)
					"bass": draw_circle(a, Sim.ATTACK_RANGE_U["bass"] * sim.u * ease(k, 0.4), Color(col, 0.16 * (1.0 - k)))
				if f["hit"]:
					draw_arc(b, 10.0 + 26.0 * k, 0, TAU, 24, Color(col, 0.8 * (1.0 - k)), 1.5, true)
			"bloom":
				var col: Color = PAL["player"].get(f["layer"], ink)
				for i in 3:
					var kk := clampf(k * 1.4 - i * 0.2, 0.0, 1.0)
					if kk > 0.0 and kk < 1.0:
						draw_arc(f["pos"], 20.0 + 220.0 * ease(kk, 0.4), 0, TAU, 64, Color(col, 0.6 * (1.0 - kk)), 1.5, true)
			"dust":
				_dust(f, k, step)

	# The player.
	if not hidden:
		var col: Color = PAL["player"][sim.equipped]
		var r := 13.0 * (1.0 + 0.10 * pulse)
		draw_circle(p, r, col)
		draw_circle(p + sim.face * 6.0, 3.0, PAL["bg"])
		if not sim.dash.is_empty() and sim.dash["just"]:
			draw_arc(p, r + 6.0, 0, TAU, 32, Color(col, 0.9), 2.0, true)

	# ── on the glass ──
	draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
	for i in sim.max_lives:
		var q := Vector2(34.0 + i * 26.0, 34.0)
		if i < sim.lives:
			draw_circle(q, 8.0, ink)
		else:
			draw_arc(q, 8.0, 0, TAU, 24, Color(ink, 0.4), 1.4, true)
	for i in sim.owned.size():
		var id: String = sim.owned[i]
		var q := Vector2(34.0 + i * 34.0, 72.0)
		_glyph(q, id, 9.0 if id != sim.equipped else 12.0, Color(PAL["player"][id], 1.0 if id == sim.equipped else 0.5), id == sim.equipped)
	# The bar: dodge beats are the big marks.
	var bar := Beat.steps_per_bar()
	var bx := size.x / 2.0 - 120.0
	for s in bar:
		var big := Beat.dodge_steps.has(s)
		draw_circle(Vector2(bx + 240.0 * s / (bar - 1), size.y - 34.0), 4.0 if big else 1.5, Color(ink, 0.8 if big else 0.35))
	draw_circle(Vector2(bx + 240.0 * fposmod(step, bar) / (bar - 1), size.y - 34.0), 7.0, Color(ink, 0.25 + 0.5 * pulse))
	if last_grade.get("just", false) and now - float(last_grade["t0"]) < beat:
		_text(font, Vector2(size.x / 2.0, size.y - 56.0), "JUST", 14, ink, true)
	for e in sim.encounters:
		if e["running"]:
			var em: Dictionary = e["emitter_ref"]
			var w := 360.0 if e["kind"] == "boss" else 200.0
			draw_rect(Rect2(size.x / 2.0 - w / 2.0, 30.0, w, 3.0), Color(ink, 0.15))
			draw_rect(Rect2(size.x / 2.0 - w / 2.0, 30.0, w * em["hp"] / em["max_hp"], 3.0), PAL["enemy"]["drum"])
			var need: int = int(e["phrases"][e["index"]].get("advance", {}).get("answered", 0))
			for i in need:
				var q := Vector2(size.x / 2.0 - (need - 1) * 9.0 + i * 18.0, 50.0)
				if i < sim.streak:
					draw_circle(q, 4.0, ink)
				else:
					draw_arc(q, 4.0, 0, TAU, 16, Color(ink, 0.4), 1.2, true)
	if not banner.is_empty() and now - float(banner["t0"]) < beat * 8.0:
		var k := (now - float(banner["t0"])) / (beat * 8.0)
		_text(font, Vector2(size.x / 2.0, 110.0), banner["text"], 18, Color(ink, minf(1.0, 4.0 * (1.0 - k))), true)
	_text(font, Vector2(24, size.y - 18), "WASD  move      SPACE  dash on the beat      Q E  instrument      - =  zoom      [ ]  offset %+.0f ms" % Beat.input_offset_ms, 12, Color(ink, 0.55), false)

## Scattered to dust, then gathered back into a circle: one curve, fast out, slowing, speeding up, fast in.
func _dust(f: Dictionary, k: float, step: float) -> void:
	var from: Vector2 = f["from"]
	var to: Vector2 = f["to"]
	var col: Color = PAL["player"][sim.equipped]
	var out := sin(PI * pow(k, 0.62))                 # how far the grains are flung: quick out, slow turn, quick back
	var home := k * k * (3.0 - 2.0 * k)
	home = home * home                                # where their centre is: lingers, then rushes to the new place
	var sub := sin(step * PI * 2.0)                   # a small tremble on the subdivisions, for some grains only
	for g in grains:
		var q: Vector2 = from.lerp(to, home) + g["dir"] * (150.0 * g["far"] * out)
		if g["shake"]:
			q += Vector2.from_angle(g["ph"]) * 2.2 * sub * out
		draw_circle(q, g["size"] * (0.6 + 0.4 * (1.0 - out)), Color(col, 0.9))

func _emitter(em: Dictionary, pulse: float) -> void:
	var red: Color = PAL["enemy"]["drum"]
	var q: Vector2 = em["pos"]
	match em["kind"]:
		"device":
			_diamond(q, 12.0, red, true)
			draw_arc(q, 20.0 + 3.0 * pulse, 0, TAU, 32, Color(red, 0.5), 1.2, true)
		"monster":
			draw_circle(q, 11.0, PAL["enemy"]["lead"])
			draw_line(q + Vector2(10, 0), q + Vector2(10, -28), PAL["enemy"]["lead"], 2.5, true)
			draw_line(q + Vector2(10, -28), q + Vector2(22, -20), PAL["enemy"]["lead"], 2.5, true)
		"guardian", "boss":
			var r: float = em["body"]
			var enc := sim._encounter_of(em)
			var awake: bool = not enc.is_empty() and enc["running"]
			var sides := 6 if em["kind"] == "boss" else 3
			var pts := PackedVector2Array()
			for i in sides:
				pts.append(q + Vector2.from_angle(-PI / 2 + TAU * i / sides) * r * (1.0 + (0.08 * pulse if awake else 0.0)))
			draw_colored_polygon(pts, Color(red, 1.0 if awake else 0.55))
			draw_arc(q, r + 12.0, -PI / 2, -PI / 2 + TAU * em["hp"] / maxf(1.0, em["max_hp"]), 48, Color(red, 0.8), 2.0, true)
			if not awake and not enc.is_empty():
				draw_arc(q, enc["r"], 0, TAU, 96, Color(red, 0.18), 1.0, true)

func _shape(inst: Dictionary, grow: float, col: Color, filled: bool) -> void:
	_shape_grown(inst, 0.0, col, filled, grow)

## Draw an attack's shape, optionally pushed outward by `pad` pixels (for echoes) or scaled by `grow` (while it spreads).
func _shape_grown(inst: Dictionary, pad: float, col: Color, filled: bool, grow: float = 1.0) -> void:
	var s: Dictionary = inst["def"]["shape"]
	var o: Vector2 = inst["origin"]
	match s["kind"]:
		"circle":
			var r: float = s["r"] * grow + pad
			if filled:
				draw_circle(o, r, col)
			else:
				draw_arc(o, r, 0, TAU, 64, col, 1.4, true)
		"ring":
			var mid: float = (s["r0"] + s["r1"]) / 2.0
			var half: float = (s["r1"] - s["r0"]) / 2.0 * grow + pad
			if filled:
				draw_arc(o, mid, 0, TAU, 96, col, half * 2.0, true)
			else:
				draw_arc(o, mid + half, 0, TAU, 96, col, 1.4, true)
				draw_arc(o, maxf(1.0, mid - half), 0, TAU, 96, col, 1.4, true)
		"beam", "zone":
			var w: float
			var h: float
			var c := Vector2.ZERO
			if s["kind"] == "beam":
				w = minf(s.get("len", 4000.0), 4000.0)
				h = s["w"] * grow + pad * 2.0
				c = Vector2(w / 2.0, 0)
				w += pad
			else:
				w = s["w"] * grow + pad * 2.0
				h = s["h"] * grow + pad * 2.0
			var x := Vector2.from_angle(inst["rot"])
			var y := Vector2(-x.y, x.x)
			var m: Vector2 = o + x * c.x
			var pts := PackedVector2Array([m - x * w / 2 - y * h / 2, m + x * w / 2 - y * h / 2, m + x * w / 2 + y * h / 2, m - x * w / 2 + y * h / 2])
			if filled:
				draw_colored_polygon(pts, col)
			else:
				pts.append(pts[0])
				draw_polyline(pts, col, 1.4, true)

func _diamond(q: Vector2, r: float, col: Color, filled: bool) -> void:
	var pts := PackedVector2Array([q + Vector2(0, -r), q + Vector2(r, 0), q + Vector2(0, r), q + Vector2(-r, 0)])
	if filled:
		draw_colored_polygon(pts, col)
	else:
		pts.append(pts[0])
		draw_polyline(pts, col, 1.4, true)

## Each instrument has its own mark: drum a disc, hat a triangle, bass a square.
func _glyph(q: Vector2, layer: String, r: float, col: Color, filled: bool) -> void:
	match layer:
		"drum":
			if filled:
				draw_circle(q, r, col)
			else:
				draw_arc(q, r, 0, TAU, 32, col, 1.6, true)
		"hat":
			var pts := PackedVector2Array([q + Vector2(0, -r), q + Vector2(r, r * 0.8), q + Vector2(-r, r * 0.8)])
			if filled:
				draw_colored_polygon(pts, col)
			else:
				pts.append(pts[0])
				draw_polyline(pts, col, 1.6, true)
		_:
			var rect := Rect2(q - Vector2(r, r) * 0.85, Vector2(r, r) * 1.7)
			draw_rect(rect, col, filled, -1.0 if filled else 1.6)

func _text(font: Font, pos: Vector2, s: String, size: int, col: Color, centred: bool) -> void:
	var w := font.get_string_size(s, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x
	draw_string(font, pos - Vector2(w / 2.0 if centred else 0.0, 0), s, HORIZONTAL_ALIGNMENT_LEFT, -1, size, col)
