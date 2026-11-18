extends SceneTree
## Prints the generated song as JSON. Usage:
##   godot --headless --path godot -s res://tools/dump_song.gd -- <seed>

func _init() -> void:
	var args := OS.get_cmdline_user_args()
	var seed_in := int(args[0]) if args.size() > 0 else 7
	print("SONG " + JSON.stringify(Song.generate(seed_in, 2).to_dict()))
	quit()
