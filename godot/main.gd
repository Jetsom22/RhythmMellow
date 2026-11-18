extends Node2D
## Entry point. The game by default; ?lab=1 opens the beat lab (timing and sound checks).

func _ready() -> void:
	var lab := false
	if OS.has_feature("web"):
		lab = str(JavaScriptBridge.eval("new URLSearchParams(location.search).get('lab') || ''", true)) != ""
	else:
		lab = OS.get_cmdline_user_args().has("--lab")
	var scene := Node2D.new()
	scene.set_script(load("res://lab/lab.gd" if lab else "res://game/game.gd"))
	add_child(scene)
