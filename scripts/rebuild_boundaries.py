"""行政区域を取り直し、東京湾の細い埠頭だけを落とす。内陸の区境はそのまま残す。"""

import json
import math
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "static" / "data"
BAY = (139.73, 140.08, 35.50, 35.70)
EPSILON = 0.0022
MIN_ISLAND = 0.000008
PREF_IDS = {8, 9, 10, 11, 12, 13, 14, 19, 22}
MUNI_CODES = ("11", "12", "13", "14")
HEADERS = {"User-Agent": "bat-abelable/1.0"}


def fetch_json(url):
    request = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.loads(response.read().decode("utf-8"))


def in_bay(point):
    return BAY[0] <= point[0] <= BAY[1] and BAY[2] <= point[1] <= BAY[3]


def dist(start, end):
    return math.hypot(end[0] - start[0], end[1] - start[1])


def point_line_distance(point, start, end):
    if start == end:
        return dist(point, start)
    dx, dy = end[0] - start[0], end[1] - start[1]
    ratio = ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy)
    ratio = max(0, min(1, ratio))
    return math.hypot(point[0] - (start[0] + ratio * dx), point[1] - (start[1] + ratio * dy))


def rdp(points, epsilon):
    if len(points) < 3:
        return points
    index, farthest = 0, 0
    for cursor in range(1, len(points) - 1):
        span = point_line_distance(points[cursor], points[0], points[-1])
        if span > farthest:
            index, farthest = cursor, span
    if farthest <= epsilon:
        return [points[0], points[-1]]
    return rdp(points[: index + 1], epsilon)[:-1] + rdp(points[index:], epsilon)


def despike(points):
    for _ in range(6):
        if len(points) < 4:
            return points
        kept = []
        removed = False
        for index, point in enumerate(points):
            if not in_bay(point):
                kept.append(point)
                continue
            previous = points[index - 1]
            nxt = points[(index + 1) % len(points)]
            base = dist(previous, nxt)
            via = dist(previous, point) + dist(point, nxt)
            if 0 < base < 0.015 and via > base * 2.4:
                removed = True
                continue
            kept.append(point)
        points = kept
        if not removed:
            break
    return points


def simplify_coast(ring):
    closed = ring[0] == ring[-1]
    points = ring[:-1] if closed else ring[:]
    points = despike(points)
    if len(points) >= 4 and any(in_bay(point) for point in points):
        flags = [in_bay(point) for point in points]
        simplified = []
        index = 0
        while index < len(points):
            if not flags[index]:
                simplified.append(points[index])
                index += 1
                continue
            end = index
            while end < len(points) and flags[end]:
                end += 1
            chunk = points[index:end]
            if index > 0:
                chunk = [points[index - 1], *chunk]
            if end < len(points):
                chunk = [*chunk, points[end]]
            reduced = rdp(chunk, EPSILON)
            if index > 0:
                reduced = reduced[1:]
            if end < len(points) and reduced:
                reduced = reduced[:-1]
            simplified.extend(reduced)
            index = end
        points = simplified or points
        points = despike(points)
    if len(points) < 4:
        return ring
    rounded = [[round(lon, 5), round(lat, 5)] for lon, lat in points]
    if closed and rounded[0] != rounded[-1]:
        rounded.append(rounded[0])
    return rounded


def ring_area(ring):
    area = 0
    for index in range(len(ring) - 1):
        area += ring[index][0] * ring[index + 1][1] - ring[index + 1][0] * ring[index][1]
    return abs(area) / 2


def centroid(ring):
    if not ring:
        return [0, 0]
    return [sum(point[0] for point in ring) / len(ring), sum(point[1] for point in ring) / len(ring)]


def keep_ring(ring):
    if ring_area(ring) >= MIN_ISLAND:
        return True
    return not in_bay(centroid(ring if ring[0] == ring[-1] else ring + [ring[0]]))


def clean_polygon(rings):
    if not rings:
        return None
    outer = simplify_coast(rings[0])
    if not keep_ring(outer):
        return None
    holes = [simplify_coast(ring) for ring in rings[1:] if keep_ring(ring)]
    return [outer, *holes]


def clean_geometry(geometry):
    if geometry["type"] == "Polygon":
        rings = clean_polygon(geometry["coordinates"])
        return {"type": "Polygon", "coordinates": rings} if rings else None
    if geometry["type"] == "MultiPolygon":
        polygons = [rings for polygon in geometry["coordinates"] if (rings := clean_polygon(polygon))]
        return {"type": "MultiPolygon", "coordinates": polygons} if polygons else None
    return geometry


def decode_arc(arc, scale, translate):
    x = y = 0
    points = []
    for dx, dy in arc:
        x += dx
        y += dy
        points.append([x * scale[0] + translate[0], y * scale[1] + translate[1]])
    return points


def materialize(indexes, decoded):
    ring = []
    for index in indexes:
        arc = decoded[index] if index >= 0 else list(reversed(decoded[~index]))
        ring.extend(arc if not ring else arc[1:])
    return ring


def topo_to_features(topology, wanted):
    scale = topology["transform"]["scale"]
    translate = topology["transform"]["translate"]
    decoded = [decode_arc(arc, scale, translate) for arc in topology["arcs"]]
    collection = next(iter(topology["objects"].values()))
    features = []
    for geometry in collection["geometries"]:
        props = geometry.get("properties") or {}
        code = props.get("id") or props.get("code") or props.get("N03_007")
        try:
            numeric = int(code)
        except (TypeError, ValueError):
            numeric = None
        if numeric not in wanted and props.get("name") not in wanted and props.get("nam_ja") not in wanted:
            if numeric is None:
                continue
            if numeric not in wanted:
                continue
        kind = geometry["type"]
        if kind == "Polygon":
            coordinates = [materialize(ring, decoded) for ring in geometry["arcs"]]
        elif kind == "MultiPolygon":
            coordinates = [[materialize(ring, decoded) for ring in polygon] for polygon in geometry["arcs"]]
        else:
            continue
        features.append({
            "type": "Feature",
            "properties": {
                "name": props.get("nam_ja") or props.get("name") or props.get("N03_001") or "",
                "id": numeric,
            },
            "geometry": {"type": kind, "coordinates": coordinates},
        })
    return features


def municipality_features():
    features = []
    base = "https://raw.githubusercontent.com/smartnews-smri/japan-topography/main/data/municipality/geojson/s0010/N03-21_{}_210101.json"
    for code in MUNI_CODES:
        payload = fetch_json(base.format(code))
        for feature in payload["features"]:
            props = feature["properties"]
            ward = props.get("N03_004") or ""
            city = props.get("N03_003") or ""
            name = ward or city or props.get("N03_001") or ""
            geometry = clean_geometry(feature["geometry"])
            if not geometry or not name:
                continue
            features.append({
                "type": "Feature",
                "properties": {
                    "name": name,
                    "city": city,
                    "prefecture": props.get("N03_001") or "",
                },
                "geometry": geometry,
            })
        print("municipality", code, len(features), flush=True)
    return features


def main():
    municipalities = municipality_features()
    muni_path = OUT_DIR / "municipalities.geojson"
    muni_path.write_text(
        json.dumps({"type": "FeatureCollection", "features": municipalities}, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    topology = fetch_json("https://raw.githubusercontent.com/dataofjapan/land/master/japan.topojson")
    sample = next(iter(topology["objects"].values()))["geometries"][0]
    print("pref props", sample.get("properties"), flush=True)
    prefectures = []
    for feature in topo_to_features(topology, PREF_IDS):
        geometry = clean_geometry(feature["geometry"])
        if geometry:
            feature["geometry"] = geometry
            prefectures.append(feature)
    pref_path = OUT_DIR / "prefectures.geojson"
    pref_path.write_text(
        json.dumps({"type": "FeatureCollection", "features": prefectures}, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print("prefectures", len(prefectures), pref_path.stat().st_size)
    print("municipalities", len(municipalities), muni_path.stat().st_size)


if __name__ == "__main__":
    main()
