// ==UserScript==
// @name         GeoFS Day-Night Gradient
// @namespace    
// @version      1.7.0
// @description  Adds a live day/night gradient overlay to the GeoFS multiplayer map.
// @author       SpeedBird
// @match        https://www.geo-fs.com/pages/map.php*
// @grant
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  const root = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  const LOG_PREFIX = '[GeoFS DayNight]';
  const DEG2RAD = Math.PI / 180;
  const RAD2DEG = 180 / Math.PI;
  const DAY_MS = 86400000;
  const J1970 = 2440588;
  const J2000 = 2451545;
  const OBLIQUITY = 23.4397 * DEG2RAD;
  const CHECK_INTERVAL = 250;
  const MAX_WAIT = 45000;

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const OFFSCREEN_WIDTH = 64;
  const OFFSCREEN_HEIGHT = 36;
  const DRAW_MIN_INTERVAL_MS = 60;
  const SUN_REFRESH_MS = 60000;
  const log = (...args) => console.log(LOG_PREFIX, ...args);

  const toJulian = (date) => date.valueOf() / DAY_MS - 0.5 + J1970;
  const toDays = (date) => toJulian(date) - J2000;
  const solarMeanAnomaly = (d) => DEG2RAD * (357.5291 + 0.98560028 * d);
  const eclipticLongitude = (M) => {
    const C = DEG2RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
    const P = DEG2RAD * 102.9372;
    return M + C + P + Math.PI;
  };
  const rightAscension = (L) => Math.atan2(Math.sin(L) * Math.cos(OBLIQUITY), Math.cos(L));
  const declination = (L) => Math.asin(Math.sin(L) * Math.sin(OBLIQUITY));
  const siderealTime = (d) => DEG2RAD * (280.16 + 360.9856235 * d);
  const wrapPi = (rad) => {
    let result = rad % (2 * Math.PI);
    if (result < -Math.PI) result += 2 * Math.PI;
    if (result > Math.PI) result -= 2 * Math.PI;
    return result;
  };

  const computeSubsolarPoint = (date = new Date()) => {
    const d = toDays(date);
    const M = solarMeanAnomaly(d);
    const L = eclipticLongitude(M);
    const dec = declination(L);
    const ra = rightAscension(L);
    const gst = siderealTime(d);
    const lon = wrapPi(ra - gst);
    return { lat: dec, lon };
  };

  const TWILIGHT_BANDS = [
    {
      name: 'civil',
      minAltDeg: -6,
      maxAltDeg: 0,
      fill: 'rgba(233, 240, 255, 0.55)'
    },
    {
      name: 'nautical',
      minAltDeg: -12,
      maxAltDeg: -6,
      fill: 'rgba(155, 178, 234, 0.62)'
    },
    {
      name: 'astronomical',
      minAltDeg: -18,
      maxAltDeg: -12,
      fill: 'rgba(74, 104, 187, 0.68)'
    }
  ];

  const NIGHT_STYLE = {
    fill: 'rgba(18, 28, 70, 0.7)'
  };

  const parseRgba = (rgba) => {
    const m = rgba.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([0-9.]+)\)/);
    if (!m) return { r: 0, g: 0, b: 0, a: 0 };
    return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: Number(m[4]) };
  };

  const lerp = (a, b, t) => a + (b - a) * t;

  const mixRgba = (c1, c2, t) => ({
    r: lerp(c1.r, c2.r, t),
    g: lerp(c1.g, c2.g, t),
    b: lerp(c1.b, c2.b, t),
    a: lerp(c1.a, c2.a, t)
  });

  const dayColor = parseRgba('rgba(233, 240, 255, 0.0)');
  const civilColor = parseRgba(TWILIGHT_BANDS[0].fill);
  const nauticalColor = parseRgba(TWILIGHT_BANDS[1].fill);
  const astroColor = parseRgba(TWILIGHT_BANDS[2].fill);
  const nightColor = parseRgba(NIGHT_STYLE.fill);

  const toRgbaString = (c) => `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${c.a.toFixed(3)})`;

  const getTwilightFill = (illumination) => {
    if (illumination >= 0) return null;
    const altitudeDeg = Math.asin(illumination) * RAD2DEG;

    let c;

    // Day -> civil transition over a narrow 2° band
    if (altitudeDeg > -2) {
      const t = clamp((0 - altitudeDeg) / 2, 0, 1);
      c = mixRgba(dayColor, civilColor, t);
      return toRgbaString(c);
    }

    // Mostly pure civil twilight
    if (altitudeDeg > -4) {
      return toRgbaString(civilColor);
    }

    // Civil -> nautical over ~4°
    if (altitudeDeg > -8) {
      const t = clamp((-4 - altitudeDeg) / 4, 0, 1);
      c = mixRgba(civilColor, nauticalColor, t);
      return toRgbaString(c);
    }

    // Mostly pure nautical twilight
    if (altitudeDeg > -10) {
      return toRgbaString(nauticalColor);
    }

    // Nautical -> astronomical over ~4°
    if (altitudeDeg > -14) {
      const t = clamp((-10 - altitudeDeg) / 4, 0, 1);
      c = mixRgba(nauticalColor, astroColor, t);
      return toRgbaString(c);
    }

    // Mostly pure astronomical twilight
    if (altitudeDeg > -16) {
      return toRgbaString(astroColor);
    }

    // Astronomical -> night over ~6°
    if (altitudeDeg > -22) {
      const t = clamp((-16 - altitudeDeg) / 6, 0, 1);
      c = mixRgba(astroColor, nightColor, t);
      return toRgbaString(c);
    }

    // Deep night
    return toRgbaString(nightColor);
  };

  const ensureToggleStyles = () => {
    if (document.getElementById('geofs-daynight-style')) return;
    const style = document.createElement('style');
    style.id = 'geofs-daynight-style';
    style.textContent = `
      #geofs-daynight-toggle {
        position: absolute;
        top: 12px;
        right: 12px;
        padding: 6px 14px;
        border: none;
        border-radius: 18px;
        font-size: 13px;
        font-family: 'Segoe UI', system-ui, sans-serif;
        background: rgba(5, 23, 52, 0.68);
        color: #f8fbff;
        letter-spacing: 0.2px;
        cursor: pointer;
        transition: background 0.2s ease, transform 0.2s ease;
        z-index: 1200;
      }
      #geofs-daynight-toggle[data-state="off"] {
        background: rgba(20, 20, 20, 0.35);
        color: #dbdde2;
      }
      #geofs-daynight-toggle:hover {
        transform: translateY(-1px);
        background: rgba(28, 70, 133, 0.75);
      }
    `;
    document.head.appendChild(style);
  };

  const createToggleButton = (onToggle) => {
    ensureToggleStyles();
    const toggle = document.createElement('button');
    toggle.id = 'geofs-daynight-toggle';
    toggle.textContent = 'Day/Night ✓';
    toggle.dataset.state = 'on';
    toggle.addEventListener('click', () => {
      const next = onToggle();
      toggle.dataset.state = next ? 'on' : 'off';
      toggle.textContent = next ? 'Day/Night ✓' : 'Day/Night ✕';
    });
    (document.querySelector('.geofs-map') || document.body).appendChild(toggle);
    return toggle;
  };

  class LeafletDayNightOverlay {
    constructor(map) {
      this.map = map;
      this.enabled = true;
      this.sun = computeSubsolarPoint();
      this.lastSunUpdate = Date.now();
      this.lastDrawTime = 0;
      this.frameId = null;
      this.pendingSunUpdate = false;
      this.canvas = document.createElement('canvas');
      this.canvas.id = 'geofs-daynight-overlay';
      Object.assign(this.canvas.style, {
        position: 'absolute',
        inset: '0',
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 450,
        mixBlendMode: 'multiply'
      });

      this.container = map.getContainer();
      this.ensureContainerPositioning();
      this.container.appendChild(this.canvas);
      this.ctx = this.canvas.getContext('2d');
      this.ctx.imageSmoothingEnabled = true;

      this.resizeObserver = 'ResizeObserver' in root ? new ResizeObserver(() => this.requestDraw(true)) : null;
      if (this.resizeObserver) this.resizeObserver.observe(this.container);

      this.boundRequestDraw = this.requestDraw.bind(this);
      this.map.on('move zoom viewreset resize', this.boundRequestDraw);
      root.addEventListener('resize', this.boundRequestDraw);
      this.timer = setInterval(() => this.requestDraw(true), 60000);

      this.toggle = createToggleButton(() => {
        this.enabled = !this.enabled;
        this.canvas.style.display = this.enabled ? 'block' : 'none';
        if (this.enabled) this.requestDraw(true);
        return this.enabled;
      });

      this.requestDraw(true);
    }

    ensureContainerPositioning() {
      const position = root.getComputedStyle(this.container).position;
      if (!position || position === 'static') {
        this.container.style.position = 'relative';
      }
    }

    requestDraw(forceSun = false) {
      if (!this.enabled) return;
      if (forceSun) this.pendingSunUpdate = true;
      if (this.frameId != null) return;
      this.frameId = root.requestAnimationFrame(() => this.performDraw());
    }

    performDraw() {
      this.frameId = null;
      if (!this.enabled) return;
      const now = performance.now();
      if (now - this.lastDrawTime < DRAW_MIN_INTERVAL_MS) {
        this.frameId = root.requestAnimationFrame(() => this.performDraw());
        return;
      }
      if (this.pendingSunUpdate || now - this.lastSunUpdate > SUN_REFRESH_MS) {
        this.sun = computeSubsolarPoint();
        this.lastSunUpdate = now;
        this.pendingSunUpdate = false;
      }
      this.lastDrawTime = now;
      this.draw();
    }

    draw() {
      const size = this.map.getSize();
      if (!size || size.x <= 0 || size.y <= 0) return;

      const width = size.x;
      const height = size.y;

      if (this.canvas.width !== width || this.canvas.height !== height) {
        this.canvas.width = width;
        this.canvas.height = height;
        this.canvas.style.width = `${width}px`;
        this.canvas.style.height = `${height}px`;
      }

      if (!this.offscreen) {
        this.offscreen = document.createElement('canvas');
        this.offscreen.width = OFFSCREEN_WIDTH;
        this.offscreen.height = OFFSCREEN_HEIGHT;
        this.offCtx = this.offscreen.getContext('2d');
      }

      const ow = OFFSCREEN_WIDTH;
      const oh = OFFSCREEN_HEIGHT;
      const scaleX = width / ow;
      const scaleY = height / oh;

      this.offCtx.clearRect(0, 0, ow, oh);

      for (let oy = 0; oy < oh; oy++) {
        const screenY = (oy + 0.5) * scaleY;
        for (let ox = 0; ox < ow; ox++) {
          const screenX = (ox + 0.5) * scaleX;
          let latLng;
          try {
            latLng = this.map.containerPointToLatLng([screenX, screenY]);
          } catch (err) {
            continue;
          }
          if (!latLng) continue;
          const illum = this.illumination(latLng.lat, latLng.lng);
          if (illum >= 0) continue;
          const fill = getTwilightFill(illum);
          if (!fill) continue;
          this.offCtx.fillStyle = fill;
          this.offCtx.fillRect(ox, oy, 1, 1);
        }
      }

      this.ctx.imageSmoothingEnabled = true;
      this.ctx.imageSmoothingQuality = 'high';
      this.ctx.clearRect(0, 0, width, height);
      this.ctx.drawImage(this.offscreen, 0, 0, ow, oh, 0, 0, width, height);
    }

    illumination(latDeg, lonDeg) {
      const lat = latDeg * DEG2RAD;
      const lon = lonDeg * DEG2RAD;
      return (
        Math.sin(lat) * Math.sin(this.sun.lat) +
        Math.cos(lat) * Math.cos(this.sun.lat) * Math.cos(lon - this.sun.lon)
      );
    }

    destroy() {
      clearInterval(this.timer);
      if (this.boundRequestDraw) {
        this.map.off('move zoom viewreset resize', this.boundRequestDraw);
        root.removeEventListener('resize', this.boundRequestDraw);
      }
      if (this.frameId != null) {
        root.cancelAnimationFrame(this.frameId);
        this.frameId = null;
      }
      if (this.resizeObserver) this.resizeObserver.disconnect();
      if (this.canvas) this.canvas.remove();
      if (this.toggle) this.toggle.remove();
    }
  }

  class CesiumDayNightOverlay {
    constructor(viewer) {
      this.viewer = viewer;
      this.scene = viewer.scene;
      this.cesium = root.Cesium;
      this.enabled = true;
      this.sun = computeSubsolarPoint();
      this.lastSunUpdate = 0;
      this.lastDraw = 0;
      this.canvasOffsetX = 0;
      this.canvasOffsetY = 0;

      this.host = document.querySelector('.geofs-map-viewport') || viewer.canvas.parentElement || document.body;
      this.ensureHostPositioning();

      this.canvas = document.createElement('canvas');
      this.canvas.id = 'geofs-daynight-overlay';
      Object.assign(this.canvas.style, {
        position: 'absolute',
        inset: '0',
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 450,
        mixBlendMode: 'multiply',
        opacity: '1'
      });
      this.host.appendChild(this.canvas);
      this.ctx = this.canvas.getContext('2d');

      this.resizeObserver = 'ResizeObserver' in root ? new ResizeObserver(() => this.handleResize()) : null;
      if (this.resizeObserver) {
        this.resizeObserver.observe(this.host);
      }
      root.addEventListener('resize', () => this.handleResize());

      this.postRenderHandler = this.handlePostRender.bind(this);
      this.scene.postRender.addEventListener(this.postRenderHandler);

      ensureToggleStyles();
      this.toggle = createToggleButton(() => {
        this.enabled = !this.enabled;
        this.canvas.style.display = this.enabled ? 'block' : 'none';
        return this.enabled;
      });
      this.handleResize(true);
    }

    ensureHostPositioning() {
      const pos = root.getComputedStyle(this.host).position;
      if (pos === 'static' || !pos) {
        this.host.style.position = 'relative';
      }
    }

    handleResize(force) {
      const { clientWidth, clientHeight } = this.host;
      if (!clientWidth || !clientHeight) return;
      const dpr = root.devicePixelRatio || 1;
      const pixelW = Math.round(clientWidth * dpr);
      const pixelH = Math.round(clientHeight * dpr);
      if (force || this.canvas.width !== pixelW || this.canvas.height !== pixelH) {
        this.canvas.width = pixelW;
        this.canvas.height = pixelH;
        this.canvas.style.width = `${clientWidth}px`;
        this.canvas.style.height = `${clientHeight}px`;
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      this.updateOffsets();
    }

    updateOffsets() {
      const viewerRect = this.viewer.canvas.getBoundingClientRect();
      const overlayRect = this.canvas.getBoundingClientRect();
      this.canvasOffsetX = overlayRect.left - viewerRect.left;
      this.canvasOffsetY = overlayRect.top - viewerRect.top;
    }

    handlePostRender() {
      if (!this.enabled) return;
      const now = performance.now();
      if (now - this.lastDraw < 1000) return;
      if (now - this.lastSunUpdate > SUN_REFRESH_MS) {
        this.sun = computeSubsolarPoint();
        this.lastSunUpdate = now;
      }
      this.draw();
      this.lastDraw = now;
    }

    draw() {
      const width = this.canvas.clientWidth;
      const height = this.canvas.clientHeight;
      if (!width || !height) return;
      this.updateOffsets();

      if (!this.offscreen) {
        this.offscreen = document.createElement('canvas');
        this.offscreen.width = OFFSCREEN_WIDTH;
        this.offscreen.height = OFFSCREEN_HEIGHT;
        this.offCtx = this.offscreen.getContext('2d');
      }

      const ow = OFFSCREEN_WIDTH;
      const oh = OFFSCREEN_HEIGHT;
      const scaleX = width / ow;
      const scaleY = height / oh;

      this.offCtx.clearRect(0, 0, ow, oh);

      for (let oy = 0; oy < oh; oy++) {
        const screenY = (oy + 0.5) * scaleY;
        for (let ox = 0; ox < ow; ox++) {
          const screenX = (ox + 0.5) * scaleX;
          const latLon = this.screenToLatLon(screenX, screenY);
          if (!latLon) continue;
          const illum = this.illumination(latLon.lat, latLon.lon);
          if (illum >= 0) continue;
          const fill = getTwilightFill(illum);
          if (!fill) continue;
          this.offCtx.fillStyle = fill;
          this.offCtx.fillRect(ox, oy, 1, 1);
        }
      }

      this.ctx.imageSmoothingEnabled = true;
      this.ctx.imageSmoothingQuality = 'high';
      this.ctx.clearRect(0, 0, width, height);
      this.ctx.drawImage(this.offscreen, 0, 0, ow, oh, 0, 0, width, height);
    }

    screenToLatLon(x, y) {
      const cartesian2 = this.cartesian2 || (this.cartesian2 = new this.cesium.Cartesian2());
      cartesian2.x = x + this.canvasOffsetX;
      cartesian2.y = y + this.canvasOffsetY;
      const cartesian = this.viewer.camera.pickEllipsoid(cartesian2, this.scene.globe.ellipsoid);
      if (!cartesian) return null;
      const cartographic = this.cesium.Cartographic.fromCartesian(cartesian);
      return {
        lat: cartographic.latitude * RAD2DEG,
        lon: cartographic.longitude * RAD2DEG
      };
    }

    illumination(latDeg, lonDeg) {
      const lat = latDeg * DEG2RAD;
      const lon = lonDeg * DEG2RAD;
      return (
        Math.sin(lat) * Math.sin(this.sun.lat) +
        Math.cos(lat) * Math.cos(this.sun.lat) * Math.cos(lon - this.sun.lon)
      );
    }

    intensityFromIllumination(illum) {
      if (illum >= 0.25) return 0;
      if (illum <= -0.95) return 1;
      return clamp((0.25 - illum) / (0.25 + 0.95), 0, 1);
    }

    destroy() {
      this.scene.postRender.removeEventListener(this.postRenderHandler);
      if (this.resizeObserver) this.resizeObserver.disconnect();
      root.removeEventListener('resize', this.handleResize);
      if (this.canvas) this.canvas.remove();
      if (this.toggle) this.toggle.remove();
    }
  }

  const waitForEnvironment = () =>
    new Promise((resolve, reject) => {
      const start = performance.now();
      const check = () => {
        const leafletMap = root.geofs?.api?.map?._map;
        const viewer = root.geofs?.api?.viewer;
        if (leafletMap && root.L) {
          resolve({ type: 'leaflet', instance: leafletMap });
          return;
        }
        if (viewer && root.Cesium && viewer.scene && viewer.canvas) {
          resolve({ type: 'cesium', instance: viewer });
          return;
        }
        if (performance.now() - start > MAX_WAIT) {
          reject(new Error('Timed out waiting for the GeoFS viewer or Leaflet map.'));
          return;
        }
        setTimeout(check, CHECK_INTERVAL);
      };
      check();
    });

  const bootstrap = () => {
    waitForEnvironment()
      .then((env) => {
        log(`Environment detected (${env.type}), installing day/night overlay.`);
        if (root.__geofsDayNightOverlay) {
          root.__geofsDayNightOverlay.destroy();
        }
        root.__geofsDayNightOverlay =
          env.type === 'leaflet'
            ? new LeafletDayNightOverlay(env.instance)
            : new CesiumDayNightOverlay(env.instance);
      })
      .catch((err) => log(err.message));
  };

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    bootstrap();
  } else {
    document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
  }
})();
