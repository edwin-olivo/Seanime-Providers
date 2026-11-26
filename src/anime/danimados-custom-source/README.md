# Danimados Custom Source

Adds the complete [Danimados](https://danimados.cc/) catalog of western
animated series and cartoons as a Seanime **custom source**. Unlike an
`onlinestream-provider`, a custom source is searchable by free text and does
not require the series to exist in AniList.

## What it does

- `listAnime(search, page, perPage)`:
  - with text: queries `https://danimados.cc/?s=<query>` (WordPress search);
  - without text: browses `https://danimados.cc/series/page/N/` (~50 items per
    page, 31 pages at the time of writing).
  - Returns AniList-shaped `AL_BaseAnime` objects with title, poster, year and
    `siteUrl` pointing at the Danimados series page.
- `getAnime` / `getAnimeWithRelations`: rebuild the media from the cached
  series page when Seanime opens a title.
- `getAnimeMetadata`: parses `#seasons .se-c ul.episodios` and returns the
  episode list (absolute numbers, season, title, thumbnail, air date).

Local numeric IDs are a stable hash of the series URL; the URL↔ID map is kept
in `$store` so IDs survive restarts. Seanime remaps those local IDs to global
media IDs internally.

## Pairing with the streaming provider

This source only supplies **catalog and metadata**. To play episodes, also
install the Danimados `onlinestream-provider` (`src/anime/danimados/`). When
Seanime searches streams for a series opened from this custom source, the
streaming provider receives the Danimados title in `SearchOptions` and
resolves the episodes and video sources from the same site.

## Limitations

- Custom sources cannot be tested in the Playground; load them in development
  mode or install the manifest normally and browse them from the Custom
  Sources / Discover section.
- `getAnimeDetails` returns `null` (no extra genres/description beyond the
  catalog card).
- Video hosts are JavaScript-driven, so the streaming provider needs ChromeDP
  to resolve `.m3u8`/`.mp4` sources.
