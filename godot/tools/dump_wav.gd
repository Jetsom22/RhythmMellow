extends SceneTree
## Writes every baked layer to a WAV file, for analysis outside the engine.
##   godot --headless --path godot -s res://tools/dump_wav.gd -- <dir> [seed] [bass] [lead]

func _init() -> void:
	var args := OS.get_cmdline_user_args()
	var dir := args[0] if args.size() > 0 else "user://"
	var seed_in := int(args[1]) if args.size() > 1 else 7
	var timbre := {"bass": int(args[2]) if args.size() > 2 else 0, "lead": int(args[3]) if args.size() > 3 else 0}
	var song := Song.generate(seed_in, 2)
	for id in ["drum", "hat", "bass", "lead", "pad"]:
		var t0 := Time.get_ticks_msec()
		var buf := Synth.render(song.layers[id], song.loop_steps, 110.0, 1.0, timbre, Synth.kick_steps_of(song))
		Synth.to_stream(buf, false).save_to_wav("%s/%s.wav" % [dir, id])
		print("BAKED %s %d ms" % [id, Time.get_ticks_msec() - t0])
	quit()
