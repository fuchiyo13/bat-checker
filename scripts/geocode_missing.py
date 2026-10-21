"""位置が空、または東京都から外れている球場だけ住所から再取得する。"""

import json
import time
from pathlib import Path

from fetch_victoria import in_tokyo, one_line, pick_gsi

ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / "data" / "stadiums.geojson"


def queries_for(props):
    address = one_line(props.get("address"))
    name = props.get("name") or ""
    found = []
    if address:
        found.append(address if address.startswith("東京都") else "東京都" + address)
    if name:
        found.append("東京都" + name)
    return found


def main():
    payload = json.loads(PATH.read_text(encoding="utf-8"))
    updated = 0
    for feature in payload["features"]:
        geometry = feature.get("geometry")
        props = feature["properties"]
        needs = geometry is None
        if geometry and geometry.get("coordinates"):
            lng, lat = geometry["coordinates"]
            needs = not in_tokyo(lat, lng)
        if not needs:
            continue
        found = pick_gsi(queries_for(props))
        time.sleep(0.12)
        if not found:
            feature["geometry"] = None
            continue
        lat, lng, title = found
        feature["geometry"] = {"type": "Point", "coordinates": [round(lng, 6), round(lat, 6)]}
        props["geocode_label"] = title
        updated += 1
    PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"updated {updated}")


if __name__ == "__main__":
    main()
