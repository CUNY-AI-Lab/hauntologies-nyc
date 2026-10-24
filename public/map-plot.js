'use strict';
// Plot a place: the pin beside search arms the map. The next click drops a spot, zooms to it
// and names it by its cross streets and neighbourhood (NYC GeoSearch); a second click on the
// spot confirms it and opens Contribute with that point and name filled in. A click elsewhere
// moves the spot; Esc or the pin again cancels.
(() => {
  const $ = id => document.getElementById(id);
  const button = $('plotPlaceButton');
  if (!button || typeof map === 'undefined' || !map || !window.L) return;
  const inBoroughs = (lat, lon) => !window.NycGeometry?.available || Boolean(window.NycGeometry.findBorough(lat, lon));
  const node = (tag, text, className) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; };
  let armed = false, spot = null, plotted = null, lookup = 0, statusBefore = '';

  function say(text) { const status = $('mapStatus'); if (status) status.textContent = text; }

  function arm(on) {
    armed = on;
    button.setAttribute('aria-pressed', String(on));
    document.body.classList.toggle('map-plotting', on);
    if (on) { statusBefore = $('mapStatus')?.textContent || ''; say('Click the map to plot a place. Press Esc to cancel.'); }
    else { clearSpot(); say(statusBefore); }
  }

  function clearSpot() { lookup++; spot?.remove(); spot = null; plotted = null; }

  function card(point) {
    const root = node('div', undefined, 'plot-confirm');
    const title = node('strong', point.near || (point.busy ? 'Finding the cross streets…' : 'This spot'));
    root.append(title);
    if (point.area) root.append(node('p', point.area));
    root.append(node('p', point.outside ? 'New places must be in New York City. Click inside the five boroughs.' : 'Click the spot again to use it, or click elsewhere to move it.', 'small'));
    const actions = node('div', undefined, 'plot-confirm-actions');
    if (!point.outside) { const use = node('button', 'Use this place', 'primary'); use.type = 'button'; use.addEventListener('click', confirm); actions.append(use); }
    const cancel = node('button', 'Cancel', 'outline'); cancel.type = 'button'; cancel.addEventListener('click', () => arm(false));
    actions.append(cancel); root.append(actions);
    return root;
  }

  function show() {
    if (!spot || !plotted) return;
    spot.setPopupContent(card(plotted));
    if (!spot.isPopupOpen()) spot.openPopup();
  }

  async function plot(latlng) {
    const latitude = Number(latlng.lat.toFixed(6)), longitude = Number(latlng.lng.toFixed(6));
    clearSpot();
    plotted = {latitude, longitude, busy: true, outside: !inBoroughs(latitude, longitude)};
    spot = L.marker([latitude, longitude], {pane: 'researchPoints', zIndexOffset: 900, keyboard: true, title: 'Plotted place. Select again to use it.',
      icon: L.divIcon({className: 'plot-spot', html: '<span aria-hidden="true">+</span>', iconSize: [30, 30], iconAnchor: [15, 15]})});
    spot.bindPopup('', {maxWidth: 280, autoPanPadding: [24, 90]});
    spot.on('click', event => { L.DomEvent.stop(event); if (plotted && !plotted.outside) confirm(); });
    spot.addTo(map);
    map.setView([latitude, longitude], Math.max(map.getZoom(), 17), {animate: false});
    show();
    if (plotted.outside) return;
    const version = ++lookup;
    let vicinity = null;
    try { vicinity = await window.PlaceSearch?.describe?.(latitude, longitude); } catch {}
    if (version !== lookup) return;
    const borough = window.NycGeometry?.findBorough?.(latitude, longitude);
    plotted = {...plotted, busy: false, near: vicinity?.near || '', area: vicinity?.area || borough || ''};
    show();
    say('Click the spot again to use it.');
  }

  function confirm() {
    if (!plotted || plotted.outside) return;
    const {latitude, longitude} = plotted;
    const name = [plotted.near, plotted.area].filter(Boolean).join(', ') || `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
    arm(false);
    $('submitTool').click();
    window.dispatchEvent(new CustomEvent('contributions-plot-confirmed', {detail: {latitude, longitude, name}}));
  }

  button.addEventListener('click', () => arm(!armed));
  map.on('click', event => {
    if (!armed) return;
    if (typeof emptyMapTarget === 'function' && !emptyMapTarget(event.originalEvent?.target)) return;
    L.DomEvent.stop(event.originalEvent);
    plot(event.latlng);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && armed && !event.defaultPrevented) { event.preventDefault(); arm(false); button.focus({preventScroll: true}); }
  });
})();
