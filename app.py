"""草野球球場のウレタンバット規制マップ。"""

import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, jsonify, render_template, request

BASE_DIR = Path(__file__).resolve().parent
SEED_PATH = BASE_DIR / "data" / "stadiums.geojson"
DB_PATH = BASE_DIR / "instance" / "bat_abelable.db"

AREA_GROUPS = ("tokyo", "tokyo_tama", "saitama", "kanagawa", "chiba", "chiba_west")
BAT_STATUSES = ("allowed", "prohibited", "unknown")
REPORT_TYPES = ("correction", "new")

app = Flask(__name__)
app.config["JSON_AS_ASCII"] = False


def connect():
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def load_seed():
    payload = json.loads(SEED_PATH.read_text(encoding="utf-8"))
    rows = []
    for feature in payload["features"]:
        props = feature["properties"]
        geometry = feature.get("geometry")
        if geometry and geometry.get("coordinates"):
            lng, lat = geometry["coordinates"]
            lat, lng = float(lat), float(lng)
        else:
            lat = lng = None
        status = props["bat_status"]
        area_group = props.get("area_group") or "tokyo"
        if status not in BAT_STATUSES:
            raise ValueError(f"invalid bat_status: {status}")
        if area_group not in AREA_GROUPS:
            raise ValueError(f"invalid area_group: {area_group}")
        rows.append(
            (
                int(props["id"]),
                props["name"],
                props.get("area") or "東京都",
                props.get("area_category") or props.get("area") or "東京都",
                area_group,
                lat,
                lng,
                status,
                props.get("access") or "要確認",
                props.get("parking") or "要確認",
                props.get("dimensions") or "要確認",
                props.get("note") or "",
                props.get("address") or "",
                props.get("official_url") or "",
                props.get("as_of") or "",
            )
        )
    return rows


def init_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with connect() as connection:
        connection.executescript(
            """
            DROP TABLE IF EXISTS stadiums;

            CREATE TABLE stadiums (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                area TEXT NOT NULL,
                area_category TEXT NOT NULL,
                area_group TEXT NOT NULL,
                lat REAL,
                lng REAL,
                bat_status TEXT NOT NULL,
                access TEXT NOT NULL DEFAULT '',
                parking TEXT NOT NULL DEFAULT '',
                dimensions TEXT NOT NULL DEFAULT '',
                note TEXT NOT NULL DEFAULT '',
                address TEXT NOT NULL DEFAULT '',
                official_url TEXT NOT NULL DEFAULT '',
                as_of TEXT NOT NULL DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS reports (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                report_type TEXT NOT NULL,
                stadium_name TEXT NOT NULL,
                area TEXT NOT NULL DEFAULT '',
                bat_status TEXT NOT NULL DEFAULT '',
                note TEXT NOT NULL DEFAULT '',
                address TEXT NOT NULL DEFAULT '',
                reporter_name TEXT NOT NULL DEFAULT '',
                contact TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            );
            """
        )
        connection.execute("DELETE FROM stadiums")
        connection.executemany(
            """
            INSERT INTO stadiums (
                id, name, area, area_category, area_group, lat, lng, bat_status,
                access, parking, dimensions, note, address, official_url, as_of
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            load_seed(),
        )


def stadium_features(connection):
    features = []
    for row in connection.execute("SELECT * FROM stadiums ORDER BY id"):
        geometry = None
        if row["lat"] is not None and row["lng"] is not None:
            geometry = {"type": "Point", "coordinates": [row["lng"], row["lat"]]}
        features.append(
            {
                "type": "Feature",
                "geometry": geometry,
                "properties": {
                    "id": row["id"],
                    "name": row["name"],
                    "area": row["area"],
                    "area_category": row["area_category"],
                    "area_group": row["area_group"],
                    "bat_status": row["bat_status"],
                    "access": row["access"],
                    "parking": row["parking"],
                    "dimensions": row["dimensions"],
                    "note": row["note"],
                    "address": row["address"],
                    "official_url": row["official_url"],
                    "as_of": row["as_of"],
                    "lat": row["lat"],
                    "lng": row["lng"],
                },
            }
        )
    return {"type": "FeatureCollection", "features": features}


def clip(value, limit):
    return str(value or "").strip()[:limit]


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/api/stadiums")
def api_stadiums():
    with connect() as connection:
        return jsonify(stadium_features(connection))


@app.post("/api/reports")
def api_reports():
    if request.content_length and request.content_length > 20_000:
        return jsonify({"error": "送信内容が長すぎます。"}), 413

    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"error": "JSONで送信してください。"}), 400

    report_type = clip(payload.get("report_type"), 20)
    stadium_name = clip(payload.get("stadium_name"), 80)
    area = clip(payload.get("area"), 40)
    bat_status = clip(payload.get("bat_status"), 20)
    note = clip(payload.get("note"), 500)
    address = clip(payload.get("address"), 120)
    reporter_name = clip(payload.get("reporter_name"), 40)
    contact = clip(payload.get("contact"), 80)

    if report_type not in REPORT_TYPES:
        return jsonify({"error": "報告の種類を選んでください。"}), 400
    if not stadium_name:
        return jsonify({"error": "球場名を入力してください。"}), 400
    if bat_status and bat_status not in BAT_STATUSES:
        return jsonify({"error": "規制区分が不正です。"}), 400
    if not note:
        return jsonify({"error": "分かった内容を入力してください。"}), 400

    created_at = datetime.now(timezone.utc).isoformat()
    with connect() as connection:
        cursor = connection.execute(
            """
            INSERT INTO reports (
                report_type, stadium_name, area, bat_status, note, address,
                reporter_name, contact, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                report_type,
                stadium_name,
                area,
                bat_status,
                note,
                address,
                reporter_name,
                contact,
                created_at,
            ),
        )
        report_id = cursor.lastrowid

    return jsonify({"ok": True, "id": report_id}), 201


init_db()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", "5000")), debug=True)
