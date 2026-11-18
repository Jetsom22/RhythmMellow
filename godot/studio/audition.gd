class_name Audition
extends Node
## Plays the studio's loops. It goes out the same way the game's music does (the browser's audio
## thread on the web, the engine's mixer elsewhere), through the same master compression, so
## what is heard here is what the game will play.
##
## It uses WebAudio as it is and changes nothing in it.

var started := false
var _web: WebAudio = null
var _players: Dictionary = {}

func _ready() -> void:
	if WebAudio.available():
		_web = WebAudio.new()
		_web.install()

## Give a layer its loop. Before start() every layer needs one; after it, the new loop takes over in place.
func set_loop(id: String, buf: PackedFloat32Array) -> void:
	if _web:
		if started:
			_web.replace_loop(id, buf)
		else:
			_web.add_loop(id, buf)
		return
	var at := 0.0
	if _players.has(id):
		at = _players[id].get_playback_position()
		_players[id].queue_free()
	var p := AudioStreamPlayer.new()
	p.stream = Synth.to_stream(buf, true)
	p.volume_db = -80.0
	add_child(p)
	_players[id] = p
	if started:
		p.play(fmod(at, float(buf.size()) / Synth.SR))

func start() -> void:
	started = true
	if _web:
		_web.start()
	else:
		for id in _players:
			_players[id].play()

func set_gain(id: String, v: float) -> void:
	if _web:
		_web.set_gain(id, v)
	elif _players.has(id):
		_players[id].volume_db = linear_to_db(maxf(v, 0.0001))

## Seconds of music heard since the start.
func time() -> float:
	if not started:
		return 0.0
	if _web:
		return maxf(0.0, _web.time())
	for id in _players:
		return _players[id].get_playback_position()
	return 0.0
