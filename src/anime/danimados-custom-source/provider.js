/// <reference path="./custom-source.d.ts" />

/**
 * Danimados Custom Source
 *
 * Exposes the full Danimados catalog (western animated series / cartoons) as a
 * Seanime custom source, so it can be searched by free text without an AniList
 * entry. Episode playback is handled by the companion onlinestream provider at
 * src/anime/danimados/provider.js.
 */

class Provider {
  constructor() {
    this.base = "https://danimados.cc";
    this.userAgent =
      "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36";
    this.idsKey = "danimados.custom.ids";
    this.seriesKeyPrefix = "danimados.custom.series.";
  }

  getSettings() {
    return { supportsAnime: true, supportsManga: false };
  }

  async listAnime(search, page, perPage) {
    const term = String(search || "").trim();
    const currentPage = Math.max(1, parseInt(page, 10) || 1);
    const size = Math.max(1, parseInt(perPage, 10) || 20);

    let url;
    if (term) {
      url = `${this.base}/?s=${encodeURIComponent(term)}`;
      if (currentPage > 1) url += `&paged=${currentPage}`;
    } else {
      url = currentPage > 1 ? `${this.base}/series/page/${currentPage}/` : `${this.base}/series/`;
    }

    let html;
    try {
      html = await (await this.request(url)).text();
    } catch (error) {
      console.log(`[Danimados CS] listAnime failed: ${error?.message || error}`);
      return { media: [], page: currentPage, totalPages: currentPage, total: 0 };
    }

    const $ = LoadDoc(html);
    const items = [];
    const seen = {};

    if (term) {
      $(".result-item article").each((_, element) => {
        const link = element.find(".title a").first();
        const href = link.attr("href") || "";
        if (!/\/series\//.test(href)) return;
        const seriesUrl = this.absoluteUrl(href);
        if (seen[seriesUrl]) return;
        seen[seriesUrl] = true;
        items.push({
          url: seriesUrl,
          title: link.text().trim(),
          image: this.absoluteUrl(element.find(".image img").first().attr("src") || ""),
          year: parseInt(element.find(".meta .year").first().text(), 10) || undefined,
        });
      });
    } else {
      // The archive mixes two card layouts: slider cards use ".image",
      // main grid cards use ".poster"; both are article.item elements.
      $("article.item").each((_, element) => {
        let href = "";
        element.find("a").each((__, anchor) => {
          const candidate = anchor.attr("href") || "";
          if (!href && /\/series\//.test(candidate)) href = candidate;
        });
        if (!href) return;
        const seriesUrl = this.absoluteUrl(href);
        if (seen[seriesUrl]) return;
        seen[seriesUrl] = true;
        const imageSrc = element.find(".image img").first().attr("src") ||
          element.find(".poster img").first().attr("src") || "";
        const title = element.find(".data h3.title").first().text().trim() ||
          element.find(".image img").first().attr("alt") ||
          element.find(".poster img").first().attr("alt") || "";
        const year = parseInt(element.find(".data span").first().text(), 10) || undefined;
        items.push({ url: seriesUrl, title, image: this.absoluteUrl(imageSrc), year });
      });
    }

    const totalPages = this.parseTotalPages($, currentPage);
    const media = [];
    for (const item of items) media.push(this.toBaseAnime(item));
    console.log(`[Danimados CS] listAnime "${term}" page ${currentPage}: ${media.length} items of ${totalPages} pages`);
    return { media, page: currentPage, totalPages, total: totalPages * size };
  }

  async getAnime(ids) {
    const out = [];
    for (const id of ids || []) {
      const url = this.urlForId(Number(id));
      if (!url) continue;
      const info = await this.fetchSeries(url, Number(id));
      if (!info) continue;
      out.push(this.toBaseAnime({
        url,
        title: info.title,
        image: info.image,
        year: info.year,
        episodes: info.episodes.length,
      }));
    }
    return out;
  }

  async getAnimeWithRelations(id) {
    const list = await this.getAnime([id]);
    if (!list.length) throw new Error(`[Danimados CS] No media for id ${id}`);
    return Object.assign({}, list[0], { relations: { edges: [] } });
  }

  async getAnimeMetadata(id) {
    const url = this.urlForId(Number(id));
    if (!url) return null;
    const info = await this.fetchSeries(url, Number(id));
    if (!info) return null;

    const episodes = {};
    for (const episode of info.episodes) {
      episodes[String(episode.number)] = {
        anidbId: 0,
        tvdbId: 0,
        anidbEid: 0,
        title: episode.title || `Episodio ${episode.number}`,
        image: episode.image || "",
        airDate: episode.date || "",
        length: 0,
        summary: "",
        overview: "",
        episodeNumber: episode.number,
        episode: String(episode.number),
        seasonNumber: episode.season,
        absoluteEpisodeNumber: episode.number,
        hasImage: !!episode.image,
      };
    }
    return {
      titles: { en: info.title, es: info.title },
      episodes,
      episodeCount: info.episodes.length,
      specialCount: 0,
      mappings: {},
    };
  }

  async getAnimeDetails(_id) {
    return null;
  }

  async getManga(_ids) {
    return [];
  }

  async getMangaDetails(_id) {
    return null;
  }

  async listManga(_search, page) {
    return { media: [], page: page || 1, totalPages: 1, total: 0 };
  }

  // ---- helpers ---------------------------------------------------------

  toBaseAnime(item) {
    const title = item.title || item.url;
    const image = item.image || "";
    const cover = image
      ? { extraLarge: image, large: image, medium: image, color: "" }
      : undefined;
    return {
      id: this.localId(item.url),
      siteUrl: item.url,
      type: "ANIME",
      format: "TV",
      status: "FINISHED",
      title: { english: title, romaji: title, native: title, userPreferred: title },
      // These two are non-standard extras, but they make the companion
      // streaming provider's SearchOptions reliable regardless of mapping.
      englishTitle: title,
      romajiTitle: title,
      synonyms: [title],
      coverImage: cover,
      bannerImage: image || undefined,
      description: "",
      genres: [],
      isAdult: false,
      episodes: item.episodes || undefined,
      seasonYear: item.year,
      startDate: item.year ? { year: item.year } : undefined,
    };
  }

  parseTotalPages($, fallback) {
    let total = fallback;
    const text = $(".pagination span").first().text();
    const match = text.match(/de\s+(\d+)/i);
    if (match) return parseInt(match[1], 10) || fallback;
    $(".pagination a").each((_, element) => {
      const value = parseInt(element.text(), 10);
      if (Number.isFinite(value) && value > total) total = value;
    });
    return total;
  }

  async fetchSeries(url, id) {
    const key = `${this.seriesKeyPrefix}${id}`;
    const cached = $store.get(key);
    if (cached && cached.title) return cached;

    const res = await this.request(url);
    const $ = LoadDoc(await res.text());
    const title = $(".sheader .data h1").first().text().trim() ||
      $(".sheader .poster img").first().attr("alt") || "";
    const image = this.absoluteUrl($(".sheader .poster img").first().attr("src") || "", url);
    const meta = $(".sheader .meta-top").first().text();
    const yearMatch = meta.match(/\b(?:19|20)\d{2}\b/);

    const episodes = [];
    let absolute = 0;
    $("#seasons .se-c").each((_, seasonElement) => {
      const season = parseInt(seasonElement.find(".se-q .se-t").first().text(), 10) || 1;
      seasonElement.find("ul.episodios li").each((__, item) => {
        const link = item.find(".episodiotitle a").first();
        const href = link.attr("href");
        if (!href) return;
        absolute += 1;
        const numbering = item.find(".numerando").first().text().trim();
        const match = numbering.match(/(\d+)\s*-\s*(\d+)/);
        episodes.push({
          number: absolute,
          season,
          seasonNumber: match ? parseInt(match[2], 10) : absolute,
          title: link.text().trim(),
          url: this.absoluteUrl(href, url),
          image: this.absoluteUrl(item.find(".imagen img").first().attr("src") || "", url),
          date: item.find(".date").first().text().trim(),
        });
      });
    });

    const info = {
      title: title || url,
      image,
      year: yearMatch ? parseInt(yearMatch[0], 10) : undefined,
      episodes,
    };
    $store.set(key, info);
    return info;
  }

  getIdMap() {
    const map = $store.get(this.idsKey);
    if (map && map.byUrl && map.byId) return map;
    return { byUrl: {}, byId: {} };
  }

  localId(url) {
    const key = String(url);
    const map = this.getIdMap();
    if (map.byUrl[key]) return map.byUrl[key];
    let hash = 2166136261;
    for (let i = 0; i < key.length; i++) {
      hash = (hash * 31 + key.charCodeAt(i)) % 2147483647;
    }
    if (hash < 1) hash = 1;
    while (map.byId[String(hash)] && map.byId[String(hash)] !== key) {
      hash = (hash + 1) % 2147483647;
      if (hash < 1) hash = 1;
    }
    map.byUrl[key] = hash;
    map.byId[String(hash)] = key;
    $store.set(this.idsKey, map);
    return hash;
  }

  urlForId(id) {
    return this.getIdMap().byId[String(id)] || "";
  }

  absoluteUrl(url, base = this.base) {
    if (!url) return "";
    try { return new URL(String(url), base).toString(); } catch (error) { return String(url); }
  }

  async request(url, options = {}) {
    const { headers, ...rest } = options;
    const res = await fetch(url, {
      ...rest,
      headers: { "User-Agent": this.userAgent, ...(headers || {}) },
    });
    if (!res.ok) throw new Error(`Request failed (${res.status}): ${url}`);
    return res;
  }
}

if (typeof globalThis !== "undefined") globalThis.Provider = Provider;
