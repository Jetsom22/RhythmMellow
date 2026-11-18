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
## Where time comes from: a function returning the song time being heard, read from the audio.
## The system clock is only used to glide between readings; on its own it drifts from the sound.
var _source: Callable = Callable()
var _begin_usec := 0
var _heard := 0.0
var _heard_usec := 0

func set_meter(m: Dictionary) -> void:
	bpm = float(m.get("bpm", bpm))
	steps_per_beat = int(m.get("stepsPerBeat", 4))
	beats_per_bar = int(m.get("beatsPerBar", 4))
	strike_steps.assign(m.get("strikeSteps", [0, 4, 8, 12]))
	dodge_steps.assign(m.get("dodgeSteps", m.get("strikeSteps", [0, 4, 8, 12])))

func steps_per_bar() -> int:
	return steps_per_beat * beats_per_bar

func sec_per_step() -> float:
	return 60.0 / bpm / steps_per_beat

## Call in the same frame the looping layers start. `source` returns heard song time in seconds.
func start(source: Callable = Callable()) -> void:
	_source = source
	_begin_usec = Time.get_ticks_usec()
	_heard = source.call() if source.is_valid() else 0.0
	_heard_usec = _begin_usec
	running = true

func _process(_delta: float) -> void:
	if not running or not _source.is_valid():
		return
	var t: float = _source.call()
	var now := Time.get_ticks_usec()
	# Audio time arrives in small jumps. Glide toward it; snap only if it is far off.
	var coast := _heard + float(now - _heard_usec) / 1000000.0
	_heard = t if absf(t - coast) > 0.05 else lerpf(coast, t, 0.2)
	_heard_usec = now

## Song time the player is hearing right now, in seconds.
func heard_time() -> float:
	return heard_time_at(Time.get_ticks_usec())

func heard_time_at(usec: int) -> float:
	if not _source.is_valid():
		return float(usec - _begin_usec) / 1000000.0
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
