# Danimados

Spanish-language provider for western animated series ("cartoons") from
[danimados.cc](https://danimados.cc/). The site is WordPress with the DooPlay
theme, so the provider follows the theme's data flow:

1. `search()` parses `/?s=<query>` (`.result-item` cards) and returns the
   `/series/<slug>/` URLs as opaque IDs.
2. `findEpisodes()` parses `#seasons .se-c` on the series page. Episode numbers
   are made absolute across seasons, in the order the site lists them.
3. `findEpisodeServer()` reads `#playeroptions li.dooplay_player_option`, then
   POSTs to `admin-ajax.php` with `action=doo_player_ajax` to obtain the
   `embed_url`.

## Embed resolution

The available hosts (StreamWish, VidHide, Filemoon and Voe) render their player
with JavaScript. `findEpisodeServer()` therefore uses `ChromeDP` first: it
listens for `Network.responseReceived` events (HLS/MP4 responses), waits for the
player, and evaluates the page to collect `<video>` sources, JWPlayer/VideoJS
configs and any `.m3u8`/`.mp4` URLs in the DOM. A plain `fetch` regex pass is
used as a fallback when `ChromeDP` is unavailable.

## Limitations

- Only one audio track is exposed, so `supportsDub` is `false`.
- Episode numbering is absolute across seasons; Seanime's `absoluteSeasonOffset`
  is not applied because `findEpisodes()` only receives the series ID.
- Host availability and anti-bot behavior can change without notice.
