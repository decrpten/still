import {
  $,
  $$,
  clamp,
  formatDurationLong,
  formatTime,
  icon,
  padNumber,
  plural,
  prefersReducedMotion,
  readJSON,
  writeJSON,
} from "./core.js";
import {
  fetchPlaylist,
  fetchSingleVideo,
  humanizeApiError,
  isKeyError,
  parseYouTubeInput,
} from "./api.js";
import { YouTubePlayer } from "./player.js";

const STORAGE = {
  apiKey: "still.apiKey.v1",
  settings: "still.settings.v1",
  library: "still.library.v1",
  progress: "still.progress.v1",
};

const DEFAULT_SETTINGS = {
  autoplay: true,
  resume: true,
  volume: 70,
  speed: 1,
};

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const PAGE_TITLE = "still. — a quieter way to study with YouTube";

function normalizeSettings(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    autoplay: source.autoplay !== false,
    resume: source.resume !== false,
    volume: clamp(Number(source.volume) || DEFAULT_SETTINGS.volume, 0, 100),
    speed: SPEEDS.includes(Number(source.speed)) ? Number(source.speed) : 1,
  };
}

function normalizeLibrary(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((entry) => entry && typeof entry.id === "string" && typeof entry.title === "string");
}

function normalizeProgress(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
}

function readApiKey() {
  try {
    return localStorage.getItem(STORAGE.apiKey) || "";
  } catch {
    return "";
  }
}

const state = {
  apiKey: readApiKey(),
  settings: normalizeSettings(readJSON(STORAGE.settings, {})),
  library: normalizeLibrary(readJSON(STORAGE.library, [])),
  progress: normalizeProgress(readJSON(STORAGE.progress, {})),
  playlist: null,
  currentIndex: -1,
  route: "landing",
  focusMode: false,
  player: null,
  playerCreating: false,
  playerReady: false,
  playerError: false,
  pendingSeek: null,
  pendingPlay: false,
  pendingLoad: null,
  isPlaying: false,
  isBuffering: false,
  isSeeking: false,
  hasStarted: false,
  currentSpeed: 1,
  muted: false,
  lastVolume: 70,
  tickTimer: null,
  lastSavedAt: 0,
  toastTimer: null,
  controlsTimer: null,
  endTimer: null,
  loadController: null,
  loadToken: 0,
  pendingRoute: "",
  searchQuery: "",
  speedMenuOpen: false,
};

state.currentSpeed = state.settings.speed;
state.lastVolume = state.settings.volume || 70;

const dom = {
  landingView: $("#landingView"),
  startForm: $("#startForm"),
  playlistInput: $("#playlistInput"),
  apiKeyInput: $("#apiKeyInput"),
  showKeyBtn: $("#showKeyBtn"),
  saveKeyBtn: $("#saveKeyBtn"),
  keySetup: $("#keySetup"),
  keySaved: $("#keySaved"),
  changeKeyBtn: $("#changeKeyBtn"),
  startError: $("#startError"),
  savedSection: $("#savedSection"),
  savedGrid: $("#savedGrid"),
  viewAllBtn: $("#viewAllBtn"),
  landingLibraryBtn: $("#landingLibraryBtn"),
  landingSettingsBtn: $("#landingSettingsBtn"),

  loadingView: $("#loadingView"),
  loadingTitle: $("#loadingTitle"),
  loadingDetail: $("#loadingDetail"),

  appView: $("#appView"),
  headerPlaylistTitle: $("#headerPlaylistTitle"),
  headerPlaylistMeta: $("#headerPlaylistMeta"),
  workspace: $("#workspace"),
  playerFrame: $("#playerFrame"),
  ytPlayer: $("#ytPlayer"),
  playerPoster: $("#playerPoster"),
  posterImage: $("#posterImage"),
  posterLabel: $("#posterLabel"),
  posterTitle: $("#posterTitle"),
  posterMeta: $("#posterMeta"),
  posterPlay: $("#posterPlay"),
  posterPlayLabel: $("#posterPlayLabel"),
  playerLoading: $("#playerLoading"),
  playerError: $("#playerError"),
  playerErrorTitle: $("#playerErrorTitle"),
  playerErrorText: $("#playerErrorText"),
  playerErrorLink: $("#playerErrorLink"),
  endCard: $("#endCard"),
  endcardKicker: $("#endcardKicker"),
  endcardTitle: $("#endcardTitle"),
  endcardText: $("#endcardText"),
  endcardPrimary: $("#endcardPrimary"),
  endcardSecondary: $("#endcardSecondary"),
  currentTime: $("#currentTime"),
  duration: $("#duration"),
  seekBar: $("#seekBar"),
  prevBtn: $("#prevBtn"),
  playBtn: $("#playBtn"),
  nextBtn: $("#nextBtn"),
  muteBtn: $("#muteBtn"),
  volumeBar: $("#volumeBar"),
  speedBtn: $("#speedBtn"),
  speedMenu: $("#speedMenu"),
  fullscreenBtn: $("#fullscreenBtn"),
  markWatchedBtn: $("#markWatchedBtn"),
  markWatchedLabel: $("#markWatchedLabel"),
  focusBtn: $("#focusBtn"),
  panelCloseBtn: $("#panelCloseBtn"),
  videoKicker: $("#videoKicker"),
  videoTitle: $("#videoTitle"),
  videoChannel: $("#videoChannel"),
  videoDuration: $("#videoDuration"),
  videoWatchedStatus: $("#videoWatchedStatus"),
  playlistTitle: $("#playlistTitle"),
  playlistChannel: $("#playlistChannel"),
  progressText: $("#progressText"),
  progressRemaining: $("#progressRemaining"),
  progressTrack: $("#progressTrack"),
  progressFill: $("#progressFill"),
  playlistSearch: $("#playlistSearch"),
  clearSearchBtn: $("#clearSearchBtn"),
  playlistScroll: $("#playlistScroll"),
  playlistItems: $("#playlistItems"),
  playlistNoResults: $("#playlistNoResults"),
  resetSearchBtn: $("#resetSearchBtn"),
  newPlaylistBtn: $("#newPlaylistBtn"),
  libraryBtn: $("#libraryBtn"),
  settingsBtn: $("#settingsBtn"),

  loadDialog: $("#loadDialog"),
  loadForm: $("#loadForm"),
  loadInput: $("#loadInput"),
  loadError: $("#loadError"),
  libraryDialog: $("#libraryDialog"),
  libraryList: $("#libraryList"),
  libraryEmpty: $("#libraryEmpty"),
  libraryOpenBtn: $("#libraryOpenBtn"),
  settingsDialog: $("#settingsDialog"),
  settingsForm: $("#settingsForm"),
  autoplayToggle: $("#autoplayToggle"),
  resumeToggle: $("#resumeToggle"),
  settingsKeyInput: $("#settingsKeyInput"),
  settingsShowKeyBtn: $("#settingsShowKeyBtn"),
  saveSettingsKeyBtn: $("#saveSettingsKeyBtn"),
  settingsKeyError: $("#settingsKeyError"),
  clearProgressBtn: $("#clearProgressBtn"),
  removeKeyBtn: $("#removeKeyBtn"),

  toast: $("#toast"),
};

/* --------------------------------------------------------------------------
   Persistence
   -------------------------------------------------------------------------- */

function saveSettings() {
  writeJSON(STORAGE.settings, state.settings);
}

function saveLibrary() {
  writeJSON(STORAGE.library, state.library);
}

function saveProgressStore() {
  const entries = Object.entries(state.progress);
  if (entries.length > 900) {
    const trimmed = entries
      .sort(([, a], [, b]) => (b?.updatedAt || 0) - (a?.updatedAt || 0))
      .slice(0, 600);
    state.progress = Object.fromEntries(trimmed);
  }
  writeJSON(STORAGE.progress, state.progress);
}

function getProgress(videoId) {
  const value = state.progress[videoId];
  return value && typeof value === "object" ? value : null;
}

function isCompleted(videoId) {
  return Boolean(getProgress(videoId)?.completed);
}

function getCurrentItem() {
  return state.playlist?.items?.[state.currentIndex] || null;
}

function syncLibraryProgress() {
  const playlist = state.playlist;
  if (!playlist || playlist.kind === "single") return;
  const entry = state.library.find((item) => item.id === playlist.id);
  if (!entry) return;
  entry.watchedCount = playlist.items.filter((item) => isCompleted(item.videoId)).length;
  entry.count = playlist.count;
  entry.lastVideoId = getCurrentItem()?.videoId || entry.lastVideoId || "";
  saveLibrary();
}

/* --------------------------------------------------------------------------
   Small UI helpers
   -------------------------------------------------------------------------- */

function showToast(message, duration = 2800) {
  if (!message) return;
  window.clearTimeout(state.toastTimer);
  dom.toast.textContent = message;
  dom.toast.classList.add("is-visible");
  state.toastTimer = window.setTimeout(() => {
    dom.toast.classList.remove("is-visible");
  }, duration);
}

function setError(element, message) {
  if (!element) return;
  element.textContent = message || "";
  element.hidden = !message;
}

function showStartError(message) {
  setError(dom.startError, message);
}

function showLoadingView(title = "Loading playlist", detail = "Talking to YouTube…") {
  state.route = "loading";
  closeAllDialogs();
  dom.landingView.hidden = true;
  dom.appView.hidden = true;
  dom.loadingView.hidden = false;
  dom.loadingTitle.textContent = title;
  dom.loadingDetail.textContent = detail;
  document.title = "Loading… — still.";
  window.scrollTo({ top: 0, behavior: "instant" });
}

function setLoadingDetail(detail) {
  dom.loadingDetail.textContent = detail;
}

function closeAllDialogs() {
  for (const dialog of $$("dialog[open]")) {
    dialog.close();
  }
}

function openDialog(dialog) {
  if (!dialog) return;
  if (!dialog.open) dialog.showModal();
}

function closeDialog(dialog) {
  if (dialog?.open) dialog.close();
}

function setToggleIcon(button, shown) {
  const use = button?.querySelector("use");
  if (use) use.setAttribute("href", shown ? "#i-eye-off" : "#i-eye");
  if (button) {
    button.setAttribute("aria-label", shown ? "Hide API key" : "Show API key");
    button.setAttribute("title", shown ? "Hide API key" : "Show API key");
  }
}

function togglePasswordVisibility(input, button) {
  if (!input) return;
  const show = input.type === "password";
  input.type = show ? "text" : "password";
  setToggleIcon(button, show);
}

function applyFocusMode() {
  dom.workspace.classList.toggle("focus-mode", state.focusMode);
  dom.focusBtn.classList.toggle("is-active", state.focusMode);
  const label = dom.focusBtn.querySelector("span");
  if (label) label.textContent = state.focusMode ? "Exit focus" : "Focus mode";
  dom.focusBtn.setAttribute("aria-pressed", String(state.focusMode));
}

function toggleFocusMode() {
  state.focusMode = !state.focusMode;
  applyFocusMode();
  showToast(state.focusMode ? "Focus mode on — just the video." : "Playlist restored.");
}

function setHashForCurrent() {
  if (state.route !== "app" || !state.playlist) return;
  const item = getCurrentItem();
  if (!item) return;
  let hash = "";
  if (state.playlist.kind === "single") {
    hash = `#video=${encodeURIComponent(item.videoId)}`;
  } else {
    const params = new URLSearchParams({ list: state.playlist.id });
    params.set("v", item.videoId);
    hash = `#${params.toString()}`;
  }
  const next = `${window.location.pathname}${window.location.search}${hash}`;
  window.history.replaceState(null, "", next);
}

function clearHash() {
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
}

function parseHashRoute() {
  const raw = window.location.hash.replace(/^#/, "");
  if (!raw) return null;
  const params = new URLSearchParams(raw);
  const list = params.get("list");
  const video = params.get("video") || params.get("v");
  if (!list && !video) return null;
  return { list, video };
}

function setPageTitle(title) {
  document.title = title ? `${title} — still.` : PAGE_TITLE;
}

/* --------------------------------------------------------------------------
   Volume / playback controls
   -------------------------------------------------------------------------- */

function updateVolumeUi() {
  const volume = state.muted ? 0 : clamp(state.settings.volume, 0, 100);
  dom.volumeBar.value = String(volume);
  dom.volumeBar.style.setProperty("--fill", `${volume}%`);
  const use = dom.muteBtn.querySelector("use");
  if (use) use.setAttribute("href", volume === 0 ? "#i-volume-x" : "#i-volume");
  dom.muteBtn.setAttribute("aria-label", volume === 0 ? "Unmute" : "Mute");
  dom.muteBtn.setAttribute("title", volume === 0 ? "Unmute (M)" : "Mute (M)");
}

function applyVolume(value, { save = true } = {}) {
  const volume = clamp(Math.round(Number(value) || 0), 0, 100);
  if (volume > 0) {
    state.lastVolume = volume;
    state.settings.volume = volume;
    state.muted = false;
  } else {
    state.muted = true;
  }
  state.player?.setVolume(volume);
  if (volume > 0) state.player?.unmute();
  else state.player?.mute();
  updateVolumeUi();
  if (save) saveSettings();
}

function toggleMute() {
  if (state.muted || state.settings.volume === 0) {
    const restore = state.lastVolume || 70;
    state.settings.volume = restore;
    state.muted = false;
    state.player?.setVolume(restore);
    state.player?.unmute();
  } else {
    state.lastVolume = state.settings.volume;
    state.muted = true;
    state.player?.mute();
  }
  updateVolumeUi();
  saveSettings();
  showToast(state.muted ? "Muted" : "Sound on", 1400);
}

function updatePlayButton() {
  const use = dom.playBtn.querySelector("use");
  if (use) use.setAttribute("href", state.isPlaying ? "#i-pause" : "#i-play");
  dom.playBtn.setAttribute("aria-label", state.isPlaying ? "Pause" : "Play");
}

function updateSpeedUi() {
  dom.speedBtn.textContent = `${state.currentSpeed}×`;
  for (const button of $$("[data-speed]", dom.speedMenu)) {
    button.setAttribute("aria-checked", String(Number(button.dataset.speed) === state.currentSpeed));
  }
}

function setPlaybackRate(rate) {
  const value = Number(rate);
  if (!SPEEDS.includes(value)) return;
  state.currentSpeed = value;
  state.settings.speed = value;
  state.player?.setPlaybackRate(value);
  updateSpeedUi();
  saveSettings();
  hideSpeedMenu();
  showToast(`Playback speed ${value}×`, 1400);
}

function hideSpeedMenu() {
  state.speedMenuOpen = false;
  dom.speedMenu.hidden = true;
  dom.speedBtn.setAttribute("aria-expanded", "false");
}

function showSpeedMenu() {
  state.speedMenuOpen = true;
  updateSpeedUi();
  dom.speedMenu.hidden = false;
  dom.speedBtn.setAttribute("aria-expanded", "true");
}

function toggleSpeedMenu() {
  if (state.speedMenuOpen) hideSpeedMenu();
  else showSpeedMenu();
}

function toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen?.().catch(() => {});
    return;
  }
  dom.playerFrame.requestFullscreen?.().catch(() => {
    showToast("Fullscreen isn't available in this browser.", 2600);
  });
}

function updateFullscreenUi() {
  const fullscreen = Boolean(document.fullscreenElement);
  const use = dom.fullscreenBtn.querySelector("use");
  if (use) use.setAttribute("href", fullscreen ? "#i-compress" : "#i-expand");
  dom.fullscreenBtn.setAttribute("aria-label", fullscreen ? "Exit fullscreen" : "Fullscreen");
  dom.fullscreenBtn.setAttribute("title", fullscreen ? "Exit fullscreen (F)" : "Fullscreen (F)");
}

function showControlsTemporarily() {
  dom.playerFrame.classList.add("controls-visible");
  window.clearTimeout(state.controlsTimer);
  if (state.isPlaying) {
    state.controlsTimer = window.setTimeout(() => {
      dom.playerFrame.classList.remove("controls-visible");
    }, 2600);
  }
}

function showControls() {
  dom.playerFrame.classList.add("controls-visible");
  window.clearTimeout(state.controlsTimer);
}

/* --------------------------------------------------------------------------
   Progress + playlist rendering
   -------------------------------------------------------------------------- */

function updateSeekUi(current, duration) {
  const live = Boolean(getCurrentItem()?.live);
  if (live || !Number.isFinite(duration) || duration <= 0) {
    dom.seekBar.disabled = true;
    dom.seekBar.value = "0";
    dom.seekBar.style.setProperty("--fill", "0%");
    dom.currentTime.textContent = live ? "LIVE" : "0:00";
    dom.duration.textContent = live ? "LIVE" : "0:00";
    return;
  }

  dom.seekBar.disabled = false;
  if (Math.abs(Number(dom.seekBar.max) - duration) > 0.4) {
    dom.seekBar.max = String(duration);
  }
  if (!state.isSeeking) {
    dom.seekBar.value = String(clamp(current, 0, duration));
  }
  const visual = state.isSeeking ? Number(dom.seekBar.value) : current;
  const percent = clamp((visual / duration) * 100, 0, 100);
  dom.seekBar.style.setProperty("--fill", `${percent}%`);
  dom.currentTime.textContent = formatTime(visual);
  dom.duration.textContent = formatTime(duration);
}

function updateProgressSummary() {
  const playlist = state.playlist;
  if (!playlist) return;
  const total = playlist.items.length;
  let watched = 0;
  let remainingSeconds = 0;

  for (const item of playlist.items) {
    const progress = getProgress(item.videoId);
    if (progress?.completed) {
      watched += 1;
    } else {
      const watchedSeconds = clamp(Number(progress?.position) || 0, 0, item.duration || 0);
      remainingSeconds += Math.max(0, (item.duration || 0) - watchedSeconds);
    }
  }

  const percent = total > 0 ? (watched / total) * 100 : 0;
  dom.progressText.textContent = `${watched} of ${total} watched`;
  dom.progressRemaining.textContent =
    total === 0
      ? ""
      : watched === total
        ? "Course complete"
        : remainingSeconds > 0
          ? `${formatDurationLong(remainingSeconds)} left`
          : "In progress";
  dom.progressFill.style.width = `${percent}%`;
  dom.progressTrack.setAttribute("aria-valuenow", String(Math.round(percent)));

  const entry = state.library.find((item) => item.id === playlist.id);
  if (entry) {
    entry.watchedCount = watched;
    entry.count = total;
    saveLibrary();
  }
}

function renderPlaylistItem(item, index) {
  const li = document.createElement("li");
  li.className = "playlist-item";
  li.dataset.index = String(index);
  li.dataset.videoId = item.videoId;
  if (index === state.currentIndex) li.classList.add("is-active");
  if (isCompleted(item.videoId)) li.classList.add("is-watched");

  const button = document.createElement("button");
  button.type = "button";
  button.className = "playlist-item-btn";
  button.dataset.index = String(index);
  button.setAttribute("aria-label", `${index + 1}. ${item.title}`);
  if (index === state.currentIndex) button.setAttribute("aria-current", "true");

  const indexEl = document.createElement("span");
  indexEl.className = "item-index";
  indexEl.append(isCompleted(item.videoId) ? icon("check") : document.createTextNode(padNumber(index + 1)));

  const thumb = document.createElement("span");
  thumb.className = "item-thumb";
  if (item.thumbnail) {
    const img = document.createElement("img");
    img.src = item.thumbnail;
    img.alt = "";
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    thumb.append(img);
  }
  const duration = document.createElement("span");
  duration.className = "item-duration";
  duration.textContent = item.live ? "LIVE" : item.duration > 0 ? formatTime(item.duration) : "—";
  thumb.append(duration);

  const copy = document.createElement("span");
  copy.className = "item-copy";
  const title = document.createElement("span");
  title.className = "item-title";
  title.textContent = item.title;
  const channel = document.createElement("span");
  channel.className = "item-channel";
  channel.textContent = item.channel || "";
  copy.append(title, channel);

  button.append(indexEl, thumb, copy);
  li.append(button);
  return li;
}

function renderPlaylist() {
  const playlist = state.playlist;
  dom.playlistItems.replaceChildren();
  if (!playlist) return;

  const fragment = document.createDocumentFragment();
  playlist.items.forEach((item, index) => {
    fragment.append(renderPlaylistItem(item, index));
  });
  dom.playlistItems.append(fragment);

  dom.playlistTitle.textContent = playlist.title;
  dom.playlistChannel.textContent =
    playlist.kind === "single"
      ? playlist.channel || "One video"
      : `${playlist.channel || "YouTube"} · ${playlist.count} ${plural(playlist.count, "lesson")}`;

  updateProgressSummary();
  applyPlaylistSearch();
  updatePlaylistActive({ scroll: false });
}

function updatePlaylistWatchedStates() {
  const items = state.playlist?.items || [];
  for (const li of $$(".playlist-item", dom.playlistItems)) {
    const index = Number(li.dataset.index);
    const item = items[index];
    if (!item) continue;
    const watched = isCompleted(item.videoId);
    li.classList.toggle("is-watched", watched);
    const indexEl = li.querySelector(".item-index");
    if (indexEl) {
      indexEl.replaceChildren(watched ? icon("check") : document.createTextNode(padNumber(index + 1)));
    }
  }
  updateProgressSummary();
  updateVideoMeta();
}

function updatePlaylistActive({ scroll = true } = {}) {
  for (const li of $$(".playlist-item", dom.playlistItems)) {
    const active = Number(li.dataset.index) === state.currentIndex;
    li.classList.toggle("is-active", active);
    const button = li.querySelector(".playlist-item-btn");
    if (active) button?.setAttribute("aria-current", "true");
    else button?.removeAttribute("aria-current");
  }

  if (!scroll) return;
  const active = dom.playlistItems.querySelector(".playlist-item.is-active");
  active?.scrollIntoView({
    block: "nearest",
    behavior: prefersReducedMotion() ? "auto" : "smooth",
  });
}

function applyPlaylistSearch() {
  const query = state.searchQuery.trim().toLowerCase();
  let visible = 0;

  for (const li of $$(".playlist-item", dom.playlistItems)) {
    const item = state.playlist?.items[Number(li.dataset.index)];
    if (!item) continue;
    const match = !query || `${item.title} ${item.channel}`.toLowerCase().includes(query);
    li.hidden = !match;
    if (match) visible += 1;
  }

  dom.clearSearchBtn.hidden = !query;
  dom.playlistNoResults.hidden = visible > 0 || !query;
  dom.playlistScroll.classList.toggle("is-empty", visible === 0);
}

function updateVideoMeta() {
  const item = getCurrentItem();
  const playlist = state.playlist;
  if (!item || !playlist) return;

  dom.videoKicker.textContent =
    playlist.kind === "single"
      ? "Single video"
      : `Lesson ${state.currentIndex + 1} of ${playlist.items.length}`;
  dom.videoTitle.textContent = item.title;
  dom.videoChannel.textContent = item.channel || "";
  dom.videoDuration.textContent = item.live ? "Live" : item.duration > 0 ? formatDurationLong(item.duration) : "";
  dom.videoDuration.hidden = !dom.videoDuration.textContent;

  const progress = getProgress(item.videoId);
  const completed = Boolean(progress?.completed);
  dom.videoWatchedStatus.textContent = completed
    ? "Watched"
    : progress?.position > 5
      ? "In progress"
      : "Not started";
  dom.markWatchedLabel.textContent = completed ? "Watched" : "Mark watched";
  dom.markWatchedBtn.classList.toggle("is-complete", completed);
  dom.markWatchedBtn.setAttribute("aria-pressed", String(completed));

  dom.prevBtn.disabled = state.currentIndex <= 0;
  dom.nextBtn.disabled = state.currentIndex >= playlist.items.length - 1;
}

/* --------------------------------------------------------------------------
   Poster / end card / error overlays
   -------------------------------------------------------------------------- */

function resumePositionFor(item) {
  if (!state.settings.resume || !item || item.live) return 0;
  const progress = getProgress(item.videoId);
  if (!progress || progress.completed) return 0;
  const position = Number(progress.position) || 0;
  const duration = Number(progress.duration) || item.duration || 0;
  if (position < 10) return 0;
  if (duration > 0 && duration - position < 8) return 0;
  return Math.floor(position);
}

function showPoster() {
  const item = getCurrentItem();
  if (!item) return;
  const playlist = state.playlist;
  const resumeAt = resumePositionFor(item);
  const completed = isCompleted(item.videoId);

  dom.playerPoster.hidden = false;
  dom.posterImage.hidden = !item.thumbnail;
  if (item.thumbnail) dom.posterImage.src = item.thumbnail;
  dom.posterImage.alt = "";

  dom.posterLabel.textContent =
    playlist.kind === "single"
      ? "Single video"
      : `Lesson ${state.currentIndex + 1} of ${playlist.items.length}`;
  dom.posterTitle.textContent = item.title;
  dom.posterMeta.textContent = [
    item.channel,
    item.live ? "Live" : item.duration > 0 ? formatDurationLong(item.duration) : "",
    resumeAt > 0 ? `Resume at ${formatTime(resumeAt)}` : completed ? "Watched" : "",
  ]
    .filter(Boolean)
    .join(" · ");

  dom.posterPlayLabel.textContent =
    resumeAt > 0
      ? `Resume at ${formatTime(resumeAt)}`
      : completed
        ? "Replay"
        : playlist.kind === "single"
          ? "Play video"
          : "Play lesson";

  dom.endCard.hidden = true;
  dom.playerError.hidden = true;
  dom.playerLoading.hidden = true;
  dom.playerFrame.classList.remove("is-playing");
  showControls();
}

function hidePoster() {
  dom.playerPoster.hidden = true;
}

function showPlayerError(title, text, videoId) {
  state.playerError = true;
  state.isPlaying = false;
  stopTicker();
  dom.playerFrame.classList.remove("is-playing");
  dom.playerLoading.hidden = true;
  dom.playerErrorTitle.textContent = title;
  dom.playerErrorText.textContent = text;
  dom.playerErrorLink.href = videoId
    ? `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`
    : "https://www.youtube.com";
  dom.playerError.hidden = false;
  dom.endCard.hidden = true;
  updatePlayButton();
}

function hidePlayerError() {
  state.playerError = false;
  dom.playerError.hidden = true;
}

function showEndCard() {
  const playlist = state.playlist;
  const item = getCurrentItem();
  if (!playlist || !item) return;
  const next = playlist.items[state.currentIndex + 1];
  const isSingle = playlist.kind === "single";

  state.isPlaying = false;
  dom.playerFrame.classList.remove("is-playing");
  dom.playerLoading.hidden = true;
  dom.endCard.hidden = false;
  dom.endcardKicker.textContent = next ? "Lesson complete" : isSingle ? "Video complete" : "Course complete";
  dom.endcardTitle.textContent = next ? "Ready for the next one." : isSingle ? "Video complete." : "Course complete.";
  dom.endcardText.textContent = next
    ? `Up next: ${next.title}`
    : isSingle
      ? "You made it to the end."
      : `You reached the end of ${playlist.title}.`;

  dom.endcardPrimary.textContent = next ? "Play next" : isSingle ? "Replay video" : "Replay playlist";
  dom.endcardPrimary.onclick = () => {
    if (next) selectVideo(state.currentIndex + 1, { play: true });
    else selectVideo(0, { play: true });
  };

  dom.endcardSecondary.hidden = !next;
  dom.endcardSecondary.textContent = "Replay lesson";
  dom.endcardSecondary.onclick = () => restartCurrentVideo();

  showControls();
}
/* --------------------------------------------------------------------------
   Progress persistence + ticker
   -------------------------------------------------------------------------- */

function saveCurrentProgress({ force = false } = {}) {
  const item = getCurrentItem();
  if (!item || !state.playerReady || item.live) return;

  const duration = state.player.getDuration() || item.duration || 0;
  const position = state.player.getCurrentTime() || 0;
  if (duration <= 0) return;
  if (!force && position < 1) return;

  const existing = getProgress(item.videoId) || {};
  const completed = Boolean(existing.completed) || position / duration >= 0.97;
  state.progress[item.videoId] = {
    ...existing,
    position: clamp(position, 0, duration),
    duration,
    completed,
    updatedAt: Date.now(),
  };
  state.lastSavedAt = Date.now();
  saveProgressStore();
}

function markWatched(videoId, completed, { silent = false } = {}) {
  const item = state.playlist?.items.find((entry) => entry.videoId === videoId);
  const existing = getProgress(videoId) || {};
  const duration = Number(existing.duration) || Number(item?.duration) || 0;

  state.progress[videoId] = {
    ...existing,
    position: completed ? duration || Number(existing.position) || 0 : 0,
    duration,
    completed: Boolean(completed),
    updatedAt: Date.now(),
  };
  saveProgressStore();
  updatePlaylistWatchedStates();
  syncLibraryProgress();
  if (!silent) {
    showToast(completed ? "Marked watched." : "Marked unwatched.", 1600);
  }
}

function toggleWatchedCurrent() {
  const item = getCurrentItem();
  if (!item) return;
  markWatched(item.videoId, !isCompleted(item.videoId));
}

function startTicker() {
  stopTicker();
  state.tickTimer = window.setInterval(tickProgress, 250);
}

function stopTicker() {
  if (state.tickTimer) {
    window.clearInterval(state.tickTimer);
    state.tickTimer = null;
  }
}

function tickProgress() {
  if (!state.playerReady || !state.player) return;
  const item = getCurrentItem();
  if (!item) return;

  const duration = state.player.getDuration() || item.duration || 0;
  const current = state.player.getCurrentTime() || 0;
  updateSeekUi(current, duration);

  if (duration > 0 && current > 5) {
    const progress = getProgress(item.videoId);
    if (!progress?.completed && current / duration >= 0.97 && duration > 30) {
      markWatched(item.videoId, true, { silent: true });
    } else if (!progress?.completed && dom.videoWatchedStatus.textContent === "Not started") {
      updateVideoMeta();
    }
  }

  if (state.isPlaying && Date.now() - state.lastSavedAt > 5000) {
    saveCurrentProgress();
  }
}

/* --------------------------------------------------------------------------
   Player integration
   -------------------------------------------------------------------------- */

function setPlayerLoading(message = "Loading player…") {
  const label = dom.playerLoading.querySelector("span:last-child");
  if (label) label.textContent = message;
  dom.playerLoading.hidden = false;
}

function hidePlayerLoading() {
  dom.playerLoading.hidden = true;
}

function ensurePlayer() {
  if (state.player || state.playerCreating) return;
  const item = getCurrentItem();
  if (!item) return;

  state.playerCreating = true;
  const startSeconds = state.pendingSeek || 0;

  const player = new YouTubePlayer({
    container: dom.ytPlayer,
    onReady: handlePlayerReady,
    onStateChange: handlePlayerStateChange,
    onError: handlePlayerError,
    onApiError: () => {},
  });
  state.player = player;

  player.create(item.videoId, { startSeconds }).catch((error) => {
    state.player = null;
    state.playerCreating = false;
    state.playerReady = false;
    hidePlayerLoading();
    showToast(
      error?.message
        ? "Couldn't load the YouTube player. Check your connection and browser blockers."
        : "Couldn't load the YouTube player.",
      4200,
    );
  });
}

function handlePlayerReady(player) {
  state.playerCreating = false;
  state.playerReady = true;
  player.setVolume(state.settings.volume);
  if (state.muted) player.mute();
  else player.unmute();
  player.setPlaybackRate(state.currentSpeed);

  if (state.pendingSeek != null) {
    player.seekTo(state.pendingSeek);
    state.pendingSeek = null;
  }

  if (state.pendingLoad) {
    const load = state.pendingLoad;
    state.pendingLoad = null;
    state.pendingPlay = false;
    applyPlayerLoad(load);
  } else if (state.pendingPlay) {
    state.pendingPlay = false;
    state.hasStarted = true;
    hidePoster();
    hidePlayerLoading();
    player.play();
    showControlsTemporarily();
  } else {
    hidePlayerLoading();
  }

  updatePlayButton();
  updateVolumeUi();
}

function handlePlayerStateChange(playerState) {
  switch (playerState) {
    case 1: // playing
      state.isPlaying = true;
      state.isBuffering = false;
      state.hasStarted = true;
      hidePoster();
      hidePlayerLoading();
      hidePlayerError();
      dom.endCard.hidden = true;
      dom.playerFrame.classList.add("is-playing");
      updatePlayButton();
      startTicker();
      showControlsTemporarily();
      break;

    case 2: // paused
      state.isPlaying = false;
      state.isBuffering = false;
      stopTicker();
      saveCurrentProgress();
      dom.playerFrame.classList.remove("is-playing");
      hidePlayerLoading();
      updatePlayButton();
      showControls();
      break;

    case 3: // buffering
      state.isBuffering = true;
      if (state.hasStarted && dom.playerPoster.hidden) {
        setPlayerLoading("Buffering…");
      }
      break;

    case 5: // cued
      state.isPlaying = false;
      state.isBuffering = false;
      stopTicker();
      hidePlayerLoading();
      dom.playerFrame.classList.remove("is-playing");
      updatePlayButton();
      if (!state.hasStarted) showPoster();
      break;

    case 0: // ended
      handleEnded();
      break;

    case -1: // unstarted
    default:
      hidePlayerLoading();
      break;
  }
}

function handlePlayerError(code) {
  const item = getCurrentItem();
  const messages = {
    2: ["That video link isn't valid.", "The video ID was rejected by YouTube."],
    5: ["The player couldn't play this video.", "Try reloading the page or another lesson."],
    100: ["This video isn't available.", "It may be private, deleted, or region-locked."],
    101: ["This video can't be embedded.", "The owner disabled playback outside YouTube."],
    150: ["This video can't be embedded.", "The owner disabled playback outside YouTube."],
  };
  const [title, text] = messages[code] || [
    "This video can't play here",
    "The video may be private, age-restricted, or have embedding disabled.",
  ];
  showPlayerError(title, text, item?.videoId);
  showToast("This lesson can't be played in the embedded player.", 3600);
}

function applyPlayerLoad({ videoId, play, startSeconds = 0 }) {
  if (!state.player) return;
  state.pendingLoad = null;
  state.playerError = false;
  hidePlayerError();
  dom.endCard.hidden = true;

  if (play) {
    state.hasStarted = true;
    hidePoster();
    setPlayerLoading("Loading video…");
    showControls();
    state.player.load(videoId, { play: true, startSeconds });
  } else {
    state.player.load(videoId, { play: false, startSeconds });
    hidePlayerLoading();
    showPoster();
  }
  state.pendingSeek = null;
}

function loadCurrentIntoPlayer({ play = false } = {}) {
  const item = getCurrentItem();
  if (!item) return;

  const startSeconds = state.pendingSeek || 0;
  if (!state.player) {
    ensurePlayer();
    return;
  }

  if (!state.playerReady) {
    state.pendingLoad = { videoId: item.videoId, play, startSeconds };
    if (play) setPlayerLoading("Loading player…");
    return;
  }

  applyPlayerLoad({ videoId: item.videoId, play, startSeconds });
}

function startPlayback() {
  const item = getCurrentItem();
  if (!item) return;

  if (!dom.endCard.hidden) {
    restartCurrentVideo();
    return;
  }

  state.hasStarted = true;
  hidePoster();
  showControls();

  if (!state.player) {
    state.pendingPlay = true;
    ensurePlayer();
    setPlayerLoading("Loading player…");
    return;
  }

  if (!state.playerReady) {
    state.pendingPlay = true;
    setPlayerLoading("Loading player…");
    return;
  }

  if (state.player.videoId !== item.videoId) {
    applyPlayerLoad({
      videoId: item.videoId,
      play: true,
      startSeconds: resumePositionFor(item),
    });
    return;
  }

  if (state.player.getState() === 0) {
    state.player.seekTo(0);
  }
  state.player.play();
  showControlsTemporarily();
}

function restartCurrentVideo() {
  const item = getCurrentItem();
  if (!item) return;
  dom.endCard.hidden = true;
  hidePoster();
  state.hasStarted = true;
  showControls();

  if (!state.playerReady) {
    state.pendingPlay = true;
    state.pendingSeek = 0;
    ensurePlayer();
    setPlayerLoading("Loading player…");
    return;
  }

  if (state.player.videoId !== item.videoId) {
    applyPlayerLoad({ videoId: item.videoId, play: true, startSeconds: 0 });
    return;
  }

  state.player.seekTo(0);
  state.player.play();
  showControlsTemporarily();
}

function togglePlay() {
  if (!getCurrentItem()) return;
  if (!dom.endCard.hidden) {
    restartCurrentVideo();
    return;
  }
  if (state.isPlaying) {
    state.player?.pause();
  } else {
    startPlayback();
  }
}

function seekBy(seconds) {
  if (!state.playerReady || !state.player) return;
  const item = getCurrentItem();
  if (!item) return;
  const duration = state.player.getDuration() || item.duration || 0;
  if (duration <= 0) return;
  const next = clamp(state.player.getCurrentTime() + seconds, 0, duration);
  state.player.seekTo(next);
  updateSeekUi(next, duration);
  showControlsTemporarily();
}

function nextVideo() {
  const playlist = state.playlist;
  if (!playlist) return;
  if (state.currentIndex < playlist.items.length - 1) {
    selectVideo(state.currentIndex + 1, { play: true });
  } else if (!dom.endCard.hidden) {
    showToast("You've reached the end of this playlist.", 2200);
  } else {
    showEndCard();
  }
}

function previousVideo() {
  if (!state.playlist) return;
  if (state.currentIndex > 0) {
    selectVideo(state.currentIndex - 1, { play: true });
  } else {
    state.player?.seekTo(0);
    showToast("Start of playlist.", 1400);
  }
}

function handleEnded() {
  const playlist = state.playlist;
  const item = getCurrentItem();
  if (!playlist || !item) return;

  const endedIndex = state.currentIndex;
  const next = playlist.items[endedIndex + 1];

  state.isPlaying = false;
  state.isBuffering = false;
  stopTicker();
  dom.playerFrame.classList.remove("is-playing");
  saveCurrentProgress({ force: true });
  markWatched(item.videoId, true, { silent: true });
  updatePlayButton();
  showControls();

  window.clearTimeout(state.endTimer);
  if (state.settings.autoplay && next) {
    setPlayerLoading("Next lesson…");
    state.endTimer = window.setTimeout(() => {
      if (state.route === "app" && state.currentIndex === endedIndex) {
        selectVideo(endedIndex + 1, { play: true });
      }
    }, 700);
  } else {
    showEndCard();
  }
}

/* --------------------------------------------------------------------------
   Selecting a lesson
   -------------------------------------------------------------------------- */

function selectVideo(index, { play = false, initial = false } = {}) {
  const playlist = state.playlist;
  if (!playlist) return;
  const item = playlist.items[index];
  if (!item) return;

  const sameVideo =
    index === state.currentIndex &&
    state.player &&
    state.player.videoId === item.videoId;

  if (sameVideo && !initial) {
    if (play) startPlayback();
    return;
  }

  if (state.currentIndex >= 0 && state.currentIndex !== index) {
    saveCurrentProgress({ force: true });
  }

  state.currentIndex = index;
  state.playerError = false;
  state.isPlaying = false;
  state.isBuffering = false;
  state.pendingSeek = resumePositionFor(item) || null;
  state.pendingPlay = play;
  state.pendingLoad = null;
  state.hasStarted = !initial && play;
  window.clearTimeout(state.endTimer);

  hidePlayerError();
  hideSpeedMenu();
  dom.endCard.hidden = true;
  dom.playerFrame.classList.remove("is-playing");
  stopTicker();

  updateVideoMeta();
  updatePlaylistActive();
  updatePlaylistWatchedStates();
  syncLibraryProgress();
  setHashForCurrent();
  setPageTitle(item.title);
  updatePlayButton();

  showPoster();
  if (play) hidePoster();

  loadCurrentIntoPlayer({ play });
}

/* --------------------------------------------------------------------------
   Loading playlists + routing
   -------------------------------------------------------------------------- */

function findStartIndex(playlist, startVideoId) {
  if (startVideoId) {
    const found = playlist.items.findIndex((item) => item.videoId === startVideoId);
    if (found >= 0) return found;
  }

  const entry = state.library.find((item) => item.id === playlist.id);
  if (entry?.lastVideoId) {
    const found = playlist.items.findIndex((item) => item.videoId === entry.lastVideoId);
    if (found >= 0) return found;
  }

  const firstUnwatched = playlist.items.findIndex((item) => !isCompleted(item.videoId));
  return firstUnwatched >= 0 ? firstUnwatched : 0;
}

async function openPlaylistById(playlistId, { startVideoId = "", source = "manual" } = {}) {
  if (!state.apiKey) {
    state.pendingRoute = `#list=${encodeURIComponent(playlistId)}`;
    clearHash();
    showLanding({ error: "Add your YouTube Data API key to open that playlist.", focusKey: true });
    return false;
  }

  if (state.playlist?.kind === "playlist" && state.playlist.id === playlistId) {
    showApp();
    if (startVideoId) {
      const index = state.playlist.items.findIndex((item) => item.videoId === startVideoId);
      if (index >= 0) selectVideo(index, { play: false, initial: true });
    }
    return true;
  }

  state.loadController?.abort();
  const controller = new AbortController();
  state.loadController = controller;
  const token = ++state.loadToken;
  const wasPlaying = state.isPlaying;

  saveCurrentProgress({ force: true });
  state.player?.pause();
  stopTicker();
  showLoadingView("Loading playlist", "Fetching course details…");

  try {
    const playlist = await fetchPlaylist(playlistId, state.apiKey, {
      signal: controller.signal,
      onProgress: (count, total) => {
        if (token !== state.loadToken) return;
        setLoadingDetail(total > 0 ? `Found ${count} of ${total} lessons…` : `Found ${count} lessons…`);
      },
      onStage: (stage) => {
        if (token !== state.loadToken) return;
        if (stage === "durations") setLoadingDetail("Reading video durations…");
      },
    });

    if (token !== state.loadToken) return false;

    state.playlist = playlist;
    state.currentIndex = -1;
    state.hasStarted = false;
    state.pendingSeek = null;
    state.pendingPlay = false;
    state.pendingLoad = null;
    state.playerError = false;
    state.searchQuery = "";
    dom.playlistSearch.value = "";

    const index = findStartIndex(playlist, startVideoId);
    state.currentIndex = index;
    const current = playlist.items[index];
    const entry = state.library.find((item) => item.id === playlist.id);

    if (entry) {
      Object.assign(entry, {
        title: playlist.title,
        channel: playlist.channel,
        thumbnail: playlist.thumbnail,
        count: playlist.count,
        watchedCount: playlist.items.filter((item) => isCompleted(item.videoId)).length,
        lastVideoId: current?.videoId || entry.lastVideoId || "",
        lastOpenedAt: Date.now(),
      });
      saveLibrary();
    } else {
      state.library.push({
        id: playlist.id,
        title: playlist.title,
        channel: playlist.channel,
        thumbnail: playlist.thumbnail,
        count: playlist.count,
        watchedCount: playlist.items.filter((item) => isCompleted(item.videoId)).length,
        lastVideoId: current?.videoId || "",
        lastOpenedAt: Date.now(),
        addedAt: Date.now(),
      });
      saveLibrary();
    }

    showApp();
    renderPlaylist();
    selectVideo(index, { play: false, initial: true });
    if (playlist.warning) showToast(`Some durations couldn't load: ${playlist.warning}`, 4200);
    if (playlist.truncated) showToast("This playlist is very long. The first 1,000 lessons were loaded.", 4200);
    return true;
  } catch (error) {
    if (error.name === "AbortError" || token !== state.loadToken) return false;
    state.loadController = null;
    const message = humanizeApiError(error);

    if (state.playlist) {
      showApp();
      if (wasPlaying) state.player?.play();
      showToast(message, 5200);
      if (isKeyError(error)) openSettingsDialog();
    } else {
      clearHash();
      showLanding({ error: message, focusKey: isKeyError(error) });
    }
    return false;
  } finally {
    if (token === state.loadToken) state.loadController = null;
  }
}

async function openSingleVideo(videoId) {
  if (!state.apiKey) {
    state.pendingRoute = `#video=${encodeURIComponent(videoId)}`;
    clearHash();
    showLanding({ error: "Add your YouTube Data API key to open that video.", focusKey: true });
    return false;
  }

  if (
    state.playlist?.kind === "single" &&
    state.playlist.items[0]?.videoId === videoId
  ) {
    showApp();
    return true;
  }

  state.loadController?.abort();
  const controller = new AbortController();
  state.loadController = controller;
  const token = ++state.loadToken;
  const wasPlaying = state.isPlaying;

  saveCurrentProgress({ force: true });
  state.player?.pause();
  stopTicker();
  showLoadingView("Loading video", "Fetching video details…");

  try {
    const playlist = await fetchSingleVideo(videoId, state.apiKey, { signal: controller.signal });
    if (token !== state.loadToken) return false;

    state.playlist = playlist;
    state.currentIndex = 0;
    state.hasStarted = false;
    state.pendingSeek = null;
    state.pendingPlay = false;
    state.pendingLoad = null;
    state.playerError = false;
    state.searchQuery = "";
    dom.playlistSearch.value = "";

    showApp();
    renderPlaylist();
    selectVideo(0, { play: false, initial: true });
    return true;
  } catch (error) {
    if (error.name === "AbortError" || token !== state.loadToken) return false;
    state.loadController = null;
    const message = humanizeApiError(error);

    if (state.playlist) {
      showApp();
      if (wasPlaying) state.player?.play();
      showToast(message, 5200);
      if (isKeyError(error)) openSettingsDialog();
    } else {
      clearHash();
      showLanding({ error: message, focusKey: isKeyError(error) });
    }
    return false;
  } finally {
    if (token === state.loadToken) state.loadController = null;
  }
}

async function openParsed(parsed, { source = "manual" } = {}) {
  if (!parsed || parsed.error) {
    showToast(parsed?.error || "Couldn't read that link.", 3200);
    return false;
  }
  closeAllDialogs();
  if (parsed.type === "playlist") {
    return openPlaylistById(parsed.id, { startVideoId: parsed.startVideoId, source });
  }
  return openSingleVideo(parsed.id);
}

function routeFromHash() {
  const route = parseHashRoute();
  if (!route) {
    if (state.route === "app" || state.route === "loading") {
      showLanding();
    }
    return;
  }

  if (!state.apiKey) {
    state.pendingRoute = window.location.hash;
    clearHash();
    showLanding({ error: "Add your YouTube Data API key to open this course.", focusKey: true });
    return;
  }

  if (route.list) {
    if (state.playlist?.kind === "playlist" && state.playlist.id === route.list) {
      showApp();
      if (route.video) {
        const index = state.playlist.items.findIndex((item) => item.videoId === route.video);
        if (index >= 0) selectVideo(index, { play: false, initial: true });
      }
      return;
    }
    openPlaylistById(route.list, { startVideoId: route.video, source: "route" });
    return;
  }

  if (route.video) {
    openSingleVideo(route.video);
  }
}

/* --------------------------------------------------------------------------
   Views
   -------------------------------------------------------------------------- */

function showApp() {
  state.route = "app";
  closeAllDialogs();
  dom.loadingView.hidden = true;
  dom.landingView.hidden = true;
  dom.appView.hidden = false;
  document.body.dataset.view = "app";

  if (state.playlist) {
    dom.headerPlaylistTitle.textContent = state.playlist.title;
    dom.headerPlaylistMeta.textContent =
      state.playlist.kind === "single"
        ? "Single video"
        : `${state.playlist.channel || "YouTube"} · ${state.playlist.count} ${plural(state.playlist.count, "lesson")}`;
    setPageTitle(getCurrentItem()?.title || state.playlist.title);
  }

  applyFocusMode();
  updateVolumeUi();
  updateSpeedUi();
}

function showLanding({ error = "", focusKey = false } = {}) {
  if (state.player && state.isPlaying) state.player.pause();
  saveCurrentProgress({ force: true });
  stopTicker();
  state.route = "landing";
  closeAllDialogs();
  dom.loadingView.hidden = true;
  dom.appView.hidden = true;
  dom.landingView.hidden = false;
  document.body.dataset.view = "landing";
  setPageTitle("");
  window.scrollTo({ top: 0, behavior: "instant" });

  renderLanding();
  showStartError(error);

  if (focusKey || !state.apiKey) {
    dom.keySetup.hidden = false;
    dom.keySaved.hidden = true;
    window.setTimeout(() => dom.apiKeyInput.focus(), 60);
  }
}

function looksLikeApiKey(value) {
  const key = String(value || "").trim();
  // Google API keys are typically 39 chars and start with AIza.
  return /^AIza[0-9A-Za-z_-]{20,}$/.test(key);
}

function saveApiKey(value, { quiet = false } = {}) {
  const key = String(value || "").trim();
  if (!key) {
    showStartError("Enter your YouTube Data API key first.");
    return false;
  }

  state.apiKey = key;
  try {
    localStorage.setItem(STORAGE.apiKey, key);
  } catch {
    showToast("Couldn't save the key. localStorage may be blocked.", 3200);
    showStartError("Couldn't save the key. Check that this browser allows local site data.");
    return false;
  }

  showStartError("");
  updateKeyUi();

  if (!quiet) {
    showToast("API key saved. Paste a playlist and hit Open.", 3200);
  }

  if (state.pendingRoute) {
    const route = state.pendingRoute;
    state.pendingRoute = "";
    window.location.hash = route;
  }
  return true;
}

function updateKeyUi() {
  const hasKey = Boolean(state.apiKey);
  dom.keySetup.hidden = hasKey;
  dom.keySaved.hidden = !hasKey;
  if (hasKey) {
    dom.apiKeyInput.value = "";
    dom.apiKeyInput.type = "password";
  }
  if (dom.settingsKeyInput) {
    dom.settingsKeyInput.value = state.apiKey;
  }
  setToggleIcon(dom.showKeyBtn, dom.apiKeyInput.type === "text");
  setToggleIcon(dom.settingsShowKeyBtn, dom.settingsKeyInput?.type === "text");
  if (dom.saveKeyBtn) {
    dom.saveKeyBtn.classList.toggle("btn-primary", !hasKey);
    dom.saveKeyBtn.classList.toggle("btn-secondary", hasKey);
  }
}

function tryAutoSaveApiKeyFromInput() {
  if (state.apiKey) return false;
  if (dom.keySetup?.hidden) return false;
  const value = dom.apiKeyInput?.value || "";
  if (!looksLikeApiKey(value)) return false;
  return saveApiKey(value);
}

/* --------------------------------------------------------------------------
   Landing rendering
   -------------------------------------------------------------------------- */

function courseHref(entry) {
  if (entry.kind === "single" || entry.id.startsWith("video:")) {
    return `#video=${encodeURIComponent(entry.id.replace(/^video:/, ""))}`;
  }
  const params = new URLSearchParams({ list: entry.id });
  if (entry.lastVideoId) params.set("v", entry.lastVideoId);
  return `#${params.toString()}`;
}

function buildCourseCard(entry) {
  const wrap = document.createElement("div");
  wrap.className = "course-card-wrap";

  const anchor = document.createElement("a");
  anchor.className = "course-card";
  anchor.href = courseHref(entry);
  anchor.dataset.libraryId = entry.id;
  anchor.setAttribute("aria-label", `Open ${entry.title}`);

  if (!state.apiKey) {
    anchor.addEventListener("click", (event) => {
      event.preventDefault();
      state.pendingRoute = anchor.hash;
      showLanding({ error: "Add your YouTube API key to open this course.", focusKey: true });
    });
  }

  const thumb = document.createElement("div");
  thumb.className = "course-thumb";
  if (entry.thumbnail) {
    const img = document.createElement("img");
    img.src = entry.thumbnail;
    img.alt = "";
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    thumb.append(img);
  }
  const play = document.createElement("span");
  play.className = "course-play";
  play.append(icon("play"));
  thumb.append(play);

  const body = document.createElement("div");
  body.className = "course-body";
  const title = document.createElement("h3");
  title.textContent = entry.title;
  const meta = document.createElement("p");
  meta.textContent = [entry.channel, `${entry.count || 0} ${plural(entry.count || 0, "lesson")}`]
    .filter(Boolean)
    .join(" · ");
  const progress = document.createElement("div");
  progress.className = "course-progress";
  const track = document.createElement("div");
  track.className = "course-progress-track";
  const fill = document.createElement("span");
  const percent = entry.count > 0 ? clamp(((entry.watchedCount || 0) / entry.count) * 100, 0, 100) : 0;
  fill.style.width = `${percent}%`;
  track.append(fill);
  const count = document.createElement("small");
  count.textContent = `${entry.watchedCount || 0}/${entry.count || 0}`;
  progress.append(track, count);

  body.append(title, meta, progress);
  anchor.append(thumb, body);

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "course-remove";
  remove.setAttribute("aria-label", `Remove ${entry.title} from library`);
  remove.title = "Remove from library";
  remove.append(icon("trash"));
  remove.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    removeLibraryEntry(entry.id);
  });

  wrap.append(anchor, remove);
  return wrap;
}

function renderSavedCourses() {
  const sorted = [...state.library].sort((a, b) => (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0));
  dom.savedGrid.replaceChildren();
  dom.savedSection.hidden = sorted.length === 0;
  dom.landingLibraryBtn.hidden = sorted.length === 0;
  dom.viewAllBtn.hidden = sorted.length <= 3;

  const fragment = document.createDocumentFragment();
  for (const entry of sorted.slice(0, 3)) {
    fragment.append(buildCourseCard(entry));
  }
  dom.savedGrid.append(fragment);
}

function renderLanding() {
  updateKeyUi();
  renderSavedCourses();
}

/* --------------------------------------------------------------------------
   Library dialog
   -------------------------------------------------------------------------- */

function renderLibraryDialog() {
  const sorted = [...state.library].sort((a, b) => (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0));
  dom.libraryList.replaceChildren();
  dom.libraryEmpty.hidden = sorted.length > 0;
  dom.libraryList.hidden = sorted.length === 0;

  const fragment = document.createDocumentFragment();
  for (const entry of sorted) {
    const row = document.createElement("div");
    row.className = "library-item";

    const open = document.createElement("button");
    open.type = "button";
    open.className = "library-open";
    open.addEventListener("click", () => {
      closeDialog(dom.libraryDialog);
      if (!state.apiKey) {
        state.pendingRoute = courseHref(entry);
        showLanding({ error: "Add your YouTube API key to open this course.", focusKey: true });
        return;
      }
      window.location.hash = courseHref(entry);
    });

    const thumb = document.createElement("span");
    thumb.className = "library-thumb";
    if (entry.thumbnail) {
      const img = document.createElement("img");
      img.src = entry.thumbnail;
      img.alt = "";
      img.loading = "lazy";
      img.referrerPolicy = "no-referrer";
      thumb.append(img);
    }

    const copy = document.createElement("span");
    copy.className = "library-copy";
    const title = document.createElement("h3");
    title.textContent = entry.title;
    const meta = document.createElement("p");
    meta.textContent = [
      entry.channel,
      `${entry.count || 0} ${plural(entry.count || 0, "lesson")}`,
      entry.count > 0 ? `${entry.watchedCount || 0} watched` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    copy.append(title, meta);
    open.append(thumb, copy);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "icon-btn library-remove";
    remove.setAttribute("aria-label", `Remove ${entry.title} from library`);
    remove.title = "Remove from library";
    remove.append(icon("trash"));
    remove.addEventListener("click", () => removeLibraryEntry(entry.id));

    row.append(open, remove);
    fragment.append(row);
  }
  dom.libraryList.append(fragment);
}

function removeLibraryEntry(id) {
  const entry = state.library.find((item) => item.id === id);
  if (!entry) return;
  if (!window.confirm(`Remove “${entry.title}” from your library?`)) return;
  state.library = state.library.filter((item) => item.id !== id);
  saveLibrary();
  renderLanding();
  if (dom.libraryDialog.open) renderLibraryDialog();
  showToast("Removed from library.", 1800);
}

function openLibraryDialog() {
  renderLibraryDialog();
  openDialog(dom.libraryDialog);
}

function openLoadDialog() {
  setError(dom.loadError, "");
  dom.loadInput.value = "";
  openDialog(dom.loadDialog);
  window.setTimeout(() => dom.loadInput.focus(), 60);
}

function openSettingsDialog() {
  dom.autoplayToggle.checked = state.settings.autoplay;
  dom.resumeToggle.checked = state.settings.resume;
  dom.settingsKeyInput.value = state.apiKey;
  dom.settingsKeyInput.type = "password";
  setToggleIcon(dom.settingsShowKeyBtn, false);
  setError(dom.settingsKeyError, "");
  openDialog(dom.settingsDialog);
}
/* --------------------------------------------------------------------------
   Form handlers
   -------------------------------------------------------------------------- */

function handleStartSubmit(event) {
  event.preventDefault();
  showStartError("");
  state.pendingRoute = "";

  // Always try to keep a typed key if the user entered one.
  if (!state.apiKey) {
    const typedKey = dom.apiKeyInput.value.trim();
    if (typedKey) {
      if (!saveApiKey(typedKey, { quiet: true })) return;
    }
  }

  const playlistValue = dom.playlistInput.value.trim();
  if (!playlistValue) {
    if (state.apiKey) {
      showStartError("API key is saved. Now paste a YouTube playlist link above.");
      dom.playlistInput.focus();
    } else {
      showStartError("Add your YouTube Data API key, then paste a playlist link.");
      dom.keySetup.hidden = false;
      dom.apiKeyInput.focus();
    }
    return;
  }

  const parsed = parseYouTubeInput(playlistValue);
  if (parsed.error) {
    showStartError(parsed.error);
    dom.playlistInput.focus();
    return;
  }

  if (!state.apiKey) {
    showStartError("Add your YouTube Data API key first.");
    dom.keySetup.hidden = false;
    dom.keySaved.hidden = true;
    dom.apiKeyInput.focus();
    return;
  }

  openParsed(parsed, { source: "landing" });
}

function handleSaveKeyClick(event) {
  event?.preventDefault?.();
  event?.stopPropagation?.();

  const value = dom.apiKeyInput.value;
  if (!String(value || "").trim()) {
    showStartError("Paste your YouTube API key into the field, then click Save key.");
    dom.apiKeyInput.focus();
    return;
  }

  const saved = saveApiKey(value);
  if (saved && !state.pendingRoute && state.route !== "app") {
    window.setTimeout(() => dom.playlistInput.focus(), 80);
  }
}

function handleLoadSubmit(event) {
  event.preventDefault();
  setError(dom.loadError, "");

  const parsed = parseYouTubeInput(dom.loadInput.value);
  if (parsed.error) {
    setError(dom.loadError, parsed.error);
    dom.loadInput.focus();
    return;
  }

  if (!state.apiKey) {
    closeDialog(dom.loadDialog);
    showLanding({ error: "Add a YouTube Data API key first.", focusKey: true });
    return;
  }

  closeDialog(dom.loadDialog);
  openParsed(parsed, { source: "dialog" });
}

function handleSettingsSubmit(event) {
  event.preventDefault();
  handleSaveSettingsKey();
}

function handleSaveSettingsKey() {
  const key = dom.settingsKeyInput.value.trim();
  if (!key) {
    setError(dom.settingsKeyError, "Enter an API key first.");
    dom.settingsKeyInput.focus();
    return;
  }
  const saved = saveApiKey(key, { quiet: true });
  if (!saved) {
    setError(dom.settingsKeyError, "Couldn't save that key. Check browser storage permissions.");
    return;
  }
  setError(dom.settingsKeyError, "");
  showToast("API key saved.", 1800);
}

function handleClearProgress() {
  const ok = window.confirm("Clear all watch progress? Your courses and API key stay saved.");
  if (!ok) return;

  state.progress = {};
  saveProgressStore();
  for (const entry of state.library) {
    entry.watchedCount = 0;
  }
  saveLibrary();
  if (state.playlist) {
    updatePlaylistWatchedStates();
    updateVideoMeta();
  }
  renderLanding();
  if (dom.libraryDialog.open) renderLibraryDialog();
  showToast("Watch progress cleared.", 2200);
}

function handleRemoveKey() {
  const ok = window.confirm("Remove your YouTube API key from this browser? Your library and progress will stay.");
  if (!ok) return;

  state.apiKey = "";
  try {
    localStorage.removeItem(STORAGE.apiKey);
  } catch {
    // Ignore storage errors.
  }
  state.pendingRoute = "";
  state.loadToken += 1;
  state.loadController?.abort();
  state.loadController = null;
  state.player?.pause();
  stopTicker();
  clearHash();
  closeAllDialogs();
  updateKeyUi();
  showLanding();
  showToast("API key removed.", 2400);
}

/* --------------------------------------------------------------------------
   Playback event handlers
   -------------------------------------------------------------------------- */

function handlePosterPlay() {
  startPlayback();
}

function handlePlayButton() {
  togglePlay();
}

function handleSeekInput() {
  state.isSeeking = true;
  const duration = Number(dom.seekBar.max) || 0;
  updateSeekUi(Number(dom.seekBar.value), duration);
}

function handleSeekChange() {
  const value = Number(dom.seekBar.value);
  state.isSeeking = false;
  if (state.playerReady) {
    state.player.seekTo(value);
    if (state.player.getState() === 0) {
      dom.endCard.hidden = true;
      state.player.play();
    }
  }
  showControlsTemporarily();
}

function handleVolumeInput() {
  applyVolume(Number(dom.volumeBar.value));
}

function handleSearchInput() {
  state.searchQuery = dom.playlistSearch.value;
  applyPlaylistSearch();
}

function clearPlaylistSearch() {
  state.searchQuery = "";
  dom.playlistSearch.value = "";
  applyPlaylistSearch();
  dom.playlistSearch.focus();
}

function handlePlaylistClick(event) {
  const button = event.target.closest(".playlist-item-btn");
  if (!button) return;
  const index = Number(button.dataset.index);
  if (!Number.isInteger(index)) return;
  selectVideo(index, { play: true });
}

function handleSpeedMenuClick(event) {
  const button = event.target.closest("[data-speed]");
  if (!button) return;
  setPlaybackRate(Number(button.dataset.speed));
}

function handleHomeClick(event) {
  event.preventDefault();
  state.loadToken += 1;
  state.loadController?.abort();
  state.loadController = null;
  state.player?.pause();
  stopTicker();
  state.pendingRoute = "";
  clearHash();
  showLanding();
}

function handleLibraryOpenFromEmpty() {
  closeDialog(dom.libraryDialog);
  window.setTimeout(openLoadDialog, 80);
}

function handlePanelClose() {
  if (!state.focusMode) {
    state.focusMode = true;
    applyFocusMode();
    showToast("Focus mode on — just the video.", 2000);
  }
}

function isTypingTarget(target) {
  return Boolean(
    target instanceof Element &&
      target.closest("input, textarea, select, [contenteditable='true']"),
  );
}

function handleKeyDown(event) {
  if (event.defaultPrevented || state.route !== "app") return;
  if (document.querySelector("dialog[open]")) return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;

  const target = event.target;
  if (isTypingTarget(target)) return;
  if (event.code === "Space" && target instanceof Element && target.closest("button, a")) return;

  switch (event.key) {
    case " ":
      event.preventDefault();
      togglePlay();
      showControlsTemporarily();
      break;
    case "ArrowLeft":
      event.preventDefault();
      seekBy(-5);
      break;
    case "ArrowRight":
      event.preventDefault();
      seekBy(5);
      break;
    case "ArrowUp": {
      event.preventDefault();
      const next = clamp(state.settings.volume + 5, 0, 100);
      applyVolume(next);
      showToast(`Volume ${next}%`, 900);
      showControlsTemporarily();
      break;
    }
    case "ArrowDown": {
      event.preventDefault();
      const next = clamp(state.settings.volume - 5, 0, 100);
      applyVolume(next);
      showToast(`Volume ${next}%`, 900);
      showControlsTemporarily();
      break;
    }
    case "m":
    case "M":
      event.preventDefault();
      toggleMute();
      showControlsTemporarily();
      break;
    case "f":
    case "F":
      event.preventDefault();
      toggleFullscreen();
      break;
    case "n":
    case "N":
      event.preventDefault();
      nextVideo();
      break;
    case "p":
    case "P":
      event.preventDefault();
      previousVideo();
      break;
    case "/":
      event.preventDefault();
      dom.playlistSearch.focus();
      dom.playlistSearch.select();
      break;
    case "Escape":
      if (state.speedMenuOpen) {
        event.preventDefault();
        hideSpeedMenu();
      }
      break;
    default:
      break;
  }
}

/* --------------------------------------------------------------------------
   Event wiring
   -------------------------------------------------------------------------- */

function wireEvents() {
  dom.startForm.addEventListener("submit", handleStartSubmit);
  dom.saveKeyBtn.addEventListener("click", handleSaveKeyClick);
  dom.showKeyBtn.addEventListener("click", () => togglePasswordVisibility(dom.apiKeyInput, dom.showKeyBtn));
  dom.changeKeyBtn.addEventListener("click", () => {
    dom.keySetup.hidden = false;
    dom.keySaved.hidden = true;
    dom.apiKeyInput.value = state.apiKey || "";
    dom.apiKeyInput.focus();
    dom.apiKeyInput.select();
  });

  // Enter in the key field should save the key, not submit an empty playlist form.
  dom.apiKeyInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    handleSaveKeyClick(event);
  });

  // Paste often feels like it should "just work."
  dom.apiKeyInput.addEventListener("paste", () => {
    window.setTimeout(() => {
      if (tryAutoSaveApiKeyFromInput()) return;
      const value = dom.apiKeyInput.value.trim();
      if (value) showStartError("");
    }, 0);
  });

  dom.apiKeyInput.addEventListener("input", () => {
    const hasText = Boolean(dom.apiKeyInput.value.trim());
    dom.saveKeyBtn.classList.toggle("btn-primary", hasText);
    dom.saveKeyBtn.classList.toggle("btn-secondary", !hasText);
  });

  dom.landingLibraryBtn.addEventListener("click", openLibraryDialog);
  dom.viewAllBtn.addEventListener("click", openLibraryDialog);
  dom.landingSettingsBtn.addEventListener("click", openSettingsDialog);
  dom.newPlaylistBtn.addEventListener("click", openLoadDialog);
  dom.libraryBtn.addEventListener("click", openLibraryDialog);
  dom.settingsBtn.addEventListener("click", openSettingsDialog);
  dom.libraryOpenBtn.addEventListener("click", handleLibraryOpenFromEmpty);

  dom.loadForm.addEventListener("submit", handleLoadSubmit);
  dom.settingsForm.addEventListener("submit", handleSettingsSubmit);
  dom.saveSettingsKeyBtn.addEventListener("click", handleSaveSettingsKey);
  dom.settingsShowKeyBtn.addEventListener("click", () =>
    togglePasswordVisibility(dom.settingsKeyInput, dom.settingsShowKeyBtn),
  );
  dom.autoplayToggle.addEventListener("change", () => {
    state.settings.autoplay = dom.autoplayToggle.checked;
    saveSettings();
  });
  dom.resumeToggle.addEventListener("change", () => {
    state.settings.resume = dom.resumeToggle.checked;
    saveSettings();
  });
  dom.clearProgressBtn.addEventListener("click", handleClearProgress);
  dom.removeKeyBtn.addEventListener("click", handleRemoveKey);

  dom.posterPlay.addEventListener("click", handlePosterPlay);
  dom.playBtn.addEventListener("click", handlePlayButton);
  dom.prevBtn.addEventListener("click", previousVideo);
  dom.nextBtn.addEventListener("click", nextVideo);
  dom.muteBtn.addEventListener("click", toggleMute);
  dom.volumeBar.addEventListener("input", handleVolumeInput);
  dom.seekBar.addEventListener("input", handleSeekInput);
  dom.seekBar.addEventListener("change", handleSeekChange);
  dom.speedBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleSpeedMenu();
  });
  dom.speedMenu.addEventListener("click", handleSpeedMenuClick);
  dom.fullscreenBtn.addEventListener("click", toggleFullscreen);
  dom.markWatchedBtn.addEventListener("click", toggleWatchedCurrent);
  dom.focusBtn.addEventListener("click", toggleFocusMode);
  dom.panelCloseBtn.addEventListener("click", handlePanelClose);

  dom.playlistItems.addEventListener("click", handlePlaylistClick);
  dom.playlistSearch.addEventListener("input", handleSearchInput);
  dom.clearSearchBtn.addEventListener("click", clearPlaylistSearch);
  dom.resetSearchBtn.addEventListener("click", clearPlaylistSearch);

  dom.playerFrame.addEventListener("mousemove", showControlsTemporarily);
  dom.playerFrame.addEventListener("pointerdown", showControlsTemporarily);
  dom.playerFrame.addEventListener("focusin", showControls);
  dom.playerFrame.addEventListener("mouseleave", () => {
    if (state.isPlaying) {
      dom.playerFrame.classList.remove("controls-visible");
    }
  });

  for (const button of $$("[data-close-dialog]")) {
    button.addEventListener("click", () => closeDialog(button.closest("dialog")));
  }
  for (const dialog of $$("dialog")) {
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) closeDialog(dialog);
    });
  }

  for (const home of $$("[data-home]")) {
    home.addEventListener("click", handleHomeClick);
  }

  document.addEventListener("click", (event) => {
    if (!state.speedMenuOpen) return;
    if (event.target instanceof Element && event.target.closest("#speedMenu, #speedBtn")) return;
    hideSpeedMenu();
  });

  document.addEventListener("keydown", handleKeyDown);
  document.addEventListener("fullscreenchange", updateFullscreenUi);
  window.addEventListener("hashchange", routeFromHash);
  window.addEventListener("beforeunload", () => saveCurrentProgress({ force: true }));
  window.addEventListener("pagehide", () => saveCurrentProgress({ force: true }));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveCurrentProgress({ force: true });
  });
}

/* --------------------------------------------------------------------------
   Boot
   -------------------------------------------------------------------------- */

function init() {
  if (window.location.protocol === "file:") {
    showToast("Open still. through a local web server, not as a file. See the README.", 6000);
  }

  wireEvents();
  updateKeyUi();
  updateVolumeUi();
  updateSpeedUi();
  updateFullscreenUi();
  hideSpeedMenu();
  applyFocusMode();
  dom.seekBar.disabled = true;
  renderLanding();

  const route = parseHashRoute();
  if (route) {
    routeFromHash();
  } else {
    showLanding();
  }
}

init();
