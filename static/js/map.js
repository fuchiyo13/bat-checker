const STATUS = {
  allowed: { label: "使用可能", short: "OK" },
  prohibited: { label: "使用不可", short: "NG" },
  unknown: { label: "情報なし", short: "?" },
};

const areaSelect = document.querySelector("#filter-area");
const statusSelect = document.querySelector("#filter-status");
const keywordInput = document.querySelector("#filter-keyword");
const list = document.querySelector("#stadium-list");
const countLabel = document.querySelector("#result-count");
const emptyState = document.querySelector("#empty-state");
const emptyMessage = document.querySelector("#empty-message");
const nameList = document.querySelector("#stadium-names");

const map = L.map("map", { zoomControl: true, scrollWheelZoom: true, minZoom: 7, maxZoom: 16 });
map.attributionControl.setPrefix(false);
map.attributionControl.addAttribution(
  '境界: <a href="https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-v3_1.html" target="_blank" rel="noopener noreferrer">国土数値情報（行政区域）</a>を加工'
);

function prefectureStyle(zoom) {
  return {
    color: "#ffffff",
    weight: zoom >= 12 ? 4.2 : zoom >= 9 ? 3.4 : 2.6,
    opacity: 1,
    fillColor: "#141414",
    fillOpacity: 1,
    lineJoin: "round",
    lineCap: "round",
  };
}

function municipalityStyle(zoom) {
  return {
    color: "#ffffff",
    weight: zoom >= 13 ? 1.45 : zoom >= 11 ? 1.05 : zoom >= 9 ? 0.75 : 0.45,
    opacity: zoom < 8 ? 0.4 : 0.88,
    fill: false,
    fillOpacity: 0,
    lineJoin: "round",
    lineCap: "round",
  };
}

const prefectureLayer = L.geoJSON(null, {
  interactive: false,
  style: () => prefectureStyle(map.getZoom()),
}).addTo(map);

const labelPane = map.createPane("ward-labels");
labelPane.style.zIndex = 450;
const wardLabels = L.layerGroup().addTo(map);

function ringArea(ring) {
  let area = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    area += ring[index][0] * ring[index + 1][1] - ring[index + 1][0] * ring[index][1];
  }
  return Math.abs(area) / 2;
}

function pointInRing(point, ring) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const xi = ring[index][0];
    const yi = ring[index][1];
    const xj = ring[previous][0];
    const yj = ring[previous][1];
    const crosses = yi > point[1] !== yj > point[1]
      && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi + 0.0) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

function distanceToSegment(point, start, end) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  if (dx === 0 && dy === 0) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const ratio = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point[0] - (start[0] + ratio * dx), point[1] - (start[1] + ratio * dy));
}

function labelPoint(geometry) {
  if (!geometry) return null;
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  let ring = null;
  let bestArea = 0;
  polygons.forEach((polygon) => {
    const area = ringArea(polygon[0]);
    if (area > bestArea) {
      bestArea = area;
      ring = polygon[0];
    }
  });
  if (!ring) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  ring.forEach(([x, y]) => {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  });
  let best = null;
  let bestDistance = -1;
  const steps = 12;
  for (let xStep = 0; xStep <= steps; xStep += 1) {
    for (let yStep = 0; yStep <= steps; yStep += 1) {
      const point = [
        minX + ((maxX - minX) * xStep) / steps,
        minY + ((maxY - minY) * yStep) / steps,
      ];
      if (!pointInRing(point, ring)) continue;
      let distance = Infinity;
      for (let index = 0; index < ring.length - 1; index += 1) {
        distance = Math.min(distance, distanceToSegment(point, ring[index], ring[index + 1]));
      }
      if (distance > bestDistance) {
        bestDistance = distance;
        best = point;
      }
    }
  }
  return best;
}

function addWardLabel(feature) {
  const name = feature.properties?.name || "";
  if (!/[区市]$/.test(name)) return;
  const point = labelPoint(feature.geometry);
  if (!point) return;
  const width = Math.max(36, name.length * 14);
  L.marker([point[1], point[0]], {
    pane: "ward-labels",
    interactive: false,
    keyboard: false,
    icon: L.divIcon({
      className: "ward-label",
      html: `<span>${escapeHtml(name)}</span>`,
      iconSize: [width, 18],
      iconAnchor: [width / 2, 9],
    }),
  }).addTo(wardLabels);
}

function updateWardLabels() {
  labelPane.style.display = map.getZoom() >= 11 ? "" : "none";
}

const municipalityLayer = L.geoJSON(null, {
  style: () => municipalityStyle(map.getZoom()),
  onEachFeature(feature, layer) {
    const name = feature.properties?.name;
    const city = feature.properties?.city;
    if (!name) return;
    const label = city && city !== name ? `${city}${name}` : name;
    layer.bindTooltip(label, { sticky: true, className: "boundary-tip", opacity: 1 });
    addWardLabel(feature);
  },
}).addTo(map);

const markers = L.layerGroup().addTo(map);

function applyBoundaryStyle() {
  const zoom = map.getZoom();
  prefectureLayer.setStyle(prefectureStyle(zoom));
  municipalityLayer.setStyle(municipalityStyle(zoom));
  updateWardLabels();
}

map.on("zoomend", applyBoundaryStyle);

async function loadBoundaries() {
  const [prefectures, municipalities] = await Promise.all([
    fetch("/static/data/prefectures.geojson", { cache: "no-store" }),
    fetch("/static/data/municipalities.geojson", { cache: "no-store" }),
  ]);
  if (!prefectures.ok || !municipalities.ok) return;
  prefectureLayer.addData(await prefectures.json());
  municipalityLayer.addData(await municipalities.json());
  applyBoundaryStyle();
}
let stadiums = [];
let markerById = new Map();
let activeId = null;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}

function iconFor(status) {
  const meta = STATUS[status] || STATUS.unknown;
  return L.divIcon({
    className: "bat-marker",
    html: `<div class="pin ${status}"><span>${meta.short}</span></div>`,
    iconSize: [34, 42],
    iconAnchor: [17, 38],
    popupAnchor: [0, -32],
  });
}

function placeLabel(props) {
  if (props.area && props.area !== props.area_category) {
    return `${props.area_category} ${props.area}`;
  }
  return props.area_category || props.area || "";
}

function factLine(label, value) {
  const text = value || "要確認";
  return `<p class="popup-fact"><span>${label}</span>${escapeHtml(text)}</p>`;
}

function popupHtml(props) {
  const meta = STATUS[props.bat_status] || STATUS.unknown;
  const hasPoint = props.lat != null && props.lng != null;
  const directions = hasPoint
    ? `<a href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${props.lat},${props.lng}`)}" target="_blank" rel="noopener noreferrer">経路を開く</a>`
    : "";
  const asOf = props.as_of ? `<p class="popup-asof">確認時点 ${escapeHtml(props.as_of)}</p>` : "";
  const note = props.note ? `<p class="popup-note">${escapeHtml(props.note)}</p>` : "";

  return `
    <article class="popup-card">
      <span class="popup-status ${escapeHtml(props.bat_status)}">ウレタン ${escapeHtml(meta.label)}</span>
      <h2>${escapeHtml(props.name)}</h2>
      <p class="popup-area">${escapeHtml(placeLabel(props))}</p>
      ${factLine("両翼", props.dimensions)}
      ${factLine("アクセス", props.access)}
      ${factLine("駐車場", props.parking)}
      ${note}
      <p class="popup-address">${escapeHtml(props.address)}</p>
      ${asOf}
      <div class="popup-actions">
        ${directions}
      </div>
    </article>
  `;
}

function matches(feature) {
  const props = feature.properties;
  if (areaSelect.value !== "all" && props.area_category !== areaSelect.value) return false;
  if (statusSelect.value !== "all" && props.bat_status !== statusSelect.value) return false;
  const keyword = keywordInput.value.trim().toLowerCase();
  if (!keyword) return true;
  const haystack = [props.name, props.area, props.area_category, props.address, props.access, props.note].join(" ").toLowerCase();
  return haystack.includes(keyword);
}

function fitTo(features) {
  const points = features.filter((feature) => feature.properties.lat != null && feature.properties.lng != null);
  if (!points.length) return;
  const bounds = L.latLngBounds(points.map((feature) => [feature.properties.lat, feature.properties.lng]));
  map.fitBounds(bounds.pad(0.18), { maxZoom: 13, animate: true });
}

function render(refit) {
  const visible = stadiums.filter(matches);
  markers.clearLayers();
  markerById = new Map();

  visible.forEach((feature) => {
    const props = feature.properties;
    if (props.lat == null || props.lng == null) return;
    const marker = L.marker([props.lat, props.lng], { icon: iconFor(props.bat_status) });
    marker.bindPopup(popupHtml(props), { className: "bat-popup", maxWidth: 280 });
    marker.on("click", () => setActive(props.id));
    marker.addTo(markers);
    markerById.set(props.id, marker);
  });

  countLabel.textContent = `表示 ${visible.length} / ${stadiums.length}`;
  list.innerHTML = visible.map((feature) => {
    const props = feature.properties;
    const meta = STATUS[props.bat_status] || STATUS.unknown;
    return `
      <li>
        <button type="button" data-id="${props.id}" class="${props.id === activeId ? "active" : ""}">
          <i class="dot ${escapeHtml(props.bat_status)}"></i>
          <span class="item-name">${escapeHtml(props.name)}</span>
          <span class="item-meta">${escapeHtml(placeLabel(props))} ・ ウレタン${escapeHtml(meta.label)}${props.lat == null ? " ・ 位置未設定" : ""}</span>
        </button>
      </li>
    `;
  }).join("");

  const noMatch = visible.length === 0;
  emptyState.hidden = !noMatch;
  if (noMatch) {
    emptyMessage.textContent = statusSelect.value === "allowed"
      ? "使用可能と確認できた球場は、いまの掲載データにはありません。現地情報があれば報告できます。"
      : "条件に合う球場がありません。キーワードやエリアを変えてみてください。";
  }

  if (activeId && !markerById.has(activeId)) {
    activeId = null;
    map.closePopup();
  }

  if (refit) fitTo(visible);
}

function setActive(id) {
  activeId = id;
  list.querySelectorAll("button").forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.id) === id);
  });
  const activeButton = list.querySelector(`button[data-id="${id}"]`);
  if (activeButton) activeButton.scrollIntoView({ block: "nearest" });
}

function openStadium(id) {
  const marker = markerById.get(id);
  if (!marker) return;
  setActive(id);
  let opened = false;
  const open = () => {
    if (opened) return;
    opened = true;
    marker.openPopup();
  };
  map.once("moveend", open);
  map.flyTo(marker.getLatLng(), Math.max(map.getZoom(), 14), { duration: 0.45 });
  setTimeout(open, 700);
}

list.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-id]");
  if (!button) return;
  openStadium(Number(button.dataset.id));
});

areaSelect.addEventListener("change", () => render(true));
statusSelect.addEventListener("change", () => render(true));
keywordInput.addEventListener("input", () => render(false));
document.querySelector("#fit-all").addEventListener("click", () => fitTo(stadiums.filter(matches)));

async function loadStadiums() {
  const response = await fetch("/api/stadiums");
  if (!response.ok) throw new Error("球場データを読み込めませんでした。");
  const collection = await response.json();
  stadiums = collection.features.map((feature) => {
    const coords = feature.geometry?.coordinates;
    return {
      ...feature,
      properties: {
        ...feature.properties,
        lat: feature.properties.lat ?? (coords ? coords[1] : null),
        lng: feature.properties.lng ?? (coords ? coords[0] : null),
      },
    };
  });
  nameList.innerHTML = stadiums
    .map((feature) => `<option value="${escapeHtml(feature.properties.name)}"></option>`)
    .join("");
  render(true);
  setTimeout(() => map.invalidateSize(), 150);
}

const reportForm = document.querySelector("#report-form");
const reportError = document.querySelector("#report-error");
const reportSubmit = document.querySelector("#report-submit");
const toast = new bootstrap.Toast(document.querySelector("#app-toast"));

reportForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  reportError.hidden = true;
  const formData = new FormData(reportForm);
  const payload = Object.fromEntries(formData.entries());
  reportSubmit.disabled = true;

  try {
    const response = await fetch("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "送信に失敗しました。");

    reportForm.reset();
    bootstrap.Modal.getInstance(document.querySelector("#report-modal"))?.hide();
    document.querySelector("#toast-body").textContent = "受け付けました。内容は確認用に保存しています。";
    toast.show();
  } catch (error) {
    reportError.textContent = error.message;
    reportError.hidden = false;
  } finally {
    reportSubmit.disabled = false;
  }
});

window.addEventListener("resize", () => map.invalidateSize());

loadBoundaries();
loadStadiums().catch((error) => {
  countLabel.textContent = error.message;
});
