let apiPromise = null;

function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;

  apiPromise = new Promise((resolve, reject) => {
    const existing = document.getElementById("youtube-iframe-api");
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      if (error) reject(error);
      else resolve(window.YT);
    };

    const previousReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      try {
        previousReady?.();
      } catch {
        // Ignore errors from other scripts.
      }
      finish();
    };

    const timeout = window.setTimeout(() => {
      finish(new Error("YouTube player timed out while loading."));
    }, 20000);

    if (existing) {
      existing.addEventListener("error", () => finish(new Error("YouTube player failed to load.")), { once: true });
      // If the script loaded but the API callback was missed, poll briefly.
      const poll = window.setInterval(() => {
        if (window.YT?.Player) {
          window.clearInterval(poll);
          finish();
        }
      }, 250);
      window.setTimeout(() => window.clearInterval(poll), 20000);
      return;
    }

    const script = document.createElement("script");
    script.id = "youtube-iframe-api";
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.addEventListener("error", () => finish(new Error("YouTube player failed to load.")), { once: true });
    document.head.append(script);
  });

  return apiPromise;
}

export class YouTubePlayer {
  constructor({ container, onReady, onStateChange, onError, onApiError }) {
    this.container = container;
    this.onReady = onReady;
    this.onStateChange = onStateChange;
    this.onError = onError;
    this.onApiError = onApiError;
    this.player = null;
    this.ready = false;
    this.videoId = "";
    this.pending = null;
    this.readyPromise = null;
    this.resolveReady = null;
    this.rejectReady = null;
  }

  async create(videoId, { startSeconds = 0 } = {}) {
    this.videoId = videoId;
    this.readyPromise = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });

    try {
      await loadYouTubeApi();
      const origin = window.location.origin && window.location.origin !== "null"
        ? window.location.origin
        : undefined;

      this.player = new window.YT.Player(this.container.id, {
        videoId,
        host: "https://www.youtube-nocookie.com",
        playerVars: {
          autoplay: 0,
          controls: 0,
          disablekb: 1,
          enablejsapi: 1,
          fs: 0,
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
          iv_load_policy: 3,
          cc_load_policy: 0,
          start: Math.max(0, Math.floor(startSeconds || 0)),
          ...(origin ? { origin } : {}),
        },
        events: {
          onReady: (event) => this.handleReady(event),
          onStateChange: (event) => this.onStateChange?.(event.data),
          onError: (event) => this.onError?.(event.data),
        },
      });

      return await this.readyPromise;
    } catch (error) {
      this.rejectReady?.(error);
      this.onApiError?.(error);
      throw error;
    }
  }

  handleReady(event) {
    this.player = event.target;
    this.ready = true;
    this.resolveReady?.(this);
    this.onReady?.(this);

    if (this.pending) {
      const pending = this.pending;
      this.pending = null;
      this.load(pending.videoId, pending);
    }
  }

  load(videoId, { play = false, startSeconds = 0 } = {}) {
    if (!this.ready || !this.player) {
      this.pending = { videoId, play, startSeconds };
      return;
    }

    this.videoId = videoId;
    const start = Math.max(0, Math.floor(startSeconds || 0));
    if (play) {
      this.player.loadVideoById({ videoId, startSeconds: start });
    } else {
      this.player.cueVideoById({ videoId, startSeconds: start });
    }
  }

  play() {
    this.player?.playVideo?.();
  }

  pause() {
    this.player?.pauseVideo?.();
  }

  seekTo(seconds) {
    this.player?.seekTo?.(Math.max(0, seconds), true);
  }

  getCurrentTime() {
    try {
      return this.player?.getCurrentTime?.() || 0;
    } catch {
      return 0;
    }
  }

  getDuration() {
    try {
      return this.player?.getDuration?.() || 0;
    } catch {
      return 0;
    }
  }

  getState() {
    try {
      return this.player?.getPlayerState?.() ?? -1;
    } catch {
      return -1;
    }
  }

  setVolume(value) {
    try {
      this.player?.setVolume?.(Math.max(0, Math.min(100, value)));
    } catch {
      // Player may not be ready yet.
    }
  }

  mute() {
    try {
      this.player?.mute?.();
    } catch {
      // Ignore.
    }
  }

  unmute() {
    try {
      this.player?.unMute?.();
    } catch {
      // Ignore.
    }
  }

  isMuted() {
    try {
      return Boolean(this.player?.isMuted?.());
    } catch {
      return false;
    }
  }

  setPlaybackRate(rate) {
    try {
      this.player?.setPlaybackRate?.(rate);
    } catch {
      // Ignore.
    }
  }
}
