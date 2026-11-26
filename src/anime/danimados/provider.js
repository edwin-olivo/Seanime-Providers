/// <reference path="../online-streaming-provider.d.ts" />

/**
 * Danimados - Spanish-language western animated series (cartoons).
 *
 * The site runs WordPress with the DooPlay theme:
 *  - Search:        /?s=<query>              -> .result-item articles
 *  - Episodes:      /series/<slug>/          -> #seasons .se-c ul.episodios
 *  - Player data:   /wp-admin/admin-ajax.php (action=doo_player_ajax)
 *  - Embed hosts:   StreamWish / VidHide / Filemoon / Voe (all JS-driven)
 */

const EXTRACT_SOURCES_JS = `(function(){
  var found = [];
  function add(value) {
    if (typeof value !== 'string' || !value) return;
    try { value = new URL(value, location.href).href; } catch (e) { return; }
    if (!/^https?:/.test(value)) return;
    if (/\\.(?:png|jpe?g|gif|webp|svg|css|js|ico)(?:\\?|$)/i.test(value)) return;
    if (/test-videos|bigbuckbunny|example\\.com|gtv-videos-bucket|commondatastorage|bitmovin/i.test(value)) return;
    if (found.indexOf(value) === -1) found.push(value);
  }
  try {
    var video = document.querySelector('video');
    if (video) {
      add(video.src);
      add(video.currentSrc);
      Array.prototype.forEach.call(video.querySelectorAll('source'), function (source) { add(source.src); });
    }
  } catch (e) {}
  try {
    if (window.jwplayer) {
      var jw = window.jwplayer();
      if (jw && jw.getConfig) {
        var config = jw.getConfig();
        (config.sources || []).forEach(function (source) { add(source.file || source.src); });
      }
    }
  } catch (e) {}
  try {
    var vjs = document.querySelector('.video-js video');
    if (vjs && vjs.player && vjs.player.sources) {
      (vjs.player.sources() || []).forEach(function (source) { add(source.src); });
    }
  } catch (e) {}
  try {
    var html = document.documentElement.outerHTML;
    var regex = /https?:[^"'<>\\s\\\\]+\\.(?:m3u8|mp4)(?:\\?[^"'<>\\s]*)?/gi;
    var match;
    while ((match = regex.exec(html)) !== null) add(match[0].replace(/&amp;/g, '&'));
  } catch (e) {}
  return found;
})()`;

class Provider {
  constructor() {
    this.base = "https://danimados.cc";
    this.ajaxUrl = `${this.base}/wp-admin/admin-ajax.php`;
    this.userAgent =
      "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36";
  }

  getSettings() {
    return {
      episodeServers: ["StreamWish", "VidHide", "Filemoon", "Voe"],
      supportsDub: false,
    };
  }

  buildQueries(opts) {
    const raw = [];
    const push = value => {
      const text = String(value || "").trim();
      if (text && raw.indexOf(text) === -1) raw.push(text);
    };

    // Seanime passes SearchOptions; the Playground/checker may pass a plain string.
    push(opts && typeof opts === "object" && (opts.query || (opts.opts && opts.opts.query)));
    if (typeof opts === "string") push(opts);
    const media = opts && opts.media;
    if (media) {
      push(media.englishTitle);
      push(media.romajiTitle);
      (media.synonyms || []).forEach(push);
    }

    const queries = [];
    for (const value of raw.slice(0, 8)) {
      const spanish = value.replace(/\s+and\s+/gi, " y ").replace(/\s*&\s*/g, " y ");
      const base = spanish.replace(/\s*[:(]\s*[^:(]*$/, "").trim();
      const variants = [value, spanish, base];
      for (const variant of variants) {
        const text = String(variant || "").trim();
        if (text && queries.indexOf(text) === -1) queries.push(text);
      }
    }
    return queries.slice(0, 12);
  }

  parseResults(html) {
    const $ = LoadDoc(html);
    const results = [];
    const seen = new Set();

    $(".result-item article").each((_, element) => {
      const $item = element;
      const link = $item.find(".title a").first();
      const url = this.absoluteUrl(link.attr("href") || "");
      const title = link.text().trim();
      if (!title || !/\/series\//.test(url) || seen.has(url)) return;
      seen.add(url);
      results.push({ id: url, title, url, subOrDub: "sub" });
    });
    return results;
  }

  async search(opts) {
    const queries = this.buildQueries(opts);
    console.log(`[Danimados] search queries: ${JSON.stringify(queries)}`);

    let results = [];
    for (const query of queries) {
      try {
        const res = await this.request(`${this.base}/?s=${encodeURIComponent(query)}`);
        const parsed = this.parseResults(await res.text());
        if (parsed.length) {
          console.log(`[Danimados] matched query: ${query}`);
          results = parsed;
          break;
        }
      } catch (error) {
        console.log(`[Danimados] search request failed for "${query}": ${error?.message || error}`);
      }
    }

    console.log(`[Danimados] series found: ${results.length}`);

    // Expose one search entry per season so findEpisodes() can return episode
    // numbers starting at 1 for each season (same approach as aniworld).
    const expanded = [];
    for (const result of results) {
      try {
        const seasons = await this.getSeasons(result.url);
        if (seasons.length <= 1) {
          expanded.push(result);
          continue;
        }
        for (const season of seasons) {
          expanded.push({
            id: `${result.url}|season:${season}`,
            title: `${result.title} - Temporada ${season}`,
            url: result.url,
            subOrDub: "sub",
          });
        }
      } catch (error) {
        expanded.push(result);
      }
    }
    console.log(`[Danimados] results returned: ${expanded.length}`);
    return expanded;
  }

  async getSeasons(seriesUrl) {
    const res = await this.request(seriesUrl);
    const $ = LoadDoc(await res.text());
    const seasons = [];
    $("#seasons .se-c").each((_, element) => {
      const number = parseInt(element.find(".se-q .se-t").first().text(), 10);
      if (Number.isFinite(number) && !seasons.includes(number)) seasons.push(number);
    });
    return seasons;
  }

  async findEpisodes(id) {
    const parts = String(id).split("|");
    const seriesUrl = this.absoluteUrl(parts[0]);
    const seasonPart = parts.find(part => part.startsWith("season:"));
    const onlySeason = seasonPart ? parseInt(seasonPart.split(":")[1], 10) : null;

    const res = await this.request(seriesUrl);
    const $ = LoadDoc(await res.text());
    const seasons = [];
    $("#seasons .se-c").each((_, element) => seasons.push(element));

    // A bare series ID with several seasons would produce duplicate numbers,
    // so fall back to absolute numbering only in that case.
    const absoluteFallback = onlySeason === null && seasons.length > 1;
    console.log(`[Danimados] findEpisodes ${seriesUrl} season=${onlySeason || "all"}`);
    const episodes = [];
    const seen = new Set();
    let absolute = 0;

    seasons.forEach(seasonElement => {
      const $season = seasonElement;
      const season = parseInt($season.find(".se-q .se-t").first().text(), 10) || 1;
      if (onlySeason !== null && season !== onlySeason) return;

      $season.find("ul.episodios li").each((__, item) => {
        const $item = item;
        const link = $item.find(".episodiotitle a").first();
        const href = link.attr("href");
        if (!href) return;

        const url = this.absoluteUrl(href);
        if (seen.has(url)) return;
        seen.add(url);

        absolute += 1;
        const numbering = $item.find(".numerando").first().text().trim();
        const match = numbering.match(/(\d+)\s*-\s*(\d+)/);
        const seasonNumber = match ? parseInt(match[2], 10) : absolute;
        const number = absoluteFallback ? absolute : seasonNumber;
        const title = link.text().trim() || `Episodio ${seasonNumber}`;

        episodes.push({
          id: url,
          number,
          url,
          title: absoluteFallback ? `T${season}E${seasonNumber} - ${title}` : title,
        });
      });
    });

    console.log(`[Danimados] findEpisodes returned ${episodes.length} episodes`);
    return episodes;
  }

  async findEpisodeServer(episode, server) {
    const episodeUrl = this.absoluteUrl(episode.url || episode.id);
    const res = await this.request(episodeUrl);
    const $ = LoadDoc(await res.text());

    const options = [];
    $("#playeroptions li.dooplay_player_option").each((_, element) => {
      const $option = element;
      options.push({
        name: $option.find(".title").first().text().trim() || "Video",
        post: $option.attr("data-post") || "",
        nume: $option.attr("data-nume") || "1",
        type: $option.attr("data-type") || "tv",
      });
    });
    console.log(`[Danimados] findEpisodeServer ${episodeUrl} requested=${server} options=${JSON.stringify(options.map(option => option.name))}`);
    if (!options.length) throw new Error("No Danimados video servers found");

    const wanted = String(server || "").trim().toLowerCase();
    const selected =
      options.find(option => option.name.toLowerCase() === wanted) ||
      options.find(option => option.name.toLowerCase().includes(wanted)) ||
      options[0];

    const embedUrl = await this.getEmbedUrl(selected, episodeUrl);
    console.log(`[Danimados] selected=${selected.name} embed=${embedUrl}`);
    let sources = await this.resolveWithBrowser(embedUrl);
    console.log(`[Danimados] browser sources=${sources.length}`);
    if (!sources.length) {
      sources = await this.resolveWithFetch(embedUrl);
      console.log(`[Danimados] fetch fallback sources=${sources.length}`);
    }
    sources = this.rankSources(sources);
    console.log(`[Danimados] final sources=${sources.length}`);
    if (!sources.length) throw new Error(`No video source found for ${selected.name}`);

    return {
      server: selected.name,
      headers: { Referer: embedUrl, "User-Agent": this.userAgent },
      videoSources: sources.map(url => ({
        url,
        type: this.sourceType(url),
        quality: this.quality(url),
        label: selected.name,
        subtitles: [],
      })),
    };
  }

  async getEmbedUrl(option, referer) {
    const body = [
      "action=doo_player_ajax",
      `post=${encodeURIComponent(option.post)}`,
      `nume=${encodeURIComponent(option.nume)}`,
      `type=${encodeURIComponent(option.type)}`,
    ].join("&");

    const res = await this.request(this.ajaxUrl, {
      method: "POST",
      body,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        Referer: referer,
      },
    });

    let data;
    try {
      data = JSON.parse(await res.text());
    } catch (error) {
      throw new Error("Danimados returned an invalid player response");
    }
    if (!data?.embed_url) throw new Error(`Danimados has no embed for ${option.name}`);
    return this.absoluteUrl(data.embed_url);
  }

  async resolveWithBrowser(embedUrl) {
    if (typeof ChromeDP === "undefined" || typeof ChromeDP.newBrowser !== "function") {
      console.log("[Danimados] ChromeDP unavailable");
      return [];
    }

    let browser;
    try {
      browser = await ChromeDP.newBrowser({ timeout: 30, userAgent: this.userAgent });
      const found = [];
      const bodyRequests = [];
      const collect = url => {
        if (!this.isMediaUrl(url) || found.includes(url)) return;
        found.push(url);
      };
      const onEvent = ({ method, params }) => {
        if (method !== "Network.responseReceived") return;
        const response = params?.response || {};
        const mime = String(response.mimeType || "");
        if (this.isMediaUrl(response.url) || /mpegurl|video\//i.test(mime)) collect(response.url);
        if (params?.requestId && bodyRequests.length < 8 && (/json|javascript/i.test(mime) || /api|player|source/i.test(response.url || ""))) {
          bodyRequests.push(params.requestId);
        }
      };

      try { browser.listenTarget(onEvent); } catch (error) {}
      try { browser.listenBrowser(onEvent); } catch (error) {}
      try { await browser.executeCDP("Network.enable"); } catch (error) {}
      try {
        await browser.navigate(embedUrl);
      } catch (error) {
        // Embeds commonly redirect or abort the initial navigation; keep the session alive.
      }
      await browser.sleep(4000);

      // Inspect API responses: several hosts hide the real .m3u8 inside JSON.
      for (const requestId of bodyRequests) {
        try {
          const body = await browser.executeCDP("Network.getResponseBody", { requestId });
          if (body?.body) {
            for (const url of this.extractSources(body.body, embedUrl)) collect(url);
          }
        } catch (error) {}
      }

      for (let attempt = 0; attempt < 2 && !found.length; attempt++) {
        try {
          const result = await browser.evaluate(EXTRACT_SOURCES_JS);
          const list = Array.isArray(result) ? result : result?.sources || [];
          for (const url of list) collect(url);
        } catch (error) {
          console.log(`[Danimados] Source extraction failed: ${error?.message || error}`);
        }
        if (!found.length) await browser.sleep(4000);
      }
      return found;
    } catch (error) {
      console.log(`[Danimados] Browser resolution failed: ${error?.message || error}`);
      return [];
    } finally {
      if (browser) {
        try { await browser.close(); } catch (error) {}
      }
    }
  }

  async resolveWithFetch(embedUrl) {
    try {
      let html = await (await this.request(embedUrl, { headers: { Referer: this.base + "/" } })).text();
      const redirect = html.match(/window\.location\.href\s*=\s*['"](https?:\/\/[^'"]+)/i);
      if (redirect?.[1]) {
        try {
          html = await (await this.request(redirect[1], { headers: { Referer: embedUrl } })).text();
        } catch (error) {}
      }
      return this.extractSources(html, embedUrl);
    } catch (error) {
      console.log(`[Danimados] Fetch resolution failed: ${error?.message || error}`);
      return [];
    }
  }

  extractSources(html, base) {
    const found = [];
    const add = value => {
      if (!value) return;
      try { value = new URL(String(value).replace(/&amp;/g, "&"), base).toString(); } catch (error) { return; }
      if (!found.includes(value)) found.push(value);
    };
    const patterns = [
      /(?:https?:)?\/\/[^"'<>\s\\]+\.m3u8(?:\?[^"'<>\s\\]*)?/gi,
      /(?:https?:)?\/\/[^"'<>\s\\]+\.mp4(?:\?[^"'<>\s\\]*)?/gi,
      /(?:file|src|url)\s*:\s*['"]([^'"]+\.(?:m3u8|mp4)[^'"]*)['"]/gi,
      /var\s+source\s*=\s*['"]([^'"]+)['"]/gi,
    ];
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(html)) !== null) add(match[1] || match[0]);
    }
    return found.filter(url => this.isMediaUrl(url));
  }

  isMediaUrl(url) {
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return false;
    if (/\.(?:png|jpe?g|gif|webp|svg|css|js|ico)(?:\?|$)/i.test(url)) return false;
    // Some embeds ship a Big Buck Bunny placeholder in their JS before the real source loads.
    if (/test-videos|bigbuckbunny|example\.com|gtv-videos-bucket|commondatastorage|bitmovin/i.test(url)) return false;
    return /\.m3u8(?:\?|$)/i.test(url) || /\.mp4(?:\?|$)/i.test(url) || /mpegurl|video\//i.test(url);
  }

  rankSources(sources) {
    const rank = url => (/\.m3u8(?:\?|$)/i.test(url) ? 0 : /\.mp4(?:\?|$)/i.test(url) ? 1 : 2);
    return [...new Set(sources)].filter(url => this.isMediaUrl(url)).sort((a, b) => rank(a) - rank(b));
  }

  sourceType(url) {
    if (/\.m3u8(?:\?|$)/i.test(url) || /mpegurl/i.test(url)) return "m3u8";
    if (/\.mp4(?:\?|$)/i.test(url)) return "mp4";
    return "unknown";
  }

  quality(url) {
    const match = String(url).match(/(?:^|[^0-9])(240|360|480|720|1080|1440|2160)p(?:\D|$)/i);
    return match ? `${match[1]}p` : "Auto";
  }

  absoluteUrl(url, base = this.base) {
    try { return new URL(String(url), base).toString(); } catch (error) { return String(url); }
  }

  async request(url, options = {}) {
    const { allowHttpError, headers, ...rest } = options;
    const res = await fetch(url, {
      ...rest,
      headers: { "User-Agent": this.userAgent, ...(headers || {}) },
    });
    if (!res.ok && !allowHttpError) throw new Error(`Request failed (${res.status}): ${url}`);
    return res;
  }
}
