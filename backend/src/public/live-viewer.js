// Bes Emergency Live View — first-party viewer script (no dependencies).
// The access token arrives in the URL fragment (/live#<token>), which is
// never sent to a server. It is moved to sessionStorage for this tab and
// removed from the address bar, then sent only in an Authorization header.
(function () {
  "use strict";

  var STORAGE_KEY = "bes-live-token";
  var ACTIVE_POLL_MS = 10000;
  var ENDED_POLL_MS = 60000;

  var token = null;
  var opened = false;
  var stopped = false;
  var state = null;
  var currentSequence = null;
  var followLatest = true;
  var lastMapQuery = null;

  function $(id) {
    return document.getElementById(id);
  }

  function readToken() {
    var hash = window.location.hash ? window.location.hash.slice(1) : "";
    try {
      if (hash) sessionStorage.setItem(STORAGE_KEY, hash);
      token = hash || sessionStorage.getItem(STORAGE_KEY);
    } catch (e) {
      token = hash || null;
    }
    if (hash && window.history && window.history.replaceState) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }

  function forgetToken() {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch (e) {}
    token = null;
  }

  function show(id, visible) {
    $(id).classList.toggle("hidden", !visible);
  }

  function setMessage(text) {
    var box = $("message");
    box.textContent = text || "";
    show("message", Boolean(text));
  }

  function formatTime(value) {
    var d = new Date(value);
    return isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
  }

  function ago(value) {
    var seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
    if (seconds < 60) return seconds + "s ago";
    var minutes = Math.round(seconds / 60);
    if (minutes < 60) return minutes + " min ago";
    return Math.round(minutes / 60) + " h ago";
  }

  function segmentBySequence(sequence) {
    if (!state) return null;
    for (var i = 0; i < state.segments.length; i++) {
      if (state.segments[i].sequence === sequence) return state.segments[i];
    }
    return null;
  }

  function play(segment, autoplay) {
    var player = $("player");
    currentSequence = segment.sequence;
    player.src = segment.mediaUrl;
    $("clip-label").textContent =
      "Clip " + segment.sequence + " · recorded " + formatTime(segment.startedAt) + (segment.facing ? " · " + segment.facing + " camera" : "");
    if (autoplay) {
      var attempt = player.play();
      if (attempt && attempt.catch) attempt.catch(function () {});
    }
    renderClipButtons();
  }

  function renderClipButtons() {
    var list = $("clips");
    while (list.firstChild) list.removeChild(list.firstChild);
    state.segments.forEach(function (segment) {
      var button = document.createElement("button");
      button.type = "button";
      button.textContent = "Clip " + segment.sequence + " · " + formatTime(segment.startedAt);
      if (segment.sequence === currentSequence) button.className = "current";
      button.addEventListener("click", function () {
        var latest = state.segments[state.segments.length - 1];
        followLatest = segment.sequence === latest.sequence;
        play(segment, true);
      });
      list.appendChild(button);
    });
  }

  function renderVideo() {
    var segments = state.segments;
    show("video-section", segments.length > 0);
    if (segments.length === 0) return;
    var latest = segments[segments.length - 1];
    var player = $("player");
    var idle = !currentSequence || player.ended || player.paused;
    if (followLatest && idle && latest.sequence !== currentSequence) {
      play(latest, Boolean(currentSequence));
    } else {
      renderClipButtons();
    }
  }

  function tracking() {
    return (state && state.tracking && state.tracking.state) || (state && state.status === "ended" ? "CLOSED" : "SOS_ACTIVE");
  }

  function duration(seconds) {
    var minutes = Math.round(seconds / 60);
    if (minutes < 60) return minutes + " min";
    return Math.floor(minutes / 60) + " h " + (minutes % 60) + " min";
  }

  // Never present an old fix as where the phone is now.
  function freshnessText(loc) {
    var f = state.route && state.route.freshness;
    var when = "updated " + ago(loc.recordedAt) + " (" + formatTime(loc.recordedAt) + ")";
    if (!f || f.status === "live") return "Live · " + when;
    if (f.status === "delayed") return "Updates delayed · last " + when;
    if (f.status === "stale") {
      return "No recent updates — last confirmed location " + ago(loc.recordedAt) + " (" + formatTime(loc.recordedAt) + "). The phone may have moved since.";
    }
    return "Final recorded location · " + formatTime(loc.recordedAt);
  }

  function renderLocation() {
    var loc = state.latestLocation;
    show("location-section", Boolean(loc));
    if (!loc) return;
    var lat = Number(loc.latitude).toFixed(5);
    var lng = Number(loc.longitude).toFixed(5);
    var f = state.route && state.route.freshness;
    $("location-heading").textContent = f && f.status === "live" ? "Current location" : "Last known location";
    $("location-text").textContent = lat + ", " + lng + " · " + freshnessText(loc);
    var details = [];
    if (loc.accuracy != null) details.push("GPS accuracy ±" + Math.round(loc.accuracy) + " m");
    if (state.route && state.route.batteryLevel != null) details.push("Battery " + state.route.batteryLevel + "%");
    $("location-details").textContent = details.join(" · ");
    var query = lat + "," + lng;
    $("maps-link").href = "https://maps.google.com/?q=" + encodeURIComponent(query);
    if (query !== lastMapQuery) {
      lastMapQuery = query;
      $("map").src = "https://maps.google.com/maps?q=" + encodeURIComponent(query) + "&z=16&output=embed";
    }
  }

  var SVG_NS = "http://www.w3.org/2000/svg";

  function svg(name, attrs) {
    var el = document.createElementNS(SVG_NS, name);
    for (var key in attrs) el.setAttribute(key, attrs[key]);
    return el;
  }

  // The route as a simple drawing (no map tiles): the trail, the start, the
  // stops (numbered) and the latest point. Each stop links to a map.
  function renderRoute() {
    var route = state.route;
    var points = (route && route.points) || [];
    show("route-section", points.length > 1);
    if (points.length < 2) return;
    var box = $("route");
    while (box.firstChild) box.removeChild(box.firstChild);
    var W = 600;
    var H = 320;
    var pad = 24;
    var minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    points.forEach(function (p) {
      minLat = Math.min(minLat, p[0]);
      maxLat = Math.max(maxLat, p[0]);
      minLng = Math.min(minLng, p[1]);
      maxLng = Math.max(maxLng, p[1]);
    });
    var midLat = (((minLat + maxLat) / 2) * Math.PI) / 180;
    var spanX = Math.max((maxLng - minLng) * Math.cos(midLat), 0.0005);
    var spanY = Math.max(maxLat - minLat, 0.0005);
    var scale = Math.min((W - 2 * pad) / spanX, (H - 2 * pad) / spanY);
    function xy(lat, lng) {
      var x = W / 2 + (lng - (minLng + maxLng) / 2) * Math.cos(midLat) * scale;
      var y = H / 2 - (lat - (minLat + maxLat) / 2) * scale;
      return [x.toFixed(1), y.toFixed(1)];
    }
    var root = svg("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "Route drawing" });
    root.appendChild(svg("rect", { x: 0, y: 0, width: W, height: H, rx: 12, fill: "#f4f5f8" }));
    root.appendChild(
      svg("polyline", {
        points: points.map(function (p) { return xy(p[0], p[1]).join(","); }).join(" "),
        fill: "none",
        stroke: "#ef445b",
        "stroke-width": 3,
        "stroke-linejoin": "round",
        "stroke-linecap": "round",
      }),
    );
    var first = xy(points[0][0], points[0][1]);
    root.appendChild(svg("circle", { cx: first[0], cy: first[1], r: 7, fill: "#2f9e44", stroke: "#fff", "stroke-width": 2 }));
    (route.stops || []).forEach(function (stop, i) {
      var c = xy(stop.latitude, stop.longitude);
      root.appendChild(svg("circle", { cx: c[0], cy: c[1], r: 10, fill: "#1c3d8f", stroke: "#fff", "stroke-width": 2 }));
      var label = svg("text", { x: c[0], y: Number(c[1]) + 4, "text-anchor": "middle", "font-size": 11, "font-weight": 700, fill: "#fff" });
      label.textContent = String(i + 1);
      root.appendChild(label);
    });
    var last = points[points.length - 1];
    var end = xy(last[0], last[1]);
    root.appendChild(svg("circle", { cx: end[0], cy: end[1], r: 8, fill: "#ef445b", stroke: "#fff", "stroke-width": 3 }));
    box.appendChild(root);
    $("route-legend").textContent =
      "Green: start (" + formatTime(points[0][2]) + ") · Red: latest point (" + formatTime(last[2]) + ") · Blue: stops";

    var list = $("stops");
    while (list.firstChild) list.removeChild(list.firstChild);
    (route.stops || []).forEach(function (stop, i) {
      var item = document.createElement("li");
      var stayed = stop.ongoing ? "still there (" + duration(stop.durationSeconds) + " so far)" : "stayed " + duration(stop.durationSeconds);
      item.appendChild(document.createTextNode("Stop " + (i + 1) + ": arrived " + formatTime(stop.arrivedAt) + " · " + stayed + " · "));
      var link = document.createElement("a");
      link.href = "https://maps.google.com/?q=" + encodeURIComponent(stop.latitude + "," + stop.longitude);
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "Open in Maps";
      item.appendChild(link);
      list.appendChild(item);
    });
    show("stops-empty", !route.stops || route.stops.length === 0);
  }

  function render() {
    var who = state.ownerName ? state.ownerName + "'s emergency" : "Bes emergency";
    $("title").textContent = who;
    document.title = who + " — Bes";
    var status = $("status");
    var ended = state.status === "ended";
    var recovering = tracking() === "RECOVERY_TRACKING";
    status.textContent = recovering ? "SOS ended · phone still being tracked" : ended ? "Emergency ended" : "Emergency active";
    status.className = "status " + (ended && !recovering ? "ended" : "active");
    $("started").textContent =
      "Started " + formatTime(state.startedAt) + (ended && state.endedAt ? " · ended " + formatTime(state.endedAt) : "");
    if (state.segments.length === 0 && !state.latestLocation) {
      setMessage(ended ? "No video or location was shared for this emergency." : "Waiting for the first video clip and location…");
    } else {
      setMessage(
        recovering
          ? "The SOS has ended, but this phone is still sharing its location until its owner marks it recovered."
          : ended
            ? "This emergency has ended. Recordings remain available until this link expires."
            : "",
      );
    }
    renderVideo();
    renderLocation();
    renderRoute();
    show("audio-section", Boolean(state.audioUrl));
    if (state.audioUrl && !$("audio").getAttribute("src")) $("audio").src = state.audioUrl;
  }

  function stop(text) {
    stopped = true;
    forgetToken();
    show("video-section", false);
    show("audio-section", false);
    show("location-section", false);
    show("route-section", false);
    show("status", false);
    $("player").removeAttribute("src");
    setMessage(text);
  }

  function poll() {
    if (stopped) return;
    var url = "/live/api/state" + (opened ? "" : "?open=1");
    fetch(url, {
      headers: { Authorization: "Bearer " + token },
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
    })
      .then(function (response) {
        if (response.status === 404) return stop("This link isn't valid. Check that you opened the full link you received.");
        if (response.status === 410) return stop("This live view link has expired or was turned off by the person who shared it.");
        if (!response.ok) throw new Error("status " + response.status);
        return response.json().then(function (data) {
          opened = true;
          state = data;
          show("status", true);
          render();
        });
      })
      .catch(function () {
        if (!state) setMessage("Can't reach Bes right now. Retrying…");
      })
      .then(function () {
        if (!stopped) setTimeout(poll, state && tracking() === "CLOSED" ? ENDED_POLL_MS : ACTIVE_POLL_MS);
      });
  }

  function start() {
    readToken();
    if (!token) {
      setMessage("Open the full live view link you received to see this emergency.");
      return;
    }
    $("player").addEventListener("ended", function () {
      // Continue to the next clip, if one has arrived.
      var next = segmentBySequence(currentSequence + 1);
      if (next) play(next, true);
    });
    poll();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
