/* Zoning Lookup – generated site
 * Settings live in js/config.js. Field names are verified against the data by
 * the generator; the app reports a clear error if a configured field is missing
 * instead of guessing another one.
 */
(function () {
  'use strict';

  // Site settings come from js/config.js (written by make_site.py). Defaults below.
  var CONFIG = Object.assign({
    dataUrl: 'data/zoning.geojson',            // relative path: works on GitHub Pages
    fallbackScript: 'data/zoning.js',          // same data as a script; lets index.html work from file://
    datasetName: 'zoning dataset',
    dataSource: null,                          // not stated unless provided
    codeField: null,                           // verified against the data by the generator
    nameField: null,
    searchFields: null,                        // null = every text attribute in the data
    hiddenFields: [],                          // attribute names to leave out of popups
    fieldLabels: {},
    fieldOrder: [],
    defaultOpacity: 0.35,                      // fill opacity, 0 – 1
    maxSearchResults: 50,
    homePadding: [24, 24],
    overlaysUrl: null,                         // set by the generator when the city folder had an Overlay folder
    overlaysScript: null,
    overlayGroupField: '_overlay_group'        // overlay layer name = first two words of overlay_name
  }, window.SITE_CONFIG || {});

  // Categorical palette; colors are assigned to whatever classes the data contains.
  var PALETTE = [
    '#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#911eb4', '#46f0f0',
    '#f032e6', '#bcf60c', '#fabebe', '#008080', '#e6beff', '#9a6324', '#fffac8',
    '#800000', '#aaffc3', '#808000', '#ffd8b1', '#000075', '#ff7f9f', '#00bfff', '#c0c0c0'
  ];

  var BASEMAPS = {
    satellite: {
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      options: {
        maxZoom: 20, maxNativeZoom: 19,
        attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community'
      }
    },
    streets: {
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
      options: {
        maxZoom: 20, maxNativeZoom: 19,
        attribution: 'Map &copy; Esri, HERE, Garmin, USGS, NGA, OpenStreetMap contributors, and the GIS User Community'
      }
    }
  };
  var LABELS_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';

  var el = function (id) { return document.getElementById(id); };
  var map, baseLayer, labelLayer, zoningLayer, bounds;
  var features = [];          // { layer, props, key }
  var classes = {};           // key -> { key, name, color, count, layers: [] }
  var classOrder = [];
  var fillOpacity = CONFIG.defaultOpacity;
  var selected = null;        // feature record
  var legendFilter = null;    // class key
  var tileErrors = 0;
  var map3d = null, map3dReady = false, mode = '2d', currentBasemap = 'satellite';
  var zoningGeoJSON = null, tip3d = null, pop3d = null, hover3dId = null;
  var hoverTip = null, hoverHtml = '', hoverRec = null, infoPopup = null;   // ONE shared tooltip + ONE shared popup
  var hoverOutline = null, selOutline = null, hoverOutlineId = null;
  var overlayGroups = [], overlaysGeoJSON = null;
  var OVERLAY_PALETTE = ['#00e5ff', '#ff1744', '#ffea00', '#d500f9', '#00e676', '#ff9100', '#2979ff', '#ff4081', '#76ff03', '#ffffff'];
  var OVERLAY_NAME_KEYS = ['overlay_name', 'overlayname', 'overlay_nam', 'overlay_nm', 'ovl_name', 'overlay_desc', 'overlay_description', 'overlay_label', 'overlay'];
  var OVERLAY_CODE_KEYS = ['overlay_code', 'overlaycode', 'overlay_cod', 'overlay_cd', 'ovl_code', 'overlay_id'];
  var TERRAIN_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function hasValue(v) { return v !== null && v !== undefined && String(v).trim() !== ''; }
  function prettyLabel(k) {
    if (CONFIG.fieldLabels[k]) return CONFIG.fieldLabels[k];
    return k.replace(/[_-]+/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }
  function showError(html) { var e = el('error'); e.innerHTML = html; e.hidden = false; el('status').hidden = true; }
  function setStatus(t) { var s = el('status'); s.textContent = t; s.hidden = !t; }
  function notice(msg, actionLabel, action) {
    var n = el('map-notice');
    n.innerHTML = '<span>' + esc(msg) + '</span>';
    if (actionLabel) {
      var b = document.createElement('button');
      b.type = 'button'; b.textContent = actionLabel;
      b.addEventListener('click', function () { action(); n.hidden = true; });
      n.appendChild(b);
    }
    n.hidden = false;
  }

  // Approximate polygon area in acres (equirectangular around the ring centroid; for display only).
  function ringArea(ring) {
    var lat0 = 0, i;
    for (i = 0; i < ring.length; i++) lat0 += ring[i][1];
    lat0 = (lat0 / ring.length) * Math.PI / 180;
    var kx = 111320 * Math.cos(lat0), ky = 110574, a = 0;
    for (i = 0; i < ring.length - 1; i++) {
      a += (ring[i][0] * kx) * (ring[i + 1][1] * ky) - (ring[i + 1][0] * kx) * (ring[i][1] * ky);
    }
    return Math.abs(a) / 2;
  }
  function geomAcres(g) {
    var polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    var m2 = 0;
    polys.forEach(function (p) {
      p.forEach(function (ring, i) { m2 += (i === 0 ? 1 : -1) * ringArea(ring); });
    });
    return m2 / 4046.8564224;
  }

  // Point-in-polygon (ray casting) on GeoJSON geometry; holes respected.
  function inRing(x, y, ring) {
    var c = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) c = !c;
    }
    return c;
  }
  function inPolygon(x, y, rings) {
    if (!inRing(x, y, rings[0])) return false;
    for (var i = 1; i < rings.length; i++) if (inRing(x, y, rings[i])) return false;
    return true;
  }
  function pointInGeom(x, y, g) {
    if (g.type === 'Polygon') return inPolygon(x, y, g.coordinates);
    if (g.type === 'MultiPolygon') return g.coordinates.some(function (p) { return inPolygon(x, y, p); });
    return false;
  }
  function geomBBox(g) {
    var b = [Infinity, Infinity, -Infinity, -Infinity];
    (function walk(c) {
      if (typeof c[0] === 'number') {
        if (c[0] < b[0]) b[0] = c[0]; if (c[1] < b[1]) b[1] = c[1];
        if (c[0] > b[2]) b[2] = c[0]; if (c[1] > b[3]) b[3] = c[1];
      } else c.forEach(walk);
    })(g.coordinates);
    return b;
  }
  // A point that is really inside the polygon (the bounds centre can fall outside concave shapes).
  function interiorLatLng(rec) {
    var c = rec.layer.getBounds().getCenter(), g = rec.feature.geometry;
    if (pointInGeom(c.lng, c.lat, g)) return c;
    var b = geomBBox(g), n = 8;
    for (var i = 1; i < n; i++) for (var j = 1; j < n; j++) {
      var x = b[0] + (b[2] - b[0]) * i / n, y = b[1] + (b[3] - b[1]) * j / n;
      if (pointInGeom(x, y, g)) return L.latLng(y, x);
    }
    return c;
  }
  function pick(props, keys) {
    var lower = {};
    Object.keys(props).forEach(function (k) { lower[k.toLowerCase()] = k; });
    for (var i = 0; i < keys.length; i++) if (lower[keys[i]] && hasValue(props[lower[keys[i]]])) return props[lower[keys[i]]];
    return '';
  }
  // Every visible overlay polygon that covers this point (one entry per overlay polygon).
  function overlaysAt(lng, lat) {
    var hits = [];
    overlayGroups.forEach(function (g) {
      if (!g.visible) return;
      g.recs.forEach(function (r) {
        var b = r.bbox;
        if (lng < b[0] || lng > b[2] || lat < b[1] || lat > b[3]) return;
        if (pointInGeom(lng, lat, r.geom)) hits.push(r);
      });
    });
    return hits;
  }

  /* ---------- map setup ---------- */
  function initMap() {
    map = L.map('map', { zoomControl: false, attributionControl: false, preferCanvas: false });
    L.control.attribution({ position: 'bottomleft', prefix: '<a href="https://leafletjs.com">Leaflet</a>' }).addTo(map);
    L.control.zoom({ position: 'topright' }).addTo(map);
    addHomeControl();
    L.control.scale({ imperial: true, metric: true, position: 'bottomleft' }).addTo(map);
    map.setView([39.5, -98.35], 4); // placeholder until the data extent is known
    // Overlays and highlight outlines live in their own non-interactive panes above the zoning polygons,
    // so zoning keeps receiving hover/click events and nothing is ever re-ordered under the cursor.
    map.createPane('overlays').style.zIndex = 450;
    map.createPane('highlight').style.zIndex = 460;
    map.getPane('overlays').style.pointerEvents = 'none';
    map.getPane('highlight').style.pointerEvents = 'none';
    hoverOutline = L.geoJSON(null, { pane: 'highlight', interactive: false,
      style: { color: '#ffffff', weight: 3.5, opacity: 1, fill: false } }).addTo(map);
    selOutline = L.geoJSON(null, { pane: 'highlight', interactive: false,
      style: { color: '#ffd23f', weight: 5, opacity: 1, fill: false } }).addTo(map);
    setBasemap('satellite');
  }

  function setBasemap(name) {
    currentBasemap = name;
    if (typeof updateSwapCard === 'function' && el('thumb-other')) updateSwapCard();
    if (map3dReady) apply3DBasemap();
    if (baseLayer) map.removeLayer(baseLayer);
    tileErrors = 0;
    var def = BASEMAPS[name];
    baseLayer = L.tileLayer(def.url, def.options);
    baseLayer.on('tileerror', function () {
      tileErrors++;
      if (tileErrors === 6) {
        if (name === 'satellite') {
          notice('Satellite imagery is not loading right now.', 'Switch to street map', function () {
            setBasemap('streets');
          });
        } else {
          notice('Street map tiles are not loading. Check your connection.');
        }
      }
    });
    baseLayer.on('load', function () { if (tileErrors < 6) el('map-notice').hidden = true; });
    baseLayer.addTo(map);
    baseLayer.bringToBack();
    updateLabelLayer();
  }

  function updateLabelLayer() {
    var want = el('toggle-labels').checked && currentBasemap === 'satellite';
    if (map3dReady) apply3DBasemap();
    if (want && !labelLayer) {
      labelLayer = L.tileLayer(LABELS_URL, { maxZoom: 20, maxNativeZoom: 19, pane: 'overlayPane', attribution: 'Labels &copy; Esri' });
      labelLayer.addTo(map);
      if (zoningLayer) zoningLayer.bringToFront();
    } else if (!want && labelLayer) {
      map.removeLayer(labelLayer); labelLayer = null;
    }
  }

  function addHomeControl() {
    var Home = L.Control.extend({
      options: { position: 'topright' },
      onAdd: function () {
        var bar = L.DomUtil.create('div', 'leaflet-bar');
        var a = L.DomUtil.create('a', 'home-btn', bar);
        a.href = '#'; a.title = 'Zoom to full extent'; a.setAttribute('role', 'button'); a.setAttribute('aria-label', 'Zoom to full extent');
        a.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" fill="none" stroke="#1d2733" stroke-width="2" stroke-linejoin="round"/></svg>';
        L.DomEvent.on(a, 'click', function (e) { L.DomEvent.preventDefault(e); fitAll(); });
        L.DomEvent.disableClickPropagation(bar);
        return bar;
      }
    });
    new Home().addTo(map);
  }

  function fitAll() {
    if (!bounds || !bounds.isValid()) return;
    if (mode === '3d' && map3dReady) {
      map3d.fitBounds(boundsArr(bounds), { padding: 60, pitch: 55, bearing: -15, duration: 800 });
    } else {
      map.fitBounds(bounds, { padding: CONFIG.homePadding });
    }
  }
  function boundsArr(b) { return [[b.getWest(), b.getSouth()], [b.getEast(), b.getNorth()]]; }

  /* ---------- data ---------- */
  function loadData() {
    setStatus('Loading zoning data…');
    fetch(CONFIG.dataUrl)
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status + ' while loading ' + CONFIG.dataUrl);
        return r.json();
      })
      .then(function (gj) { buildLayer(gj); })
      .catch(function (err) {
        // Opened from disk (file://) or fetch blocked: fall back to the same data as a script file.
        var s = document.createElement('script');
        s.src = CONFIG.fallbackScript;
        s.onload = function () {
          if (window.ZONING_GEOJSON) buildLayer(window.ZONING_GEOJSON);
          else showError('<b>The zoning data could not be loaded.</b><br>' + esc(err.message));
        };
        s.onerror = function () {
          showError('<b>The zoning data could not be loaded.</b><br>' + esc(err.message) +
            '<br><br>Check that <code>data/zoning.geojson</code> is present, or serve the folder with <code>python -m http.server 8000</code>.');
        };
        document.head.appendChild(s);
      });
  }

  function buildLayer(gj) {
    if (!gj || gj.type !== 'FeatureCollection' || !Array.isArray(gj.features)) {
      showError('<b>The data file is not a valid GeoJSON FeatureCollection.</b>'); return;
    }
    var valid = gj.features.filter(function (f) {
      return f && f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon') && f.properties;
    });
    var skipped = gj.features.length - valid.length;
    if (!valid.length) { showError('<b>The data file contains no polygon features.</b>'); return; }

    // Verify configured fields exist rather than silently substituting another one.
    var allFields = {};
    valid.forEach(function (f) { Object.keys(f.properties).forEach(function (k) { allFields[k] = true; }); });
    var missing = [CONFIG.codeField, CONFIG.nameField].filter(function (k) { return k && !allFields[k]; });
    if (!CONFIG.codeField) { showError('<b>No zoning code field is configured.</b> Set <code>codeField</code> in <code>js/config.js</code>.'); return; }
    if (missing.length) {
      showError('<b>Configured field not found: ' + esc(missing.join(', ')) + '.</b><br>Available fields: ' +
        Object.keys(allFields).map(function (k) { return '<code>' + esc(k) + '</code>'; }).join(', ') +
        '.<br>Update <code>codeField</code> / <code>nameField</code> in <code>js/config.js</code>.');
      return;
    }

    // Build the class list from the data.
    valid.forEach(function (f) {
      var code = f.properties[CONFIG.codeField], name = f.properties[CONFIG.nameField];
      var key = hasValue(code) ? String(code).trim() : (hasValue(name) ? String(name).trim() : '(unclassified)');
      f.__key = key;
      if (!classes[key]) classes[key] = { key: key, name: hasValue(name) ? String(name).trim() : '', color: '', count: 0, layers: [] };
      classes[key].count++;
    });
    classOrder = Object.keys(classes).sort(function (a, b) { return a.localeCompare(b, undefined, { numeric: true }); });
    classOrder.forEach(function (k, i) { classes[k].color = i < PALETTE.length ? PALETTE[i] : 'hsl(' + ((i * 137.5) % 360) + ',65%,55%)'; });

    valid.forEach(function (f, i) { f.id = i; });
    zoningGeoJSON = { type: 'FeatureCollection', features: valid };
    zoningLayer = L.geoJSON(zoningGeoJSON, {
      style: baseStyle,
      onEachFeature: function (f, layer) {
        var rec = { id: f.id, layer: layer, props: f.properties, key: f.__key, acres: geomAcres(f.geometry), feature: f };
        layer.__rec = rec;
        features.push(rec);
        classes[f.__key].layers.push(layer);
        layer.on({
          mouseover: function (e) { hoverRec = rec; showHover(rec, e.latlng); },
          mousemove: function (e) { if (hoverRec === rec) showHover(rec, e.latlng); },
          mouseout: function () { if (hoverRec === rec) { hoverRec = null; hideHover(); } },
          click: function (e) { L.DomEvent.stopPropagation(e); selectFeature(rec, false, e.latlng); }
        });
      }
    }).addTo(map);

    bounds = zoningLayer.getBounds();
    fitAll();
    updateSwapCard();
    buildLegend();
    buildStats(valid.length, skipped);
    initSearch();
    setStatus('');
    wireMapHover();
    loadOverlays();
  }

  /* ---------- styling ---------- */
  function baseStyle(f) {
    var c = classes[f.__key].color;
    return { color: c, weight: 2, opacity: 1, fillColor: c, fillOpacity: fillOpacity, lineJoin: 'round' };
  }
  function hoverStyle(rec) {
    var c = classes[rec.key].color;
    return { color: c, weight: 2, opacity: 1, fillColor: c, fillOpacity: Math.min(fillOpacity + 0.25, 0.9) };
  }
  function selectedStyle(rec) {
    var c = classes[rec.key].color;
    return { color: c, weight: 2, opacity: 1, fillColor: c, fillOpacity: Math.min(fillOpacity + 0.3, 0.95) };
  }
  function overlayStyle(g) {
    return { color: g.color, weight: 3, opacity: 1, dashArray: '10 6', lineCap: 'butt', fillColor: g.color,
             fillOpacity: overlayFillOpacity() };
  }
  function overlayFillOpacity() { return Math.min(fillOpacity * 0.6, 0.5); }
  function restyleOverlays() {
    overlayGroups.forEach(function (g) { g.layer.setStyle(overlayStyle(g)); });
  }
  function dimmedStyle(rec) {
    var c = classes[rec.key].color;
    return { color: c, weight: 1, opacity: 0.45, fillColor: c, fillOpacity: Math.min(fillOpacity, 0.08) };
  }
  function applyStyle(rec) {
    if (rec === selected) { rec.layer.setStyle(selectedStyle(rec)); return; }
    if (legendFilter && rec.key !== legendFilter) { rec.layer.setStyle(dimmedStyle(rec)); return; }
    rec.layer.setStyle(baseStyle({ __key: rec.key }));
  }
  function restyleAll() { features.forEach(applyStyle); update3DStates(); }

  /* ---------- tooltip & popup ----------
   * One shared tooltip and one shared popup instance. Because there is only ever a single tooltip object,
   * tooltips can no longer pile up on the map, and nothing is re-ordered in the DOM while the cursor moves. */
  function overlayLines(hits) {
    return hits.map(function (r) {
      var nm = pick(r.props, OVERLAY_NAME_KEYS) || r.group.name, cd = pick(r.props, OVERLAY_CODE_KEYS);
      return 'Overlay: ' + esc(nm) + (cd ? ' (' + esc(cd) + ')' : '');
    });
  }
  function tooltipHtml(rec, ll, hits) {
    var out = [];
    if (rec) {
      var p = rec.props;
      if (hasValue(p[CONFIG.nameField])) out.push('Zoning District: ' + esc(p[CONFIG.nameField]));
      if (hasValue(p[CONFIG.codeField])) out.push('Zoning Code: ' + esc(p[CONFIG.codeField]));
      if (!out.length) out.push('Zoning polygon');
    }
    hits = hits || (ll ? overlaysAt(ll.lng, ll.lat) : []);
    return out.concat(overlayLines(hits)).join('<br>');
  }

  function attrRows(p, skip) {
    var keys = Object.keys(p).filter(function (k) {
      return k.charAt(0) !== '_' && CONFIG.hiddenFields.indexOf(k) < 0 && hasValue(p[k]) && (!skip || skip.indexOf(k) < 0);
    });
    keys.sort(function (a, b) {
      var ia = CONFIG.fieldOrder.indexOf(a), ib = CONFIG.fieldOrder.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    return keys.map(function (k) {
      return '<tr><th scope="row">' + esc(prettyLabel(k)) + '</th><td>' + esc(p[k]) + '</td></tr>';
    });
  }

  function overlaysPopupHtml(hits) {
    return hits.map(function (r) {
      return '<div class="ov-block"><h4 class="popup-sub"><span class="swatch ov" style="border-color:' + r.group.color + '"></span>' +
        esc(r.group.name) + '</h4><table class="popup-table">' + attrRows(r.props).join('') + '</table></div>';
    }).join('');
  }

  function popupHtml(rec, ll) {
    var p = rec.props, rows = attrRows(p);
    rows.push('<tr><th scope="row">Approx. area</th><td>' + rec.acres.toLocaleString(undefined, { maximumFractionDigits: 1 }) +
      ' acres <span class="muted small">(computed from polygon)</span></td></tr>');
    var title = hasValue(p[CONFIG.codeField]) ? p[CONFIG.codeField] : rec.key;
    var html = '<h3 class="popup-title"><span class="swatch" style="background:' + classes[rec.key].color + '"></span>' + esc(title) +
      (hasValue(p[CONFIG.nameField]) ? ' – ' + esc(p[CONFIG.nameField]) : '') + '</h3>' +
      '<table class="popup-table">' + rows.join('') + '</table>';
    var hits = ll ? overlaysAt(ll.lng, ll.lat) : [];
    if (hits.length) html += '<div class="ov-title">Overlays at this location</div>' + overlaysPopupHtml(hits);
    return html;
  }

  function overlayOnlyPopupHtml(hits) {
    return '<h3 class="popup-title">Overlay' + (hits.length > 1 ? 's' : '') + ' at this location</h3>' + overlaysPopupHtml(hits);
  }

  /* hover (2D) */
  function setHoverOutline(rec) {
    var id = rec ? rec.id : null;
    if (id === hoverOutlineId) return;
    hoverOutlineId = id;
    hoverOutline.clearLayers();
    if (rec && rec !== selected) hoverOutline.addData(rec.feature);
  }
  function showHover(rec, ll) {
    if (rec !== selected) rec.layer.setStyle(hoverStyle(rec));
    setHoverOutline(rec);
    showTip(tooltipHtml(rec, ll), ll);
  }
  function showTip(html, ll) {
    if (!html) { hideTip(); return; }
    if (!hoverTip) hoverTip = L.tooltip({ className: 'zone-tip', direction: 'top', opacity: 1, offset: [0, -6] });
    if (html !== hoverHtml) { hoverTip.setContent(html); hoverHtml = html; }
    hoverTip.setLatLng(ll);
    if (!map.hasLayer(hoverTip)) hoverTip.addTo(map);
  }
  function hideTip() {
    if (hoverTip && map.hasLayer(hoverTip)) map.removeLayer(hoverTip);
    hoverHtml = '';
  }
  function hideHover() {
    var prev = hoverOutlineId !== null ? features[hoverOutlineId] : null;
    setHoverOutline(null);
    if (prev) applyStyle(prev);
    hideTip();
  }
  function wireMapHover() {
    // Over empty map or over an overlay with no zoning polygon beneath it.
    map.on('mousemove', function (e) {
      if (hoverRec) return;
      if (!overlayGroups.length) { hideTip(); return; }
      showTip(tooltipHtml(null, e.latlng), e.latlng);
    });
    map.on('mouseout movestart zoomstart', function () { hoverRec = null; hideHover(); });
    // Click that did not land on a zoning polygon: show overlays there, if any.
    map.on('click', function (e) {
      var hits = overlaysAt(e.latlng.lng, e.latlng.lat);
      if (!hits.length) return;
      clearSelection();
      openInfo(e.latlng, overlayOnlyPopupHtml(hits));
    });
  }

  function openInfo(ll, html) {
    hideHover();
    if (!infoPopup) infoPopup = L.popup({ maxWidth: 340, maxHeight: 360, autoPanPadding: [30, 30] });
    infoPopup.setLatLng(ll).setContent(html);
    map.openPopup(infoPopup);
  }

  /* ---------- selection ---------- */
  function selectFeature(rec, zoom, latlng) {
    if (mode === '3d' && map3dReady) { select3D(rec, zoom, latlng); return; }
    var prev = selected;
    selected = rec;
    if (prev && prev !== rec) applyStyle(prev);
    applyStyle(rec);
    hoverOutline.clearLayers(); hoverOutlineId = null;
    selOutline.clearLayers(); selOutline.addData(rec.feature);
    if (zoom) map.fitBounds(rec.layer.getBounds(), { padding: [60, 60], maxZoom: 18 });
    var ll = latlng || interiorLatLng(rec);
    openInfo(ll, popupHtml(rec, ll));
    el('btn-clear-selection').disabled = false;
  }

  function clearSelection() {
    if (mode === '3d' && map3dReady && pop3d) pop3d.remove();
    if (selected) {
      var s = selected; selected = null;
      applyStyle(s);
    }
    selOutline.clearLayers();
    if (infoPopup) map.closePopup(infoPopup);
    update3DStates();
    el('btn-clear-selection').disabled = true;
  }

  /* ---------- overlays ---------- */
  function loadJson(url, scriptUrl, globalName) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' while loading ' + url);
      return r.json();
    }).catch(function (err) {
      return new Promise(function (resolve, reject) {      // file:// fallback: same data as a script
        var s = document.createElement('script');
        s.src = scriptUrl;
        s.onload = function () { window[globalName] ? resolve(window[globalName]) : reject(err); };
        s.onerror = function () { reject(err); };
        document.head.appendChild(s);
      });
    });
  }

  function loadOverlays() {
    if (!CONFIG.overlaysUrl) return;
    loadJson(CONFIG.overlaysUrl, CONFIG.overlaysScript, 'OVERLAYS_GEOJSON').then(buildOverlays).catch(function (err) {
      notice('Overlay layers could not be loaded: ' + err.message);
    });
  }

  function buildOverlays(gj) {
    if (!gj || !Array.isArray(gj.features)) return;
    var field = CONFIG.overlayGroupField, byName = {};
    gj.features.forEach(function (f) {
      if (!f || !f.geometry || !f.properties || (f.geometry.type !== 'Polygon' && f.geometry.type !== 'MultiPolygon')) return;
      var name = hasValue(f.properties[field]) ? String(f.properties[field]) : 'Overlay';
      (byName[name] = byName[name] || []).push(f);
    });
    var names = Object.keys(byName).sort(function (a, b) { return a.localeCompare(b, undefined, { numeric: true }); });
    if (!names.length) return;
    var all = [];
    overlayGroups = names.map(function (name, i) {
      var g = { name: name, color: OVERLAY_PALETTE[i % OVERLAY_PALETTE.length], visible: true, count: byName[name].length, features: byName[name] };
      g.layer = L.geoJSON({ type: 'FeatureCollection', features: g.features }, {
        pane: 'overlays', interactive: false, style: function () { return overlayStyle(g); }
      }).addTo(map);
      g.recs = g.features.map(function (f) { return { props: f.properties, geom: f.geometry, bbox: geomBBox(f.geometry), group: g }; });
      all = all.concat(g.features);
      return g;
    });
    overlaysGeoJSON = { type: 'FeatureCollection', features: all };
    buildOverlayPanel();
    var st = el('stats');
    st.insertAdjacentHTML('beforeend', '<dt>Overlay layers</dt><dd>' + overlayGroups.length + ' (' + all.length + ' polygons)</dd>');
    if (map3dReady) add3DOverlays();
  }

  function buildOverlayPanel() {
    var ul = el('overlay-list'); ul.innerHTML = '';
    overlayGroups.forEach(function (g) {
      var li = document.createElement('li'); li.className = 'ov-item';
      var id = 'ov-' + overlayGroups.indexOf(g);
      li.innerHTML = '<label class="row" for="' + id + '"><input id="' + id + '" type="checkbox" checked>' +
        '<span class="swatch ov" style="border-color:' + g.color + '"></span>' +
        '<span class="label">' + esc(g.name) + '</span><span class="count" title="Number of polygons">' + g.count + '</span></label>' +
        '<button type="button" class="text-btn">Zoom</button>';
      li.querySelector('input').addEventListener('change', function (e) { setOverlayVisible(g, e.target.checked); });
      li.querySelector('button').addEventListener('click', function () { zoomToOverlay(g); });
      ul.appendChild(li);
    });
    el('overlay-panel').hidden = false;
  }

  function setOverlayVisible(g, on) {
    g.visible = on;
    if (on) g.layer.addTo(map); else map.removeLayer(g.layer);
    hideHover();
    update3DOverlayFilter();
  }

  function zoomToOverlay(g) {
    var b = g.layer.getBounds();
    if (!b.isValid()) return;
    if (!g.visible) { el('ov-' + overlayGroups.indexOf(g)).checked = true; setOverlayVisible(g, true); }
    if (mode === '3d' && map3dReady) map3d.fitBounds(boundsArr(b), { padding: 80, maxZoom: 17, duration: 700 });
    else map.fitBounds(b, { padding: [60, 60], maxZoom: 18 });
  }

  /* ---------- legend ---------- */
  function buildLegend() {
    var ul = el('legend'); ul.innerHTML = '';
    classOrder.forEach(function (k) {
      var c = classes[k], li = document.createElement('li'), b = document.createElement('button');
      b.type = 'button'; b.className = 'legend-btn'; b.setAttribute('aria-pressed', 'false'); b.dataset.key = k;
      b.innerHTML = '<span class="swatch" style="background:' + c.color + '"></span>' +
        '<span class="label"><b>' + esc(k) + '</b>' + (c.name && c.name !== k ? ' – ' + esc(c.name) : '') + '</span>' +
        '<span class="count" title="Number of polygons">' + c.count + '</span>';
      b.addEventListener('click', function () { toggleLegendFilter(k); });
      li.appendChild(b); ul.appendChild(li);
    });
  }

  function toggleLegendFilter(key) {
    legendFilter = legendFilter === key ? null : key;
    Array.prototype.forEach.call(document.querySelectorAll('.legend-btn'), function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.key === legendFilter));
    });
    restyleAll();
    if (legendFilter) {
      var gb = L.featureGroup(classes[legendFilter].layers).getBounds();
      if (mode === '3d' && map3dReady) map3d.fitBounds(boundsArr(gb), { padding: 80, maxZoom: 17, duration: 700 });
      else map.fitBounds(gb, { padding: [60, 60], maxZoom: 18 });
    }
  }

  /* ---------- stats ---------- */
  function buildStats(total, skipped) {
    var rows = [
      ['Zoning polygons', total],
      ['Unique zoning classes', classOrder.length],
      ['Dataset', CONFIG.datasetName],
      ['Data source', CONFIG.dataSource || 'Not stated in the supplied files']
    ];
    if (skipped) rows.splice(1, 0, ['Skipped (no valid geometry)', skipped]);
    el('stats').innerHTML = rows.map(function (r) { return '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>'; }).join('');
  }

  /* ---------- search ---------- */
  function initSearch() {
    var input = el('search-input'), clearBtn = el('search-clear');
    var textFields = CONFIG.searchFields;
    if (!textFields) {
      var set = {};
      features.forEach(function (r) {
        Object.keys(r.props).forEach(function (k) { if (typeof r.props[k] === 'string' && hasValue(r.props[k])) set[k] = true; });
      });
      textFields = Object.keys(set);
    }
    // Skip attributes that are identical on every feature (e.g. city/state) so they do not match everything.
    textFields = textFields.filter(function (k) {
      var seen = {};
      features.forEach(function (r) { seen[String(r.props[k])] = true; });
      return k === CONFIG.codeField || k === CONFIG.nameField || Object.keys(seen).length > 1;
    });
    input.disabled = false;

    function run() {
      var q = input.value.trim().toLowerCase();
      clearBtn.hidden = !q;
      var list = el('search-results'), summary = el('search-summary');
      list.innerHTML = '';
      if (!q) { summary.textContent = ''; return; }
      var hits = features.filter(function (r) {
        return textFields.some(function (k) { return hasValue(r.props[k]) && String(r.props[k]).toLowerCase().indexOf(q) > -1; });
      });
      hits.sort(function (a, b) {
        var ea = String(a.props[CONFIG.codeField]).toLowerCase() === q ? 0 : 1, eb = String(b.props[CONFIG.codeField]).toLowerCase() === q ? 0 : 1;
        return ea - eb || a.key.localeCompare(b.key, undefined, { numeric: true }) || b.acres - a.acres;
      });
      if (!hits.length) {
        summary.textContent = 'No zoning districts match “' + input.value.trim() + '”. Try a zoning code such as ' + classOrder[0] + '.';
        return;
      }
      var shown = hits.slice(0, CONFIG.maxSearchResults);
      summary.textContent = hits.length + (hits.length === 1 ? ' polygon matches' : ' polygons match') +
        (hits.length > shown.length ? ' (showing first ' + shown.length + ')' : '') + '. Select one to zoom to it.';
      // number polygons within the same class so identical codes can be told apart
      var seq = {};
      features.forEach(function (r) { seq[r.key] = 0; });
      var idx = new Map();
      features.slice().sort(function (a, b) { return b.acres - a.acres; }).forEach(function (r) { idx.set(r, ++seq[r.key]); });
      shown.forEach(function (r) {
        var li = document.createElement('li'), b = document.createElement('button');
        b.type = 'button'; b.className = 'result-btn';
        b.innerHTML = '<span class="swatch" style="background:' + classes[r.key].color + '"></span><span><span class="code">' + esc(r.props[CONFIG.codeField] || r.key) + '</span> ' +
          esc(r.props[CONFIG.nameField] || '') + '<span class="meta">Polygon ' + idx.get(r) + ' of ' + classes[r.key].count +
          ' · approx. ' + r.acres.toLocaleString(undefined, { maximumFractionDigits: 1 }) + ' acres</span></span>';
        b.addEventListener('click', function () {
          if (window.matchMedia('(max-width: 860px)').matches) setSidebar(false);
          selectFeature(r, true);
        });
        li.appendChild(b); list.appendChild(li);
      });
    }

    input.addEventListener('input', run);
    clearBtn.addEventListener('click', function () { input.value = ''; run(); input.focus(); });
    input.addEventListener('keydown', function (e) { if (e.key === 'Escape') { input.value = ''; run(); } });
  }

  /* ---------- UI wiring ---------- */
  function setSidebar(open) {
    var sb = el('sidebar'), t = el('sidebar-toggle');
    sb.classList.toggle('collapsed', !open);
    t.setAttribute('aria-expanded', String(open));
    t.setAttribute('aria-label', open ? 'Hide sidebar' : 'Show sidebar');
    setTimeout(function () { if (map) map.invalidateSize(); }, 250);
  }

  function wireUi() {
    el('sidebar-toggle').addEventListener('click', function () { setSidebar(el('sidebar').classList.contains('collapsed')); });
    el('toggle-zoning').addEventListener('change', function (e) {
      if (!zoningLayer) return;
      if (e.target.checked) { zoningLayer.addTo(map); } else { hoverRec = null; hideHover(); clearSelection(); map.removeLayer(zoningLayer); }
      set3DVisibility(e.target.checked);
    });
    el('toggle-labels').addEventListener('change', updateLabelLayer);
    var slider = el('opacity');
    slider.value = Math.round(CONFIG.defaultOpacity * 100);
    el('opacity-value').textContent = slider.value + '%';
    slider.addEventListener('input', function () {
      fillOpacity = slider.value / 100;
      el('opacity-value').textContent = slider.value + '%';
      restyleAll();
      restyleOverlays();
      set3DOpacity();
    });
    el('basemap-swap').addEventListener('click', function () { setBasemap(currentBasemap === 'satellite' ? 'streets' : 'satellite'); });
    map.on('moveend', scheduleSwapCard);
    el('view-2d').addEventListener('click', function () { setMode('2d'); });
    el('view-3d').addEventListener('click', function () { setMode('3d'); });
    el('btn-extent').addEventListener('click', fitAll);
    el('btn-clear-selection').addEventListener('click', function () {
      clearSelection();
      if (legendFilter) toggleLegendFilter(legendFilter);
    });
    el('legend-toggle').addEventListener('click', function () {
      var ul = el('legend'), hide = !ul.hidden;
      ul.hidden = hide; el('legend-hint').hidden = hide;
      this.textContent = hide ? 'Show' : 'Hide';
      this.setAttribute('aria-expanded', String(!hide));
    });
    if (window.matchMedia('(max-width: 860px)').matches) setSidebar(false);
  }


  /* ---------- basemap swap card (preview shows the OTHER basemap) ---------- */
  var thumbTimer = null;
  function updateSwapCard() {
    var other = currentBasemap === 'satellite' ? 'streets' : 'satellite';
    var c, z;
    if (mode === '3d' && map3d) { c = map3d.getCenter(); z = map3d.getZoom() + 1; }
    else { c = map.getCenter(); z = map.getZoom(); }
    var tz = Math.max(4, Math.min(16, Math.round(z) - 1)), n = Math.pow(2, tz);
    var x = Math.floor((c.lng + 180) / 360 * n);
    var r = c.lat * Math.PI / 180;
    var y = Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n);
    x = Math.max(0, Math.min(n - 1, x)); y = Math.max(0, Math.min(n - 1, y));
    var svc = other === 'satellite' ? 'World_Imagery' : 'World_Street_Map';
    el('thumb-other').style.backgroundImage = 'url(https://server.arcgisonline.com/ArcGIS/rest/services/' + svc + '/MapServer/tile/' + tz + '/' + y + '/' + x + ')';
    el('thumb-cap').textContent = other === 'satellite' ? 'Imagery' : 'Street map';
    el('basemap-swap').setAttribute('aria-label', other === 'satellite' ? 'Switch to imagery' : 'Switch to street map');
  }
  function scheduleSwapCard() { clearTimeout(thumbTimer); thumbTimer = setTimeout(updateSwapCard, 400); }

  /* ---------- 3D view (MapLibre GL, terrain + draped zoning) ---------- */
  function colorExpr() {
    var e = ['match', ['to-string', ['get', CONFIG.codeField]]];
    classOrder.forEach(function (k) { e.push(k, classes[k].color); });
    e.push('#888888');
    return e;
  }
  function fillOpacityExpr() {
    return ['case',
      ['boolean', ['feature-state', 'selected'], false], Math.min(fillOpacity + 0.3, 0.95),
      ['boolean', ['feature-state', 'dim'], false], Math.min(fillOpacity, 0.08),
      ['boolean', ['feature-state', 'hover'], false], Math.min(fillOpacity + 0.25, 0.9),
      fillOpacity];
  }
  function lineColorExpr() {
    return ['case',
      ['boolean', ['feature-state', 'selected'], false], '#ffd23f',
      ['boolean', ['feature-state', 'hover'], false], '#ffffff',
      colorExpr()];
  }
  function lineWidthExpr() {
    return ['case',
      ['boolean', ['feature-state', 'selected'], false], 4.5,
      ['boolean', ['feature-state', 'hover'], false], 3.5,
      ['boolean', ['feature-state', 'dim'], false], 1,
      2];
  }
  function recById(id) { return features[id]; }

  function init3D() {
    if (map3d) return true;
    try {
      var esri = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
      var c = bounds.getCenter();
      map3d = new maplibregl.Map({
        container: 'map3d',
        attributionControl: false,
        center: [c.lng, c.lat], zoom: 12, pitch: 60, bearing: -15, maxPitch: 80,
        style: {
          version: 8,
          sources: {
            imagery: { type: 'raster', tileSize: 256, maxzoom: 19, tiles: [esri + 'World_Imagery/MapServer/tile/{z}/{y}/{x}'],
              attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community' },
            streets: { type: 'raster', tileSize: 256, maxzoom: 19, tiles: [esri + 'World_Street_Map/MapServer/tile/{z}/{y}/{x}'],
              attribution: 'Map &copy; Esri, HERE, Garmin, USGS, NGA, OpenStreetMap contributors, and the GIS User Community' },
            labels: { type: 'raster', tileSize: 256, maxzoom: 19, tiles: [LABELS_URL], attribution: 'Labels &copy; Esri' },
            dem: { type: 'raster-dem', tileSize: 256, maxzoom: 15, encoding: 'terrarium', tiles: [TERRAIN_URL],
              attribution: 'Elevation: Mapzen / AWS Terrain Tiles (USGS, NASA SRTM and others)' },
            zoning: { type: 'geojson', data: zoningGeoJSON },
            overlays: { type: 'geojson', data: overlaysGeoJSON || { type: 'FeatureCollection', features: [] } }
          },
          layers: [
            { id: 'bg', type: 'background', paint: { 'background-color': '#1b2a3a' } },
            { id: 'imagery', type: 'raster', source: 'imagery' },
            { id: 'streets', type: 'raster', source: 'streets', layout: { visibility: 'none' } },
            { id: 'labels', type: 'raster', source: 'labels', layout: { visibility: 'none' } },
            { id: 'zoning-fill', type: 'fill', source: 'zoning', paint: { 'fill-color': colorExpr(), 'fill-opacity': fillOpacityExpr() } },
            { id: 'zoning-line', type: 'line', source: 'zoning', layout: { 'line-join': 'round' },
              paint: { 'line-color': lineColorExpr(), 'line-width': lineWidthExpr() } },
            { id: 'overlay-fill', type: 'fill', source: 'overlays', paint: { 'fill-color': overlayColorExpr(), 'fill-opacity': overlayFillOpacity() } },
            { id: 'overlay-line', type: 'line', source: 'overlays', layout: { 'line-join': 'round' },
              paint: { 'line-color': overlayColorExpr(), 'line-width': 3, 'line-dasharray': [3, 2] } }
          ],
          terrain: { source: 'dem', exaggeration: 1.25 }
        }
      });
    } catch (err) {
      map3d = null;
      notice('3D view is not available in this browser (WebGL is required).');
      return false;
    }
    map3d.addControl(new maplibregl.NavigationControl({ visualizePitch: true, showCompass: true }), 'top-right');
    map3d.addControl(new maplibregl.AttributionControl({ compact: false }), 'bottom-left');
    map3d.addControl(new maplibregl.ScaleControl({ maxWidth: 100, unit: 'imperial' }), 'bottom-left');
    map3d.on('moveend', scheduleSwapCard);
    tip3d = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: 'zone-tip-3d', offset: 12 });

    map3d.on('load', function () {
      map3dReady = true;
      apply3DBasemap();
      set3DOpacity();
      update3DStates();
      set3DVisibility(el('toggle-zoning').checked);
      update3DOverlayFilter();
    });
    map3d.on('error', function (e) {
      if (e && e.error && e.sourceId && (e.sourceId === 'imagery' || e.sourceId === 'streets')) {
        notice('Some map tiles could not be loaded. Check your connection.');
      }
    });
    // One unified handler: zoning (rendered feature) + every visible overlay covering the pointer.
    map3d.on('mousemove', function (e) {
      var rec = hit3D(e), hits = overlaysAt(e.lngLat.lng, e.lngLat.lat), id = rec ? rec.id : null;
      if (hover3dId !== id) {
        if (hover3dId !== null) map3d.setFeatureState({ source: 'zoning', id: hover3dId }, { hover: false });
        hover3dId = id;
        if (id !== null) map3d.setFeatureState({ source: 'zoning', id: id }, { hover: true });
      }
      if (!rec && !hits.length) { map3d.getCanvas().style.cursor = ''; tip3d.remove(); return; }
      map3d.getCanvas().style.cursor = 'pointer';
      tip3d.setLngLat(e.lngLat).setHTML(tooltipHtml(rec, e.lngLat, hits)).addTo(map3d);
    });
    map3d.getCanvas().addEventListener('mouseleave', hideHover3D);
    map3d.on('movestart', hideHover3D);
    map3d.on('click', function (e) {
      var rec = hit3D(e);
      if (rec) { select3D(rec, false, e.lngLat); return; }
      var hits = overlaysAt(e.lngLat.lng, e.lngLat.lat);
      if (!hits.length) return;
      clearSelection();
      tip3d.remove();
      if (pop3d) pop3d.remove();
      pop3d = new maplibregl.Popup({ className: 'zone-pop', maxWidth: '340px', offset: 8 })
        .setLngLat(e.lngLat).setHTML(overlayOnlyPopupHtml(hits)).addTo(map3d);
    });
    return true;
  }

  function hit3D(e) {
    if (!map3d.getLayer('zoning-fill')) return null;
    var fs = map3d.queryRenderedFeatures(e.point, { layers: ['zoning-fill'] });
    return fs.length ? recById(fs[0].id) : null;
  }
  function hideHover3D() {
    if (!map3d) return;
    map3d.getCanvas().style.cursor = '';
    if (hover3dId !== null) map3d.setFeatureState({ source: 'zoning', id: hover3dId }, { hover: false });
    hover3dId = null;
    if (tip3d) tip3d.remove();
  }
  function overlayColorExpr() {
    var e = ['match', ['get', CONFIG.overlayGroupField]];
    overlayGroups.forEach(function (g) { e.push(g.name, g.color); });
    e.push('#888888');
    return overlayGroups.length ? e : '#888888';
  }
  function overlayFilterExpr() {
    var names = overlayGroups.filter(function (g) { return g.visible; }).map(function (g) { return g.name; });
    return ['match', ['get', CONFIG.overlayGroupField], names.length ? names : ['__none__'], true, false];
  }
  function update3DOverlayFilter() {
    if (!map3dReady || !map3d.getLayer('overlay-fill')) return;
    map3d.setFilter('overlay-fill', overlayFilterExpr());
    map3d.setFilter('overlay-line', overlayFilterExpr());
  }
  function add3DOverlays() {            // only needed if the overlays finished loading after the 3D map was created
    if (!map3dReady) return;
    map3d.getSource('overlays').setData(overlaysGeoJSON);
    map3d.setPaintProperty('overlay-fill', 'fill-color', overlayColorExpr());
    map3d.setPaintProperty('overlay-line', 'line-color', overlayColorExpr());
    update3DOverlayFilter();
  }

  function apply3DBasemap() {
    if (!map3dReady) return;
    var sat = currentBasemap === 'satellite';
    map3d.setLayoutProperty('imagery', 'visibility', sat ? 'visible' : 'none');
    map3d.setLayoutProperty('streets', 'visibility', sat ? 'none' : 'visible');
    map3d.setLayoutProperty('labels', 'visibility', (sat && el('toggle-labels').checked) ? 'visible' : 'none');
    // keep zoning above the labels layer
    if (map3d.getLayer('zoning-fill')) { map3d.moveLayer('zoning-fill'); map3d.moveLayer('zoning-line'); }
    if (map3d.getLayer('overlay-fill')) { map3d.moveLayer('overlay-fill'); map3d.moveLayer('overlay-line'); }
  }
  function set3DOpacity() {
    if (!map3dReady) return;
    map3d.setPaintProperty('zoning-fill', 'fill-opacity', fillOpacityExpr());
    if (map3d.getLayer('overlay-fill')) map3d.setPaintProperty('overlay-fill', 'fill-opacity', overlayFillOpacity());
  }
  function set3DVisibility(on) {
    if (!map3dReady) return;
    map3d.setLayoutProperty('zoning-fill', 'visibility', on ? 'visible' : 'none');
    map3d.setLayoutProperty('zoning-line', 'visibility', on ? 'visible' : 'none');
  }
  function update3DStates() {
    if (!map3dReady) return;
    features.forEach(function (rec) {
      map3d.setFeatureState({ source: 'zoning', id: rec.id }, {
        selected: rec === selected,
        dim: !!legendFilter && rec.key !== legendFilter && rec !== selected
      });
    });
  }

  function open3DPopup(rec, lngLat) {
    if (pop3d) pop3d.remove();
    if (tip3d) tip3d.remove();
    pop3d = new maplibregl.Popup({ className: 'zone-pop', maxWidth: '340px', offset: 8 })
      .setLngLat([lngLat.lng, lngLat.lat]).setHTML(popupHtml(rec, lngLat)).addTo(map3d);
  }

  function select3D(rec, zoom, lngLat) {
    selected = rec;
    update3DStates();
    features.forEach(function (r) { applyStyle(r); }); // keep 2D styles in sync
    selOutline.clearLayers(); selOutline.addData(rec.feature);
    el('btn-clear-selection').disabled = false;
    var ll = lngLat || interiorLatLng(rec);
    if (zoom) {
      map3d.fitBounds(boundsArr(rec.layer.getBounds()), { padding: 90, maxZoom: 17, duration: 800 });
      map3d.once('moveend', function () { if (selected === rec) open3DPopup(rec, ll); });
    } else {
      open3DPopup(rec, ll);
    }
  }

  function setMode(m) {
    if (m === mode) return;
    var b2 = el('view-2d'), b3 = el('view-3d');
    if (m === '3d') {
      if (!bounds || !bounds.isValid()) return;
      if (!init3D()) return;
      var c = map.getCenter(), z = map.getZoom();
      el('map').hidden = true;
      el('map3d').hidden = false;
      map3d.resize();
      if (z <= map.getBoundsZoom(bounds) + 0.6) {
        map3d.fitBounds(boundsArr(bounds), { padding: 30, pitch: 58, bearing: -15, duration: 0 });
      } else {
        map3d.jumpTo({ center: [c.lng, c.lat], zoom: Math.max(z - 1, 1), pitch: 60, bearing: -15 });
      }
      mode = '3d';
      if (map3dReady) { apply3DBasemap(); set3DOpacity(); update3DStates(); set3DVisibility(el('toggle-zoning').checked); }
    } else {
      var cc = map3d.getCenter(), zz = map3d.getZoom();
      if (pop3d) pop3d.remove();
      if (tip3d) tip3d.remove();
      el('map3d').hidden = true;
      el('map').hidden = false;
      map.invalidateSize();
      map.setView([cc.lat, cc.lng], zz + 1, { animate: false });
      mode = '2d';
      hideHover();
      restyleAll();
    }
    updateSwapCard();
    b2.setAttribute('aria-pressed', String(mode === '2d'));
    b3.setAttribute('aria-pressed', String(mode === '3d'));
  }

  /* ---------- start ---------- */
  document.addEventListener('DOMContentLoaded', function () {
    if (typeof L === 'undefined') { showError('<b>The mapping library failed to load.</b> Check that <code>vendor/leaflet/</code> is present.'); return; }
    initMap();
    wireUi();
    loadData();
  });
})();
