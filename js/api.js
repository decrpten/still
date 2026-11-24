import {
  parseISODuration,
  pickThumbnail,
} from "./core.js";

const API_BASE = "https://www.googleapis.com/youtube/v3";
const MAX_PLAYLIST_PAGES = 20;
const VIDEO_CHUNK_SIZE = 50;

export class ApiError extends Error {
  constructor(message, { status = 0, reason = "", code = "" } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.reason = reason;
    this.code = code;
  }
}

export function isKeyError(error) {
  if (!(error instanceof ApiError)) return false;
  if (error.code === "missingKey") return true;
  return ["keyInvalid", "ipRefererBlocked", "accessNotConfigured", "forbidden"].includes(error.reason);
}

export function humanizeApiError(error) {
  if (!error) return "Something went wrong. Try again.";
  if (error instanceof ApiError) {
    switch (error.reason) {
      case "missingKey":
        return "Add your YouTube Data API key first.";
      case "keyInvalid":
        return "That API key isn't valid. Check it in Settings.";
      case "quotaExceeded":
      case "dailyLimitExceeded":
        return "Today's YouTube API quota is used up. Try another key or wait until tomorrow.";
      case "ipRefererBlocked":
        return "This API key isn't allowed from this site. Add this page's origin to the key's HTTP referrer restrictions.";
      case "accessNotConfigured":
        return "Enable the YouTube Data API v3 for this key's Google Cloud project, then try again.";
      case "playlistNotFound":
        return "Playlist not found. It may be private, deleted, or the link may be wrong.";
      case "videoNotFound":
        return "Video not found. It may be private, deleted, or region-locked.";
      case "forbidden":
        return "YouTube refused the request. Check the key's API and HTTP referrer restrictions.";
      case "rateLimitExceeded":
        return "Too many requests to YouTube. Wait a moment, then try again.";
      default:
        break;
    }
    if (error.status === 404) return "That playlist or video couldn't be found.";
    if (error.status === 403) return "YouTube refused the request. Check the key's restrictions and quota.";
    if (error.status >= 500) return "YouTube had a problem. Try again in a moment.";
    return error.message || "The YouTube API request failed.";
  }
  if (error.name === "AbortError") return "Loading was cancelled.";
  if (error instanceof TypeError) return "Couldn't reach YouTube. Check your connection and any browser blockers.";
  return error.message || "Something went wrong. Try again.";
}

async function ytGet(endpoint, params, apiKey, signal) {
  if (!apiKey) {
    throw new ApiError("Missing API key", { code: "missingKey", reason: "missingKey" });
  }

  const url = new URL(`${API_BASE}/${endpoint}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  url.searchParams.set("key", apiKey);

  let response;
  try {
    response = await fetch(url, {
      signal,
      headers: { Accept: "application/json" },
    });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new TypeError("Network request failed");
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const apiError = data?.error;
    const reason = apiError?.errors?.[0]?.reason || apiError?.status || "";
    const message = apiError?.message || `YouTube API error ${response.status}`;
    throw new ApiError(message, {
      status: response.status,
      reason,
    });
  }

  return data;
}

async function fetchPlaylistItems(playlistId, apiKey, { signal, onProgress } = {}) {
  const items = [];
  let pageToken = "";
  let page = 0;
  let total = 0;

  do {
    const data = await ytGet(
      "playlistItems",
      {
        part: "snippet,contentDetails",
        playlistId,
        maxResults: 50,
        pageToken,
      },
      apiKey,
      signal,
    );

    total = data.pageInfo?.totalResults || total;
    items.push(...(data.items || []));
    pageToken = data.nextPageToken || "";
    page += 1;
    onProgress?.(items.length, total);

    if (page >= MAX_PLAYLIST_PAGES) break;
  } while (pageToken);

  return { items, total, truncated: Boolean(pageToken) };
}

async function fetchVideoDetails(videoIds, apiKey, signal) {
  const map = new Map();
  const uniqueIds = [...new Set(videoIds.filter(Boolean))];

  for (let i = 0; i < uniqueIds.length; i += VIDEO_CHUNK_SIZE) {
    const chunk = uniqueIds.slice(i, i + VIDEO_CHUNK_SIZE);
    const data = await ytGet(
      "videos",
      {
        part: "snippet,contentDetails",
        id: chunk.join(","),
        maxResults: VIDEO_CHUNK_SIZE,
      },
      apiKey,
      signal,
    );
    for (const video of data.items || []) {
      map.set(video.id, video);
    }
  }

  return map;
}

function buildPlaylistItem(playlistItem, video, fallbackChannel) {
  const videoId = playlistItem.contentDetails?.videoId || playlistItem.snippet?.resourceId?.videoId;
  const title = playlistItem.snippet?.title || video?.snippet?.title || "";
  if (!videoId) return null;
  if (title === "Deleted video" || title === "Private video") return null;

  const snippet = video?.snippet || {};
  const live = ["live", "upcoming"].includes(snippet.liveBroadcastContent || playlistItem.snippet?.liveBroadcastContent);
  const duration = live ? 0 : parseISODuration(video?.contentDetails?.duration);

  return {
    videoId,
    title: title || "Untitled lesson",
    channel:
      playlistItem.snippet?.videoOwnerChannelTitle ||
      playlistItem.snippet?.channelTitle ||
      snippet.channelTitle ||
      fallbackChannel ||
      "",
    thumbnail:
      pickThumbnail(playlistItem.snippet?.thumbnails, ["medium", "high", "default"]) ||
      pickThumbnail(snippet.thumbnails, ["medium", "high", "default"]),
    duration,
    live,
    publishedAt: playlistItem.contentDetails?.videoPublishedAt || snippet.publishedAt || "",
  };
}

export async function fetchPlaylist(playlistId, apiKey, { signal, onProgress, onStage } = {}) {
  onStage?.("details");
  const [metadataResponse, itemsResponse] = await Promise.all([
    ytGet(
      "playlists",
      {
        part: "snippet,contentDetails",
        id: playlistId,
        maxResults: 1,
      },
      apiKey,
      signal,
    ),
    fetchPlaylistItems(playlistId, apiKey, {
      signal,
      onProgress: (count, total) => onProgress?.(count, total),
    }),
  ]);

  const metadata = metadataResponse.items?.[0];
  if (!metadata) {
    throw new ApiError("Playlist not found", { status: 404, reason: "playlistNotFound" });
  }

  const channel = metadata.snippet?.channelTitle || "";
  onStage?.("durations");

  let videoMap = new Map();
  let durationWarning = "";
  try {
    const ids = (itemsResponse.items || [])
      .map((item) => item.contentDetails?.videoId)
      .filter(Boolean);
    videoMap = await fetchVideoDetails(ids, apiKey, signal);
  } catch (error) {
    if (error.name === "AbortError") throw error;
    durationWarning = humanizeApiError(error);
  }

  const items = (itemsResponse.items || [])
    .map((item) => buildPlaylistItem(item, videoMap.get(item.contentDetails?.videoId), channel))
    .filter(Boolean);

  if (items.length === 0) {
    throw new ApiError("This playlist has no playable videos", {
      status: 404,
      reason: "playlistNotFound",
    });
  }

  return {
    kind: "playlist",
    id: playlistId,
    title: metadata.snippet?.title || "Untitled playlist",
    description: metadata.snippet?.description || "",
    channel,
    thumbnail: pickThumbnail(metadata.snippet?.thumbnails, ["high", "medium", "default"]),
    items,
    count: items.length,
    truncated: itemsResponse.truncated || items.length > 1000,
    warning: durationWarning,
  };
}

export async function fetchSingleVideo(videoId, apiKey, { signal } = {}) {
  const data = await ytGet(
    "videos",
    {
      part: "snippet,contentDetails",
      id: videoId,
      maxResults: 1,
    },
    apiKey,
    signal,
  );

  const video = data.items?.[0];
  if (!video) {
    throw new ApiError("Video not found", { status: 404, reason: "videoNotFound" });
  }

  const live = ["live", "upcoming"].includes(video.snippet?.liveBroadcastContent);
  const item = {
    videoId,
    title: video.snippet?.title || "Untitled video",
    channel: video.snippet?.channelTitle || "",
    thumbnail: pickThumbnail(video.snippet?.thumbnails, ["high", "medium", "default"]),
    duration: live ? 0 : parseISODuration(video.contentDetails?.duration),
    live,
    publishedAt: video.snippet?.publishedAt || "",
  };

  return {
    kind: "single",
    id: `video:${videoId}`,
    title: "Single video",
    description: "",
    channel: item.channel,
    thumbnail: item.thumbnail,
    items: [item],
    count: 1,
    truncated: false,
    warning: "",
  };
}

export function parseYouTubeInput(rawInput) {
  const raw = String(rawInput || "").trim();
  if (!raw) {
    return { error: "Paste a YouTube playlist or video link first." };
  }

  let value = raw;
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(value) && /(?:youtube\.com|youtu\.be)/i.test(value)) {
    value = `https://${value}`;
  }

  let url = null;
  try {
    url = new URL(value);
  } catch {
    url = null;
  }

  if (url) {
    const host = url.hostname.replace(/^www\./i, "").replace(/^m\./i, "").replace(/^music\./i, "");
    const isYouTube = host === "youtu.be" || host === "youtube.com" || host.endsWith(".youtube.com");
    if (!isYouTube) {
      return { error: "That doesn't look like a YouTube link." };
    }

    const list = url.searchParams.get("list");
    if (list && isPlaylistId(list)) {
      return {
        type: "playlist",
        id: list,
        startVideoId: isVideoId(url.searchParams.get("v")) ? url.searchParams.get("v") : "",
      };
    }

    if (host === "youtu.be") {
      const videoId = url.pathname.split("/").filter(Boolean)[0];
      if (isVideoId(videoId)) return { type: "video", id: videoId };
      return { error: "Couldn't find a video ID in that link." };
    }

    const path = url.pathname.replace(/\/+$/, "");
    const pathVideo =
      path.match(/\/(?:embed|shorts|live|v)\/([A-Za-z0-9_-]{11})(?:\/|$)/)?.[1] ||
      url.searchParams.get("v");

    if (isVideoId(pathVideo)) {
      return { type: "video", id: pathVideo };
    }

    const pathPlaylist = path.match(/\/playlist\/([A-Za-z0-9_-]+)(?:\/|$)/)?.[1];
    if (isPlaylistId(pathPlaylist)) {
      return { type: "playlist", id: pathPlaylist, startVideoId: "" };
    }

    if (list) {
      return { error: "That playlist ID doesn't look valid." };
    }

    return { error: "Paste a playlist link, video link, or playlist ID." };
  }

  // Raw IDs and pasted query strings.
  if (/[?&]list=/.test(raw)) {
    const params = new URLSearchParams(raw.replace(/^\?/, ""));
    const list = params.get("list");
    if (isPlaylistId(list)) {
      return {
        type: "playlist",
        id: list,
        startVideoId: isVideoId(params.get("v")) ? params.get("v") : "",
      };
    }
  }

  if (isPlaylistId(raw)) {
    return { type: "playlist", id: raw, startVideoId: "" };
  }

  if (isVideoId(raw)) {
    return { type: "video", id: raw };
  }

  return { error: "Couldn't find a playlist or video ID in that. Check the link and try again." };
}

function isVideoId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{11}$/.test(value);
}

function isPlaylistId(value) {
  if (typeof value !== "string") return false;
  if (!/^[A-Za-z0-9_-]{10,}$/.test(value)) return false;
  // Common YouTube playlist prefixes: PL, UU, LL, FL, OL, RD, PU, SB, WL.
  return /^(PL|UU|LL|FL|OL|RD|PU|SB|WL)/.test(value) || value.length >= 12;
}
