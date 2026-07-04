#!/usr/bin/env node
/**
 * Stremio Latinuvio Addon
 *
 * Streams en español latino para películas, series y anime.
 *
 * Based on: https://github.com/Stremio/stremio-addon-sdk
 * Protocol: https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/protocol.md
 */
const { addonBuilder, serveHTTP, publishToCentral } = require("stremio-addon-sdk");
const { imdbToTmdb } = require("./lib/tmdb");
const { resolveStreams, toStremioStreams } = require("./lib/provider-bridge");

// ── Manifest ──────────────────────────────────────────────────────────────
const manifest = {
    id: "org.latinokodi.latinuvio",
    version: "1.0.0",

    name: "Latinuvio",
    description: "Streams en español latino para películas, series y anime.",

    // Set to "other" since we target Spanish content, not English
    // This ensures the addon shows up alongside Cinemeta, not replacing it.
    resources: ["stream"],
    types: ["movie", "series"],

    // Our streams are keyed by IMDB ID ("tt" prefix)
    idPrefixes: ["tt"],

    // We speak Spanish
    catalogs: [],

    // Optional: icon and background
    // icon: "https://latinokodi.site/latinuvio-icon.png",
    // background: "https://latinokodi.site/latinuvio-bg.jpg",

    // Behavior hints for Stremio
    behaviorHints: {
        configurable: false,
        configurationRequired: false
    }
};

// ── Builder ───────────────────────────────────────────────────────────────
const builder = new addonBuilder(manifest);

// ── Stream Handler ────────────────────────────────────────────────────────
// Stremio calls this when the user selects a movie/episode.
// args = { type: "movie"|"series", id: "tt1234567" or "tt1234567:1:3" }
builder.defineStreamHandler(async (args) => {
    console.log(`[Addon] Stream request: type=${args.type} id=${args.id}`);

    try {
        // Parse ID
        // Movie:  "tt1234567"
        // Series: "tt1234567:1:3"  (imdbId:season:episode)
        const parts = args.id.split(":");
        const imdbId = parts[0]; // "tt1234567"

        let season = 0;
        let episode = 0;

        if (args.type === "series" && parts.length >= 3) {
            season = parseInt(parts[1], 10) || 0;
            episode = parseInt(parts[2], 10) || 0;
        }

        // Convert IMDB ID to TMDB ID
        const tmdbInfo = await imdbToTmdb(imdbId);
        if (!tmdbInfo) {
            console.log(`[Addon] No TMDB match for ${imdbId}`);
            return Promise.resolve({ streams: [] });
        }

        const mediaType = args.type === "series" ? "tv" : "movie";

        // Resolve streams from all providers
        const rawStreams = await resolveStreams(
            tmdbInfo.tmdbId,
            mediaType,
            season,
            episode,
            tmdbInfo.title
        );

        // Convert to Stremio format
        const stremioStreams = toStremioStreams(rawStreams);

        console.log(`[Addon] Returning ${stremioStreams.length} streams for "${tmdbInfo.title}"`);
        return Promise.resolve({ streams: stremioStreams });

    } catch (e) {
        console.error(`[Addon] Stream handler error:`, e.message);
        return Promise.resolve({ streams: [] });
    }
});

// ── Start Server ──────────────────────────────────────────────────────────
const PORT = process.env.PORT || 7000;

serveHTTP(builder.getInterface(), { port: PORT });

console.log(`\n========================================`);
console.log(`  Latinuvio Stremio Addon v${manifest.version}`);
console.log(`  http://localhost:${PORT}/manifest.json`);
console.log(`  http://localhost:${PORT}/configure`);
console.log(`========================================\n`);
