# still.

A study-first YouTube wrapper. Paste a course playlist and get a clean player with **no home feed, no recommendations, no comments, and no rabbit holes** — just the lesson and its playlist.

It is a zero-dependency frontend. Playback uses the official YouTube IFrame player; playlist data comes from the YouTube Data API v3 with your own API key.

## What it does

- Loads public or unlisted YouTube playlists (or a single video).
- Shows only the current video and that playlist.
- Uses custom playback controls, so the normal YouTube end screen and related-video UI stay covered.
- Auto-advances through the playlist (optional).
- Saves watch progress, resume position, speed, and volume in `localStorage`.
- Keeps a small local course library with progress.
- Search inside the playlist.
- Focus mode hides the playlist entirely.
- Keyboard shortcuts: `Space`, `←`/`→`, `↑`/`↓`, `M`, `F`, `N`, `P`, `/`.

## Setup

### 1. Get a YouTube Data API key

1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Create a project (or pick an existing one).
3. Go to **APIs & Services → Library**, find **YouTube Data API v3**, and enable it.
4. Go to **APIs & Services → Credentials → Create credentials → API key**.
5. Restrict the key:
   - **API restrictions:** YouTube Data API v3 only.
   - **Application restrictions → HTTP referrers:** add your site, for example:
     - `http://localhost:4173/*`
     - `http://127.0.0.1:4173/*`
     - `https://your-site.example/*` if you deploy it.

If the key is unrestricted, it still works, but restricting it is strongly recommended.

### 2. Run the frontend

```bash
npm start
```

Then open <http://localhost:4173>.

You can also use any static file server, for example:

```bash
python3 -m http.server 4173
```

Do **not** open `index.html` directly with `file://` — the YouTube player and API requests need a real HTTP origin.

### 3. Use it

1. Paste your API key on the landing page.
2. Paste a playlist link like `https://www.youtube.com/playlist?list=PL...`, a watch link that contains `list=...`, or a raw playlist ID.
3. Pick a lesson. Progress is stored locally as you watch.

The key is kept in `localStorage` and sent directly from your browser to Google. There is no backend and no analytics.

## Playlist support

- **Public and unlisted** playlists work with an API key.
- **Private playlists**, Watch Later, and Liked Videos require OAuth, which this app intentionally does not do.
- A playlist can contain up to 1,000 loaded lessons; the app caps pagination to avoid runaway API use.
- Videos with embedding disabled cannot play inside any wrapper. The app will offer an “Open on YouTube” link when YouTube rejects a video.

## Ads and recommendations

This app does not, and cannot, block ads. YouTube's embedded player controls ad delivery, and the IFrame/Data APIs do not provide ad-free playback. Your browser ad blocker is still the right tool for that.

What the app *does* remove is the recommendation surface around the video: there is no home feed, no suggested-video rail, no comments, and no related-video browsing. At the end of a lesson the app covers the player and advances or shows a clean end card.

## Files

```text
index.html      markup and UI
styles.css      all styles
app.js          UI, state, routing, player wiring
api.js          YouTube Data API calls and link parsing
core.js         shared helpers and formatting
player.js       YouTube IFrame API wrapper
server.js       tiny zero-dependency static server
```

## API quota

The YouTube Data API gives most projects 10,000 quota units per day. Loading a playlist costs roughly:

- 1 unit for playlist metadata
- 1 unit per 50 playlist items
- 1 unit per 50 videos for durations

A typical 100-lesson course is a handful of units. If you see a quota error, use another key/project or wait for the daily reset.

## Notes

- This is not affiliated with YouTube.
- It does not download videos, bypass age restrictions, or get around embedding permissions.
- If you deploy it, use HTTPS and add the deployed origin to the API key's HTTP referrer restrictions.
