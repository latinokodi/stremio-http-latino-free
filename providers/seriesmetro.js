const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const BASE_URL = "https://www3.seriesmetro.net";

const HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "es-MX,es;q=0.9",
    "Connection": "keep-alive"
};

function cleanTitle(title) {
    if (!title) return "";
    return title
        .toLowerCase()
        .replace(/ver pelicula/g, "")
        .replace(/online/g, "")
        .replace(/\(.*?\)/g, "")
        .replace(/\[.*?\]/g, "")
        .replace(/:\s*.*?$/g, "")
        .replace(/[-_]/g, " ")
        .replace(/[^a-zA-Z0-9\sáéíóúÁÉÍÓÚñÑ]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

async function getTMDBInfo(id, type) {
    const titles = new Set();
    let year = "";
    const languages = ["es-MX", "es-ES", "en-US"];
    for (const lang of languages) {
        try {
            const url = `https://api.themoviedb.org/3/${type}/${id}?api_key=${TMDB_API_KEY}&language=${lang}`;
            const res = await fetch(url).then(r => r.json());
            const title = type === "movie" ? res.title : res.name;
            const original = type === "movie" ? res.original_title : res.original_name;
            if (title) titles.add(title);
            if (original) titles.add(original);
            if (!year) year = (res.release_date || res.first_air_date || "").substring(0, 4);
        } catch (e) { }
    }
    return titles.size > 0 ? { titles: Array.from(titles), year } : null;
}

async function search(query) {
    try {
        const url = `${BASE_URL}/?s=${encodeURIComponent(query).replace(/%20/g, "+")}`;
        const html = await fetch(url, { headers: HEADERS }).then(r => r.text());
        const matches = [];
        
        const articleRe = /<article[\s\S]*?<\/article>/gi;
        let match;
        while ((match = articleRe.exec(html)) !== null) {
            const article = match[0];
            const linkMatch = /href="([^"]+)"\s*class="lnk-blk"/i.exec(article);
            const titleMatch = /<h2\s*class="entry-title">([\s\S]*?)<\/h2>/i.exec(article);
            
            if (linkMatch && titleMatch) {
                matches.push({
                    url: linkMatch[1],
                    title: titleMatch[1].replace(/<[^>]+>/g, '').trim()
                });
            }
        }
        return matches;
    } catch (e) {
        console.log(`[SeriesMetro] Search Error: ${e.message}`);
        return [];
    }
}

async function extractStreams(pageUrl) {
    try {
        const html = await fetch(pageUrl, { headers: HEADERS }).then(r => r.text());
        const streams = [];
        
        const tabsRe = /<a[^>]*href="#(options-[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
        const tabs = [];
        let tMatch;
        while ((tMatch = tabsRe.exec(html)) !== null) {
            const id = tMatch[1];
            const labelHtml = tMatch[2];
            const label = labelHtml.replace(/<[^>]+>/g, '').trim();
            tabs.push({ id, label });
        }
        
        for (const tab of tabs) {
            const blockRe = new RegExp(`<div id="${tab.id}"[\\s\\S]*?<iframe[^>]+(?:data-src|src)="([^"]+)"`, 'i');
            const bMatch = blockRe.exec(html);
            if (bMatch) {
                const proxyUrl = bMatch[1].replace(/&#038;/g, '&');
                let lang = 'Lat';
                let serverName = 'Fastream';
                
                const parts = tab.label.split('-');
                if (parts.length > 1) {
                    serverName = parts[0].trim() || 'Fastream';
                    lang = parts[1].trim();
                } else {
                    serverName = tab.label;
                }
                
                if (lang === 'Latino' || lang === 'Español Latino') lang = 'Lat';
                if (lang === 'Castellano' || lang === 'Español') lang = 'Esp';
                if (lang === 'VOSE' || lang === 'Sub') lang = 'Vose';
                
                // Fetch proxy URL to get real embed
                try {
                    const pRes = await fetch(proxyUrl, { headers: { ...HEADERS, 'Referer': pageUrl } });
                    const pHtml = await pRes.text();
                    const realMatch = /<iframe[^>]+src="([^"]+)"/i.exec(pHtml);
                    if (realMatch) {
                        let realUrl = realMatch[1];
                        if (realUrl.includes('cinemaupload.com')) {
                            realUrl = realUrl.replace('/cinemaupload.com/', '/embed.cload.video/');
                        }
                        
                        streams.push({
                            name: "SeriesMetro",
                            title: `${serverName} (${lang})`,
                            url: realUrl,
                            isEmbed: true
                        });
                    }
                } catch(e) {
                    console.log(`[SeriesMetro] Proxy fetch error: ${e.message}`);
                }
            }
        }
        
        return streams;
    } catch (e) {
        console.log(`[SeriesMetro] Extract Error: ${e.message}`);
        return [];
    }
}

async function getStreams(id, type, season, episode) {
    console.log(`[SeriesMetro] Resolving: ${type} ${id}`);
    const info = await getTMDBInfo(id, type);
    if (!info) return [];

    let matchedPost = null;
    for (const title of info.titles) {
        const results = await search(title);
        if (results && results.length > 0) {
            matchedPost = results.find(r => {
                const rt = cleanTitle(r.title);
                return info.titles.some(t => {
                    const ct = cleanTitle(t);
                    return rt.includes(ct) || ct.includes(rt);
                });
            });
            if (matchedPost) break;
        }
    }

    if (!matchedPost) {
        console.log("[SeriesMetro] No matching post found.");
        return [];
    }

    let url = matchedPost.url;
    console.log(`[SeriesMetro] Matched: "${matchedPost.title}" -> ${url}`);

    if (type === 'tv') {
        // Balandro says series use AJAX to load episodes.
        // Let's check how seasons/episodes are mapped
        const html = await fetch(url, { headers: HEADERS }).then(r => r.text());
        // In seriesmetron.py:
        // matches = scrapertools.find_multiple_matches(data, '<a data-post="(.*?)" data-season="(.*?)"')
        // And then requests episodes via AJAX or just finds them...
        // For simplicity, let's look for episode link in the current DOM
        // Format: href=".../episodio/NAME-1x1/"
        const epRegex = new RegExp(`href="([^"]+-\\d+x\\d+\\/)?"[^>]*>[^<]*${season}x${episode}`, 'i');
        const epMatch = epRegex.exec(html) || new RegExp(`href="([^"]+episodio[^"]+${season}x${episode}[^"]*)"`, 'i').exec(html);
        
        if (epMatch) {
            url = epMatch[1];
            console.log(`[SeriesMetro] Found episode: ${url}`);
        } else {
            // Might need AJAX, try simple construct if it follows standard pattern
            // The url usually looks like /episodio/breaking-bad-1x1/
            const slug = url.split('/').filter(Boolean).pop();
            url = `${BASE_URL}/episodio/${slug}-${season}x${episode}/`;
            console.log(`[SeriesMetro] Guessing episode url: ${url}`);
        }
    }

    return await extractStreams(url);
}

module.exports = { getStreams };
