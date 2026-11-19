import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;
const HOST = '0.0.0.0';

function decodeXmlEntities(text) {
  return String(text || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .trim();
}

function parseRssItems(xml, limit = 4) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;

  while ((match = itemRegex.exec(xml)) !== null && items.length < limit) {
    const block = match[1];
    const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/i);
    const linkMatch = block.match(/<link>([\s\S]*?)<\/link>/i);
    const descMatch = block.match(/<description>([\s\S]*?)<\/description>/i);

    const title = decodeXmlEntities(titleMatch ? titleMatch[1] : '');
    const url = decodeXmlEntities(linkMatch ? linkMatch[1] : '');
    const snippet = decodeXmlEntities(descMatch ? descMatch[1] : '');

    if (title && /^https?:\/\//i.test(url)) {
      items.push({ title, url, snippet });
    }
  }

  return items;
}

// Fetch live search results so the AI advisor can include current L'Oréal info and links
app.get('/api/search', async (req, res) => {
  const rawQuery = String(req.query.q || '').trim();
  if (!rawQuery) {
    return res.json({ results: [] });
  }

  // Normalize accents and apostrophes so search queries match reliably
  const query = rawQuery
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’]/g, '');

  try {
    const rssUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}&format=rss`;
    const response = await fetch(rssUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
      },
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      const xml = await response.text();
      const results = parseRssItems(xml, 4);
      if (results.length > 0) {
        return res.json({ results });
      }
    }
  } catch (err) {
    console.warn('Primary live search failed, trying Wikipedia fallback:', err.message);
  }

  // Fallback to Wikipedia OpenSearch API
  try {
    const wikiUrl = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=4&format=json`;
    const wikiRes = await fetch(wikiUrl, { signal: AbortSignal.timeout(5000) });
    if (wikiRes.ok) {
      const data = await wikiRes.json();
      const titles = Array.isArray(data[1]) ? data[1] : [];
      const snippets = Array.isArray(data[2]) ? data[2] : [];
      const urls = Array.isArray(data[3]) ? data[3] : [];
      const results = titles
        .map((title, idx) => ({
          title,
          snippet: snippets[idx] || '',
          url: urls[idx] || '',
        }))
        .filter((item) => /^https?:\/\//i.test(item.url));
      return res.json({ results });
    }
  } catch (err) {
    console.warn('Wikipedia fallback search failed:', err.message);
  }

  return res.json({ results: [] });
});

// Serve root loreal-logo.png for /img/loreal-logo.png requests
app.get('/img/loreal-logo.png', (_req, res) => {
  res.sendFile(path.join(__dirname, 'loreal-logo.png'));
});

// Serve static assets from the repository root
app.use(express.static(__dirname));

// Fallback to index.html for unmatched GET routes
app.use((_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`Server listening on http://${HOST}:${PORT}`);
});
