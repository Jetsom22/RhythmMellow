class_name Meter
extends RefCounted
## A chapter's meter, as data. Two grids, kept apart from the start:
##   strike grid: steps in a bar where enemy attacks may land (the stage's own)
##   dodge grid:  steps in a bar that a dash is judged against (the equipped drum's)
## They are the same on a first playthrough and differ in hard mode.

var bpm := 110.0
var steps_per_beat := 4
var beats_per_bar := 4
var strike_steps: Array[int] = [0, 4, 8, 12]
var dodge_steps: Array[int] = [0, 4, 8, 12]
var perfect_ms := 60.0
var near_ms := 120.0

static func from_dict(d: Dictionary) -> Meter:
	var m := Meter.new()
	m.bpm = float(d.get("bpm", 110.0))
	m.steps_per_beat = int(d.get("stepsPerBeat", 4))
	m.beats_per_bar = int(d.get("beatsPerBar", 4))
	m.strike_steps.assign(d.get("strikeSteps", [0, 4, 8, 12]))
	m.dodge_steps.assign(d.get("dodgeSteps", d.get("strikeSteps", [0, 4, 8, 12])))
	return m

func steps_per_bar() -> int:
	return steps_per_beat * beats_per_bar

func sec_per_step() -> float:
	return 60.0 / bpm / steps_per_beat

func sec_per_beat() -> float:
	return 60.0 / bpm

func is_strike_step(step: int) -> bool:
	return strike_steps.has(posmod(step, steps_per_bar()))

## Judge song time `t` against the dodge grid. Returns { grade, offset_ms (positive = late), step }.
func judge(t: float) -> Dictionary:
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
