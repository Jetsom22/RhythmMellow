class_name ScoreLibrary
extends RefCounted
## The scores that ship with the build. For now one: a starting point that carries over the
## first voices and the first mix, arranged into the scenes of a boss fight.
##
## Nothing here has been judged by ear yet. It is a place to start from in the studio.

static func _strip(eq: Array, more: Dictionary) -> Dictionary:
	var out := {"eq": eq}
	out.merge(more)
	return out

static func demo() -> Dictionary:
	var bass_eq := [["hp", 36.0, 0.7, 0.0], ["peak", 58.0, 1.0, -3.0], ["peak", 105.0, 1.0, 1.5], ["peak", 280.0, 1.0, -4.5], ["peak", 800.0, 0.9, 2.5], ["lp", 2400.0, 0.7, 0.0]]
	var lead_eq := [["hp", 420.0, 0.7, 0.0], ["peak", 520.0, 1.0, -2.5], ["peak", 3200.0, 0.8, 1.5], ["lp", 8500.0, 0.7, 0.0]]
	var bass_mix := {"level_db": -17.5, "duck": 0.45, "duck_release": 0.16}
	var lead_mix := {"level_db": -20.7, "room": 0.2}
	return {
		"id": "demo", "bpm": 110, "seed": 7,
		"meter": {"stepsPerBeat": 4, "beatsPerBar": 4, "kick": [0, 8], "snare": [4, 12]},
		"key": {"scale": "minor_pentatonic", "root": -1, "bars": 4, "chords": []},
		"instruments": {
			"kick": {"synth": "kick", "p": {}, "mix": _strip([["hp", 30.0, 0.7, 0.0], ["peak", 62.0, 1.0, 2.0], ["peak", 320.0, 1.2, -4.0], ["lp", 6000.0, 0.7, 0.0]], {"peak": 0.82})},
			"snare": {"synth": "snare", "p": {}, "mix": _strip([["hp", 170.0, 0.7, 0.0], ["peak", 220.0, 1.0, 1.5], ["peak", 3000.0, 0.9, 2.0], ["lp", 10000.0, 0.7, 0.0]], {"peak": 0.42, "room": 0.16})},
			"hat": {"synth": "hat", "p": {}, "mix": _strip([["hp", 6000.0, 0.7, 0.0], ["lp", 15000.0, 0.7, 0.0]], {"peak": 0.16, "room": 0.05})},
			"bass sub": {"synth": "tone", "p": {"oct": 12, "sub": 0.7, "saw": 0.6, "cutoff": 140, "env": 1500, "env_decay": 8, "reso": 0.41, "drive": 0.1, "release": 0.08}, "mix": _strip(bass_eq, bass_mix)},
			"bass round": {"synth": "tone", "p": {"oct": 12, "sub": 0.8, "sine": 0.18, "tri": 0.28, "cutoff": 300, "env": 900, "env_decay": 3, "reso": 0.2, "drive": 0.1, "release": 0.08}, "mix": _strip(bass_eq, bass_mix)},
			"bass fm": {"synth": "tone", "p": {"sine": 0.85, "fm": 2.85, "fm_ratio": 2, "fm_decay": 16, "fm_hold": 0.09, "drive": 0.1, "release": 0.08}, "mix": _strip(bass_eq, bass_mix)},
			# Short notes, a filter that snaps shut, accents and slides: made for the bass_pulse rule, not for long notes.
			"bass acid": {"synth": "tone", "p": {"oct": 12, "sub": 0.45, "saw": 0.8, "cutoff": 220, "env": 1800, "env_decay": 14, "reso": 0.8, "accent": 0.6, "glide": 0.05, "gate": 0.55, "release": 0.04}, "mix": _strip(bass_eq, bass_mix)},
			"lead bell": {"synth": "tone", "p": {"oct": 12, "sine": 1.0, "fm": 2.2, "fm_ratio": 2, "fm_decay": 8, "fm_hold": 0.1, "attack": 0.004, "decay": 0.31, "sustain": 0.4, "release": 0.3, "vib": 6, "echo": 0.28}, "mix": _strip(lead_eq, lead_mix)},
			"lead pulse": {"synth": "tone", "p": {"oct": 12, "pulse": 1.0, "pw": 0.32, "cutoff": 900, "env": 1700, "env_decay": 6, "reso": 0.55, "attack": 0.012, "decay": 0.25, "sustain": 0.6, "release": 0.16, "vib": 6, "echo": 0.28}, "mix": _strip(lead_eq, lead_mix)},
			"lead glass": {"synth": "tone", "p": {"oct": 12, "sine": 0.85, "fm": 0.35, "fm_ratio": 3, "fm_decay": 6, "fm_hold": 0.2, "attack": 0.008, "decay": 0.33, "sustain": 0.55, "release": 0.28, "vib": 6, "echo": 0.28}, "mix": _strip(lead_eq, lead_mix)},
			"lead reed": {"synth": "tone", "p": {"oct": 12, "sine": 0.6, "tri": 0.3, "fm": 0.7, "fm_ratio": 3, "fm_decay": 3, "fm_hold": 0.4, "attack": 0.03, "release": 0.2, "vib": 6, "echo": 0.28}, "mix": _strip(lead_eq, lead_mix)},
			"pad soft": {"synth": "tone", "p": {"tri": 0.8, "detune": 10, "attack": 0.35, "release": 0.3}, "mix": _strip([["hp", 240.0, 0.7, 0.0], ["peak", 900.0, 0.8, -3.0], ["peak", 2600.0, 0.7, 1.5], ["lp", 5000.0, 0.7, 0.0]], {"level_db": -27.0, "room": 0.32})},
		},
		"parts": {
			"rest": {"rule": "rest", "p": {}, "roll": 0},
			"drum plain": {"rule": "drum", "p": {"ghost": 0.0}, "roll": 0},
			"drum main": {"rule": "drum", "p": {"ghost": 0.6}, "roll": 0},
			"hat light": {"rule": "hat", "p": {"pulses": 0}, "roll": 0},
			"hat main": {"rule": "hat", "p": {"pulses": 4}, "roll": 0},
			"hat rush": {"rule": "hat", "p": {"pulses": 8, "quarters": 1}, "roll": 0},
			"bass long": {"rule": "bass_hold", "p": {}, "roll": 0},
			"bass eighths": {"rule": "bass_pulse", "p": {"div": 2, "density": 0.8, "octave": 0.25}, "roll": 0},
			"bass sixteenths": {"rule": "bass_pulse", "p": {"div": 1, "density": 0.7, "octave": 0.3, "accent": 0.35, "slide": 0.2}, "roll": 0},
			"lead line": {"rule": "lead_wander", "p": {"rest": 0.4, "span": 2}, "roll": 0},
			"lead sparse": {"rule": "lead_wander", "p": {"rest": 0.75, "span": 2}, "roll": 0},
			"lead arp": {"rule": "arp", "p": {"div": 2, "octaves": 2, "shape": 2}, "roll": 0},
			"lead climb": {"rule": "rise", "p": {}, "roll": 0},
			"pad hold": {"rule": "pad_chord", "p": {"voices": 3}, "roll": 0},
			"pad stabs": {"rule": "pad_chord", "p": {"voices": 3, "stab": 1}, "roll": 0},
		},
		"scenes": {
			"explore": {"bars": 4, "tracks": {
				"drum": {"part": "drum main", "inst": {"kick": "kick", "snare": "snare"}},
				"hat": {"part": "hat main", "inst": "hat"},
				"bass": {"part": "bass long", "inst": "bass sub"},
				"lead": {"part": "lead line", "inst": "lead bell"},
				"pad": {"part": "pad hold", "inst": "pad soft"},
			}},
			"intro": {"bars": 4, "tracks": {
				"drum": {"part": "drum plain", "inst": {"kick": "kick", "snare": "snare"}},
				"hat": {"part": "hat light", "inst": "hat"},
				"bass": {"part": "bass long", "inst": "bass round"},
				"lead": {"part": "lead sparse", "inst": "lead glass"},
				"pad": {"part": "pad hold", "inst": "pad soft"},
			}},
			"phase 1": {"bars": 4, "tracks": {
				"drum": {"part": "drum main", "inst": {"kick": "kick", "snare": "snare"}},
				"hat": {"part": "hat main", "inst": "hat"},
				"bass": {"part": "bass eighths", "inst": "bass fm"},
				"lead": {"part": "lead line", "inst": "lead bell"},
				"pad": {"part": "pad hold", "inst": "pad soft"},
			}},
			"build": {"bars": 2, "tracks": {
				"drum": {"part": "drum plain", "inst": {"kick": "kick", "snare": "snare"}},
				"hat": {"part": "hat rush", "inst": "hat"},
				"bass": {"part": "bass eighths", "inst": "bass fm"},
				"lead": {"part": "lead climb", "inst": "lead pulse"},
				"pad": {"part": "pad stabs", "inst": "pad soft"},
			}},
			"drop": {"bars": 4, "tracks": {
				"drum": {"part": "drum main", "inst": {"kick": "kick", "snare": "snare"}},
				"hat": {"part": "hat rush", "inst": "hat"},
				"bass": {"part": "bass sixteenths", "inst": "bass acid"},
				"lead": {"part": "lead arp", "inst": "lead pulse"},
				"pad": {"part": "pad stabs", "inst": "pad soft"},
			}},
		},
		"states": {"explore": "explore", "boss.enter": "intro", "boss.phase1": "phase 1", "boss.shift": "build", "boss.phase2": "drop"},
	}
