const OPEN_NOTIFY_ISS_URL = "http://api.open-notify.org/iss-now.json";
const OPEN_NOTIFY_ASTROS_URL = "http://api.open-notify.org/astros.json";

const OPEN_NOTIFY_ISS_PROXY_URL = `https://api.allorigins.win/raw?url=${encodeURIComponent(OPEN_NOTIFY_ISS_URL)}`;
const OPEN_NOTIFY_ASTROS_PROXY_URL = `https://api.allorigins.win/raw?url=${encodeURIComponent(OPEN_NOTIFY_ASTROS_URL)}`;

const ISS_API_ENDPOINTS =
  window.location.protocol === "https:"
    ? [OPEN_NOTIFY_ISS_PROXY_URL]
    : [OPEN_NOTIFY_ISS_URL, OPEN_NOTIFY_ISS_PROXY_URL];

const ASTRO_ENDPOINTS =
  window.location.protocol === "https:"
    ? [OPEN_NOTIFY_ASTROS_PROXY_URL]
    : [OPEN_NOTIFY_ASTROS_URL, OPEN_NOTIFY_ASTROS_PROXY_URL];

const POLL_INTERVAL_MS = 5000;
const ASTRO_REFRESH_MS = 5 * 60 * 1000;
const MARKER_ANIMATION_MS = 4500;
const PROXIMITY_THRESHOLD_KM = 1000;
const ASTRO_MANUAL_REFRESH_COOLDOWN_MS = 10000;
const LIVE_STREAM_COLLAPSE_HEIGHT_PX = 760;

const statusEl = document.getElementById("status");
const statusMessageEl = document.getElementById("statusMessage");
const latitudeEl = document.getElementById("latitude");
const longitudeEl = document.getElementById("longitude");
const updatedAtEl = document.getElementById("updatedAt");
const locationStatusEl = document.getElementById("locationStatus");
const distanceToIssEl = document.getElementById("distanceToIss");
const astroCountEl = document.getElementById("astroCount");
const astroStatusEl = document.getElementById("astroStatus");
const astroListEl = document.getElementById("astroList");
const refreshAstrosBtnEl = document.getElementById("refreshAstrosBtn");
const proximityBannerEl = document.getElementById("proximityBanner");
const proximityLiveEl = document.getElementById("proximityLive");
const liveStreamPanelEl = document.getElementById("liveStreamPanel");
const liveStreamBodyEl = document.getElementById("liveStreamBody");
const liveStreamToggleBtnEl = document.getElementById("liveStreamToggleBtn");

const map = L.map("map", {
  zoomControl: true,
  worldCopyJump: true,
  preferCanvas: true,
}).setView([20, 0], 2);

L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
  attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
  subdomains: "abcd",
  maxZoom: 19,
}).addTo(map);

const satelliteSvg = encodeURIComponent(`
  <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'>
    <circle cx='32' cy='32' r='6' fill='#22d3ee' />
    <rect x='26' y='20' width='12' height='24' rx='2' fill='#67e8f9' />
    <rect x='4' y='24' width='20' height='8' rx='2' fill='#0ea5e9' />
    <rect x='40' y='24' width='20' height='8' rx='2' fill='#0ea5e9' />
    <rect x='30' y='8' width='4' height='12' fill='#a5f3fc' />
    <circle cx='32' cy='32' r='30' fill='none' stroke='rgba(34,211,238,0.25)' stroke-width='2'/>
  </svg>
`);

const issIcon = L.icon({
  iconUrl: `data:image/svg+xml;charset=UTF-8,${satelliteSvg}`,
  iconSize: [44, 44],
  iconAnchor: [22, 22],
  className: "iss-marker",
});

let issMarker = null;
let previousPosition = null;
let animationFrameId = null;
let isFetching = false;
let isAstroFetching = false;
let userPosition = null;
let userLocationStatus = "pending";
let latestIssPosition = null;
let userLocationWatchId = null;
let astroManualCooldownTimerId = null;
let isLiveStreamCollapsed = false;

function setStatus(kind, message = "") {
  const palette = {
    connected: "text-emerald-300",
    updating: "text-cyan-300",
    error: "text-rose-300",
    init: "text-amber-300",
  };

  const labels = {
    connected: "Connected",
    updating: "Updating",
    error: "Error",
    init: "Initializing...",
  };

  statusEl.className = `mt-1 text-sm font-medium ${palette[kind] || palette.init}`;
  statusEl.textContent = labels[kind] || labels.init;
  statusMessageEl.textContent = message;
}

function updatePanel({ lat, lng, timestamp }) {
  latitudeEl.textContent = lat.toFixed(5);
  longitudeEl.textContent = lng.toFixed(5);
  updatedAtEl.textContent = new Date(timestamp * 1000).toLocaleString();
}

function setLocationStatus(message, tone = "text-slate-300") {
  locationStatusEl.className = `mt-1 text-sm ${tone}`;
  locationStatusEl.textContent = message;
}

function setAstroStatus(message, tone = "text-slate-500") {
  astroStatusEl.className = `mt-2 text-xs ${tone}`;
  astroStatusEl.textContent = message;
}

function setProximityBannerVisible(isVisible) {
  proximityBannerEl.classList.toggle("hidden", !isVisible);
  proximityBannerEl.classList.toggle("iss-visible-pulse", isVisible);
  proximityLiveEl.textContent = isVisible ? "ISS visible" : "";
}

function setAstroRefreshButtonState({ disabled, label }) {
  refreshAstrosBtnEl.disabled = disabled;
  refreshAstrosBtnEl.textContent = label;
}

function setLiveStreamCollapsed(collapsed) {
  isLiveStreamCollapsed = collapsed;
  liveStreamBodyEl.classList.toggle("hidden", collapsed);
  liveStreamPanelEl.classList.toggle("w-[min(92vw,360px)]", !collapsed);
  liveStreamPanelEl.classList.toggle("w-auto", collapsed);
  liveStreamToggleBtnEl.setAttribute("aria-expanded", String(!collapsed));
  liveStreamToggleBtnEl.textContent = collapsed ? "Show" : "Hide";
}

function maybeAutoCollapseLiveStream() {
  const isSmallLayout = window.matchMedia("(max-width: 1024px)").matches;
  const isShortViewport = window.innerHeight < LIVE_STREAM_COLLAPSE_HEIGHT_PX;

  if (isSmallLayout || isShortViewport) {
    setLiveStreamCollapsed(true);
  }
}

function renderAstronautList(people) {
  astroListEl.innerHTML = "";

  if (!people.length) {
    const emptyItem = document.createElement("li");
    emptyItem.className = "rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-slate-400";
    emptyItem.textContent = "No astronaut data available.";
    astroListEl.appendChild(emptyItem);
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const person of people) {
    const item = document.createElement("li");
    item.className = "rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2";

    const name = document.createElement("p");
    name.className = "font-medium text-slate-100";
    name.textContent = person.name;

    const craft = document.createElement("p");
    craft.className = "text-xs uppercase tracking-wide text-slate-400";
    craft.textContent = person.craft;

    item.appendChild(name);
    item.appendChild(craft);
    fragment.appendChild(item);
  }

  astroListEl.appendChild(fragment);
}

function haversineKm(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);

  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);

  const h = sinLat * sinLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return earthRadiusKm * c;
}

function updateProximityAlert(issLatLng) {
  if (!issLatLng || !userPosition || userLocationStatus !== "granted") {
    distanceToIssEl.textContent = "Unavailable";
    setProximityBannerVisible(false);
    return;
  }

  const distanceKm = haversineKm(userPosition, issLatLng);
  distanceToIssEl.textContent = `${distanceKm.toFixed(0)} km`;
  setProximityBannerVisible(distanceKm <= PROXIMITY_THRESHOLD_KM);
}

function centerOnUserPosition() {
  if (!userPosition) {
    setLocationStatus("Enable location access to use Locate Me.", "text-amber-300");
    return;
  }

  map.setView([userPosition.lat, userPosition.lng], Math.max(map.getZoom(), 6), {
    animate: true,
  });
}

function addLocateMeControl() {
  const LocateControl = L.Control.extend({
    options: { position: "topleft" },
    onAdd() {
      const container = L.DomUtil.create("div", "leaflet-bar");
      const button = L.DomUtil.create("button", "", container);
      button.type = "button";
      button.title = "Locate Me";
      button.setAttribute("aria-label", "Locate Me");
      button.innerHTML = "Locate Me";
      button.style.background = "rgba(15, 23, 42, 0.9)";
      button.style.color = "#bae6fd";
      button.style.padding = "6px 10px";
      button.style.fontSize = "12px";
      button.style.fontWeight = "600";
      button.style.cursor = "pointer";
      button.style.border = "0";

      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.on(button, "click", (event) => {
        L.DomEvent.stop(event);
        centerOnUserPosition();
      });

      return container;
    },
  });

  map.addControl(new LocateControl());
}

function animateMarker(fromLatLng, toLatLng, durationMs) {
  if (!issMarker) return;

  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
  }

  const currentBounds = map.getBounds().pad(0.2);
  if (!currentBounds.contains([toLatLng.lat, toLatLng.lng])) {
    map.panTo([toLatLng.lat, toLatLng.lng], { animate: true });
  }

  const start = performance.now();
  let deltaLng = toLatLng.lng - fromLatLng.lng;

  if (deltaLng > 180) {
    deltaLng -= 360;
  } else if (deltaLng < -180) {
    deltaLng += 360;
  }

  function step(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / durationMs, 1);

    const lat = fromLatLng.lat + (toLatLng.lat - fromLatLng.lat) * progress;
    let lng = fromLatLng.lng + deltaLng * progress;

    if (lng > 180) {
      lng -= 360;
    } else if (lng < -180) {
      lng += 360;
    }

    issMarker.setLatLng({ lat, lng });

    if (progress < 1) {
      animationFrameId = requestAnimationFrame(step);
    } else {
      animationFrameId = null;
    }
  }

  animationFrameId = requestAnimationFrame(step);
}

async function fetchWithFallback(endpoints, parseFn, fallbackMessage) {
  let lastError = null;

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, { cache: "no-store" });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      return parseFn(data);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error(fallbackMessage);
}

async function fetchIssPosition() {
  return fetchWithFallback(
    ISS_API_ENDPOINTS,
    (data) => {
      if (
        data.message !== "success" ||
        !data.iss_position ||
        typeof data.iss_position.latitude === "undefined" ||
        typeof data.iss_position.longitude === "undefined"
      ) {
        throw new Error("Unexpected API response");
      }

      const lat = Number.parseFloat(data.iss_position.latitude);
      const lng = Number.parseFloat(data.iss_position.longitude);

      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        throw new Error("Invalid coordinates");
      }

      return {
        lat,
        lng,
        timestamp: Number(data.timestamp || Math.floor(Date.now() / 1000)),
      };
    },
    "Unable to fetch ISS data"
  );
}

async function fetchAstros() {
  return fetchWithFallback(
    ASTRO_ENDPOINTS,
    (data) => {
      if (!Array.isArray(data.people)) {
        throw new Error("Unexpected astronaut response");
      }

      const people = data.people
        .filter((person) => person && person.name && person.craft)
        .map((person) => ({
          name: String(person.name),
          craft: String(person.craft),
        }));

      return {
        people,
        number: Number.isFinite(Number(data.number)) ? Number(data.number) : people.length,
      };
    },
    "Unable to fetch astronaut data"
  );
}

function requestUserLocation() {
  if (!("geolocation" in navigator)) {
    userLocationStatus = "unsupported";
    setLocationStatus("Geolocation not supported in this browser.", "text-rose-300");
    updateProximityAlert(latestIssPosition);
    return;
  }

  if (typeof userLocationWatchId === "number") {
    navigator.geolocation.clearWatch(userLocationWatchId);
  }

  userLocationWatchId = navigator.geolocation.watchPosition(
    (position) => {
      userPosition = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      };
      userLocationStatus = "granted";
      setLocationStatus("Location enabled for proximity alerts.", "text-emerald-300");
      if (latestIssPosition) {
        updateProximityAlert(latestIssPosition);
      }
    },
    (error) => {
      userPosition = null;
      userLocationStatus = "denied";

      const message =
        error.code === error.PERMISSION_DENIED
          ? "Location permission denied."
          : "Unable to access location.";

      setLocationStatus(`${message} Proximity alert unavailable.`, "text-rose-300");
      updateProximityAlert(latestIssPosition);
    },
    {
      enableHighAccuracy: false,
      timeout: 10000,
      maximumAge: 60000,
    }
  );
}

async function refreshIss() {
  if (isFetching) return;
  isFetching = true;

  try {
    setStatus("updating", "Fetching latest ISS position...");
    const nextPosition = await fetchIssPosition();

    updatePanel(nextPosition);

    if (!issMarker) {
      issMarker = L.marker([nextPosition.lat, nextPosition.lng], { icon: issIcon }).addTo(map);
      map.setView([nextPosition.lat, nextPosition.lng], 4);
    } else if (previousPosition) {
      animateMarker(previousPosition, nextPosition, MARKER_ANIMATION_MS);
    }

    previousPosition = { lat: nextPosition.lat, lng: nextPosition.lng };
    latestIssPosition = { lat: nextPosition.lat, lng: nextPosition.lng };
    updateProximityAlert(latestIssPosition);

    setStatus("connected", "Live ISS telemetry streaming");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to fetch ISS data";
    setStatus(
      "error",
      `Request failed. Endpoint unavailable or blocked by browser policy. (${message})`
    );
  } finally {
    isFetching = false;
  }
}

async function refreshAstros({ manual = false } = {}) {
  if (isAstroFetching) return;
  isAstroFetching = true;
  setAstroRefreshButtonState({ disabled: true, label: "Refreshing..." });

  try {
    setAstroStatus("Updating astronaut manifest...", "text-cyan-300");
    const astronautData = await fetchAstros();

    astroCountEl.textContent = `${astronautData.number} currently in space`;
    renderAstronautList(astronautData.people);
    setAstroStatus("Manifest synced.", "text-emerald-300");
  } catch (error) {
    astroCountEl.textContent = "-- currently in space";
    renderAstronautList([]);

    const message = error instanceof Error ? error.message : "Unable to fetch astronaut data";
    setAstroStatus(`Failed to load astronaut list. (${message})`, "text-rose-300");
  } finally {
    isAstroFetching = false;

    if (manual) {
      if (astroManualCooldownTimerId) {
        clearTimeout(astroManualCooldownTimerId);
      }
      setAstroRefreshButtonState({ disabled: true, label: "Try again shortly" });
      astroManualCooldownTimerId = setTimeout(() => {
        astroManualCooldownTimerId = null;
        setAstroRefreshButtonState({ disabled: false, label: "Refresh Astronauts" });
      }, ASTRO_MANUAL_REFRESH_COOLDOWN_MS);
    } else if (!astroManualCooldownTimerId) {
      setAstroRefreshButtonState({ disabled: false, label: "Refresh Astronauts" });
    }
  }
}

setStatus("init", "Bootstrapping map and telemetry");
setAstroRefreshButtonState({ disabled: false, label: "Refresh Astronauts" });
setLiveStreamCollapsed(false);
addLocateMeControl();

refreshAstrosBtnEl.addEventListener("click", () => {
  if (refreshAstrosBtnEl.disabled) return;
  refreshAstros({ manual: true });
});

liveStreamToggleBtnEl.addEventListener("click", () => {
  setLiveStreamCollapsed(!isLiveStreamCollapsed);
});

window.addEventListener("resize", maybeAutoCollapseLiveStream);

requestUserLocation();
refreshIss();
refreshAstros();
maybeAutoCollapseLiveStream();

setInterval(refreshIss, POLL_INTERVAL_MS);
setInterval(refreshAstros, ASTRO_REFRESH_MS);

window.addEventListener("beforeunload", () => {
  if (typeof userLocationWatchId === "number") {
    navigator.geolocation.clearWatch(userLocationWatchId);
  }
});

map.on("dragstart", maybeAutoCollapseLiveStream);
map.on("zoomstart", maybeAutoCollapseLiveStream);