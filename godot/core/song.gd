class_name Song
extends RefCounted
## A song generated from a seed: one looping pattern per layer.
## Port of src/core/music/song.ts. A note is { step, len, midi, vel, voice };
## step is the position inside the loop and len is in steps.

const LAYERS: Array[String] = ["drum", "hat", "bass", "lead", "pad"]
const MINOR_PENTATONIC: Array[int] = [0, 3, 5, 7, 10]
const STEPS_PER_BAR := 16

var seed_value: int
var loop_steps: int
var root_midi: int
var scale: Array[int] = MINOR_PENTATONIC
var chord_roots: Array[int] = []
var layers: Dictionary = {}     # layer id -> Array of notes
var tick: Array = []

## Spread `pulses` hits as evenly as possible over `steps` slots.
static func euclid(pulses: int, steps: int, rotate: int = 0) -> Array[bool]:
	var out: Array[bool] = []
	for i in steps:
		var j := posmod(i - rotate, steps)
		out.append(floori(float(j * pulses) / steps) != floori(float((j - 1) * pulses) / steps))
	return out

## Pitch of the scale tone `index` steps above the root (may exceed one octave).
static func scale_tone(sc: Array[int], index: int) -> int:
	return sc[posmod(index, sc.size())] + 12 * floori(float(index) / sc.size())

static func _note(step: int, length: int, midi: int, vel: float, voice: String) -> Dictionary:
	return {"step": step, "len": length, "midi": midi, "vel": vel, "voice": voice}

static func generate(seed_in: int, loop_bars: int) -> Song:
	var s := Song.new()
	var rnd := Rng.new(seed_in)
	var sc := MINOR_PENTATONIC
	s.seed_value = seed_in
	s.root_midi = 45 + int(floor(rnd.next() * 8))
	s.loop_steps = loop_bars * STEPS_PER_BAR
	for b in loop_bars:
		s.chord_roots.append(0 if b == 0 else int(rnd.pick([3, 5, 7, 10])))

	var drum: Array = []
	var hat: Array = []
	var bass: Array = []
	var lead: Array = []
	var pad: Array = []
	var pulses := 3 + int(floor(rnd.next() * 3))
	var hat16 := euclid(pulses, 16, int(floor(rnd.next() * 16)))

	var degree := sc.size()     # lead starts one octave up
	for b in loop_bars:
		var o := b * STEPS_PER_BAR
		# Drums: the skeleton never moves; ornaments sit off the quarter beats.
		drum.append(_note(o, 1, 36, 1.0, "kick"))
		drum.append(_note(o + 8, 1, 36, 1.0, "kick"))
		drum.append(_note(o + 4, 1, 38, 0.9, "snare"))
		drum.append(_note(o + 12, 1, 38, 0.9, "snare"))
		if rnd.next() < 0.6:
			drum.append(_note(o + int(rnd.pick([7, 10, 14])), 1, 36, 0.6, "kick"))

		# Hats: every off-beat, plus some 16ths, never on a quarter beat.
		for i in 16:
			if i % 4 == 2:
				hat.append(_note(o + i, 1, 90, 0.8, "hat"))
			elif i % 4 != 0 and hat16[i]:
				hat.append(_note(o + i, 1, 90, 0.4, "hat"))

		# Bass: long notes on the chord root, always leaving a rest of 6+ steps.
		var root_pitch := s.root_midi - 12 + s.chord_roots[b]
		var shape: Array = rnd.pick([[[0, 8]], [[0, 4], [6, 4]], [[0, 10]], [[0, 6]]])
		for i in shape.size():
			var up := 12 if (i == 1 and rnd.next() < 0.5) else 0
			bass.append(_note(o + int(shape[i][0]), int(shape[i][1]), root_pitch + up, 0.9, "bass"))

		# Lead: a note on every bar start, then a wandering line on the 8th grid.
		for i in range(0, 16, 2):
			if i != 0 and rnd.next() < 0.4:
				continue
			degree = maxi(sc.size() - 2, mini(sc.size() * 2 + 2, degree + int(rnd.pick([-2, -1, -1, 1, 1, 2]))))
			if i == 0:
				degree = sc.size() + sc.find(s.chord_roots[b]) + int(rnd.pick([0, 2]))
			lead.append(_note(o + i, int(rnd.pick([2, 2, 3, 4])), s.root_midi + scale_tone(sc, degree), 0.8, "lead"))

		# Pad: three stacked scale tones over the chord root, held for the bar.
		var ci := sc.find(s.chord_roots[b])
		for k in [0, 2, 4]:
			pad.append(_note(o, 16, s.root_midi + 12 + scale_tone(sc, ci + k), 0.5, "pad"))

		for i in range(0, 16, 4):
			s.tick.append(_note(o + i, 1, 84, 1.0 if i == 0 else 0.6, "tick"))

	s.layers = {"drum": drum, "hat": hat, "bass": bass, "lead": lead, "pad": pad}
	return s

## Plain data, for comparing against the web prototype.
func to_dict() -> Dictionary:
	return {
		"seed": seed_value, "loopSteps": loop_steps, "rootMidi": root_midi,
		"scale": scale, "chordRoots": chord_roots, "layers": layers, "tick": tick,
	}
