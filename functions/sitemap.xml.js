const API = 'https://choti.onrender.com';
const SITE = 'https://banglachoti.pages.dev';

export async function onRequestGet() {
  try {
    const first = await fetch(`${API}/api/stories?page=1&limit=15`);
    if (!first.ok) throw new Error(`API ${first.status}`);
    const firstData = await first.json();
    const stories = Array.isArray(firstData.stories) ? [...firstData.stories] : [];
    const totalPages = Math.min(Number(firstData.totalPages) || 1, 200);

    for (let page = 2; page <= totalPages; page++) {
      const r = await fetch(`${API}/api/stories?page=${page}&limit=15`);
      if (!r.ok) break;
      const d = await r.json();
      if (Array.isArray(d.stories)) stories.push(...d.stories);
    }

    const urls = [
      `<url><loc>${SITE}/</loc></url>`
    ];

    for (const story of stories) {
      if (!story || !story.slug) continue;
      const slug = encodeURIComponent(String(story.slug));
      const lastmod = story.updatedAt || story.createdAt;
      urls.push(
        `<url><loc>${SITE}/${slug}/</loc>${lastmod ? `<lastmod>${new Date(lastmod).toISOString()}</lastmod>` : ''}</url>`
      );
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`;

    return new Response(xml, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=UTF-8',
        'Cache-Control': 'public, max-age=300, s-maxage=3600'
      }
    });
  } catch (error) {
    return new Response('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://banglachoti.pages.dev/</loc></url></urlset>', {
      status: 200,
      headers: {'Content-Type': 'application/xml; charset=UTF-8'}
    });
  }
}
