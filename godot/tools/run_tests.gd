extends SceneTree
## Headless checks. Usage: godot --headless --path godot -s res://tools/run_tests.gd
## Exits non-zero if any check fails.

var failed := 0
var passed := 0

func check(what: String, ok: bool, detail: String = "") -> void:
	if ok:
		passed += 1
	else:
		failed += 1
		print("FAIL  %s  %s" % [what, detail])

func near(a: float, b: float, eps: float = 0.001) -> bool:
	return absf(a - b) <= eps

func _init() -> void:
	# The clock is a plain node here: no autoload in a bare SceneTree script.
	var beat: Node = load("res://core/beat_clock.gd").new()
	beat.bpm = 120.0

	# Judging against a plain 4/4 dodge grid.
	check("on the beat is perfect", beat.judge_time(1.0)["grade"] == "perfect")
	check("59 ms late is perfect", beat.judge_time(1.059)["grade"] == "perfect")
	check("61 ms late is near", beat.judge_time(1.061)["grade"] == "near")
	check("119 ms early is near", beat.judge_time(0.881)["grade"] == "near")
	check("an off-beat is a miss", beat.judge_time(1.25)["grade"] == "miss")
	var j: Dictionary = beat.judge_time(1.03)
	check("offset is signed, positive = late", near(j["offset_ms"], 30.0, 0.01), str(j))
	check("the judged step is the nearest dodge step", j["step"] == 8, str(j))
	check("early presses judge against the coming beat", beat.judge_time(0.97)["step"] == 8 and near(beat.judge_time(0.97)["offset_ms"], -30.0, 0.01))
	check("a press just before time zero still judges", beat.judge_time(-0.02)["grade"] == "perfect")

	# The meter is data: a different dodge grid changes what counts as on the beat.
	beat.set_meter({"stepsPerBeat": 4, "beatsPerBar": 4, "strikeSteps": [0, 4, 8, 12], "dodgeSteps": [0, 3, 6, 10]})
	check("dodge grid can differ from the strike grid", beat.dodge_steps == [0, 3, 6, 10] and beat.strike_steps == [0, 4, 8, 12])
	check("step 3 is now on the beat", beat.judge_time(3 * 0.125)["grade"] == "perfect" and beat.judge_time(3 * 0.125)["step"] == 3)
	check("step 4 is no longer on the beat", beat.judge_time(4 * 0.125)["grade"] != "perfect")
	check("the grid repeats every bar", beat.judge_time((16 + 10) * 0.125)["step"] == 26)
	beat.set_meter({"stepsPerBeat": 4, "beatsPerBar": 3, "strikeSteps": [0, 4, 8]})
	check("a 3-beat bar has 12 steps", beat.steps_per_bar() == 12)
	check("with no dodge grid given, it follows the strike grid", beat.dodge_steps == [0, 4, 8])
	check("3/4: step 12 is the next bar's first beat", beat.judge_time(12 * 0.125)["step"] == 12 and beat.judge_time(12 * 0.125)["grade"] == "perfect")
	beat.free()

	# The song is deterministic and keeps its skeleton.
	var a := Song.generate(7, 2)
	var b := Song.generate(7, 2)
	check("same seed, same song", JSON.stringify(a.to_dict()) == JSON.stringify(b.to_dict()))
	check("different seed, different song", JSON.stringify(a.to_dict()) != JSON.stringify(Song.generate(8, 2).to_dict()))
	check("two bars are 32 steps", a.loop_steps == 32)
	var kicks := []
	var snares := []
	for n in a.layers["drum"]:
		if n["voice"] == "kick": kicks.append(n["step"])
		if n["voice"] == "snare": snares.append(n["step"])
	check("kick on beats 1 and 3", kicks.has(0) and kicks.has(8) and kicks.has(16) and kicks.has(24), str(kicks))
	check("snare on beats 2 and 4", snares.has(4) and snares.has(12) and snares.has(20) and snares.has(28), str(snares))
	var hats_ok := true
	for n in a.layers["hat"]:
		if int(n["step"]) % 4 == 0: hats_ok = false
	check("hats never sit on a quarter beat", hats_ok)
	check("euclid(3, 8)", Song.euclid(3, 8) == [true, false, false, true, false, false, true, false])

	# Baked loops are exactly as long as the music, so layers stay in step forever.
	var buf := Synth.render(a.layers["drum"], a.loop_steps, 110.0)
	var want := int(round(32 * (60.0 / 110.0 / 4.0) * Synth.SR))
	check("loop length matches the music", buf.size() == want, "%d vs %d" % [buf.size(), want])
	var peak := 0.0
	for v in buf: peak = maxf(peak, absf(v))
	check("the drum loop is audible and leaves headroom", peak > 0.2 and peak <= 1.0, str(peak))
	check("every layer bakes to the same length", Synth.render(a.layers["pad"], a.loop_steps, 110.0).size() == want and Synth.render(a.tick, a.loop_steps, 110.0).size() == want)
	var st := Synth.to_stream(buf, true)
	check("the stream loops over its whole length", st.loop_mode == AudioStreamWAV.LOOP_FORWARD and st.loop_end == want and st.data.size() == want * 2)

	# Every bass and lead timbre must bake to a sound that is audible, finite and not clipping.
	for layer in ["bass", "lead"]:
		var names: Array[String] = Synth.BASS_PRESETS if layer == "bass" else Synth.LEAD_PRESETS
		for k in names.size():
			var out := Synth.render(a.layers[layer], a.loop_steps, 110.0, 1.0, {layer: k})
			var top := 0.0
			var bad := false
			var energy := 0.0
			for v in out:
				if is_nan(v) or is_inf(v): bad = true
				top = maxf(top, absf(v))
				energy += v * v
			var rms := sqrt(energy / out.size())
			check("%s '%s' bakes cleanly" % [layer, names[k]], not bad and out.size() == want and top > 0.1 and top <= 0.9 and rms > 0.02, "peak %.3f rms %.3f" % [top, rms])
	check("timbres differ from one another", Synth.render(a.layers["bass"], a.loop_steps, 110.0, 1.0, {"bass": 0}) != Synth.render(a.layers["bass"], a.loop_steps, 110.0, 1.0, {"bass": 1}))
	check("the band-limited saw has no step at the wrap", absf(Synth._saw(0.9999, 0.01) - Synth._saw(0.0001, 0.01)) < 0.05)

	print("%d passed, %d failed" % [passed, failed])
	quit(1 if failed > 0 else 0)
