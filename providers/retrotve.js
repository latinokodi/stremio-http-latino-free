const cheerio = require("cheerio");
const crypto = require("crypto");

const TMDB_KEY = "439c478a771f35c05022f9feabcca01c";
const BASE_URL = "https://retrotve.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Base64url decode helper for FileMoon decryption
function b64urlDecode(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    return Buffer.from(s, 'base64');
}

const HEADERS = {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "es-ES,es;q=0.9,en;q=0.8"
};

// ── New FileMoon Resolver (API + AES-256-GCM decryption) ──
// Endpoint: GET https://filemoon.to/api/videos/{video_id}
// Requires Origin: https://retrotve.com
// Encryption: AES-256-GCM, versioned key selection
//   version N → key_parts[N-1] + key_parts[(31-N)-1]
//   base64url decode → concatenate → AES-256 key
//   IV + payload are base64url encoded, last 16 bytes of payload = auth tag

function extractFilemoonId(url) {
    const m = url.match(/\/(?:e|d)\/([a-z0-9]{12})/i);
    return m ? m[1] : null;
}

async function resolveFilemoon(embedUrl) {
    try {
        const videoId = extractFilemoonId(embedUrl);
        if (!videoId) return null;

        const apiUrl = `https://filemoon.to/api/videos/${videoId}`;
        const res = await fetch(apiUrl, {
            headers: {
                "User-Agent": UA,
                "Accept": "application/json, text/plain, */*",
                "Origin": "https://retrotve.com",
                "Referer": "https://retrotve.com/"
            },
            redirect: "follow"
        });

        if (!res.ok) return null;
        const data = await res.json();
        const pb = data.playback;
        if (!pb || pb.algorithm !== "AES-256-GCM") return null;

        // Versioned key derivation (from FileMoon JS bundle)
        const ver = parseInt(pb.version, 10);
        const idx1 = ver - 1;              // 0-indexed
        const idx2 = (31 - ver) - 1;       // 0-indexed

        const kp1 = pb.key_parts[idx1];
        const kp2 = pb.key_parts[idx2];
        if (!kp1 || !kp2) return null;

        const rawKey = Buffer.concat([b64urlDecode(kp1), b64urlDecode(kp2)]); // 32 bytes
        const iv = b64urlDecode(pb.iv);
        const fullPayload = b64urlDecode(pb.payload);
        const ciphertext = fullPayload.subarray(0, fullPayload.length - 16);
        const authTag = fullPayload.subarray(fullPayload.length - 16);

        const decipher = crypto.createDecipheriv("aes-256-gcm", rawKey, iv);
        decipher.setAuthTag(authTag);
        let decrypted = decipher.update(ciphertext);
        decrypted = Buffer.concat([decrypted, decipher.final()]);

        const inner = JSON.parse(decrypted.toString("utf8"));
        const sources = inner.sources || [];
        if (sources.length === 0) return null;

        const best = sources[0]; // first source is usually highest quality
        return {
            url: best.url,
            server: "FileMoon",
            quality: best.label || "720p",
            headers: {
                "User-Agent": UA,
                Referer: "https://retrotve.com/",
                Origin: "https://retrotve.com"
            }
        };
    } catch (err) {
        // API-based resolution failed — embed URL may still be playable in browser
        return null;
    }
}

async function resolveOkRu(embedUrl) {
    try {
        let e = await fetch(embedUrl, {
            headers: { "User-Agent": UA, "Accept": "text/html", "Referer": "https://ok.ru/" },
            redirect: "follow"
        }).then((n) => n.text());

        if (e.includes("copyrightsRestricted") || e.includes("COPYRIGHTS_RESTRICTED") || e.includes("LIMITED_ACCESS") || e.includes("notFound") || !e.includes("urls")) {
            return null;
        }

        let cleaned = e.replace(/\\&quot;/g, '"').replace(/\\u0026/g, "&").replace(/\\/g, "");
        let r = [...cleaned.matchAll(/"name":"([^"]+)","url":"([^"]+)"/g)];
        let s = ["full", "hd", "sd", "low", "lowest"];
        let i = r.map((n) => ({ type: n[1], url: n[2] })).filter((n) => !n.type.toLowerCase().includes("mobile") && n.url.startsWith("http"));

        if (i.length === 0) return null;

        let l = i.sort((n, u) => {
            let f = s.findIndex((p) => n.type.toLowerCase().includes(p)), d = s.findIndex((p) => u.type.toLowerCase().includes(p));
            return (f === -1 ? 99 : f) - (d === -1 ? 99 : d);
        })[0];

        let c = { full: "1080p", hd: "720p", sd: "480p", low: "360p", lowest: "240p" };
        return {
            url: l.url,
            server: "OkRu",
            quality: c[l.type] || l.type,
            headers: { "User-Agent": UA, Referer: "https://ok.ru/" }
        };
    } catch (err) {
        return null;
    }
}

async function resolveEmbed(url) {
    const u = url.toLowerCase();
    if (u.includes("ok.ru") || u.includes("odnoklassniki")) {
        return resolveOkRu(url);
    }
    if (u.includes("filemoon") || u.includes("fmoon")) {
        return resolveFilemoon(url);
    }
    return null;
}

function cleanTitle(title) {
    if (!title) return "";
    return title.toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") // Remove diacritics
        .replace(/[^a-z0-9\s]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

async function getTmdbTitles(tmdbId, type) {
    let titleEsES = null;
    let titleEsMX = null;
    let titleOriginal = null;
    let titleEn = null;
    let year = null;
    
    try {
        const res = await fetch(`https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${TMDB_KEY}&language=es-ES`).then(r => r.json());
        titleEsES = type === "movie" ? res.title : res.name;
        titleOriginal = type === "movie" ? res.original_title : res.original_name;
        const dateStr = type === "movie" ? res.release_date : res.first_air_date;
        if (dateStr) {
            year = dateStr.split("-")[0];
        }
    } catch (e) {
        console.error("[Colección 2] TMDB es-ES error:", e.message);
    }
    
    try {
        const res = await fetch(`https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${TMDB_KEY}&language=es-MX`).then(r => r.json());
        titleEsMX = type === "movie" ? res.title : res.name;
    } catch (e) {
        console.error("[Colección 2] TMDB es-MX error:", e.message);
    }
    
    try {
        const res = await fetch(`https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${TMDB_KEY}&language=en-US`).then(r => r.json());
        titleEn = type === "movie" ? res.title : res.name;
    } catch (e) {
        console.error("[Colección 2] TMDB en-US error:", e.message);
    }
    
    return { titleEsES, titleEsMX, titleOriginal, titleEn, year };
}

function parseSearchPage($, baseUrl) {
    const list = [];
    $("article, .item").each((i, el) => {
        const linkTag = $(el).find("a").first();
        if (linkTag.length === 0) return;

        const href = linkTag.attr("href");
        if (!href) return;

        const titleTag = $(el).find("h2, h3").first();
        const title = titleTag.length > 0 ? titleTag.text().trim() : linkTag.text().trim();

        const imgTag = $(el).find("img").first();
        const poster = imgTag.length > 0 ? (imgTag.attr("src") || imgTag.attr("data-src") || "") : "";

        const is_series = href.includes("/serie/") || href.includes("/lista-de-series/");

        list.push({
            id: href,
            title: title,
            poster: poster,
            is_series: is_series
        });
    });
    return list.filter((v, i, a) => a.findIndex(t => t.id === v.id) === i);
}

async function searchOnSite(query) {
    try {
        const url = `${BASE_URL}/?s=${encodeURIComponent(query)}`;
        const res = await fetch(url, { headers: HEADERS });
        if (!res.ok) return [];
        const html = await res.text();
        const $ = cheerio.load(html);
        return parseSearchPage($, BASE_URL);
    } catch (e) {
        console.error(`[Colección 2] Search site error for query "${query}":`, e.message);
        return [];
    }
}

function cleanQueryString(q) {
    return q.replace(/[,;.:!\?]/g, "").replace(/\s+/g, " ").trim();
}

async function extractVideoLinks(pageUrl) {
    const streams = [];
    try {
        const res = await fetch(pageUrl, { headers: HEADERS });
        if (!res.ok) return [];
        const html = await res.text();
        const $ = cheerio.load(html);

        const trembedUrls = new Set();
        const seenUrls = new Set();

        // 1. DooPlay option buttons
        $("li.dooplay_player_option").each((i, el) => {
            const trid = $(el).attr("data-post");
            const trembed = $(el).attr("data-nume");
            const trtype = $(el).attr("data-type") || "1";
            if (trid && trembed) {
                trembedUrls.add(`${BASE_URL}/?trembed=${trembed}&trid=${trid}&trtype=${trtype}`);
            }
        });

        // 2. Regex scan for hidden/escaped trembed links
        const regexPattern = /https?:\/\/[^\s\"\'<>]+/g;
        let match;
        while ((match = regexPattern.exec(html)) !== null) {
            const matchedUrl = match[0].replace(/&amp;/g, '&').replace(/&#038;/g, '&');
            if (matchedUrl.includes("trembed=") && matchedUrl.includes("trid=")) {
                trembedUrls.add(matchedUrl);
            }
        }

        // 3. Resolve trembed URLs
        for (const embedUrl of trembedUrls) {
            try {
                const embedRes = await fetch(embedUrl, { headers: HEADERS });
                if (!embedRes.ok) continue;
                const embedHtml = await embedRes.text();
                const $embed = cheerio.load(embedHtml);
                const iframe = $embed("iframe[src]").first();
                if (iframe.length > 0) {
                    let src = iframe.attr("src") || "";
                    if (src.startsWith("//")) src = "https:" + src;
                    if (src && !seenUrls.has(src)) {
                        seenUrls.add(src);
                        const resolved = await resolveEmbed(src);
                        if (resolved) {
                            streams.push({
                                name: "Colección 2",
                                title: `${resolved.quality} \xB7 ${resolved.server} \xB7 Direct`,
                                url: resolved.url,
                                quality: resolved.quality,
                                headers: resolved.headers
                            });
                        } else if (!src.includes("mega.nz") && !src.includes("mega.co")) {
                            let server = "Mirror";
                            try { server = new URL(src).hostname.split(".")[0]; } catch(e){}
                            server = server.charAt(0).toUpperCase() + server.slice(1);
                            streams.push({
                                name: "Colección 2",
                                title: `${server} (Embed)`,
                                url: src,
                                quality: "720p",
                                headers: { Referer: pageUrl }
                            });
                        }
                    }
                }
            } catch (err) {
                console.log(`[Colección 2] Embed resolution error for ${embedUrl}: ${err.message}`);
            }
        }

        // 4. Fallback direct iframes
        $("iframe[src]").each((i, el) => {
            let src = $(el).attr("src") || "";
            if (src.startsWith("//")) src = "https:" + src;
            if (src && !seenUrls.has(src)) {
                if (src.includes("yourupload") || src.includes("sendvid")) {
                    seenUrls.add(src);
                    let server = "Mirror";
                    try { server = new URL(src).hostname.split(".")[0]; } catch(e){}
                    server = server.charAt(0).toUpperCase() + server.slice(1);
                    streams.push({
                        name: "Colección 2",
                        title: `${server} (Embed)`,
                        url: src,
                        quality: "720p",
                        headers: { Referer: pageUrl }
                    });
                }
            }
        });

    } catch (e) {
        console.error(`[Colección 2] Link extraction error:`, e.message);
    }
    return streams;
}

async function getStreams(tmdbId, mediaType, season, episode) {
    console.log(`[Colección 2] Resolving: TMDB ${tmdbId} (${mediaType})${mediaType === 'tv' ? ` S${season}E${episode}` : ''}`);
    
    // Step 1: Query TMDB for titles
    const info = await getTmdbTitles(tmdbId, mediaType);
    if (!info.titleEsES && !info.titleEsMX && !info.titleOriginal && !info.titleEn) {
        console.log("[Colección 2] Failed to fetch titles from TMDB.");
        return [];
    }

    // Generate queries
    const queries = [];
    if (info.titleEsMX) queries.push(cleanQueryString(info.titleEsMX));
    if (info.titleEsES && info.titleEsES !== info.titleEsMX) queries.push(cleanQueryString(info.titleEsES));
    if (info.titleEn) queries.push(cleanQueryString(info.titleEn));
    if (info.titleOriginal && info.titleOriginal !== info.titleEsES && info.titleOriginal !== info.titleEn) {
        queries.push(cleanQueryString(info.titleOriginal));
    }
    const uniqueQueries = [...new Set(queries)];

    let matchedContent = null;
    let bestScore = -1;

    for (const q of uniqueQueries) {
        console.log(`[Colección 2] Searching query: "${q}"`);
        const results = await searchOnSite(q);
        console.log(`[Colección 2] Found ${results.length} matches`);

        for (const res of results) {
            let score = 0;
            const cleanedResult = cleanTitle(res.title);

            const checkTitles = [info.titleEsMX, info.titleEsES, info.titleOriginal, info.titleEn];
            for (const t of checkTitles) {
                if (!t) continue;
                const cleanedT = cleanTitle(t);
                if (cleanedResult === cleanedT) {
                    score = Math.max(score, 100);
                } else if (cleanedResult.includes(cleanedT) || cleanedT.includes(cleanedResult)) {
                    score = Math.max(score, 50);
                }
            }

            if (score > bestScore && score >= 40) {
                bestScore = score;
                matchedContent = res;
            }
        }
        if (bestScore === 100) break;
    }

    if (!matchedContent) {
        console.log("[Colección 2] No matching content found on site.");
        return [];
    }

    console.log(`[Colección 2] Best Match: "${matchedContent.title}" (Score: ${bestScore}) -> ${matchedContent.id}`);

    // Step 2: Extract streams
    if (mediaType === "movie") {
        return extractVideoLinks(matchedContent.id);
    } else {
        let seriesHtml = "";
        try {
            seriesHtml = await fetch(matchedContent.id, { headers: HEADERS }).then(r => r.text());
        } catch (e) {
            console.error("[Colección 2] Failed to load series page:", e.message);
            return [];
        }

        const $ = cheerio.load(seriesHtml);
        
        let targetContainer = null;
        $(".AA-Season").each((i, el) => {
            const text = $(el).text().trim();
            const match = text.match(/Temporada\s+(\d+)/i);
            if (match && parseInt(match[1], 10) === season) {
                targetContainer = $(el).next(".TPTblCn");
                return false;
            }
        });

        if (!targetContainer || targetContainer.length === 0) {
            console.log(`[Colección 2] Season ${season} not found.`);
            return [];
        }

        const uniqueEpUrls = [];
        const seenUrls = new Set();

        targetContainer.find("a[href*='/seriestv/']").each((i, el) => {
            const href = $(el).attr("href");
            if (href && !seenUrls.has(href)) {
                seenUrls.add(href);
                uniqueEpUrls.push(href);
            }
        });

        console.log(`[Colección 2] Found ${uniqueEpUrls.length} episodes in Season ${season}`);

        if (episode > uniqueEpUrls.length || episode < 1) {
            console.log(`[Colección 2] Episode ${episode} is out of bounds.`);
            return [];
        }

        const episodeUrl = uniqueEpUrls[episode - 1];
        console.log(`[Colección 2] Matched Episode URL: ${episodeUrl}`);

        return extractVideoLinks(episodeUrl);
    }
}

module.exports = { getStreams };
