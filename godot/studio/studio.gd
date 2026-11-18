extends Control
## The studio: write a stage's music and mix it, by ear, in the browser.
##
## Pick a scene (a state of the game), choose what each layer plays and on which instrument,
## and move the sliders. A change is baked with the same code the game uses and takes over in
## place, so what is heard here is what the game will play. The work is kept in the browser and
## can be saved to a file, which is what goes into the repository.

const BG := Color("1d1f1e")
const INK := Color("f1e9d8")
const LAYER_COLORS := {"drum": Color("5fa8b8"), "hat": Color("9fcabf"), "bass": Color("7d8fd0"), "lead": Color("e8584a"), "pad": Color("c9506b")}
const STORE := "rm.studio.score"
const CACHE_MAX := 40

var score: Dictionary = {}       # what is being edited
var kept: Dictionary = {}        # the version to compare against
var scene_id := ""
var sel := "bass"                # the layer whose settings are shown
var sel_voice := "note"
var compare := false
var playing := false
var muted := {}
var solo := ""

var audition: Audition
var _cache := {}                 # bake key -> buffer
var _cache_order: Array = []
var _loaded := {}                # layer -> bake key now playing
var _stale := true
var _pending := ""
var _edit_at := 0
var _store_at := 0
var _notes := {}
var _last_ms := 0
var _report_at := 0

var _top: HBoxContainer
var _tracks: VBoxContainer
var _tabs: TabContainer
var _pages := {}
var _status: Label
var _view: Control
var _scene_pick: OptionButton
var _play: Button
var _text: TextEdit

func _ready() -> void:
	audition = Audition.new()
	add_child(audition)
	kept = ScoreLibrary.demo()
	score = kept.duplicate(true)
	var stored := Score.from_text(_stored())
	if not stored.is_empty():
		score = stored
	scene_id = str(score["scenes"].keys()[0])
	_build()
	_refill()

# ---------------------------------------------------------------- layout

func _build() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	var bg := ColorRect.new()
	bg.color = BG
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(bg)
	var margin := MarginContainer.new()
	margin.set_anchors_preset(Control.PRESET_FULL_RECT)
	for side in ["left", "right", "top", "bottom"]:
		margin.add_theme_constant_override("margin_" + side, 10)
	add_child(margin)
	var column := VBoxContainer.new()
	margin.add_child(column)
	_top = HBoxContainer.new()
	column.add_child(_top)
	var body := HSplitContainer.new()
	body.size_flags_vertical = Control.SIZE_EXPAND_FILL
	column.add_child(body)
	var left := ScrollContainer.new()
	left.custom_minimum_size.x = 600
	left.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	body.add_child(left)
	_tracks = VBoxContainer.new()
	_tracks.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	left.add_child(_tracks)
	_tabs = TabContainer.new()
	_tabs.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	body.add_child(_tabs)
	for title in ["Sound", "Mix", "Part", "Scene", "Song", "File"]:
		var scroll := ScrollContainer.new()
		scroll.name = title
		_tabs.add_child(scroll)
		var page := VBoxContainer.new()
		page.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		scroll.add_child(page)
		_pages[title] = page
	_view = Control.new()
	_view.custom_minimum_size.y = 150
	_view.draw.connect(_draw_notes)
	column.add_child(_view)

func _clear(node: Node) -> void:
	for child in node.get_children():
		node.remove_child(child)
		child.queue_free()

func _refill() -> void:
	_fill_top()
	_fill_tracks()
	_fill_right()

func _fill_right() -> void:
	_fill_sound()
	_fill_mix()
	_fill_part()
	_fill_scene()
	_fill_song()
	_fill_file()

func _label(parent: Node, text: String, dim: bool = false) -> Label:
	var l := Label.new()
	l.text = text
	if parent is VBoxContainer:
		l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	if dim:
		l.modulate = Color(1, 1, 1, 0.6)
	parent.add_child(l)
	return l

func _button(parent: Node, text: String, pressed: Callable) -> Button:
	var b := Button.new()
	b.text = text
	b.pressed.connect(pressed)
	parent.add_child(b)
	return b

func _row(parent: Node) -> HBoxContainer:
	var row := HBoxContainer.new()
	parent.add_child(row)
	return row

func _fmt(v: float) -> String:
	if absf(v) >= 100.0:
		return "%.0f" % v
	if absf(v) >= 10.0:
		return "%.1f" % v
	return "%.2f" % v

## A labelled slider. `kind`: "lin", "log" or "int".
func _slider(parent: Node, text: String, lo: float, hi: float, value: float, kind: String, changed: Callable) -> void:
	var row := _row(parent)
	var name_label := Label.new()
	name_label.text = text
	name_label.custom_minimum_size.x = 120
	row.add_child(name_label)
	var s := HSlider.new()
	s.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	s.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	s.custom_minimum_size.x = 140
	var shown := Label.new()
	shown.custom_minimum_size.x = 60
	shown.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	var is_log := kind == "log"
	if is_log:
		s.min_value = 0.0
		s.max_value = 1.0
		s.step = 0.001
		s.value = log(clampf(value, lo, hi) / lo) / log(hi / lo)
	else:
		s.min_value = lo
		s.max_value = hi
		s.step = 1.0 if kind == "int" else (hi - lo) / 400.0
		s.value = value
	shown.text = _fmt(value)
	s.value_changed.connect(func(raw: float) -> void:
		var v := lo * pow(hi / lo, raw) if is_log else raw
		shown.text = _fmt(v)
		changed.call(v))
	row.add_child(s)
	row.add_child(shown)

func _options(parent: Node, items: Array, current: String, changed: Callable) -> OptionButton:
	var o := OptionButton.new()
	for i in items.size():
		o.add_item(str(items[i]))
		if str(items[i]) == current:
			o.select(i)
	o.item_selected.connect(func(i: int) -> void: changed.call(str(items[i])))
	parent.add_child(o)
	return o

func _sorted(d: Dictionary) -> Array:
	var names := d.keys()
	names.sort()
	return names

# ---------------------------------------------------------------- the score being edited

func _scene() -> Dictionary:
	return score["scenes"][scene_id]

func _track(id: String) -> Dictionary:
	var tracks: Dictionary = _scene()["tracks"]
	if not tracks.has(id):
		tracks[id] = {"part": "rest", "inst": ""}
	return tracks[id]

func _voices(id: String) -> Array:
	if id == "drum":
		return ["kick", "snare"]
	return ["hat"] if id == "hat" else ["note"]

func _inst_name() -> String:
	return Score.inst_name(_track(sel), sel_voice)

func _inst() -> Dictionary:
	return score["instruments"].get(_inst_name(), {})

func _part_name() -> String:
	return str(_track(sel).get("part", ""))

## Where an instrument or a part is used, so a change is not a surprise somewhere else.
func _used(kind: String, item: String) -> String:
	var where: Array = []
	for s in score["scenes"]:
		for id in score["scenes"][s].get("tracks", {}):
			var t: Dictionary = score["scenes"][s]["tracks"][id]
			var hit := false
			if kind == "part":
				hit = str(t.get("part", "")) == item
			else:
				var inst: Variant = t.get("inst", "")
				hit = inst.values().has(item) if inst is Dictionary else str(inst) == item
			if hit:
				where.append("%s/%s" % [s, id])
	return ", ".join(where)

func _touch() -> void:
	_stale = true
	_edit_at = Time.get_ticks_msec()
	_store_at = _edit_at + 1500

func _unique(d: Dictionary, base: String) -> String:
	var n := 2
	var out := base + " 2"
	while d.has(out):
		n += 1
		out = "%s %d" % [base, n]
	return out

# ---------------------------------------------------------------- top bar

func _fill_top() -> void:
	_clear(_top)
	_label(_top, "SCENE")
	_scene_pick = _options(_top, score["scenes"].keys(), scene_id, func(s: String) -> void:
		scene_id = s
		_loaded_reset()
		_touch()
		_refill())
	_play = _button(_top, "Stop" if playing else "Play", func() -> void:
		playing = not playing
		_play.text = "Stop" if playing else "Play"
		_apply_gains())
	var cmp := CheckButton.new()
	cmp.text = "Hear the kept version"
	cmp.button_pressed = compare
	cmp.toggled.connect(func(on: bool) -> void:
		compare = on
		_stale = true)
	_top.add_child(cmp)
	_button(_top, "Keep this", func() -> void:
		kept = score.duplicate(true)
		_stale = true)
	_button(_top, "Back to kept", func() -> void:
		score = kept.duplicate(true)
		if not score["scenes"].has(scene_id):
			scene_id = str(score["scenes"].keys()[0])
		_touch()
		_refill())
	_status = Label.new()
	_status.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_status.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	_top.add_child(_status)

# ---------------------------------------------------------------- layers

func _fill_tracks() -> void:
	_clear(_tracks)
	var parts := _sorted(score["parts"])
	var insts := _sorted(score["instruments"])
	for id in Score.TRACKS:
		var track := _track(id)
		var head := _row(_tracks)
		var pick := Button.new()
		pick.text = id.to_upper()
		pick.toggle_mode = true
		pick.button_pressed = id == sel
		pick.custom_minimum_size.x = 70
		pick.add_theme_color_override("font_color", LAYER_COLORS[id])
		pick.add_theme_color_override("font_pressed_color", LAYER_COLORS[id])
		pick.pressed.connect(func() -> void:
			sel = id
			sel_voice = _voices(id)[0]
			_fill_tracks()
			_fill_right())
		head.add_child(pick)
		var on := CheckBox.new()
		on.text = "on"
		on.button_pressed = not muted.get(id, false)
		on.toggled.connect(func(v: bool) -> void:
			muted[id] = not v
			_apply_gains())
		head.add_child(on)
		var only := CheckBox.new()
		only.text = "solo"
		only.button_pressed = solo == id
		only.toggled.connect(func(v: bool) -> void:
			solo = id if v else ""
			_apply_gains()
			_fill_tracks())
		head.add_child(only)
		_options(head, parts, str(track.get("part", "")), func(v: String) -> void:
			track["part"] = v
			_touch()
			_fill_right())
		for voice in _voices(id):
			_options(head, insts, Score.inst_name(track, voice), func(v: String) -> void:
				if id == "drum":
					if not (track.get("inst") is Dictionary):
						track["inst"] = {}
					track["inst"][voice] = v
				else:
					track["inst"] = v
				_touch()
				_fill_right())
		_slider(_tracks, "   fader dB", -24.0, 12.0, float(track.get("gain_db", 0.0)), "lin", func(v: float) -> void:
			track["gain_db"] = snappedf(v, 0.1)
			_store_at = Time.get_ticks_msec() + 1500
			_apply_gains())
		_tracks.add_child(HSeparator.new())

# ---------------------------------------------------------------- right side

func _voice_row(page: Node) -> void:
	if sel != "drum":
		return
	var row := _row(page)
	for voice in ["kick", "snare"]:
		var b := Button.new()
		b.text = voice
		b.toggle_mode = true
		b.button_pressed = voice == sel_voice
		b.pressed.connect(func() -> void:
			sel_voice = voice
			_fill_right())
		row.add_child(b)

func _copy_row(page: Node, what: String, made: Callable) -> void:
	var row := _row(page)
	var field := LineEdit.new()
	field.placeholder_text = "name for a copy"
	field.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(field)
	_button(row, "Copy as a new " + what, func() -> void: made.call(field.text.strip_edges()))

func _fill_sound() -> void:
	var page: VBoxContainer = _pages["Sound"]
	_clear(page)
	_voice_row(page)
	var inst_name := _inst_name()
	var inst := _inst()
	if inst.is_empty():
		_label(page, "This layer has no instrument in this scene.", true)
		return
	_label(page, "%s    (%s)" % [inst_name, inst.get("synth", "tone")])
	_label(page, "used in: " + _used("inst", inst_name), true)
	_copy_row(page, "instrument", func(given: String) -> void:
		var fresh := given if given != "" and not score["instruments"].has(given) else _unique(score["instruments"], inst_name)
		score["instruments"][fresh] = inst.duplicate(true)
		var track := _track(sel)
		if sel == "drum":
			track["inst"][sel_voice] = fresh
		else:
			track["inst"] = fresh
		_touch()
		_refill())
	if not inst.has("p"):
		inst["p"] = {}
	var p: Dictionary = inst["p"]
	var full := Voice.filled(inst)
	for row in Voice.PARAMS.get(str(inst.get("synth", "tone")), []):
		var key: String = row[0]
		_slider(page, key, row[1], row[2], float(full[key]), row[4], func(v: float) -> void:
			p[key] = v
			_touch())

func _fill_mix() -> void:
	var page: VBoxContainer = _pages["Mix"]
	_clear(page)
	_voice_row(page)
	var inst := _inst()
	if inst.is_empty():
		_label(page, "This layer has no instrument in this scene.", true)
		return
	if not inst.has("mix"):
		inst["mix"] = {"eq": [], "level_db": -20.0}
	var mix: Dictionary = inst["mix"]
	_label(page, "%s: mixing strip" % _inst_name())
	if mix.has("peak"):
		_slider(page, "level (peak)", 0.02, 1.0, float(mix["peak"]), "log", func(v: float) -> void:
			mix["peak"] = v
			_touch())
	else:
		if not mix.has("level_db"):
			mix["level_db"] = float(mix.get("rms_db", -20.0))
			mix.erase("rms_db")
		_slider(page, "level dB", -40.0, -6.0, float(mix["level_db"]), "lin", func(v: float) -> void:
			mix["level_db"] = v
			_touch())
	_slider(page, "room", 0.0, 0.6, float(mix.get("room", 0.0)), "lin", func(v: float) -> void:
		mix["room"] = v
		_touch())
	_slider(page, "duck under kick", 0.0, 0.9, float(mix.get("duck", 0.0)), "lin", func(v: float) -> void:
		mix["duck"] = v
		_touch())
	_slider(page, "duck release s", 0.04, 0.5, float(mix.get("duck_release", 0.16)), "log", func(v: float) -> void:
		mix["duck_release"] = v
		_touch())
	page.add_child(HSeparator.new())
	_label(page, "EQ")
	if not mix.has("eq"):
		mix["eq"] = []
	var eq: Array = mix["eq"]
	for i in eq.size():
		var band: Array = eq[i]
		var head := _row(page)
		_options(head, ["hp", "lp", "peak"], str(band[0]), func(v: String) -> void:
			band[0] = v
			_touch())
		_button(head, "remove", func() -> void:
			eq.remove_at(i)
			_touch()
			_fill_mix())
		_slider(page, "   Hz", 20.0, 16000.0, float(band[1]), "log", func(v: float) -> void:
			band[1] = v
			_touch())
		_slider(page, "   width (Q)", 0.3, 4.0, float(band[2]), "log", func(v: float) -> void:
			band[2] = v
			_touch())
		_slider(page, "   gain dB (peak)", -15.0, 15.0, float(band[3]), "lin", func(v: float) -> void:
			band[3] = v
			_touch())
	_button(page, "Add a band", func() -> void:
		eq.append(["peak", 1000.0, 1.0, 0.0])
		_touch()
		_fill_mix())

func _fill_part() -> void:
	var page: VBoxContainer = _pages["Part"]
	_clear(page)
	var part_name := _part_name()
	var part: Dictionary = score["parts"].get(part_name, {})
	if part.is_empty():
		_label(page, "This layer has no part in this scene.", true)
		return
	_label(page, part_name)
	_label(page, "used in: " + _used("part", part_name), true)
	_copy_row(page, "part", func(given: String) -> void:
		var fresh := given if given != "" and not score["parts"].has(given) else _unique(score["parts"], part_name)
		score["parts"][fresh] = part.duplicate(true)
		_track(sel)["part"] = fresh
		_touch()
		_refill())
	var head := _row(page)
	_label(head, "rule")
	_options(head, Score.RULES.keys(), str(part.get("rule", "rest")), func(v: String) -> void:
		part["rule"] = v
		part["p"] = {}
		_touch()
		_fill_part())
	_label(head, "   roll")
	var roll := SpinBox.new()
	roll.min_value = 0
	roll.max_value = 999
	roll.value = int(part.get("roll", 0))
	roll.value_changed.connect(func(v: float) -> void:
		part["roll"] = int(v)
		_touch())
	head.add_child(roll)
	_label(page, "The roll draws this part again from the seed. Nothing else changes.", true)
	if not part.has("p"):
		part["p"] = {}
	var p: Dictionary = part["p"]
	var full := Score.rule_defaults(str(part.get("rule", "rest")))
	for k in p:
		full[k] = p[k]
	for row in Score.RULES.get(str(part.get("rule", "rest")), []):
		var key: String = row[0]
		_slider(page, key, row[1], row[2], float(full[key]), row[4], func(v: float) -> void:
			p[key] = v
			_touch())

func _fill_scene() -> void:
	var page: VBoxContainer = _pages["Scene"]
	_clear(page)
	var scene := _scene()
	_label(page, "scene: " + scene_id)
	_slider(page, "bars", 1.0, 8.0, float(scene.get("bars", 2)), "int", func(v: float) -> void:
		scene["bars"] = int(v)
		_loaded_reset()
		_touch())
	_slider(page, "low-pass Hz", 200.0, 20000.0, float(scene.get("lp", 20000.0)), "log", func(v: float) -> void:
		scene["lp"] = v
		_touch())
	_slider(page, "high-pass Hz", 20.0, 2000.0, float(scene.get("hp", 20.0)), "log", func(v: float) -> void:
		scene["hp"] = v
		_touch())
	_label(page, "The filters are on every layer of this scene. Fully open (20000 and 20) is off.", true)
	_copy_row(page, "scene", func(given: String) -> void:
		var fresh := given if given != "" and not score["scenes"].has(given) else _unique(score["scenes"], scene_id)
		score["scenes"][fresh] = scene.duplicate(true)
		scene_id = fresh
		_loaded_reset()
		_touch()
		_refill())
	page.add_child(HSeparator.new())
	_label(page, "Which scene each state of the game plays")
	var states: Dictionary = score.get("states", {})
	for state in states:
		var row := _row(page)
		var l := _label(row, str(state))
		l.custom_minimum_size.x = 140
		_options(row, score["scenes"].keys(), str(states[state]), func(v: String) -> void:
			states[state] = v
			_store_at = Time.get_ticks_msec() + 1500)

func _fill_song() -> void:
	var page: VBoxContainer = _pages["Song"]
	_clear(page)
	_slider(page, "seed", 0.0, 999.0, float(score.get("seed", 7)), "int", func(v: float) -> void:
		score["seed"] = int(v)
		_touch())
	_slider(page, "bpm", 60.0, 180.0, float(score.get("bpm", 110)), "int", func(v: float) -> void:
		score["bpm"] = int(v)
		_loaded_reset()
		_touch())
	if not score.has("key"):
		score["key"] = {}
	var key: Dictionary = score["key"]
	var row := _row(page)
	_label(row, "scale")
	_options(row, Score.SCALES.keys(), str(key.get("scale", "minor_pentatonic")), func(v: String) -> void:
		key["scale"] = v
		_touch())
	_slider(page, "root (-1: from seed)", -1.0, 57.0, float(key.get("root", -1)), "int", func(v: float) -> void:
		key["root"] = int(v)
		_touch())
	_slider(page, "chords repeat every", 1.0, 8.0, float(key.get("bars", 4)), "int", func(v: float) -> void:
		key["bars"] = int(v)
		_touch())
	var h := Score.harmony(score)
	_label(page, "root %d, chords on scale steps %s" % [h["root"], str(h["chords"])], true)

func _fill_file() -> void:
	var page: VBoxContainer = _pages["File"]
	_clear(page)
	var row := _row(page)
	_button(row, "Save to a file", func() -> void:
		var text := Score.to_text(score)
		if OS.has_feature("web"):
			JavaScriptBridge.download_buffer(text.to_utf8_buffer(), "%s.json" % str(score.get("id", "score")), "application/json")
		_text.text = text)
	_button(row, "Show as text", func() -> void: _text.text = Score.to_text(score))
	_button(row, "Load the text below", func() -> void:
		var read := Score.from_text(_text.text)
		if read.is_empty():
			_status.text = "that text is not a score"
			return
		score = read
		scene_id = str(score["scenes"].keys()[0])
		_loaded_reset()
		_touch()
		_refill())
	_button(row, "Start over from the built-in score", func() -> void:
		score = ScoreLibrary.demo()
		kept = score.duplicate(true)
		scene_id = str(score["scenes"].keys()[0])
		_loaded_reset()
		_touch()
		_refill())
	_label(page, "The work is kept in this browser as you go. To hand it over, save it to a file (or copy the text) and give it to the sound session.", true)
	_text = TextEdit.new()
	_text.custom_minimum_size.y = 320
	_text.size_flags_vertical = Control.SIZE_EXPAND_FILL
	page.add_child(_text)

# ---------------------------------------------------------------- baking and playing

func _heard() -> Dictionary:
	return kept if compare else score

func _loaded_reset() -> void:
	_stale = true

func _fader(id: String) -> float:
	var s := _heard()
	var track: Dictionary = s["scenes"].get(scene_id, {}).get("tracks", {}).get(id, {})
	return 0.85 * pow(10.0, float(track.get("gain_db", 0.0)) / 20.0)

func _apply_gains() -> void:
	for id in Score.TRACKS:
		var on: bool = playing and not muted.get(id, false) and (solo == "" or solo == id)
		audition.set_gain(id, _fader(id) if on else 0.0)

func _cache_put(key: String, buf: PackedFloat32Array) -> void:
	_cache[key] = buf
	_cache_order.append(key)
	while _cache_order.size() > CACHE_MAX:
		_cache.erase(_cache_order.pop_front())

func _process(_delta: float) -> void:
	var now := Time.get_ticks_msec()
	if _store_at > 0 and now > _store_at:
		_store_at = 0
		_store(Score.to_text(score))
	_sync(now)
	_view.queue_redraw()
	if OS.has_feature("web") and now > _report_at:
		# For automated checks of the page: what the studio is doing right now.
		_report_at = now + 250
		JavaScriptBridge.eval("window.__rmStudio = %s;" % JSON.stringify({
			"scene": scene_id, "status": _status.text, "started": audition.started, "playing": playing,
			"stale": _stale, "lastBakeMs": _last_ms, "time": audition.time(), "fps": Engine.get_frames_per_second(),
		}), true)

## Bring what is playing in line with the score: bake what is missing (one layer a frame), then swap.
func _sync(now: int) -> void:
	var s := _heard()
	if not s["scenes"].has(scene_id):
		return
	if _pending != "":
		var id := _pending
		_pending = ""
		var t0 := Time.get_ticks_msec()
		_cache_put(Score.key_of(s, scene_id, id, false), Score.bake(s, scene_id, id, false))
		_last_ms = Time.get_ticks_msec() - t0
		_stale = true
	if not _stale:
		return
	var keys := {}
	for id in Score.TRACKS:
		keys[id] = Score.key_of(s, scene_id, id, false)
	for id in Score.TRACKS:
		if not _cache.has(keys[id]):
			if now - _edit_at < 250:
				return                      # a slider is still moving
			_pending = id
			_status.text = "baking %s ..." % id
			return                          # bake on the next frame, so the line above is seen
	# Everything is baked: swap in whatever differs, all in the same frame.
	for id in Score.TRACKS:
		if _loaded.get(id, "") != keys[id]:
			audition.set_loop(id, _cache[keys[id]])
			_loaded[id] = keys[id]
	if not audition.started:
		audition.start()
	_apply_gains()
	_notes.clear()
	for id in Score.TRACKS:
		_notes[id] = Score.notes(s, scene_id, id)
	_stale = false
	_status.text = "%s   last bake %d ms   %s" % ["kept version" if compare else "edited version", _last_ms, "web" if OS.has_feature("web") else "desktop"]

# ---------------------------------------------------------------- the notes

func _draw_notes() -> void:
	var size := _view.size
	_view.draw_rect(Rect2(Vector2.ZERO, size), Color(1, 1, 1, 0.04))
	var s := _heard()
	if not s["scenes"].has(scene_id):
		return
	var bar := Score.steps_per_bar(s)
	var total := float(Score.scene_bars(s, scene_id) * bar)
	var lane := size.y / Score.TRACKS.size()
	for b in range(0, int(total), Score.steps_per_beat(s)):
		var x := size.x * b / total
		_view.draw_line(Vector2(x, 0), Vector2(x, size.y), Color(1, 1, 1, 0.16 if b % bar == 0 else 0.05), 1.0)
	for i in Score.TRACKS.size():
		var id: String = Score.TRACKS[i]
		var list: Array = _notes.get(id, [])
		var lo := 200.0
		var hi := -200.0
		for n in list:
			lo = minf(lo, float(n["midi"]))
			hi = maxf(hi, float(n["midi"]))
		var col: Color = LAYER_COLORS[id]
		var quiet: bool = muted.get(id, false) or (solo != "" and solo != id)
		if id == sel:
			_view.draw_rect(Rect2(0, i * lane, size.x, lane), Color(col, 0.10))
		for n in list:
			var y := i * lane + lane * 0.5
			if hi > lo:
				y = i * lane + lane * (0.85 - 0.7 * (float(n["midi"]) - lo) / (hi - lo))
			var x := size.x * float(n["step"]) / total
			var w := maxf(2.0, size.x * float(n["len"]) / total - 1.0)
			_view.draw_rect(Rect2(x, y - 2.0, w, 4.0), Color(col, (0.25 if quiet else 0.4 + 0.6 * float(n["vel"]))))
	if audition.started:
		var length := float(Score.scene_samples(s, scene_id)) / Score.SR
		var x := size.x * fposmod(audition.time(), length) / length
		_view.draw_line(Vector2(x, 0), Vector2(x, size.y), INK, 1.5)

# ---------------------------------------------------------------- keeping the work in the browser

func _stored() -> String:
	if not OS.has_feature("web"):
		return ""
	var got: Variant = JavaScriptBridge.eval("(function(){try{return localStorage.getItem('%s')||''}catch(e){return ''}})()" % STORE, true)
	return str(got) if got != null else ""

func _store(text: String) -> void:
	if not OS.has_feature("web"):
		return
	JavaScriptBridge.eval("(function(){try{localStorage.setItem('%s', %s)}catch(e){}})()" % [STORE, JSON.stringify(text)], true)
