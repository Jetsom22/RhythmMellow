class_name LayerMixer
extends Node
## Plays the baked loops of every layer in lock-step and fades them in and out.

const BUSES: Array[String] = ["drum", "hat", "bass", "lead", "pad", "tick"]

var players: Dictionary = {}     # id -> AudioStreamPlayer
var target: Dictionary = {}      # id -> linear gain
var _gain: Dictionary = {}
var _shots: Dictionary = {}      # name -> AudioStreamPlayer
var bake_ms: Dictionary = {}

func _player(stream: AudioStream) -> AudioStreamPlayer:
	var p := AudioStreamPlayer.new()
	p.stream = stream
	# The web's low-latency path. Elsewhere the default is already low-latency.
	if OS.has_feature("web"):
		p.playback_type = AudioServer.PLAYBACK_TYPE_SAMPLE
	add_child(p)
	return p

## Bake one layer. Returns the time it took, so slow machines can be spotted.
func bake(song: Song, id: String, bpm: float) -> float:
	var t0 := Time.get_ticks_usec()
	var notes: Array = song.tick if id == "tick" else song.layers[id]
	var p := _player(Synth.to_stream(Synth.render(notes, song.loop_steps, bpm), true))
	p.volume_db = -80.0
	players[id] = p
	target[id] = 0.0
	_gain[id] = 0.0
	bake_ms[id] = (Time.get_ticks_usec() - t0) / 1000.0
	return bake_ms[id]

func bake_shots() -> void:
	_shots["perfect"] = _player(Synth.to_stream(Synth.ping([1318.5, 1760.0], 0.12, 0.25), false))
	_shots["near"] = _player(Synth.to_stream(Synth.ping([880.0], 0.1, 0.18), false))
	_shots["miss"] = _player(Synth.to_stream(Synth.ping([196.0], 0.08, 0.2), false))

## Start every loop in the same frame.
func start() -> void:
	for id in players:
		players[id].play()

func shot(shot_name: String) -> void:
	if _shots.has(shot_name):
		_shots[shot_name].play()

func _process(delta: float) -> void:
	for id in players:
		_gain[id] = lerpf(_gain[id], target[id], minf(1.0, delta * 14.0))
		players[id].volume_db = linear_to_db(maxf(_gain[id], 0.0001))
