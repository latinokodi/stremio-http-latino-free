/**
 * Provider bridge — loads providers from the local providers/ directory
 * and wraps them with a unified interface for the Stremio addon.
 *
 * Each provider exports: { getStreams(tmdbId, mediaType, season, episode, title?) }
 * Returns: [{ name, title, url, quality, language, headers, verified, isReal, provider }]
 *
 * This bridge:
 * 1. Loads enabled providers from providers-manifest.json
 * 2. Calls each provider's getStreams in parallel with a timeout
 * 3. Filters and converts results to Stremio stream format
 */
const path = require("path");
const fs = require("fs");

// Self-contained: providers live in ../providers/
const ADDON_DIR = path.resolve(__dirname, "..");
const PROVIDERS_DIR = path.join(ADDON_DIR, "providers");
const MANIFEST_PATH = path.join(ADDON_DIR, "manifest.json");

// Known embed domains that can be played in external players (not direct streams)
const PLAYABLE_EMBED_DOMAINS = [
    "streamtape.com", "uqload.com", "uqload.co", "uqload.is",
    "mp4upload.com", "yourupload.com", "ok.ru", "odnoklassniki.ru",
    "doodstream.com", "dood.", "d000d.com", "ds2play.com",
    "filemoon.sx", "filemoon.to", "filemoon.", "moonembed",
    "vidhide", "streamwish", "voe.sx", "voex.sx",
    "goodstream.one", "vimeos.net", "fastream.to",
    "pixeldrain.com", "mixdrop.",
];

// Domains that are definitely NOT stream URLs
const BLOCKED_DOMAINS = [
    "log.info", "localhost", "127.0.0.1", "0.0.0.0",
    "example.com", "test.com",
];

function isValidStreamUrl(url) {
    if (!url || typeof url !== "string") return false;

    if (!url.startsWith("http://") && !url.startsWith("https://")) return false;

    const lower = url.toLowerCase();
    for (const bad of BLOCKED_DOMAINS) {
        if (lower.includes(bad)) return false;
    }

    // Direct stream URLs
    if (lower.includes(".m3u8") || lower.includes(".mp4")) return true;
    if (lower.includes("hls2/") || lower.includes("/hls/")) return true;
    if (lower.includes("/stream/") || lower.includes("/master.")) return true;

    // Player proxy URLs
    if (lower.includes("player.pelisserieshoy.com/p.php")) return true;

    // Playable embed URLs
    for (const domain of PLAYABLE_EMBED_DOMAINS) {
        if (lower.includes(domain) && (lower.includes("/e/") || lower.includes("/embed") || lower.includes("/d/") || lower.includes("/f/"))) {
            return true;
        }
    }

    // Video CDN URLs
    if (lower.includes("cdn") || lower.includes("video") || lower.includes(".m3u") || lower.includes("mediafire")) {
        return true;
    }

    return false;
}

let providers = null;

function loadProviders() {
    if (providers) return providers;

    if (!fs.existsSync(MANIFEST_PATH)) {
        console.error(`[Bridge] Manifest not found: ${MANIFEST_PATH}`);
        providers = [];
        return providers;
    }

    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
    const scrapers = manifest.scrapers || [];
    providers = [];

    for (const scraper of scrapers) {
        if (scraper.enabled === false) continue;
        if (!scraper.filename) continue;

        // Resolve relative to the addon root
        const providerPath = path.resolve(ADDON_DIR, scraper.filename);
        if (!fs.existsSync(providerPath)) {
            console.warn(`[Bridge] Provider file not found: ${scraper.filename}`);
            continue;
        }

        try {
            const mod = require(providerPath);
            const getStreams = mod.getStreams || mod.extract;
            if (typeof getStreams !== "function") {
                console.warn(`[Bridge] No getStreams/extract export in ${scraper.id}`);
                continue;
            }

            providers.push({
                id: scraper.id,
                name: scraper.name,
                getStreams,
                supportedTypes: scraper.supportedTypes || ["movie", "tv"],
                logo: scraper.logo || null
            });
        } catch (e) {
            console.error(`[Bridge] Failed to load ${scraper.id}:`, e.message);
        }
    }

    console.log(`[Bridge] Loaded ${providers.length} providers (self-contained)`);
    return providers;
}

/**
 * Resolve streams for a given TMDB entry.
 */
async function resolveStreams(tmdbId, mediaType, season, episode, title) {
    const provs = loadProviders();

    const applicableProviders = provs.filter(p => {
        const types = p.supportedTypes.map(t => t.toLowerCase());
        if (mediaType === "movie") return types.includes("movie") || types.includes("pelicula");
        if (mediaType === "tv") return types.includes("tv") || types.includes("series") || types.includes("serie");
        return true;
    });

    console.log(`[Bridge] Resolving TMDB:${tmdbId} (${mediaType} S${season}E${episode}) via ${applicableProviders.length} providers`);

    const TIMEOUT_MS = 20000;

    const providerPromises = applicableProviders.map(async (prov) => {
        try {
            const result = await Promise.race([
                prov.getStreams(tmdbId, mediaType, season, episode, title),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS)
                )
            ]);

            if (!result || !Array.isArray(result) || result.length === 0) {
                return [];
            }

            const valid = result
                .filter(s => s && s.url && isValidStreamUrl(s.url))
                .map(s => ({
                    ...s,
                    providerName: prov.name,
                    providerId: prov.id
                }));

            if (valid.length > 0) {
                console.log(`[Bridge] ${prov.id}: ${valid.length} streams`);
            }
            return valid;
        } catch (e) {
            if (e.message !== "timeout") {
                console.error(`[Bridge] ${prov.id} error:`, e.message);
            }
            return [];
        }
    });

    const results = await Promise.all(providerPromises);
    const allStreams = results.flat();

    // Deduplicate by URL
    const seen = new Set();
    const unique = allStreams.filter(s => {
        if (seen.has(s.url)) return false;
        seen.add(s.url);
        return true;
    });

    console.log(`[Bridge] Total: ${unique.length} unique streams`);
    return unique;
}

/**
 * Convert raw provider streams to Stremio stream objects.
 * Stremio stream format: { name?, title?, url, description?, subtitles?, behaviorHints? }
 */
function toStremioStreams(rawStreams) {
    return rawStreams.map(s => {
        const quality = s.quality || "HD";
        const lang = s.language || s.langLabel || "Latino";
        const server = s.provider || s.title || "Stream";
        const providerLabel = s.providerName || s.name || "HTTP Latino Free";

        const cleanTitle = [quality, lang, server]
            .filter(Boolean)
            .join(" · ");

        const stream = {
            name: providerLabel,
            title: cleanTitle,
            description: quality,
            url: s.url,
            externalUrl: s.url
        };

        if (s.headers && Object.keys(s.headers).length > 0) {
            stream.behaviorHints = {
                notWebReady: true
            };
        }

        return stream;
    });
}

module.exports = { loadProviders, resolveStreams, toStremioStreams, isValidStreamUrl };
