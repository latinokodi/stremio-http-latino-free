/**
 * TMDB API helper — converts IMDB IDs to TMDB IDs and fetches metadata.
 */
const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const TMDB_BASE = "https://api.themoviedb.org/3";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Cache: imdbId -> { tmdbId, type, title, year }
const cache = new Map();

async function tmdbFetch(path) {
    const url = `${TMDB_BASE}${path}${path.includes("?") ? "&" : "?"}api_key=${TMDB_API_KEY}&language=es-MX`;
    const res = await fetch(url, {
        headers: { "User-Agent": UA, "Accept": "application/json" }
    });
    if (!res.ok) {
        console.error(`[TMDB] HTTP ${res.status} on ${path}`);
        return null;
    }
    return res.json();
}

/**
 * Convert an IMDB ID (e.g. "tt1234567") to TMDB ID and metadata.
 * Returns { tmdbId, type: "movie"|"tv", title, year } or null.
 */
async function imdbToTmdb(imdbId) {
    if (cache.has(imdbId)) return cache.get(imdbId);

    try {
        const data = await tmdbFetch(`/find/${imdbId}?external_source=imdb_id`);
        if (!data) return null;

        // TMDB find returns movie_results and tv_results arrays
        const movieResults = data.movie_results || [];
        const tvResults = data.tv_results || [];

        let result = null;

        if (movieResults.length > 0) {
            const m = movieResults[0];
            result = {
                tmdbId: m.id,
                type: "movie",
                title: m.title,
                year: m.release_date ? m.release_date.substring(0, 4) : null
            };
        } else if (tvResults.length > 0) {
            const t = tvResults[0];
            result = {
                tmdbId: t.id,
                type: "tv",
                title: t.name,
                year: t.first_air_date ? t.first_air_date.substring(0, 4) : null
            };
        }

        if (result) {
            cache.set(imdbId, result);
            console.log(`[TMDB] IMDB ${imdbId} -> TMDB ${result.tmdbId} (${result.type}: "${result.title}")`);
        } else {
            console.log(`[TMDB] No match for IMDB ${imdbId}`);
        }

        return result;
    } catch (e) {
        console.error(`[TMDB] Error converting ${imdbId}:`, e.message);
        return null;
    }
}

module.exports = { imdbToTmdb, tmdbById, tmdbFetch, TMDB_API_KEY };

/**
 * Fetch TMDB metadata by TMDB ID.
 * Returns { tmdbId, type, title, year } or null.
 */
async function tmdbById(tmdbId, mediaType) {
    const cacheKey = `tmdb:${tmdbId}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey);

    try {
        const typePath = (mediaType === "series" || mediaType === "tv") ? "tv" : "movie";
        const data = await tmdbFetch(`/${typePath}/${tmdbId}`);
        if (!data) return null;

        const result = {
            tmdbId: data.id,
            type: typePath,
            title: data.title || data.name,
            year: (data.release_date || data.first_air_date || "").substring(0, 4) || null
        };

        cache.set(cacheKey, result);
        console.log(`[TMDB] TMDB ${tmdbId} -> "${result.title}" (${result.type})`);
        return result;
    } catch (e) {
        console.error(`[TMDB] Error fetching ${tmdbId}:`, e.message);
        return null;
    }
}
