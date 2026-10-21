"""東京都球場ページから所在地・アクセス・駐車場・寸法を取り込む。"""

import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

BASE = "http://victoria-league.com/studium/"
INDEX = BASE + "studium_tokyo.html"
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "stadiums.geojson"
HEADERS = {"User-Agent": "bat-abelable/1.0"}

AREAS = {
    "足立区・荒川周辺": [
        "荒川河川敷運動公園運動場", "荒川日の出町緑地野球場", "扇野球場", "上沼田東公園野球場",
        "江北橋緑地右岸野球場", "江北橋緑地左岸野球場", "五反野野球場", "鹿浜橋緑地野球場",
        "千住新橋野球場", "高砂野球場", "舎人公園野球場", "西新井橋野球場", "西新井橋緑地野球場",
        "東綾瀬公園野球場", "平野野球場", "保木間公園野球場", "谷中公園野球場",
        "荒川自然公園野球場", "南千住野球場",
    ],
    "板橋区・北区・豊島区・周辺": [
        "赤塚公園野球場", "小豆沢野球場", "荒川野球場", "荒川戸田橋緑地野球場",
        "浮間公園野球場", "城北公園野球場",
    ],
    "江戸川区・臨海エリア": [
        "市川橋上流野球場", "江戸川区球場", "江戸川病院前野球場", "京成鉄橋上流野球場",
        "小松川橋上流野球場", "篠崎公園A野球場", "篠崎公園B野球場", "ポニーランド前野球場",
        "臨海球技場第一", "臨海球技場第二",
    ],
    "大田区・品川区・多摩川沿い": [
        "大田スタジアム", "昭和島運動場", "多摩川ガス橋緑地野球場", "多摩川大師橋緑地野球場",
        "多摩川緑地野球場", "多摩川緑地広場野球場", "多摩川六郷橋緑地野球場", "萩中公園野球場",
        "東調布公園野球場", "平和島公園野球場", "大井ポートグランド",
    ],
    "葛飾区・江戸川上流・江東区・中央区周辺": [
        "荒川小菅野球場", "木根川橋野球場", "私学事業団総合運動場", "柴又野球場",
        "奥戸野球場（総合スポーツセンター）", "第二柴又野球場", "堀切橋野球場", "四つ木橋野球場",
        "新荒川大橋野球場", "中央公園運動場野球場", "亀戸野球場", "猿江恩賜公園野球場",
        "潮見野球場", "夢の島総合運動場", "大井ふ頭中央海浜公園野球場", "天王洲公園野球場",
        "南ふ頭公園野球場", "八潮北公園野球場", "渋谷スポーツセンター", "落合中央公園野球場",
        "明治神宮野球場", "西戸山公園野球場", "明治神宮外苑軟式球場",
    ],
    "杉並区周辺": [
        "上井草スポーツセンター運動場", "国立印刷局久我山運動場", "下高井戸運動場",
        "善福寺川緑地野球場", "東京電力総合グランド", "富士見ヶ丘運動場", "松ノ木運動場",
        "和田堀公園野球場",
    ],
    "墨田区周辺": [
        "荒川四ツ木橋緑地野球場", "鐘淵野球場", "錦糸公園野球場", "墨田野球場", "堤野球場", "八広野球場",
    ],
    "世田谷区周辺": [
        "砧公園野球場", "砧野球場", "駒沢オリンピック公園総合運動場", "駒沢オリンピック公園硬式野球場",
        "世田谷公園野球場", "世田谷区立総合運動場", "玉川野毛町公園野球場", "羽根木公園野球場",
        "二子玉川区民運動施設", "二子玉川緑地運動場", "健康保険二子玉川園スポーツセンター",
    ],
    "台東区・港区・文京区・新宿区": [
        "上野恩賜公園野球場", "台東リバーサイドスポーツセンター野球場", "月島運動場",
        "浜町運動場（浜町公園内）", "晴海運動場", "外濠公園総合グランド野球場", "総合体育場野球場",
        "上高田野球場", "哲学堂公園運動施設野球場",
    ],
    "練馬区周辺": [
        "大泉中央公園野球場", "学田公園野球場", "北大泉野球場", "城北中央公園野球場",
        "石神井公園A野球場", "石神井公園B野球場", "高野台野球場", "東台野球場", "光が丘公園野球場",
    ],
}

BAT = {
    "石神井公園A野球場": (
        "prohibited",
        "都立公園の案内では、A地区は住宅地と道路に面しているため高反発バットの使用を禁止しています。",
        "",
    ),
    "城北中央公園野球場": (
        "prohibited",
        "2026年4月1日から、野球場・小野球場で高反発バットの使用が禁止されています。",
        "2026-04-01",
    ),
    "光が丘公園野球場": (
        "prohibited",
        "2026年4月1日から高反発バットは禁止です。使用できるのは木製バットと、グリップ以外が単一素材の金属バットです。",
        "2026-04-01",
    ),
    "東台野球場": (
        "prohibited",
        "2023年4月1日から、軟式野球場で複合バット（金属および木製以外）の使用が禁止されています。",
        "2023-04-01",
    ),
    "芝公園野球場": (
        "prohibited",
        "中学生以上は高反発バットの使用が禁止されています。小学生の使用は認められています。",
        "",
    ),
    "潮田公園野球場": (
        "prohibited",
        "2025年4月から、複合バット（ウレタンなど）の使用が禁止されています。",
        "2025-04",
    ),
    "等々力運動広場": (
        "prohibited",
        "2025年4月1日から、複合バットの使用が禁止されています。",
        "2025-04-01",
    ),
    "大宮第二公園": (
        "prohibited",
        "少年野球でウレタンバットの使用が禁止されています。",
        "",
    ),
}

EXTRAS = {
    "東京ドーム": "台東区・港区・文京区・新宿区",
    "小石川運動場": "台東区・港区・文京区・新宿区",
    "青山運動場": "台東区・港区・文京区・新宿区",
    "麻布運動場": "台東区・港区・文京区・新宿区",
    "芝公園野球場": "台東区・港区・文京区・新宿区",
    "碑文谷野球場": "その他23区",
}

WARDS = {
    "adachi": "足立区",
    "arakawa": "荒川区",
    "itabashi": "板橋区",
    "kita": "北区",
    "toshima": "豊島区",
    "edogawa": "江戸川区",
    "ota": "大田区",
    "shinagawa": "品川区",
    "katsushika": "葛飾区",
    "koto": "江東区",
    "chuo": "中央区",
    "minato": "港区",
    "shibuya": "渋谷区",
    "shinjuku": "新宿区",
    "suginami": "杉並区",
    "sumida": "墨田区",
    "setagaya": "世田谷区",
    "taito": "台東区",
    "bunkyo": "文京区",
    "nerima": "練馬区",
    "meguro": "目黒区",
    "nakano": "中野区",
}

TOKYO = (139.55, 139.95, 35.50, 35.85)

NEW_REGIONS = [
    {
        "slug": "tokyosita",
        "index": "studium_tokyosita.html",
        "pref": "東京都",
        "category": "東京都下",
        "group": "tokyo_tama",
        "box": (138.90, 139.66, 35.48, 35.92),
    },
    {
        "slug": "kanagawa",
        "index": "studium_kanagawa.html",
        "pref": "神奈川県",
        "category": "神奈川県",
        "group": "kanagawa",
        "box": (138.95, 139.85, 35.10, 35.68),
    },
    {
        "slug": "saitama",
        "index": "studium_saitama.html",
        "pref": "埼玉県",
        "category": "埼玉県",
        "group": "saitama",
        "box": (138.70, 139.95, 35.75, 36.30),
    },
    {
        "slug": "chiba",
        "index": "studium_chiba.html",
        "pref": "千葉県",
        "category": "千葉県",
        "group": "chiba",
        "box": (139.70, 140.95, 34.90, 36.10),
    },
]


def norm(value):
    return re.sub(r"[\s　()（）・]", "", value or "")


AREA_BY_NAME = {norm(name): (area, name) for area, names in AREAS.items() for name in names}


def fetch(url):
    request = urllib.request.Request(url, headers=HEADERS)
    raw = urllib.request.urlopen(request, timeout=40).read()
    return raw.decode("utf-8", "replace")


def strip_tags(fragment):
    text = re.sub(r"(?is)<br\s*/?>", "\n", fragment)
    text = re.sub(r"(?is)<[^>]+>", " ", text)
    text = text.replace("&nbsp;", " ").replace("&gt;", ">")
    text = re.sub(r"[ \t]+", " ", text)
    return re.sub(r"\n+", "\n", text).strip()


def one_line(text):
    return re.sub(r"\s+", " ", text or "").strip()


def field_text(html, image_name):
    match = re.search(
        rf'name="{image_name}"[^>]*>\s*(.*?)(?:name="[a-z0-9_]+_bar|$)',
        html,
        re.S,
    )
    chunk = match.group(1) if match else ""
    text = one_line(strip_tags(chunk))
    return re.sub(r"\s*<.*$", "", text).strip()


def looks_like_address(text):
    if not text or re.fullmatch(r".+駅(、.+駅)*", text):
        return False
    return bool(re.search(r"(区|市|町|村|丁目|\d)", text))


def google_query(html):
    match = re.search(r"https?://maps\.google[^\"']+", html)
    if not match:
        return "", None
    parsed = urllib.parse.urlparse(match.group(0).replace("&amp;", "&"))
    query = urllib.parse.parse_qs(parsed.query)
    address = urllib.parse.unquote(query.get("q", [""])[0])
    ll = query.get("ll", [""])[0]
    point = None
    if "," in ll:
        lat, lng = ll.split(",", 1)
        try:
            point = (float(lat), float(lng))
        except ValueError:
            point = None
    return address, point


def in_box(lat, lng, box):
    return box[2] <= lat <= box[3] and box[0] <= lng <= box[1]


def in_tokyo(lat, lng):
    return in_box(lat, lng, TOKYO)


def city_from_address(address, prefecture):
    rest = address[len(prefecture):] if address.startswith(prefecture) else address
    match = re.match(r"(.+?[市区町村])", rest)
    return match.group(1) if match else ""


def gsi_hits(query):
    url = "https://msearch.gsi.go.jp/address-search/AddressSearch?q=" + urllib.parse.quote(query)
    request = urllib.request.Request(url, headers=HEADERS)
    try:
        payload = json.loads(urllib.request.urlopen(request, timeout=20).read().decode("utf-8"))
    except Exception:
        return []
    hits = []
    for item in payload[:8]:
        lng, lat = item["geometry"]["coordinates"]
        title = item.get("properties", {}).get("title", "")
        hits.append((float(lat), float(lng), title))
    return hits


def pick_gsi(queries, prefecture="東京都", box=TOKYO):
    for query in queries:
        if not query:
            continue
        for lat, lng, title in gsi_hits(query):
            compact = re.sub(r"\s+", "", title)
            if compact in {"東京都", "神奈川県", "埼玉県", "千葉県", "日本"} or prefecture not in title:
                continue
            if not in_box(lat, lng, box):
                continue
            return lat, lng, title
        time.sleep(0.08)
    return None


def parse_dimensions(text):
    wings = re.search(r"両翼\s*約?\s*([0-9]+(?:\.[0-9]+)?)\s*m", text)
    center = re.search(r"中堅\s*約?\s*([0-9]+(?:\.[0-9]+)?)\s*m", text)
    parts = []
    if wings:
        parts.append(f"両翼{wings.group(1)}m")
    if center:
        parts.append(f"中堅{center.group(1)}m")
    return " / ".join(parts) if parts else "要確認"


def parse_parking(count_text, note):
    count_text = one_line(count_text)
    note = one_line(note)
    count = re.search(r"(\d+)\s*台", count_text)
    fee = re.search(r"駐車場[:：]\s*(\S+)", note)
    fee_text = ""
    if fee:
        fee_text = re.split(r"球場", fee.group(1))[0].strip(" ・、")[:40]
    if count and fee_text:
        return f"有料（{count.group(1)}台・{fee_text}）"
    if count:
        paid = "有料" if fee_text or "有料" in note else "あり"
        return f"{paid}（{count.group(1)}台）"
    if "なし" in count_text:
        return "なし"
    if fee_text:
        return f"有料（{fee_text}）"
    return "要確認"


def ward_from_url(url):
    match = re.search(r"/tokyo/([^/]+)/", url)
    return WARDS.get(match.group(1), "") if match else ""


def index_pages(index_name=INDEX, href_prefix="tokyo/"):
    html = fetch(index_name if index_name.startswith("http") else BASE + index_name)
    pages = []
    seen = set()
    for href, name in re.findall(rf'href="({href_prefix}[^"]+\.html)"[^>]*>([^<]+)', html):
        name = re.sub(r"\s+", "", strip_tags(name))
        key = (href, norm(name))
        if key in seen:
            continue
        seen.add(key)
        pages.append((BASE + href, name))
    return pages


def scrape_page(url, name, region=None):
    html = fetch(url)
    query_address, google_point = google_query(html)
    raw_address = field_text(html, "shozaiti_bar")
    address = raw_address if looks_like_address(raw_address) else ""
    if not address and looks_like_address(query_address):
        address = query_address
    if not address:
        address = raw_address or query_address
    station = field_text(html, "moyorieki_bar") or "要確認"
    parking_cell = ""
    parking_match = re.search(
        r"tyusyajo_bar2\.jpg.*?</tr>\s*<tr>(.*?)</tr>",
        html,
        re.S,
    )
    if parking_match:
        cells = re.findall(r"<td[^>]*>\s*(?:<div[^>]*>)?(.*?)(?:</div>)?\s*</td>", parking_match.group(1), re.S)
        if cells:
            parking_cell = one_line(strip_tags(cells[0]))
    note_match = re.search(r"biko_bar2\.jpg.*?<div[^>]*>(.*?)</div>", html, re.S)
    note = one_line(strip_tags(note_match.group(1))) if note_match else ""
    prefecture = region["pref"] if region else "東京都"
    box = region["box"] if region else TOKYO
    ward = ward_from_url(url)
    queries = []
    if looks_like_address(address):
        full_address = address if address.startswith(prefecture) else prefecture + address
        queries.append(full_address)
        loose = re.sub(r"(\d+)\s*[-－]\s*\d+.*$", r"\1丁目", full_address)
        if loose != full_address:
            queries.append(loose)
    if ward:
        queries.append(f"{prefecture}{ward}{name}")
    queries.append(prefecture + name)
    found = pick_gsi(queries, prefecture, box)
    point = (found[0], found[1]) if found else None
    label = found[2] if found else ""
    usable_ll = None
    if google_point and in_box(*google_point, box):
        lat, lng = google_point
        if abs(lat - 35.6895) > 0.002 or abs(lng - 139.6917) > 0.002:
            usable_ll = google_point
    if usable_ll and (point is None or (abs(usable_ll[0] - point[0]) < 0.02 and abs(usable_ll[1] - point[1]) < 0.025)):
        point = usable_ll
        label = "google-ll"
    if address and not address.startswith(prefecture):
        address = prefecture + address
    return {
        "source_name": name,
        "url": url,
        "address": address,
        "access": station,
        "parking_cell": parking_cell,
        "note": note,
        "point": point,
        "geocode_label": label,
        "ward": ward,
        "region": region,
    }


def empty_item(name, url, region, error):
    return {
        "source_name": name,
        "url": url,
        "error": str(error),
        "point": None,
        "address": "",
        "access": "",
        "parking_cell": "",
        "note": "",
        "geocode_label": "",
        "ward": "",
        "region": region,
    }


def main():
    pages = []
    for region in NEW_REGIONS:
        region_pages = index_pages(region["index"], region["slug"] + "/")
        pages.extend((url, name, region) for url, name in region_pages)
        print("indexed", region["slug"], len(region_pages), flush=True)

    scraped = []
    for index, (url, name, region) in enumerate(pages, start=1):
        try:
            scraped.append(scrape_page(url, name, region))
        except Exception as error:
            scraped.append(empty_item(name, url, region, error))
        if index % 20 == 0:
            print("fetched", index, "/", len(pages), flush=True)
        time.sleep(0.04)

    kept = []
    if OUT.exists():
        current = json.loads(OUT.read_text(encoding="utf-8"))
        kept = [
            feature for feature in current["features"]
            if feature["properties"].get("area_group") == "tokyo"
        ]
    used = set()
    features = list(kept)
    next_id = max((feature["properties"]["id"] for feature in features), default=0) + 1
    for item in scraped:
        region = item.get("region") or {}
        key = (region.get("slug"), norm(item["source_name"]))
        canonical = item["source_name"]
        if key in used:
            canonical = f"{canonical}（別面）"
        used.add(key)
        city = city_from_address(item.get("address") or "", region.get("pref", ""))
        matched = BAT.get(item["source_name"])
        if matched is None:
            matched = next((value for bat_name, value in BAT.items() if norm(bat_name) == norm(item["source_name"])), None)
        status, bat_note, as_of = matched or ("unknown", "", "")
        facility_note = item.get("note") or ""
        trimmed = re.sub(r"駐車場[:：]\S*", "", facility_note)
        trimmed = re.sub(r"球場[:：]\S*", "", trimmed)
        trimmed = one_line(trimmed)
        note = " ".join(part for part in (bat_note, trimmed) if part).strip()
        point = item.get("point")
        geometry = {"type": "Point", "coordinates": [round(point[1], 6), round(point[0], 6)]} if point else None
        features.append({
            "type": "Feature",
            "geometry": geometry,
            "properties": {
                "id": next_id,
                "name": canonical,
                "area": city or region.get("category") or "東京都",
                "area_category": region.get("category") or "その他23区",
                "area_group": region.get("group") or "tokyo",
                "bat_status": status,
                "access": item.get("access") or "要確認",
                "parking": parse_parking(item.get("parking_cell", ""), facility_note),
                "dimensions": parse_dimensions(facility_note),
                "note": note,
                "address": item.get("address") or "",
                "official_url": "",
                "as_of": as_of,
                "geocode_label": item.get("geocode_label") or "",
            },
        })
        next_id += 1

    seen_points = {}
    for feature in features:
        geometry = feature.get("geometry")
        if not geometry:
            continue
        lng, lat = geometry["coordinates"]
        key = (round(lat, 4), round(lng, 4))
        seen_points[key] = seen_points.get(key, 0) + 1
        if seen_points[key] > 1:
            shift = (seen_points[key] - 1) * 0.00045
            geometry["coordinates"] = [round(lng + shift, 6), round(lat + shift, 6)]

    found = {norm(feature["properties"]["name"]) for feature in features}
    missing = [name for names in AREAS.values() for name in names if norm(name) not in found]
    weak = [
        f"{feature['properties']['name']} => {feature['properties'].get('geocode_label')}"
        for feature in features
        if feature.get("geometry") and not re.search(r"\d", feature["properties"].get("geocode_label") or "")
    ]
    unlocated = [feature["properties"]["name"] for feature in features if not feature.get("geometry")]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps({"type": "FeatureCollection", "features": features}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    located = sum(1 for feature in features if feature["geometry"])
    report = [
        f"pages {len(pages)} features {len(features)} located {located}",
        "missing " + "、".join(missing),
        "unlocated " + "、".join(unlocated),
        "weak:",
        *weak,
    ]
    (ROOT / "_geocode_report.txt").write_text("\n".join(report), encoding="utf-8")
    print(f"pages {len(pages)} features {len(features)} located {located} missing {len(missing)} unlocated {len(unlocated)} weak {len(weak)}")


if __name__ == "__main__":
    main()
