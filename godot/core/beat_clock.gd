extends Node
## The one clock of the game (autoload "Beat").
## Song time is derived from the system clock at the moment playback started,
## shifted by the audio output latency, as the Godot docs recommend for rhythm games.
##
## The meter is data, never assumed: a chapter supplies it.
##   strike grid: steps in a bar where enemy hits may land (the stage's own)
##   dodge grid:  steps in a bar that evasion is judged against (the equipped drum's)
## They are the same on a first playthrough and differ in hard mode.

var bpm := 110.0
var steps_per_beat := 4
var beats_per_bar := 4
var strike_steps: Array[int] = [0, 4, 8, 12]
var dodge_steps: Array[int] = [0, 4, 8, 12]

var perfect_ms := 60.0
var near_ms := 120.0
## Extra delay of this player's hands and display, found by calibration.
var input_offset_ms := 0.0

var running := false
var _begin_usec := 0
var _latency := 0.0
## When set, time is read from the audio itself: the playing position of one looping layer.
## The system clock drifts away from the sound; the sound cannot drift away from itself.
var _ref: AudioStreamPlayer = null
var _loop_len := 0.0
var _wraps := 0
var _last_raw := 0.0
var _heard := 0.0
var _heard_usec := 0

func set_meter(m: Dictionary) -> void:
	steps_per_beat = int(m.get("stepsPerBeat", 4))
	beats_per_bar = int(m.get("beatsPerBar", 4))
	strike_steps.assign(m.get("strikeSteps", [0, 4, 8, 12]))
	dodge_steps.assign(m.get("dodgeSteps", m.get("strikeSteps", [0, 4, 8, 12])))

func steps_per_bar() -> int:
	return steps_per_beat * beats_per_bar

func sec_per_step() -> float:
	return 60.0 / bpm / steps_per_beat

## Call in the same frame the looping layers start playing.
## `reference` is one of those layers and `loop_len` its length in seconds.
func start(reference: AudioStreamPlayer = null, loop_len: float = 0.0) -> void:
	_begin_usec = Time.get_ticks_usec()
	_latency = AudioServer.get_output_latency()
	_ref = reference
	_loop_len = loop_len
	_wraps = 0
	_last_raw = 0.0
	_heard = -_latency
	_heard_usec = _begin_usec
	running = true

func latency_ms() -> float:
	return _latency * 1000.0

## Delay the engine cannot see: on the web, the browser's own output path after the engine's mixer.
func set_device_latency(seconds: float) -> void:
	_latency = AudioServer.get_output_latency() + maxf(0.0, seconds)

func _process(_delta: float) -> void:
	if not running or _ref == null:
		return
	# The position jumps back to zero each time the loop comes round: count the laps.
	var raw := _ref.get_playback_position()
	if raw < _last_raw - _loop_len * 0.5:
		_wraps += 1
	_last_raw = raw
	var t := _wraps * _loop_len + raw + AudioServer.get_time_since_last_mix() - _latency
	# The mixer reports in chunks; never let the clock step backwards.
	var now := Time.get_ticks_usec()
	var coast := _heard + float(now - _heard_usec) / 1000000.0
	_heard = t if absf(t - coast) > 0.05 else lerpf(coast, t, 0.2)
	_heard_usec = now

## Song time the player is hearing right now, in seconds.
func heard_time() -> float:
	return heard_time_at(Time.get_ticks_usec())

func heard_time_at(usec: int) -> float:
	if _ref == null:
		return float(usec - _begin_usec) / 1000000.0 - _latency
	return _heard + float(usec - _heard_usec) / 1000000.0

func step_f() -> float:
	return heard_time() / sec_per_step()

## 0..1 since the last quarter beat.
func beat_phase() -> float:
	return fposmod(step_f() / steps_per_beat, 1.0)

## Judge a press made at system time `usec` against the dodge grid.
func judge(usec: int) -> Dictionary:
	return judge_time(heard_time_at(usec) - input_offset_ms / 1000.0)

## Pure: judge song time `t`. Returns { grade, offset_ms (positive = late), step }.
func judge_time(t: float) -> Dictionary:
	var sps := sec_per_step()
	var bar := steps_per_bar()
	var here := floori(t / sps / bar)
	var best_step := 0
	var best_off := INF
	for b in [here - 1, here, here + 1]:
		for s in dodge_steps:
			var st: int = b * bar + s
			var off := (t - st * sps) * 1000.0
			if absf(off) < absf(best_off):
				best_off = off
				best_step = st
	var a := absf(best_off)
	var grade := "perfect" if a <= perfect_ms else ("near" if a <= near_ms else "miss")
	return {"grade": grade, "offset_ms": best_off, "step": best_step}
