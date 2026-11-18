class_name LayerMixer
extends Node
## Plays the baked loops of every layer in lock-step and fades them in and out.
## Two ways of getting them out of the speakers:
##   web:    the browser's audio thread (WebAudio), because Godot's web audio cannot hold a beat
##   native: the engine's mixer, which loops to the exact sample on its own thread
## Either way the clock is read back from the audio, never from the system clock.

const BUSES: Array[String] = ["drum", "hat", "bass", "lead", "pad", "tick"]

var target: Dictionary = {}      # id -> linear gain
var bake_ms: Dictionary = {}
var loop_seconds := 0.0
var backend := "engine"

var _web: WebAudio = null
var _players: Dictionary = {}    # id -> AudioStreamPlayer (native)
var _shots: Dictionary = {}
var _gain: Dictionary = {}
var _sent: Dictionary = {}
var _wraps := 0
var _last_raw := 0.0

func _ready() -> void:
	if WebAudio.available():
		_web = WebAudio.new()
		_web.install()
		backend = "browser audio thread"

func _player(stream: AudioStream) -> AudioStreamPlayer:
	var p := AudioStreamPlayer.new()
	p.stream = stream
	p.playback_type = AudioServer.PLAYBACK_TYPE_STREAM
	add_child(p)
	return p

## Bake one layer. Returns the time it took, so slow machines can be spotted.
func bake(song: Song, id: String, bpm: float, timbre: Dictionary = {}) -> float:
	var t0 := Time.get_ticks_usec()
	var notes: Array = song.tick if id == "tick" else song.layers[id]
	var buf := Synth.render(notes, song.loop_steps, bpm, 1.0, timbre)
	loop_seconds = float(buf.size()) / Synth.SR
	if _web:
		_web.add_loop(id, buf)
	else:
		var p := _player(Synth.to_stream(buf, true))
		p.volume_db = -80.0
		_players[id] = p
	target[id] = 0.0
	_gain[id] = 0.0
	_sent[id] = -1.0
	bake_ms[id] = (Time.get_ticks_usec() - t0) / 1000.0
	return bake_ms[id]

## Change one layer's timbre while the music plays, without losing its place in the bar.
func rebake(song: Song, id: String, bpm: float, timbre: Dictionary) -> void:
	var buf := Synth.render(song.layers[id], song.loop_steps, bpm, 1.0, timbre)
	if _web:
		_web.replace_loop(id, buf)
	else:
		var p: AudioStreamPlayer = _players[id]
		p.stream = Synth.to_stream(buf, true)
		p.play(_players["tick"].get_playback_position())

func bake_shots() -> void:
	var shots := {
		"perfect": Synth.ping([1318.5, 1760.0], 0.12, 0.25),
		"near": Synth.ping([880.0], 0.1, 0.18),
		"miss": Synth.ping([196.0], 0.08, 0.2),
	}
	for id in shots:
		if _web:
			_web.add_shot(id, shots[id])
		else:
			_shots[id] = _player(Synth.to_stream(shots[id], false))

## Start every loop at the same instant.
func start() -> void:
	if _web:
		_web.start()
	else:
		for id in _players:
			_players[id].play()

## Song time being heard right now, read from the audio itself.
func heard_time() -> float:
	if _web:
		return _web.time()
	var ref: AudioStreamPlayer = _players["tick"]
	var raw := ref.get_playback_position()
	if raw < _last_raw - loop_seconds * 0.5:
		_wraps += 1         # the position returns to zero every lap
	_last_raw = raw
	return _wraps * loop_seconds + raw + AudioServer.get_time_since_last_mix() - AudioServer.get_output_latency()

func delay_ms() -> float:
	return _web.delay_ms() if _web else AudioServer.get_output_latency() * 1000.0

func shot(shot_name: String) -> void:
	if _web:
		_web.shot(shot_name)
	elif _shots.has(shot_name):
		_shots[shot_name].play()

func _process(delta: float) -> void:
	for id in target:
		if _web:
			if _sent[id] != target[id]:
				_sent[id] = target[id]
				_web.set_gain(id, target[id])
		else:
			_gain[id] = lerpf(_gain[id], target[id], minf(1.0, delta * 14.0))
			_players[id].volume_db = linear_to_db(maxf(_gain[id], 0.0001))
