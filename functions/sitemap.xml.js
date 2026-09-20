const API = 'https://choti.onrender.com';
const SITE = 'https://banglachoti.pages.dev';

export async function onRequestGet() {
  const urls = new Set([`${SITE}/`]);
  let page = 1;
  const limit = 100;
  const maxPages = 1000;

  try {
    while (page <= maxPages) {
      const response = await fetch(`${API}/api/stories?page=${page}&limit=${limit}`);
      if (!response.ok) break;
      const data = await response.json();
      const stories = Array.isArray(data.stories) ? data.stories : [];
      for (const story of stories) {
        if (story && story.slug) {
          urls.add(`${SITE}/${encodeURIComponent(story.slug)}/`);
        }
      }
      const totalPages = Number(data.totalPages) || 1;
      if (page >= totalPages || stories.length === 0) break;
      page++;
    }
  } catch (e) {
    // Keep homepage in sitemap if the API is temporarily unavailable.
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` +
    [...urls].map(url => `<url><loc>${escapeXml(url)}</loc></url>`).join('') +
    `</urlset>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=UTF-8',
      'Cache-Control': 'public, max-age=300, s-maxage=3600'
    }
  });
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
