extends Node2D
## Experiment 1: can Godot keep the beat?
## Bakes a song's loops, plays them together, shows the beat, and judges presses.
## Runs as a web export too, so it can be tried from a browser.

const BG := Color("f1e9d8")
const INK := Color("232524")
const LAYER_COLORS := {"drum": Color("2f6470"), "hat": Color("6f9a8f"), "bass": Color("3d4a6b"), "lead": Color("c4291c"), "pad": Color("8a1f33")}
const ORDER: Array[String] = ["drum", "hat", "bass", "lead", "pad"]
const GRADE_COLORS := {"perfect": Color("232524"), "near": Color("6f9a8f"), "miss": Color("c4291c")}

var song: Song
var mixer: LayerMixer
var state := "idle"            # idle -> baking -> playing
var bake_queue: Array[String] = []
var on := {"drum": false, "hat": false, "bass": false, "lead": false, "pad": false}
var presses: Array[float] = []
var last := {}
var last_at := -10.0
var seed_value := 7
var _push := 0.0

func _ready() -> void:
	if OS.has_feature("web"):
		var q: Variant = JavaScriptBridge.eval("new URLSearchParams(location.search).get('seed') || ''", true)
		if str(q).is_valid_int():
			seed_value = int(str(q))
	song = Song.generate(seed_value, 2)
	mixer = LayerMixer.new()
	add_child(mixer)

func _unhandled_input(e: InputEvent) -> void:
	var now := Time.get_ticks_usec()
	var pressed: bool = (e is InputEventKey and e.pressed and not e.echo) or (e is InputEventMouseButton and e.pressed)
	if not pressed:
		return
	if state == "idle":
		state = "baking"
		bake_queue = ["tick", "drum", "hat", "bass", "lead", "pad"]
		return
	if state != "playing":
		return
	if e is InputEventKey:
		var k: Key = e.keycode
		if k >= KEY_1 and k <= KEY_5:
			var id: String = ORDER[k - KEY_1]
			on[id] = not on[id]
			_apply()
		elif k == KEY_SPACE:
			_press(now)
		elif k == KEY_BRACKETLEFT:
			Beat.input_offset_ms -= 5.0
		elif k == KEY_BRACKETRIGHT:
			Beat.input_offset_ms += 5.0
		elif k == KEY_C and presses.size() >= 4:
			# Calibrate: take the typical offset of the presses so far as this player's delay.
			var sorted := presses.duplicate()
			sorted.sort()
			var mid := sorted.slice(1, sorted.size() - 1)
			var sum := 0.0
			for v in mid:
				sum += v
			Beat.input_offset_ms += round(sum / mid.size())
			presses.clear()
	elif e is InputEventMouseButton:
		_press(now)

func _press(usec: int) -> void:
	last = Beat.judge(usec)
	last_at = Beat.heard_time()
	presses.append(last["offset_ms"])
	if presses.size() > 24:
		presses.pop_front()
	mixer.shot(last["grade"])

func _apply() -> void:
	for id in ORDER:
		mixer.target[id] = 0.85 if on[id] else 0.0
	# The base pulse is heard until the drums are on.
	mixer.target["tick"] = 0.0 if on["drum"] else 0.4

func _process(delta: float) -> void:
	if state == "baking":
		# One layer per frame, so the screen can show progress.
		if bake_queue.is_empty():
			mixer.bake_shots()
			mixer.start()
			Beat.start()
			state = "playing"
			_apply()
		else:
			mixer.bake(song, bake_queue.pop_front(), Beat.bpm)
	_push += delta
	if _push > 0.2 and OS.has_feature("web"):
		_push = 0.0
		JavaScriptBridge.eval("window.__rmg = %s;" % JSON.stringify(_report()), true)
	queue_redraw()

func _report() -> Dictionary:
	return {
		"state": state, "step": Beat.step_f() if Beat.running else -1.0, "latencyMs": Beat.latency_ms(),
		"bakeMs": mixer.bake_ms, "presses": presses, "last": last, "inputOffsetMs": Beat.input_offset_ms,
		"fps": Engine.get_frames_per_second(), "seed": seed_value,
	}

func _draw() -> void:
	var size := get_viewport_rect().size
	var c := size / 2.0
	var font := ThemeDB.fallback_font
	draw_rect(Rect2(Vector2.ZERO, size), BG)
	if state == "idle":
		draw_circle(c, 46.0, INK)
		draw_colored_polygon(PackedVector2Array([c + Vector2(-12, -18), c + Vector2(20, 0), c + Vector2(-12, 18)]), BG)
		_text(font, c + Vector2(0, 92), "PRESS ANY KEY", 16, INK, true)
		return
	if state == "baking":
		var done := 6 - bake_queue.size()
		draw_arc(c, 46.0, -PI / 2, -PI / 2 + TAU * done / 6.0, 48, INK, 3.0, true)
		_text(font, c + Vector2(0, 92), "BAKING %d / 6" % done, 16, INK, true)
		return

	var phase := Beat.beat_phase()
	var pulse := exp(-phase * 5.0)
	var step := Beat.step_f()
	# The beat: a disc that swells on every quarter, inside the bar ring.
	draw_arc(c, 150.0, 0, TAU, 96, Color(INK, 0.25), 1.0, true)
	var bar := Beat.steps_per_bar()
	for s in bar:
		var a := -PI / 2 + TAU * s / bar
		var is_dodge := Beat.dodge_steps.has(s)
		var p := c + Vector2(cos(a), sin(a)) * 150.0
		draw_circle(p, 4.5 if is_dodge else 1.6, Color(INK, 0.9 if is_dodge else 0.4))
	var here := -PI / 2 + TAU * fposmod(step, bar) / bar
	draw_line(c + Vector2(cos(here), sin(here)) * 132.0, c + Vector2(cos(here), sin(here)) * 168.0, INK, 2.0, true)
	draw_circle(c, 30.0 * (1.0 + 0.22 * pulse), INK)

	# Layers: 1..5 toggles them.
	for i in ORDER.size():
		var id: String = ORDER[i]
		var p := Vector2(c.x - 160.0 + i * 80.0, c.y + 230.0)
		if on[id]:
			draw_circle(p, 14.0, LAYER_COLORS[id])
		else:
			draw_arc(p, 14.0, 0, TAU, 32, Color(INK, 0.45), 1.5, true)
		_text(font, p + Vector2(0, 40), "%d  %s" % [i + 1, id.to_upper()], 12, Color(INK, 0.7), true)

	# The last press and the spread of recent ones.
	var bx := c.x - 200.0
	var by := c.y - 250.0
	draw_rect(Rect2(bx, by, 400, 18), Color(INK, 0.08))
	var half := 60000.0 / Beat.bpm / 2.0
	var px := func(ms: float) -> float: return bx + 200.0 + clampf(ms / half, -1.0, 1.0) * 200.0
	draw_rect(Rect2(px.call(-Beat.near_ms), by, px.call(Beat.near_ms) - px.call(-Beat.near_ms), 18), Color(INK, 0.10))
	draw_rect(Rect2(px.call(-Beat.perfect_ms), by, px.call(Beat.perfect_ms) - px.call(-Beat.perfect_ms), 18), Color(INK, 0.16))
	for i in presses.size():
		var v := presses[i]
		var g := "perfect" if absf(v) <= Beat.perfect_ms else ("near" if absf(v) <= Beat.near_ms else "miss")
		draw_rect(Rect2(px.call(v) - 2, by + 22, 4, 8), Color(GRADE_COLORS[g], 0.3 + 0.7 * (i + 1.0) / presses.size()))
	if not last.is_empty():
		var age := Beat.heard_time() - last_at
		var col: Color = GRADE_COLORS[last["grade"]]
		_text(font, Vector2(c.x, by - 18), "%s   %+.0f ms" % [str(last["grade"]).to_upper(), last["offset_ms"]], 20, col, true)
		if age < 0.4:
			draw_arc(c, 40.0 + 60.0 * age / 0.4, 0, TAU, 64, Color(col, 1.0 - age / 0.4), 2.0, true)
	var mean := 0.0
	for v in presses:
		mean += v
	mean = mean / presses.size() if presses.size() > 0 else 0.0
	var sd := 0.0
	for v in presses:
		sd += (v - mean) * (v - mean)
	sd = sqrt(sd / presses.size()) if presses.size() > 0 else 0.0

	var lines := [
		"SPACE / CLICK  tap on the beat      1-5  layers      C  calibrate      [ ]  offset",
		"taps %d   mean %+.0f ms   sd %.0f ms   input offset %+.0f ms" % [presses.size(), mean, sd, Beat.input_offset_ms],
		"output latency %.0f ms   fps %d   bake %s ms   seed %d   %d bpm" % [Beat.latency_ms(), Engine.get_frames_per_second(), _bake_text(), seed_value, int(Beat.bpm)],
	]
	for i in lines.size():
		_text(font, Vector2(24, size.y - 62 + i * 18), lines[i], 12, Color(INK, 0.7), false)

func _bake_text() -> String:
	var total := 0.0
	for id in mixer.bake_ms:
		total += mixer.bake_ms[id]
	return "%.0f" % total

func _text(font: Font, pos: Vector2, s: String, size: int, col: Color, centred: bool) -> void:
	var w := font.get_string_size(s, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x
	draw_string(font, pos - Vector2(w / 2.0 if centred else 0.0, 0), s, HORIZONTAL_ALIGNMENT_LEFT, -1, size, col)
