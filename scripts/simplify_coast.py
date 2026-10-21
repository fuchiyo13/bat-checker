"""東京湾岸の細かい埠頭・運河だけをならし、内陸の区境は残す。"""

import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FILES = [
    ROOT / "static" / "data" / "prefectures.geojson",
    ROOT / "static" / "data" / "municipalities.geojson",
]
BAY = (139.73, 140.08, 35.50, 35.70)
EPSILON = 0.0022
MIN_ISLAND = 0.000008


def in_bay(point):
    return BAY[0] <= point[0] <= BAY[1] and BAY[2] <= point[1] <= BAY[3]


def distance(point, start, end):
    if start == end:
        return math.hypot(point[0] - start[0], point[1] - start[1])
    dx, dy = end[0] - start[0], end[1] - start[1]
    ratio = ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy)
    ratio = max(0, min(1, ratio))
    return math.hypot(point[0] - (start[0] + ratio * dx), point[1] - (start[1] + ratio * dy))


def rdp(points, epsilon):
    if len(points) < 3:
        return points
    index, farthest = 0, 0
    for cursor in range(1, len(points) - 1):
        span = distance(points[cursor], points[0], points[-1])
        if span > farthest:
            index, farthest = cursor, span
    if farthest <= epsilon:
        return [points[0], points[-1]]
    return rdp(points[: index + 1], epsilon)[:-1] + rdp(points[index:], epsilon)


def ring_area(ring):
    area = 0
    for index in range(len(ring) - 1):
        area += ring[index][0] * ring[index + 1][1] - ring[index + 1][0] * ring[index][1]
    return abs(area) / 2


def centroid(ring):
    area = 0
    x = y = 0
    for index in range(len(ring) - 1):
        cross = ring[index][0] * ring[index + 1][1] - ring[index + 1][0] * ring[index][1]
        x += (ring[index][0] + ring[index + 1][0]) * cross
        y += (ring[index][1] + ring[index + 1][1]) * cross
        area += cross
    if abs(area) < 1e-12:
        return ring[0]
    return [x / (3 * area), y / (3 * area)]


def simplify_coast(ring):
    closed = ring[0] == ring[-1]
    points = ring[:-1] if closed else ring[:]
    if len(points) < 4 or not any(in_bay(point) for point in points):
        return ring
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
    if len(simplified) < 4:
        return ring
    if closed and simplified[0] != simplified[-1]:
        simplified.append(simplified[0])
    return [[round(lon, 4), round(lat, 4)] for lon, lat in simplified]


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
    kind = geometry["type"]
    if kind == "Polygon":
        rings = clean_polygon(geometry["coordinates"])
        return {"type": "Polygon", "coordinates": rings} if rings else None
    if kind == "MultiPolygon":
        polygons = [rings for polygon in geometry["coordinates"] if (rings := clean_polygon(polygon))]
        return {"type": "MultiPolygon", "coordinates": polygons} if polygons else None
    return geometry


def main():
    for path in FILES:
        payload = json.loads(path.read_text(encoding="utf-8"))
        kept = []
        for feature in payload["features"]:
            geometry = clean_geometry(feature["geometry"])
            if geometry:
                feature["geometry"] = geometry
                kept.append(feature)
        payload["features"] = kept
        path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        print(path.name, len(kept), path.stat().st_size)


if __name__ == "__main__":
    main()
