# Nova Player

A Netflix-style IPTV player for Samsung smart TVs (Tizen). Supports Xtream Codes accounts and M3U playlists, with a demo library for trying it out.

## What's in it

- **Netflix-style browsing**: the billboard at the top shows details for whatever is focused. Below it are rows for Continue Watching, Top Picks for You, My List, Recently Added and every category.
- **Background art from TMDB** ([js/artwork.js](js/artwork.js)): many providers send no wide backdrop for most movies, which leaves a small poster where the big picture should be. With a free TMDB API key in **Settings → Background art**, Nova fetches the full-size backdrop from TMDB instead. Movies are looked up by the TMDB id most Xtream providers include. Series and other titles are searched by name and year, and only an exact title match is used, so a sequel's picture never lands on the original. Each title is looked up once and remembered on the device. The TV loads the 1280-pixel-wide version (originals are often 4K and slow to decode); a computer loads the original. To get a key, sign up at themoviedb.org and open Settings → API. Either the API key or the Read Access Token works. To skip typing it on the TV, put it in `js/local-config.js` (not in git) as `Nova.localConfig = { tmdbKey: '…' };` and it is built into the app by `tv-update.sh`.
- **Suggestions and ratings** ([js/recommend.js](js/recommend.js)):
  - Each movie and series page has a 1–5 star rating at the end of its button row. Press Right past My List, or press 1–5 on the remote (0 removes the rating).
  - Home gets **Top Picks for You** and up to two **Because You Watched / Liked …** rows. Movies and Series get Top Picks too, narrowed to the region filter when one is chosen.
  - Suggestions match on category, region, genre, cast, director and decade. A title counts once you've watched about two minutes of it (or half of a short clip). Finished titles, loved ones and titles with many episodes watched count most. Recent ones count more than old ones, and My List counts a little. 1–2 star ratings push similar titles down. Watched and rated titles aren't suggested again.
  - Movie lists from Xtream don't include genres, so movie suggestions mostly match on category and region until you open titles' pages.
  - Everything stays on the TV. Settings has **Clear watch history** (also clears the history behind suggestions) and **Clear ratings**.
- **Fast**: your library is cached on the TV, so the app opens instantly and refreshes in the background. Only the cards on screen are drawn, so a 50,000-title catalogue scrolls as smoothly as a small one.
- **Player**:
  - Movies and series: left/right pauses and scrubs Netflix-style, with a preview of the frame at the chosen spot above the bar (hold to go faster: steps grow from 10 s to 30 s to 60 s). OK or Play plays from there, Back returns to where you were. The paused picture itself moves to the spot. In a browser, accounts that allow more than one connection (and the demo) also get a thumbnail. It needs a second connection to the stream, which would cut off the movie on one-connection accounts. The TV never shows thumbnails, because it has only one video decoder. Also ±10 s skip buttons, resume where you left off, a next-episode countdown with auto-play, and an "Ends at" time.
  - Menus for audio, subtitles, quality, speed and picture fit. Your audio and subtitle language choice is remembered.
  - Subtitles are drawn by the app, so their size can be changed in Settings.
  - Stream info overlay, plus automatic reconnect when a stream drops.
- **Live TV**:
  - A guide with categories and channels, showing now/next programme information.
  - In the player: instant zapping, type a channel number, jump back to the previous channel, a channel list overlay, and favourites.
- **Search** with an on-screen keyboard in English or Arabic (the عربي / ABC key switches). Results are instant because the search runs on the cached library. It ignores capitals, accents, spaces and punctuation, so "spiderman" finds "Spider-Man", and treats Arabic spelling variants (أ إ آ ا, ة ه, ى ي) and diacritics as the same.
- **Region and topic filters** on Movies, Series and Live TV: Arabic, Western, Turkish, Indian, Korean, Japanese, Chinese, Other Asian, Anime, European, Kids, Sports, News and Religious. Press Up from the first row, or click a chip. Each title belongs to exactly one filter. When it fits several, the most specific one wins: Anime before Japanese, Kids before Arabic, Korean before Western. A filtered view shows Recently Added, then each category's matching titles, then genre rows such as "Drama" and "Comedy".

  How titles get sorted ([js/regions.js](js/regions.js)):
  - **Category names** cover most of it: "ARABIC …", "ENGLISH …", "TURKEY …", "FRANCE CHANNELS" and so on.
  - **Series** are split into Korean, Japanese, Chinese and Thai by their cast names, which come with the series list. This also finds Korean and Japanese shows filed under general categories like "NETFLIX SERIES".
  - **Asian movies** are sorted by the country in each movie's info. That takes one request per title, so it runs in the background the first time you open Movies. It makes one request every 1.5 seconds and waits longer whenever the provider rate-limits, so roughly 25 minutes for ~950 titles. Results are saved on the device as they come in. Later visits only look up the titles that are still missing or newly added, and an interrupted sort carries on where it stopped.
  - **Provider tags** at the end of titles, like "(ANM 2026)" for anime, are used for sorting and then hidden from the displayed title.

## Remote keys

| Key | Browsing | Player (movies/series) | Player (live) |
|---|---|---|---|
| Arrows | Move | Left/Right scrub, Down shows buttons | Up/Down change channel, Left/Right show buttons |
| OK | Open | Play/pause, or confirm scrub | Channel list |
| Back | Menu / back | Hide controls, then exit | Hide, then exit |
| Play/Pause | | Play/pause | |
| FF / RW | | Jump 30 s | |
| CH+ / CH− | Page through channels | | Change channel |
| 0–9 | 1–5 rates a title, 0 removes it | | Go to channel number |
| PRE-CH / Green | | | Previous channel |
| Yellow | Add/remove My List | | Favourite |
| Info | | Stream info | Info banner |

On a computer keyboard: Backspace or Esc = Back, Space = Play/Pause, PageUp/PageDown = CH+/−, `[` `]` = RW/FF, `I` = Info, `F` = Yellow.

With a mouse:
- **Everything is clickable:** posters, menus, buttons, channels and the search keyboard.
- **Rows:** the scroll wheel moves between rows, and hovering a row shows arrows that page through it.
- **Back:** the ← button at the top left, or your mouse's back button.
- **Player:** moving the mouse shows the controls. Click the picture to pause, hover the progress bar to preview a frame, click it to jump, and double-click for full screen.

## Try it on your computer

You need [Node.js](https://nodejs.org) 18 or newer. From this folder:

```bash
node dev-server.js
```

Then open http://localhost:8080 and choose **Try the demo**, or sign in with your provider. The dev server forwards IPTV requests so the browser's cross-site (CORS) restrictions don't block them. The TV doesn't need this.

Firefox plays MKV movies without sound, so in Firefox the dev server repackages them as MP4 on the fly. This needs [ffmpeg](https://ffmpeg.org) installed. Nothing is re-encoded, so it starts right away. Each skip or jump restarts the stream from the new position.

## Install on your Samsung TV

1. **Install Tizen Studio** from developer.samsung.com/smarttv. In its Package Manager, add *Samsung TV Extensions* and *Samsung Certificate Extension*.
2. **Turn on Developer Mode on the TV**:
   1. Open **Apps**, then type `1 2 3 4 5` on the remote.
   2. Switch Developer Mode **On** and enter your computer's IP address.
   3. Restart the TV.
3. **Connect to the TV**: in Tizen Studio, open *Tools → Device Manager → Remote Device Manager*, add the TV's IP address and connect.
4. **Create a Samsung certificate**: *Tools → Certificate Manager → + → Samsung*. Choose *TV*, sign in with a Samsung account, and include the TV's DUID (Device Manager fills it in).
5. **Build and install** from a terminal:

   ```bash
   tizen package -t wgt -s <your-certificate-profile> -- ~/nova-player
   ```

   ```bash
   tizen install -n NovaPlayer.wgt -t <tv-device-name>
   ```

   You can also import the folder as a Tizen web project in Tizen Studio and use *Run As → Tizen Web Application*.

Nova then appears in the TV's Apps list.

### Updating

After the first install, one command builds the app, replaces the old version on the TV and opens it:

```bash
./tv-update.sh <tv-ip> <your-certificate-profile>
```

Your sign-in, My List, watch progress and sorted movies stay on the TV.

On the TV it plays through Samsung's built-in AVPlay video player, which handles MPEG-TS, HLS, MKV and the TV's hardware decoding.

## Project layout

```
config.xml           Tizen app manifest (permissions, app ID)
index.html           Page shell
css/app.css          All styling (1920×1080)
js/util.js           Helpers, icons, HTTP
js/store.js          Settings, library cache (IndexedDB), watch progress, favourites
js/recommend.js      Watch history, ratings and suggestions
js/artwork.js        Background art from TMDB
js/api.js            Xtream Codes, M3U and demo providers behind one interface
js/keys.js           Remote and keyboard mapping
js/ui.js             Screen router, side menu, dialogs, panels, cards
js/rows.js           Virtualized card rows
js/engines.js        AVPlay (TV) and HTML5/hls.js (browser) playback engines
js/screens/*.js      Login, Browse, Details, Live TV, Search, Settings, Player
dev-server.js        Local server and CORS proxy for testing in a browser
```

## Notes

- Live channels use MPEG-TS on the TV by default, which starts fastest. If your provider's channels don't start, set **Settings → Live stream format → HLS**.
- If you paste an Xtream `get.php?username=…&password=…` link into the M3U tab, it switches to the Xtream API automatically. That gives you posters, plots, seasons and the programme guide.
- The programme guide (EPG) comes from Xtream's short-EPG API. Plain M3U playlists don't include one.
