class_name ShapeMap
extends RefCounted
## The ground, as shapes rather than tiles. Ground is the union of `ground` shapes minus `holes`.
## There are no walls: everything that is not ground is deadly.
## All lengths here are in pixels; stage data is written in U and scaled when loaded.
##
## Shape kinds:
##   circle  { x, y, r }
##   capsule { x1, y1, x2, y2, r }
##   rect    { x, y, w, h, rot }        centred on x,y
##   sector  { x, y, r0, r1, a0, a1 }   a ring slice, angles in degrees, clockwise from a0 to a1
##   polygon { points: [[x,y], ...] }

var ground: Array = []
var holes: Array = []

static func contains(s: Dictionary, p: Vector2) -> bool:
	match s["kind"]:
		"circle":
			return p.distance_squared_to(Vector2(s["x"], s["y"])) <= s["r"] * s["r"]
		"capsule":
			var a := Vector2(s["x1"], s["y1"])
			var b := Vector2(s["x2"], s["y2"])
			return Geometry2D.get_closest_point_to_segment(p, a, b).distance_squared_to(p) <= s["r"] * s["r"]
		"rect":
			var q := (p - Vector2(s["x"], s["y"])).rotated(-deg_to_rad(s.get("rot", 0.0)))
			return absf(q.x) <= s["w"] / 2.0 and absf(q.y) <= s["h"] / 2.0
		"sector":
			var d := p - Vector2(s["x"], s["y"])
			var r := d.length()
			if r < s["r0"] or r > s["r1"]:
				return false
			var span := fposmod(s["a1"] - s["a0"], 360.0)
			if span == 0.0:
				span = 360.0
			return fposmod(rad_to_deg(d.angle()) - s["a0"], 360.0) <= span
		"polygon":
			return Geometry2D.is_point_in_polygon(p, s["_pts"])
	return false

func is_ground(p: Vector2) -> bool:
	for h in holes:
		if contains(h, p):
			return false
	for g in ground:
		if contains(g, p):
			return true
	return false

## Points along a shape's edge, for drawing. Each is [point, outward normal].
static func outline(s: Dictionary, spacing: float) -> Array:
	var out: Array = []
	match s["kind"]:
		"circle":
			var n := maxi(24, int(TAU * s["r"] / spacing))
			for i in n + 1:
				var a := TAU * i / n
				out.append([Vector2(s["x"], s["y"]) + Vector2.from_angle(a) * s["r"], Vector2.from_angle(a)])
		"capsule":
			var a := Vector2(s["x1"], s["y1"])
			var b := Vector2(s["x2"], s["y2"])
			var dir := (b - a).normalized()
			var base := dir.angle()
			var n := maxi(8, int(PI * s["r"] / spacing))
			for i in n + 1:
				var t := base + PI / 2.0 + PI * i / n
				out.append([a + Vector2.from_angle(t) * s["r"], Vector2.from_angle(t)])
			for i in n + 1:
				var t := base - PI / 2.0 + PI * i / n
				out.append([b + Vector2.from_angle(t) * s["r"], Vector2.from_angle(t)])
			out.append(out[0])
		"rect":
			var c := Vector2(s["x"], s["y"])
			var rot := deg_to_rad(s.get("rot", 0.0))
			var hw: float = s["w"] / 2.0
			var hh: float = s["h"] / 2.0
			var corners := [Vector2(-hw, -hh), Vector2(hw, -hh), Vector2(hw, hh), Vector2(-hw, hh)]
			var normals := [Vector2(0, -1), Vector2(1, 0), Vector2(0, 1), Vector2(-1, 0)]
			for k in 4:
				var p0: Vector2 = corners[k]
				var p1: Vector2 = corners[(k + 1) % 4]
				var n := maxi(1, int(p0.distance_to(p1) / spacing))
				for i in n + 1:
					out.append([c + p0.lerp(p1, float(i) / n).rotated(rot), (normals[k] as Vector2).rotated(rot)])
		"sector":
			var c := Vector2(s["x"], s["y"])
			var span := fposmod(s["a1"] - s["a0"], 360.0)
			if span == 0.0:
				span = 360.0
			var a0 := deg_to_rad(s["a0"])
			var sp := deg_to_rad(span)
			var n := maxi(8, int(sp * s["r1"] / spacing))
			for i in n + 1:
				var t := a0 + sp * i / n
				out.append([c + Vector2.from_angle(t) * s["r1"], Vector2.from_angle(t)])
			if span < 360.0 or s["r0"] > 0.0:
				var m := maxi(4, int(sp * s["r0"] / spacing))
				for i in m + 1:
					var t := a0 + sp * (1.0 - float(i) / m)
					out.append([c + Vector2.from_angle(t) * s["r0"], -Vector2.from_angle(t)])
				out.append(out[0])
		"polygon":
			var pts: PackedVector2Array = s["_pts"]
			for k in pts.size():
				var p0 := pts[k]
				var p1 := pts[(k + 1) % pts.size()]
				var nrm := (p1 - p0).orthogonal().normalized()
				var n := maxi(1, int(p0.distance_to(p1) / spacing))
				for i in n + 1:
					out.append([p0.lerp(p1, float(i) / n), nrm])
	return out

## Turn a shape written in U into pixels.
static func scaled(s: Dictionary, u: float) -> Dictionary:
	var o := {"kind": s["kind"]}
	for k in s:
		if k == "kind":
			continue
		if k == "points":
			var pts := PackedVector2Array()
			for q in s["points"]:
				pts.append(Vector2(q[0], q[1]) * u)
			o["_pts"] = pts
		elif k in ["rot", "a0", "a1"]:
			o[k] = float(s[k])
		else:
			o[k] = float(s[k]) * u
	return o
