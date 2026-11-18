class_name Score
extends RefCounted
## A stage's music as data.
##
## The notes still come from the seed. What a score adds is the arrangement: for each state of
## the game (a "scene": intro, a boss phase, a build-up, a drop) it says which part every layer
## plays, on which instrument, with which mix. Parts are rules that turn the seed into notes;
## instruments are synth settings plus a mixing strip. All of it is a plain Dictionary, so it
## can be saved as JSON, edited in the studio, and read by the game.
##
##   score.instruments[name] = { synth, p: {..}, mix: {..} }        see Voice.PARAMS and Mix.apply
##   score.parts[name]       = { rule, p: {..}, roll }              see RULES; roll re-rolls just this part
##   score.scenes[name]      = { bars, lp, hp, tracks: { layer: { part, inst, gain_db } } }
##   score.states[state]     = scene name                           which scene a game state plays
##
## A layer's `inst` is one instrument name, or for drums { "kick": name, "snare": name }.

const SR := 44100
const TRACKS: Array[String] = ["drum", "hat", "bass", "lead", "pad"]
const SCALES := {
	"minor_pentatonic": [0, 3, 5, 7, 10],
	"minor": [0, 2, 3, 5, 7, 8, 10],
	"dorian": [0, 2, 3, 5, 7, 9, 10],
	"phrygian": [0, 1, 3, 5, 7, 8, 10],
	"major_pentatonic": [0, 2, 4, 7, 9],
}

## What each rule can be told. [key, low, high, default, scale]
const RULES := {
	"rest": [],
	# Kick and snare sit where the meter says, always. Only the ornament is the rule's to place.
	"drum": [["kick", 0.0, 1.0, 1.0, "lin"], ["snare", 0.0, 1.0, 1.0, "lin"], ["ghost", 0.0, 1.0, 0.6, "lin"]],
	"hat": [["offbeat", 0.0, 1.0, 1.0, "int"], ["pulses", 0.0, 12.0, 4.0, "int"], ["quarters", 0.0, 1.0, 0.0, "int"]],
	# Long notes on the chord root, with a rest after each.
	"bass_hold": [],
	# A one-bar figure of short notes, repeated on every chord.
	"bass_pulse": [["div", 1.0, 4.0, 2.0, "int"], ["density", 0.0, 1.0, 0.8, "lin"], ["octave", 0.0, 1.0, 0.25, "lin"], ["move", 0.0, 1.0, 0.15, "lin"], ["accent", 0.0, 1.0, 0.3, "lin"], ["slide", 0.0, 1.0, 0.0, "lin"], ["skip_kick", 0.0, 1.0, 0.0, "int"]],
	# A wandering line on the eighth-note grid; the same figure returns every `span` bars.
	"lead_wander": [["rest", 0.0, 0.9, 0.4, "lin"], ["span", 1.0, 4.0, 2.0, "int"]],
	"arp": [["div", 1.0, 4.0, 2.0, "int"], ["density", 0.0, 1.0, 1.0, "lin"], ["octaves", 1.0, 3.0, 2.0, "int"], ["shape", 0.0, 3.0, 0.0, "int"]],
	"pad_chord": [["voices", 1.0, 4.0, 3.0, "int"], ["stab", 0.0, 1.0, 0.0, "int"]],
	# One climb over the whole scene: the notes come faster and higher.
	"rise": [],
	# Notes written by hand: part.notes = [[step, len, degree above the chord, vel], ..], repeated every part.bars.
	"written": [],
}

static func rule_defaults(rule: String) -> Dictionary:
	var out := {}
	for row in RULES.get(rule, []):
		out[row[0]] = row[3]
	return out

static func _note(step: float, length: float, midi: int, vel: float, voice: String) -> Dictionary:
	return {"step": step, "len": length, "midi": midi, "vel": vel, "voice": voice}

static func _hash(s: String) -> int:
	var h := 2166136261
	for c in s.to_utf8_buffer():
		h = Rng.imul(h ^ c, 16777619)
	return h

## Every part draws from its own stream, so changing one part never reshuffles another.
static func _rng(score: Dictionary, salt: String, roll: int) -> Rng:
	return Rng.new(Rng.imul(int(score.get("seed", 7)) + 1, 0x9E3779B1) ^ _hash(salt) ^ Rng.imul(roll + 1, 0x85EBCA6B))

static func steps_per_beat(score: Dictionary) -> int:
	return int(score.get("meter", {}).get("stepsPerBeat", 4))

static func steps_per_bar(score: Dictionary) -> int:
	return steps_per_beat(score) * int(score.get("meter", {}).get("beatsPerBar", 4))

static func sec_per_step(score: Dictionary) -> float:
	return 60.0 / float(score.get("bpm", 110.0)) / steps_per_beat(score)

static func scene_bars(score: Dictionary, scene_id: String) -> int:
	return maxi(1, int(score["scenes"][scene_id].get("bars", 2)))

static func scene_samples(score: Dictionary, scene_id: String) -> int:
	return int(round(scene_bars(score, scene_id) * steps_per_bar(score) * sec_per_step(score) * SR))

## Key and chords. From the seed unless the score pins them: key.root (midi), key.chords (scale steps, one per bar).
static func harmony(score: Dictionary) -> Dictionary:
	var key: Dictionary = score.get("key", {})
	var scale: Array = SCALES.get(str(key.get("scale", "minor_pentatonic")), SCALES["minor_pentatonic"])
	var rnd := _rng(score, "harmony", 0)
	var root := 45 + int(floor(rnd.next() * 8))
	var chords: Array = [0]
	for b in range(1, maxi(1, int(key.get("bars", 4)))):
		chords.append(1 + int(floor(rnd.next() * (scale.size() - 1))))
	if int(key.get("root", -1)) >= 0:
		root = int(key["root"])
	if key.get("chords", []) is Array and not key.get("chords", []).is_empty():
		chords = key["chords"]
	return {"root": root, "scale": scale, "chords": chords}

static func _tone(scale: Array, index: int) -> int:
	return int(scale[posmod(index, scale.size())]) + 12 * floori(float(index) / scale.size())

## The notes one layer plays in one scene.
static func notes(score: Dictionary, scene_id: String, track_id: String) -> Array:
	var scene: Dictionary = score["scenes"].get(scene_id, {})
	var track: Dictionary = scene.get("tracks", {}).get(track_id, {})
	var part: Dictionary = score.get("parts", {}).get(str(track.get("part", "")), {})
	if part.is_empty():
		return []
	var rule := str(part.get("rule", "rest"))
	var p := rule_defaults(rule)
	for k in part.get("p", {}):
		p[k] = float(part["p"][k])
	var meter: Dictionary = score.get("meter", {})
	var h := harmony(score)
	var c := {
		"bars": scene_bars(score, scene_id), "bar": steps_per_bar(score), "beat": steps_per_beat(score),
		"kick": meter.get("kick", [0, 8]), "snare": meter.get("snare", [4, 12]),
		"root": h["root"], "scale": h["scale"], "chords": h["chords"],
		"rnd": _rng(score, str(track["part"]), int(part.get("roll", 0))), "part": part,
	}
	return _generate(rule, p, c)

static func _chord(c: Dictionary, bar: int) -> int:
	var chords: Array = c["chords"]
	return int(chords[bar % chords.size()])

static func _generate(rule: String, p: Dictionary, c: Dictionary) -> Array:
	var out: Array = []
	var bars: int = c["bars"]
	var bar: int = c["bar"]
	var beat: int = c["beat"]
	var rnd: Rng = c["rnd"]
	var root: int = c["root"]
	var scale: Array = c["scale"]
	var size := scale.size()
	match rule:
		"drum":
			var taken: Array = []
			for s in c["kick"]: taken.append(int(s))
			for s in c["snare"]: taken.append(int(s))
			var spots: Array = []
			for s in [bar * 7 / 16, bar * 10 / 16, bar * 14 / 16]:
				if not taken.has(s):
					spots.append(s)
			for b in bars:
				var o := b * bar
				if p["kick"] > 0.0:
					for s in c["kick"]:
						out.append(_note(o + int(s), 1, 36, p["kick"], "kick"))
				if p["snare"] > 0.0:
					for s in c["snare"]:
						out.append(_note(o + int(s), 1, 38, 0.9 * p["snare"], "snare"))
				var chance := rnd.next()
				var where := rnd.next()
				if chance < p["ghost"] and p["kick"] > 0.0 and not spots.is_empty():
					out.append(_note(o + int(spots[int(where * spots.size())]), 1, 36, 0.6 * p["kick"], "kick"))
		"hat":
			var turn := int(floor(rnd.next() * bar))
			var spread := Song.euclid(int(p["pulses"]), bar, turn)
			for b in bars:
				for i in bar:
					var pos := i % beat
					if pos == 0:
						if p["quarters"] > 0.0:
							out.append(_note(b * bar + i, 1, 90, 0.55, "hat"))
					elif pos * 2 == beat:
						if p["offbeat"] > 0.0:
							out.append(_note(b * bar + i, 1, 90, 0.8, "hat"))
					elif spread[i]:
						out.append(_note(b * bar + i, 1, 90, 0.4, "hat"))
		"bass_hold":
			var k := bar / 16.0
			for b in bars:
				var pitch := root - 12 + _tone(scale, _chord(c, b))
				var shape: Array = rnd.pick([[[0, 8]], [[0, 4], [6, 4]], [[0, 10]], [[0, 6]]])
				for i in shape.size():
					var up := 12 if (i == 1 and rnd.next() < 0.5) else 0
					out.append(_note(b * bar + int(shape[i][0] * k), shape[i][1] * k, pitch + up, 0.9, "note"))
		"bass_pulse":
			var div := maxi(1, int(p["div"]))
			var figure: Array = []
			for s in range(0, bar, div):
				var r := [rnd.next(), rnd.next(), rnd.next(), rnd.next(), rnd.next()]
				if s != 0 and r[0] >= p["density"]:
					continue
				if p["skip_kick"] > 0.0 and c["kick"].has(s) or p["skip_kick"] > 0.0 and c["kick"].has(float(s)):
					continue
				var lift := 0
				if r[2] < p["move"]:
					lift = 2 if r[2] < p["move"] * 0.5 else 4
				figure.append({"s": s, "up": 12 if r[1] < p["octave"] else 0, "lift": lift, "acc": r[3] < p["accent"], "slide": r[4] < p["slide"]})
			for b in bars:
				for f in figure:
					var n := _note(b * bar + int(f["s"]), div, root - 12 + _tone(scale, _chord(c, b) + int(f["lift"])) + int(f["up"]), 0.9, "note")
					n["acc"] = f["acc"]
					n["slide"] = f["slide"]
					out.append(n)
		"lead_wander":
			var span := maxi(1, int(p["span"]))
			var figure: Array = []
			var rel := 0
			for b in span:
				for i in range(0, bar, 2):
					var r := [rnd.next(), rnd.next(), rnd.next(), rnd.next()]
					if i != 0 and r[0] < p["rest"]:
						continue
					rel = clampi(rel + [-2, -1, -1, 1, 1, 2][int(r[1] * 6)], -2, size + 2)
					if i == 0:
						rel = 0 if r[2] < 0.5 else 2
					figure.append({"s": b * bar + i, "rel": rel, "len": [2, 2, 3, 4][int(r[3] * 4)]})
			for b in bars:
				for f in figure:
					if int(f["s"]) / bar == b % span:
						out.append(_note(b * bar + int(f["s"]) % bar, f["len"], root + _tone(scale, size + _chord(c, b) + int(f["rel"])), 0.8, "note"))
		"arp":
			var div := maxi(1, int(p["div"]))
			var steps: Array = []
			for o in int(p["octaves"]):
				for k in [0, 2, 4]:
					steps.append(k + o * size)
			var count := 0
			var figure: Array = []
			for s in range(0, bar, div):
				var r := [rnd.next(), rnd.next()]
				if r[0] >= p["density"]:
					continue
				var at := count % steps.size()
				match int(p["shape"]):
					1: at = steps.size() - 1 - at
					2:
						var lap := maxi(1, steps.size() * 2 - 2)
						at = count % lap
						if at >= steps.size():
							at = lap - at
					3: at = int(r[1] * steps.size())
				figure.append({"s": s, "rel": steps[at]})
				count += 1
			for b in bars:
				for f in figure:
					out.append(_note(b * bar + int(f["s"]), div, root + _tone(scale, size + _chord(c, b) + int(f["rel"])), 0.75, "note"))
		"pad_chord":
			for b in bars:
				var ci := _chord(c, b)
				for v in int(p["voices"]):
					var midi := root + 12 + _tone(scale, ci + v * 2)
					if p["stab"] > 0.0:
						for s in range(beat / 2, bar, beat):
							out.append(_note(b * bar + s, beat / 2.0, midi, 0.5, "note"))
					else:
						out.append(_note(b * bar, bar, midi, 0.5, "note"))
		"rise":
			var total := bars * bar
			var s := 0
			var i := 0
			while s < total:
				var along := float(s) / total
				var div := maxi(1, beat if along < 0.5 else (beat / 2 if along < 0.75 else beat / 4))
				out.append(_note(s, div, root + _tone(scale, size + mini(i / 2, size * 2)), 0.35 + 0.65 * along, "note"))
				s += div
				i += 1
		"written":
			var part: Dictionary = c["part"]
			var every := maxi(1, int(part.get("bars", bars))) * bar
			for start in range(0, bars * bar, every):
				for w in part.get("notes", []):
					var at := start + float(w[0])
					if at < bars * bar:
						var b := int(at) / bar
						out.append(_note(at, float(w[1]), root + _tone(scale, _chord(c, b) + int(w[2])), float(w[3]) if w.size() > 3 else 0.8, "note"))
	return out

## Sample positions of the kick in a scene, for ducking under it.
static func kick_hits(score: Dictionary, scene_id: String) -> Array:
	var out: Array = []
	var sps := sec_per_step(score)
	for n in notes(score, scene_id, "drum"):
		if n["voice"] == "kick" and float(n["vel"]) > 0.7:
			out.append(int(round(float(n["step"]) * sps * SR)))
	return out

static func inst_name(track: Dictionary, voice: String) -> String:
	var inst: Variant = track.get("inst", "")
	if inst is Dictionary:
		return str(inst.get(voice, ""))
	return str(inst)

## Bake one layer of one scene: its notes, on its instruments, through their mixing strips.
## With `with_gain` off the layer's own fader (gain_db) is left out, for a player that applies it live.
static func bake(score: Dictionary, scene_id: String, track_id: String, with_gain: bool = true) -> PackedFloat32Array:
	var out := PackedFloat32Array()
	out.resize(scene_samples(score, scene_id))
	var scene: Dictionary = score["scenes"][scene_id]
	var track: Dictionary = scene.get("tracks", {}).get(track_id, {})
	var by_voice := {}
	for n in notes(score, scene_id, track_id):
		if not by_voice.has(n["voice"]):
			by_voice[n["voice"]] = []
		by_voice[n["voice"]].append(n)
	if by_voice.is_empty():
		return out
	var sps := sec_per_step(score)
	var hits := kick_hits(score, scene_id)
	for voice in by_voice:
		var patch: Dictionary = score.get("instruments", {}).get(inst_name(track, voice), {})
		if patch.is_empty():
			continue
		var buf := PackedFloat32Array()
		buf.resize(out.size())
		Voice.render(buf, patch, by_voice[voice], sps)
		Mix.apply(buf, patch.get("mix", {}), SR, hits)
		for i in out.size():
			out[i] += buf[i]
	if float(scene.get("lp", 20000.0)) < 18000.0:
		Mix.biquad(out, "lp", float(scene["lp"]), 0.7, 0.0, SR)
	if float(scene.get("hp", 0.0)) > 25.0:
		Mix.biquad(out, "hp", float(scene["hp"]), 0.7, 0.0, SR)
	if with_gain and float(track.get("gain_db", 0.0)) != 0.0:
		Mix.scale(out, pow(10.0, float(track["gain_db"]) / 20.0))
	return out

## Everything a baked layer depends on, as one string: two layers with the same key sound the same.
static func key_of(score: Dictionary, scene_id: String, track_id: String, with_gain: bool = true) -> String:
	var scene: Dictionary = score["scenes"][scene_id]
	var track: Dictionary = scene.get("tracks", {}).get(track_id, {})
	var drum: Dictionary = scene.get("tracks", {}).get("drum", {})
	if not with_gain:
		track = track.duplicate()
		track.erase("gain_db")
	var insts := {}
	var inst: Variant = track.get("inst", "")
	for name in (inst.values() if inst is Dictionary else [inst]):
		insts[name] = score.get("instruments", {}).get(str(name), {})
	var what := [
		score.get("seed", 7), score.get("bpm", 110), score.get("meter", {}), score.get("key", {}),
		scene.get("bars", 2), scene.get("lp", 0), scene.get("hp", 0), track,
		score.get("parts", {}).get(str(track.get("part", "")), {}),
		score.get("parts", {}).get(str(drum.get("part", "")), {}), insts,
	]
	# Through text and back, so 110 and 110.0 (a number after a save and load) give the same key.
	return JSON.stringify(JSON.parse_string(JSON.stringify(what))).md5_text()

static func scene_for(score: Dictionary, state: String) -> String:
	return str(score.get("states", {}).get(state, score["scenes"].keys()[0]))

static func to_text(score: Dictionary) -> String:
	return JSON.stringify(score, "  ", false)        # keys stay in the order they were written

static func from_text(text: String) -> Dictionary:
	var reader := JSON.new()
	if text.strip_edges() == "" or reader.parse(text) != OK:
		return {}
	var parsed: Variant = reader.data
	if parsed is Dictionary and parsed.has("scenes") and parsed.has("instruments") and parsed.has("parts"):
		return parsed
	return {}
