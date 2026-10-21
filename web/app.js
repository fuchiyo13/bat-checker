const ADMIN_PASSWORD = "bat-fuchi";
const RAKUTEN_AFFILIATE_ID = "58b057d7.19255e95.58b057d8.f3ebfd7d";
const REPORTS_KEY = "bat-checker-reports";
const STATUS_KEY = "bat-checker-status";
const SESSION_KEY = "bat-checker-admin";

const AREAS = [
  "足立区・荒川周辺",
  "板橋区・北区・豊島区・周辺",
  "江戸川区・臨海エリア",
  "大田区・品川区・多摩川沿い",
  "葛飾区・江戸川上流・江東区・中央区周辺",
  "杉並区周辺",
  "墨田区周辺",
  "世田谷区周辺",
  "台東区・港区・文京区・新宿区",
  "練馬区周辺",
  "その他23区",
  "東京都下",
  "神奈川県",
  "埼玉県",
  "千葉県",
];

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
const reportArea = document.querySelector("#report-area");

const map = L.map("map", { zoomControl: true, scrollWheelZoom: true, minZoom: 7, maxZoom: 16 });
map.attributionControl.setPrefix(false);
map.attributionControl.addAttribution(
  '境界: <a href="https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-v3_1.html" target="_blank" rel="noopener noreferrer">国土数値情報（行政区域）</a>を加工'
);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);

function prefectureStyle(zoom) {
  return {
    color: "#ffffff",
    weight: zoom >= 12 ? 4.2 : zoom >= 9 ? 3.4 : 2.6,
    opacity: 1,
    fill: false,
    fillOpacity: 0,
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
    lineJoin: "round",
    lineCap: "round",
  };
}

const labelPane = map.createPane("ward-labels");
labelPane.style.zIndex = 450;
const wardLabels = L.layerGroup().addTo(map);
const prefectureLayer = L.geoJSON(null, {
  interactive: false,
  style: () => prefectureStyle(map.getZoom()),
}).addTo(map);
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

let baseStadiums = [];
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

function loadReports() {
  try {
    const parsed = JSON.parse(localStorage.getItem(REPORTS_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveReports(reports) {
  localStorage.setItem(REPORTS_KEY, JSON.stringify(reports));
  updatePendingBadge();
}

function loadStatusOverrides() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STATUS_KEY) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function canonicalStatus(value) {
  const raw = String(value || "unknown").toLowerCase();
  if (raw === "allowed") return "allowed";
  if (raw === "forbidden" || raw === "prohibited") return "forbidden";
  return "unknown";
}

function applyStatusOverrides(rows) {
  const overrides = loadStatusOverrides();
  return rows.map((row) => {
    const next = overrides[String(row.id)];
    if (!next) return row;
    const status = canonicalStatus(next);
    return {
      ...row,
      status,
      bat_status: status === "forbidden" ? "prohibited" : status,
    };
  });
}

function applyReports(rows) {
  const reports = loadReports().filter((report) => report.status === "approved");
  const byId = new Map(rows.map((row) => [String(row.id), { ...row }]));
  const created = [];
  reports.forEach((report) => {
    const patch = {};
    ["name", "area_category", "area", "bat_status", "access", "parking", "dimensions", "rain", "note", "address", "lat", "lng", "as_of"].forEach((key) => {
      if (report[key] !== undefined && report[key] !== "") patch[key] = report[key];
    });
    if (report.type === "new" || !byId.has(String(report.stadium_id))) {
      created.push({
        id: report.stadium_id,
        bat_status: "unknown",
        access: "要確認",
        parking: "要確認",
        dimensions: "要確認",
        rain: "要確認",
        note: "",
        address: "",
        area: report.area_category || "",
        lat: null,
        lng: null,
        ...patch,
      });
      return;
    }
    byId.set(String(report.stadium_id), { ...byId.get(String(report.stadium_id)), ...patch });
  });
  return [...byId.values(), ...created];
}

function placeLabel(stadium) {
  if (stadium.area && stadium.area !== stadium.area_category) {
    return `${stadium.area_category} ${stadium.area}`;
  }
  return stadium.area_category || stadium.area || "";
}

function rainText(stadium) {
  return stadium.rain || "要確認";
}

function trackAffiliate(label) {
  if (typeof gtag === "function") {
    gtag("event", "affiliate_click", { link_label: label });
  }
}

function rakutenUrl(keyword) {
  if (!RAKUTEN_AFFILIATE_ID) return null;
  const search = `https://search.rakuten.co.jp/search/mall/${encodeURIComponent(keyword)}/`;
  return `https://hb.afl.rakuten.co.jp/hgc/${encodeURIComponent(RAKUTEN_AFFILIATE_ID)}/?pc=${encodeURIComponent(search)}`;
}

function bindAffiliateClicks(root) {
  if (!root) return;
  root.querySelectorAll("[data-affiliate-label]").forEach((el) => {
    const label = el.dataset.affiliateLabel;
    if (!label) return;
    el.addEventListener("click", () => trackAffiliate(label));
  });
}

function rakutenLinkHtml(keyword, trackLabel, className, text) {
  const href = rakutenUrl(keyword);
  if (!href) return "";
  return `<a class="${className}" href="${href}" target="_blank" rel="noopener noreferrer sponsored" data-affiliate-label="${escapeHtml(trackLabel)}">${escapeHtml(text)}</a>`;
}

function modalRakutenLinks(shown) {
  if (!RAKUTEN_AFFILIATE_ID) return "";
  let primary;
  if (shown === "allowed") {
    primary = { keyword: "軟式 ウレタンバット", text: "高反発バットを見る", track: "rakuten_urethane" };
  } else if (shown === "prohibited") {
    primary = { keyword: "軟式 金属バット", text: "金属バットを見る", track: "rakuten_metal" };
  } else {
    primary = { keyword: "軟式 バット", text: "軟式バットを見る", track: "rakuten_soft" };
  }
  return `
    <div class="gear-inline">
      ${rakutenLinkHtml(primary.keyword, primary.track, "gear-primary", primary.text)}
      ${rakutenLinkHtml("軟式 木製バット", "rakuten_wood", "gear-text", "木製バット")}
    </div>
  `;
}

function setGearLinks() {
  const block = document.querySelector("#gear-block");
  const soft = document.querySelector("#gear-soft");
  const wood = document.querySelector("#gear-wood");
  if (!RAKUTEN_AFFILIATE_ID) {
    if (block) block.hidden = true;
    return;
  }
  const softUrl = rakutenUrl("軟式 バット");
  const metalUrl = rakutenUrl("軟式 金属バット");
  if (!softUrl || !metalUrl || !block || !soft || !wood) return;
  block.hidden = false;
  soft.href = softUrl;
  wood.href = metalUrl;
  bindAffiliateClicks(block);
}

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
      && point[0] < ((xj - xi) * (point[1] - yi)) / ((yj - yi) || 1e-12) + xi;
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
  for (let xStep = 0; xStep <= 12; xStep += 1) {
    for (let yStep = 0; yStep <= 12; yStep += 1) {
      const point = [minX + ((maxX - minX) * xStep) / 12, minY + ((maxY - minY) * yStep) / 12];
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

function applyBoundaryStyle() {
  const zoom = map.getZoom();
  prefectureLayer.setStyle(prefectureStyle(zoom));
  municipalityLayer.setStyle(municipalityStyle(zoom));
  updateWardLabels();
}

map.on("zoomend", applyBoundaryStyle);

async function loadBoundaries() {
  try {
    const [prefectures, municipalities] = await Promise.all([
      fetch("../static/data/prefectures.geojson"),
      fetch("../static/data/municipalities.geojson"),
    ]);
    if (!prefectures.ok || !municipalities.ok) throw new Error("boundary");
    prefectureLayer.addData(await prefectures.json());
    municipalityLayer.addData(await municipalities.json());
    applyBoundaryStyle();
  } catch {
    // 境界が読めないときも、下地はOpenStreetMapの標準タイルのままにする。
  }
}

function pinStatus(stadium) {
  const raw = String(stadium.status || stadium.bat_status || "unknown").toLowerCase();
  if (raw === "allowed") return "allowed";
  if (raw === "forbidden" || raw === "prohibited") return "prohibited";
  return "unknown";
}

function stadiumNotes(stadium) {
  if (stadium.notes != null && String(stadium.notes).trim() !== "") return stadium.notes;
  return stadium.note || "";
}

function affiliateLead(stadium) {
  const shown = pinStatus(stadium);
  if (shown === "prohibited") return "この球場はウレタン禁止。金属バットを確認";
  if (shown === "allowed") return "ウレタン使用可。高反発バットを確認";
  return "軟式バットの候補を確認";
}

function iconFor(status) {
  const meta = STATUS[status] || STATUS.unknown;
  return L.divIcon({
    className: "bat-marker",
    html: `<div class="pin ${status}"><span>${meta.short}</span></div>`,
    iconSize: [34, 42],
    iconAnchor: [17, 38],
  });
}

function matches(stadium) {
  if (areaSelect.value !== "all" && stadium.area_category !== areaSelect.value) return false;
  if (statusSelect.value !== "all" && pinStatus(stadium) !== statusSelect.value) return false;
  const keyword = keywordInput.value.trim().toLowerCase();
  if (!keyword) return true;
  return [stadium.name, stadium.area, stadium.area_category, stadium.address, stadium.access, stadiumNotes(stadium)]
    .join(" ")
    .toLowerCase()
    .includes(keyword);
}

function fitTo(rows) {
  const points = rows.filter((stadium) => stadium.lat != null && stadium.lng != null);
  if (!points.length) return;
  const bounds = L.latLngBounds(points.map((stadium) => [stadium.lat, stadium.lng]));
  map.fitBounds(bounds.pad(0.18), { maxZoom: 13, animate: true });
}

let nameTipMarker = null;
let touchClickPending = false;

map.getContainer().addEventListener("touchstart", () => {
  touchClickPending = true;
}, { passive: true });

map.on("click", () => {
  dismissNameTip();
});

function dismissNameTip() {
  if (!nameTipMarker) return;
  const marker = nameTipMarker;
  nameTipMarker = null;
  marker.closeTooltip();
}

function render(refit) {
  dismissNameTip();
  const visible = stadiums.filter(matches);
  markers.clearLayers();
  markerById = new Map();
  visible.forEach((stadium) => {
    if (stadium.lat == null || stadium.lng == null) return;
    const marker = L.marker([stadium.lat, stadium.lng], { icon: iconFor(pinStatus(stadium)) });
    marker.bindTooltip(escapeHtml(stadium.name), {
      className: "stadium-tip",
      direction: "top",
      offset: [0, -34],
      opacity: 1,
    });
    marker.on("mouseout", () => {
      if (nameTipMarker === marker) marker.openTooltip();
    });
    marker.on("click", (event) => {
      L.DomEvent.stopPropagation(event);
      const fromTouch = touchClickPending;
      touchClickPending = false;
      if (fromTouch && nameTipMarker !== marker) {
        if (nameTipMarker) nameTipMarker.closeTooltip();
        marker.openTooltip();
        nameTipMarker = marker;
        return;
      }
      dismissNameTip();
      openDetail(stadium.id);
    });
    marker.addTo(markers);
    markerById.set(String(stadium.id), marker);
  });
  countLabel.textContent = `表示 ${visible.length} / ${stadiums.length}`;
  list.innerHTML = visible.map((stadium) => {
    const shown = pinStatus(stadium);
    const meta = STATUS[shown] || STATUS.unknown;
    return `
      <li>
        <button type="button" data-id="${escapeHtml(stadium.id)}" class="${String(stadium.id) === String(activeId) ? "active" : ""}">
          <i class="dot ${escapeHtml(shown)}"></i>
          <span class="item-name">${escapeHtml(stadium.name)}</span>
          <span class="item-meta">${escapeHtml(placeLabel(stadium))} ・ ウレタン${escapeHtml(meta.label)}${stadium.lat == null ? " ・ 位置未設定" : ""}</span>
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
  if (refit) fitTo(visible);
}

function fact(label, value) {
  return `<p class="fact"><span>${label}</span>${escapeHtml(value || "要確認")}</p>`;
}

function openDetail(id) {
  const stadium = stadiums.find((row) => String(row.id) === String(id));
  if (!stadium) return;
  activeId = stadium.id;
  list.querySelectorAll("button").forEach((button) => {
    button.classList.toggle("active", button.dataset.id === String(id));
  });
  const shown = pinStatus(stadium);
  const meta = STATUS[shown] || STATUS.unknown;
  const notes = stadiumNotes(stadium);
  const directions = stadium.lat != null
    ? `<a href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${stadium.lat},${stadium.lng}`)}" target="_blank" rel="noopener noreferrer">経路を開く</a>`
    : "";
  const detailBody = document.querySelector("#detail-body");
  detailBody.innerHTML = `
    <span class="status-pill ${escapeHtml(shown)}">ウレタン ${escapeHtml(meta.label)}</span>
    <h2 id="detail-title">${escapeHtml(stadium.name)}</h2>
    <p class="detail-area">${escapeHtml(placeLabel(stadium))}</p>
    ${fact("両翼", stadium.dimensions)}
    ${fact("アクセス", stadium.access)}
    ${fact("駐車場", stadium.parking)}
    ${fact("雨天", rainText(stadium))}
    ${notes ? `<p class="detail-note">${escapeHtml(notes)}</p>` : ""}
    ${stadium.address ? `<p class="detail-area">${escapeHtml(stadium.address)}</p>` : ""}
    ${stadium.as_of ? `<p class="detail-area">確認時点 ${escapeHtml(stadium.as_of)}</p>` : ""}
    ${directions ? `<div class="detail-actions">${directions}</div>` : ""}
    <div class="affiliate-banner">
      <p class="affiliate-disclosure">広告</p>
      <p class="affiliate-lead">${escapeHtml(affiliateLead(stadium))}</p>
      <a href="https://px.a8.net/svt/ejp?a8mat=4BEGD2+8IM9BM+4ABU+6MZE9" target="_blank" rel="noopener noreferrer sponsored nofollow" data-affiliate-label="a8_xebio">
        <img border="0" width="300" height="250" alt="スーパースポーツゼビオ 野球用品（広告）" src="https://www24.a8.net/svt/bgt?aid=261014870515&wid=001&eno=01&mid=s00000020001001115000&mc=1">
      </a>
      <img border="0" width="1" height="1" src="https://www11.a8.net/0.gif?a8mat=4BEGD2+8IM9BM+4ABU+6MZE9" alt="">
      ${modalRakutenLinks(shown)}
    </div>
  `;
  bindAffiliateClicks(detailBody);
  openModal("detail-modal");
  const marker = markerById.get(String(id));
  if (marker) map.flyTo(marker.getLatLng(), Math.max(map.getZoom(), 14), { duration: 0.45 });
}

const ADMIN_STATUS_OPTIONS = [
  { value: "allowed", label: "使用可" },
  { value: "prohibited", label: "使用不可" },
  { value: "unknown", label: "情報なし" },
];

function fillAreaSelects() {
  const options = AREAS.map((area) => `<option>${escapeHtml(area)}</option>`).join("");
  areaSelect.innerHTML = `<option value="all">すべて</option>${options}`;
  reportArea.innerHTML = `<option value="">未選択</option>${options}`;
  document.querySelector("#admin-status-area").innerHTML = `<option value="all">すべてのエリア</option>${options}`;
}

function openModal(id) {
  document.querySelector(`#${id}`).hidden = false;
}

function closeModal(id) {
  document.querySelector(`#${id}`).hidden = true;
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toast.hidden = true; }, 2800);
}

function updatePendingBadge() {
  const pending = loadReports().filter((report) => report.status === "pending").length;
  document.querySelector("#pending-count").textContent = pending ? `(${pending})` : "";
}

function refreshStadiums() {
  stadiums = applyStatusOverrides(applyReports(baseStadiums));
  render(false);
}

document.querySelectorAll("[data-close]").forEach((button) => {
  button.addEventListener("click", () => closeModal(button.dataset.close));
});

document.querySelectorAll(".modal").forEach((modal) => {
  modal.addEventListener("click", (event) => {
    if (event.target === modal) modal.hidden = true;
  });
});

list.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-id]");
  if (!button) return;
  openDetail(button.dataset.id);
});

areaSelect.addEventListener("change", () => render(true));
statusSelect.addEventListener("change", () => render(true));
keywordInput.addEventListener("input", () => render(false));
document.querySelector("#fit-all").addEventListener("click", () => fitTo(stadiums.filter(matches)));
document.querySelector("#open-report").addEventListener("click", () => openModal("report-modal"));
function showAdminTab(name) {
  const queue = name !== "status";
  document.querySelector("#admin-queue").hidden = !queue;
  document.querySelector("#admin-status").hidden = queue;
  document.querySelector("#tab-queue").classList.toggle("active", queue);
  document.querySelector("#tab-status").classList.toggle("active", !queue);
  document.querySelector("#tab-queue").setAttribute("aria-selected", queue ? "true" : "false");
  document.querySelector("#tab-status").setAttribute("aria-selected", queue ? "false" : "true");
  if (queue) renderQueue();
  else renderStatusEditor();
}

function openAdmin() {
  const authed = sessionStorage.getItem(SESSION_KEY) === "1";
  document.querySelector("#admin-login").hidden = authed;
  document.querySelector("#admin-panel").hidden = !authed;
  if (authed) {
    if (document.querySelector("#admin-status").hidden) renderQueue();
    else renderStatusEditor();
  }
  openModal("admin-modal");
}

document.querySelector("#open-admin").addEventListener("click", openAdmin);
document.querySelector("#tab-queue").addEventListener("click", () => showAdminTab("queue"));
document.querySelector("#tab-status").addEventListener("click", () => showAdminTab("status"));

document.querySelector("#report-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const error = document.querySelector("#report-error");
  error.hidden = true;
  const form = new FormData(event.currentTarget);
  const payload = Object.fromEntries(form.entries());
  if (!payload.name.trim() || !payload.note.trim()) {
    error.textContent = "球場名と分かった内容を入力してください。";
    error.hidden = false;
    return;
  }
  const existing = stadiums.find((stadium) => stadium.name === payload.name.trim());
  const reports = loadReports();
  reports.push({
    id: `report-${Date.now()}`,
    type: payload.type === "new" ? "new" : "correction",
    status: "pending",
    stadium_id: existing && payload.type !== "new" ? existing.id : `local-${Date.now()}`,
    name: payload.name.trim(),
    area_category: payload.area_category,
    area: payload.area_category,
    bat_status: payload.type === "new" || payload.bat_status !== "unknown" ? (payload.bat_status || "unknown") : "",
    note: payload.note.trim(),
    dimensions: payload.dimensions.trim(),
    access: payload.access.trim(),
    parking: payload.parking.trim(),
    rain: payload.rain.trim(),
    address: payload.address.trim(),
    reporter_name: payload.reporter_name.trim(),
    contact: payload.contact.trim(),
    created_at: new Date().toISOString(),
    reviewed_at: "",
  });
  saveReports(reports);
  event.currentTarget.reset();
  closeModal("report-modal");
  showToast("受け付けました。管理者の確認後に地図へ反映します。");
});

function renderQueue() {
  const reports = loadReports().filter((report) => report.status === "pending");
  document.querySelector("#queue-count").textContent = `承認待ち ${reports.length}件`;
  document.querySelector("#queue-list").innerHTML = reports.map((report) => `
    <li>
      <h3>${escapeHtml(report.name)}</h3>
      <p class="queue-meta">${report.type === "new" ? "新規" : "修正"} ・ ウレタン${escapeHtml((STATUS[report.bat_status] || STATUS.unknown).label)} ・ ${escapeHtml(report.created_at.slice(0, 16).replace("T", " "))}</p>
      <p>${escapeHtml(report.note)}</p>
      <div class="queue-actions">
        <button type="button" class="btn btn-ok" data-approve="${escapeHtml(report.id)}">承認して反映</button>
        <button type="button" class="btn btn-danger" data-reject="${escapeHtml(report.id)}">却下</button>
      </div>
    </li>
  `).join("") || "<li>承認待ちの報告はありません。</li>";
}

document.querySelector("#queue-list").addEventListener("click", (event) => {
  const approve = event.target.closest("[data-approve]");
  const reject = event.target.closest("[data-reject]");
  if (!approve && !reject) return;
  const id = (approve || reject).dataset.approve || (approve || reject).dataset.reject;
  const reports = loadReports();
  const report = reports.find((row) => row.id === id);
  if (!report) return;
  report.status = approve ? "approved" : "rejected";
  report.reviewed_at = new Date().toISOString();
  saveReports(reports);
  refreshStadiums();
  renderQueue();
  showToast(approve ? "承認して地図へ反映しました。" : "却下しました。地図は変えていません。");
});

document.querySelector("#admin-login").addEventListener("submit", (event) => {
  event.preventDefault();
  const error = document.querySelector("#admin-error");
  const password = new FormData(event.currentTarget).get("password");
  if (password !== ADMIN_PASSWORD) {
    error.textContent = "パスワードが違います。";
    error.hidden = false;
    return;
  }
  sessionStorage.setItem(SESSION_KEY, "1");
  event.currentTarget.hidden = true;
  document.querySelector("#admin-panel").hidden = false;
  showAdminTab("queue");
});

document.querySelector("#admin-logout").addEventListener("click", () => {
  sessionStorage.removeItem(SESSION_KEY);
  document.querySelector("#admin-login").hidden = false;
  document.querySelector("#admin-panel").hidden = true;
  showAdminTab("queue");
});

function adminStatusRows() {
  const keyword = document.querySelector("#admin-status-keyword").value.trim().toLowerCase();
  const area = document.querySelector("#admin-status-area").value;
  const status = document.querySelector("#admin-status-filter").value;
  return stadiums.filter((stadium) => {
    if (area !== "all" && stadium.area_category !== area) return false;
    if (status !== "all" && pinStatus(stadium) !== status) return false;
    if (!keyword) return true;
    return [stadium.name, stadium.area, stadium.area_category, stadium.address].join(" ").toLowerCase().includes(keyword);
  });
}

function renderStatusEditor() {
  const rows = adminStatusRows();
  document.querySelector("#admin-status-count").textContent = `${rows.length}件`;
  const statusList = document.querySelector("#admin-status-list");
  const scroll = statusList.scrollTop;
  statusList.innerHTML = rows.map((stadium) => {
    const shown = pinStatus(stadium);
    const cells = ADMIN_STATUS_OPTIONS.map((option) => `
      <button type="button"
        class="status-cell ${option.value}${option.value === shown ? " is-on" : ""}"
        data-status-id="${escapeHtml(stadium.id)}"
        data-status-value="${option.value}"
        aria-pressed="${option.value === shown ? "true" : "false"}"
        aria-label="${escapeHtml(stadium.name)}を${option.label}にする"></button>
    `).join("");
    return `
      <li class="status-grid">
        <div>
          <p class="admin-status-name">${escapeHtml(stadium.name)}</p>
          <p class="queue-meta">${escapeHtml(placeLabel(stadium))}</p>
        </div>
        ${cells}
      </li>
    `;
  }).join("");
  statusList.scrollTop = scroll;
}

document.querySelector("#admin-status-keyword").addEventListener("input", renderStatusEditor);
document.querySelector("#admin-status-area").addEventListener("change", renderStatusEditor);
document.querySelector("#admin-status-filter").addEventListener("change", renderStatusEditor);

document.querySelector("#admin-status-list").addEventListener("click", (event) => {
  const cell = event.target.closest("button[data-status-id]");
  if (!cell || cell.classList.contains("is-on")) return;
  const id = cell.dataset.statusId;
  const shown = cell.dataset.statusValue;
  const overrides = loadStatusOverrides();
  overrides[String(id)] = canonicalStatus(shown);
  localStorage.setItem(STATUS_KEY, JSON.stringify(overrides));
  const scroll = document.querySelector("#admin-status-list").scrollTop;
  refreshStadiums();
  renderStatusEditor();
  document.querySelector("#admin-status-list").scrollTop = scroll;
  const stadium = stadiums.find((row) => String(row.id) === String(id));
  const label = (ADMIN_STATUS_OPTIONS.find((option) => option.value === shown) || ADMIN_STATUS_OPTIONS[2]).label;
  showToast(`${stadium ? stadium.name : "球場"}を${label}で登録しました。`);
});

window.addEventListener("resize", () => map.invalidateSize());

fillAreaSelects();
setGearLinks();
updatePendingBadge();
loadBoundaries();

fetch("stadiums.json?v=20261016")
  .then((response) => {
    if (!response.ok) throw new Error("球場データを読み込めませんでした。");
    return response.json();
  })
  .then((rows) => {
    baseStadiums = rows;
    stadiums = applyStatusOverrides(applyReports(rows));
    nameList.innerHTML = rows.map((stadium) => `<option value="${escapeHtml(stadium.name)}"></option>`).join("");
    render(true);
    if (!document.querySelector("#admin-panel").hidden && !document.querySelector("#admin-status").hidden) {
      renderStatusEditor();
    }
    setTimeout(() => map.invalidateSize(), 150);
  })
  .catch((error) => {
    countLabel.textContent = error.message;
  });
