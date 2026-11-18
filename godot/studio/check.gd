extends SceneTree
## Headless checks for the score: every layer of every scene bakes cleanly.
##   godot --headless --path godot -s res://studio/check.gd [-- <dir to write WAVs into>]
## Exits non-zero if any check fails.

var failed := 0

func check(what: String, ok: bool, detail: String = "") -> void:
	if not ok:
		failed += 1
		print("FAIL  %s  %s" % [what, detail])

func _init() -> void:
	var args := OS.get_cmdline_user_args()
	var score := ScoreLibrary.demo()
	# A score survives being saved and loaded: the same text, the same sound.
	var again := Score.from_text(Score.to_text(score))
	check("a score reads back from its own text", not again.is_empty())
	var total_ms := 0
	for scene_id in score["scenes"]:
		var want := Score.scene_samples(score, scene_id)
		var sum := PackedFloat32Array()
		sum.resize(want)
		for id in Score.TRACKS:
			var t0 := Time.get_ticks_msec()
			var buf := Score.bake(score, scene_id, id)
			var ms := Time.get_ticks_msec() - t0
			total_ms += ms
			var top := Mix.peak(buf)
			check("%s/%s is as long as its scene" % [scene_id, id], buf.size() == want, "%d vs %d" % [buf.size(), want])
			check("%s/%s makes a sound" % [scene_id, id], top > 0.01, str(top))
			check("%s/%s does not clip" % [scene_id, id], top <= 1.0, str(top))
			var bad := false
			for v in buf:
				if is_nan(v) or is_inf(v):
					bad = true
					break
			check("%s/%s has no broken samples" % [scene_id, id], not bad)
			check("%s/%s is the same after a save and load" % [scene_id, id], Score.key_of(score, scene_id, id) == Score.key_of(again, scene_id, id))
			for i in want:
				sum[i] += buf[i]
			print("BAKED %-8s %-5s %4d ms  %2d notes  peak %.2f  sounding %.1f dB" % [scene_id, id, ms, Score.notes(score, scene_id, id).size(), top, Mix.sounding_db(buf)])
			if args.size() > 0:
				Synth.to_stream(buf, false).save_to_wav("%s/%s-%s.wav" % [args[0], scene_id.replace(" ", ""), id])
		check("%s: the layers together stay under the ceiling" % scene_id, Mix.peak(sum) <= 1.5, str(Mix.peak(sum)))
		print("SCENE %-8s all layers peak %.2f" % [scene_id, Mix.peak(sum)])
		# Kick and snare are where the meter puts them.
		var kicks := []
		var snares := []
		var bar := Score.steps_per_bar(score)
		for n in Score.notes(score, scene_id, "drum"):
			if n["voice"] == "kick" and n["vel"] > 0.7: kicks.append(int(n["step"]) % bar)
			if n["voice"] == "snare": snares.append(int(n["step"]) % bar)
		for s in score["meter"]["kick"]:
			check("%s: a kick on step %d" % [scene_id, s], kicks.has(int(s)))
		for s in score["meter"]["snare"]:
			check("%s: a snare on step %d" % [scene_id, s], snares.has(int(s)))
	# The seed decides the notes; a part's roll changes that part only.
	var other := score.duplicate(true)
	other["seed"] = 8
	check("another seed, another bass line", JSON.stringify(Score.notes(score, "phase 1", "bass")) != JSON.stringify(Score.notes(other, "phase 1", "bass")))
	var rolled := score.duplicate(true)
	rolled["parts"]["lead line"]["roll"] = 1
	check("a roll changes its own part", JSON.stringify(Score.notes(score, "explore", "lead")) != JSON.stringify(Score.notes(rolled, "explore", "lead")))
	check("a roll leaves the other parts alone", JSON.stringify(Score.notes(score, "explore", "bass")) == JSON.stringify(Score.notes(rolled, "explore", "bass")))
	print("%d ms to bake everything. %s" % [total_ms, "ALL PASSED" if failed == 0 else "%d FAILED" % failed])
	quit(1 if failed > 0 else 0)
