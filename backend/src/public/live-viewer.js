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

  function renderLocation() {
    var loc = state.latestLocation;
    show("location-section", Boolean(loc));
    if (!loc) return;
    var lat = Number(loc.latitude).toFixed(5);
    var lng = Number(loc.longitude).toFixed(5);
    $("location-text").textContent = lat + ", " + lng + " · updated " + ago(loc.recordedAt) + " (" + formatTime(loc.recordedAt) + ")";
    var query = lat + "," + lng;
    $("maps-link").href = "https://maps.google.com/?q=" + encodeURIComponent(query);
    if (query !== lastMapQuery) {
      lastMapQuery = query;
      $("map").src = "https://maps.google.com/maps?q=" + encodeURIComponent(query) + "&z=16&output=embed";
    }
  }

  function render() {
    var who = state.ownerFirstName ? state.ownerFirstName + "'s emergency" : "Bes emergency";
    $("title").textContent = who;
    document.title = who + " — Bes";
    var status = $("status");
    var ended = state.status === "ended";
    status.textContent = ended ? "Emergency ended" : "Emergency active";
    status.className = "status " + (ended ? "ended" : "active");
    $("started").textContent =
      "Started " + formatTime(state.startedAt) + (ended && state.endedAt ? " · ended " + formatTime(state.endedAt) : "");
    if (state.segments.length === 0 && !state.latestLocation) {
      setMessage(ended ? "No video or location was shared for this emergency." : "Waiting for the first video clip and location…");
    } else {
      setMessage(ended ? "This emergency has ended. Recordings remain available until this link expires." : "");
    }
    renderVideo();
    renderLocation();
    show("audio-section", Boolean(state.audioUrl));
    if (state.audioUrl && !$("audio").getAttribute("src")) $("audio").src = state.audioUrl;
  }

  function stop(text) {
    stopped = true;
    forgetToken();
    show("video-section", false);
    show("audio-section", false);
    show("location-section", false);
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
        if (!stopped) setTimeout(poll, state && state.status === "ended" ? ENDED_POLL_MS : ACTIVE_POLL_MS);
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
