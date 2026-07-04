#!/usr/bin/env node
/**
 * Stremio HTTP Latino Free
 *
 * Streams en español latino para películas, series y anime.
 *
 * Based on: https://github.com/Stremio/stremio-addon-sdk
 * Protocol: https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/protocol.md
 */
const { addonBuilder } = require("stremio-addon-sdk");
const { imdbToTmdb, tmdbById } = require("./lib/tmdb");
const { resolveStreams, toStremioStreams } = require("./lib/provider-bridge");

// ── Manifest ──────────────────────────────────────────────────────────────
const manifest = {
    id: "org.latinokodi.latinuvio",
    version: "1.0.0",

    name: "HTTP Latino Free",
    description: "Streams en español latino para películas, series y anime.",

    // Set to "other" since we target Spanish content, not English
    // This ensures the addon shows up alongside Cinemeta, not replacing it.
    resources: ["stream"],
    types: ["movie", "series"],

    // Accept all ID formats (no idPrefixes restriction)
    catalogs: [],

    // Logo and background (hosted alongside the addon)
    logo: "https://latinokodi.site/stremio-http-latino-free/logo.png",
    background: "https://latinokodi.site/stremio-http-latino-free/background.jpg",

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
// args = { type: "movie"|"series", id: "tt1234567", "tt1234567:1:3", "tmdb:12345", or "tmdb:12345:1:3" }
builder.defineStreamHandler(async (args) => {
    console.log(`[Addon] Stream request: type=${args.type} id=${args.id}`);

    try {
        let tmdbId, imdbId, season = 0, episode = 0, title;

        if (args.id.startsWith("tmdb:")) {
            // TMDB ID format: "tmdb:12345" or "tmdb:12345:1:3"
            const afterPrefix = args.id.slice(5); // "12345" or "12345:1:3"
            const tmdbParts = afterPrefix.split(":");
            tmdbId = parseInt(tmdbParts[0], 10);
            if (tmdbParts.length >= 2) {
                season = parseInt(tmdbParts[1], 10) || 0;
                episode = parseInt(tmdbParts[2], 10) || 0;
            }
            // Fetch metadata from TMDB
            const meta = await tmdbById(tmdbId, args.type);
            title = meta ? meta.title : `TMDB ${tmdbId}`;
        } else {
            // IMDB ID format: "tt1234567" or "tt1234567:1:3"
            const parts = args.id.split(":");
            imdbId = parts[0];
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
            tmdbId = tmdbInfo.tmdbId;
            title = tmdbInfo.title;
        }

        const mediaType = args.type === "series" ? "tv" : "movie";

        // Resolve streams from all providers
        const rawStreams = await resolveStreams(
            tmdbId,
            mediaType,
            season,
            episode,
            title
        );

        // Convert to Stremio format
        const stremioStreams = toStremioStreams(rawStreams);

        console.log(`[Addon] Returning ${stremioStreams.length} streams for "${title}"`);
        return Promise.resolve({ streams: stremioStreams });

    } catch (e) {
        console.error(`[Addon] Stream handler error:`, e.message);
        return Promise.resolve({ streams: [] });
    }
});

// ── Start Server ──────────────────────────────────────────────────────────
const express = require("express");
const getRouter = require("stremio-addon-sdk/src/getRouter");
const PORT = process.env.PORT || 7000;
const BASE_PATH = "/stremio-http-latino-free";

const app = express();

// Strip the base path before passing to the addon router
app.use((req, res, next) => {
    if (req.url.startsWith(BASE_PATH)) {
        req.url = req.url.slice(BASE_PATH.length) || "/";
    }
    next();
});

// Use the SDK's official router (includes CORS, manifest, stream handler)
app.use(getRouter(builder.getInterface()));

// Serve static files (logo, background) from disk
app.use(express.static(__dirname));

app.listen(PORT, () => {
    console.log(`HTTP Latino Free v${manifest.version} on port ${PORT}`);
    console.log(`Manifest: http://localhost:${PORT}${BASE_PATH}/manifest.json`);
});
