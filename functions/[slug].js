const API = 'https://choti.onrender.com';
const SITE = 'https://banglachoti.pages.dev';

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
}
function strip(v) {
  return String(v || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}
function attrReplace(html, id, value) {
  const re = new RegExp(`(<[^>]+id=["']${id}["'][^>]*content=["'])[^"']*(["'])`, 'i');
  return html.replace(re, `$1${esc(value)}$2`);
}

export async function onRequestGet(context) {
  const slug = String(context.params.slug || '').trim();
  if (!slug || ['story','story.html','index.html'].includes(slug.toLowerCase())) {
    return context.env.ASSETS.fetch(new Request(new URL('/404.html', context.request.url)));
  }

  try {
    const apiRes = await fetch(`${API}/api/stories/slug/${encodeURIComponent(slug)}`, {
      headers: { Accept: 'application/json' }
    });
    if (!apiRes.ok) {
      return new Response('Story not found', { status: 404, headers: {'Content-Type':'text/plain; charset=UTF-8'} });
    }
    const story = await apiRes.json();
    const templateRes = await context.env.ASSETS.fetch(new Request(new URL('/story.html', context.request.url)));
    let html = await templateRes.text();

    const title = String(story.title || 'বাংলা গল্প').trim();
    const description = String(story.excerpt || strip(story.content).slice(0, 160) || `${title} গল্পটি Bangla Choti Kahinii-তে পড়ুন।`).trim();
    const canonical = `${SITE}/${encodeURIComponent(story.slug || slug)}/`;
    const image = story.image ? new URL(story.image, SITE).href : '';

    html = html.replace(/<title>[^<]*<\/title>/i, `<title>${esc(title)} | Bangla Choti Kahinii</title>`);
    html = html.replace(/<meta name="description"[^>]*>/i, `<meta name="description" content="${esc(description)}">`);
    html = html.replace(/<link id="canonicalLink"[^>]*>/i, `<link id="canonicalLink" rel="canonical" href="${esc(canonical)}">`);
    html = attrReplace(html, 'ogTitle', title);
    html = attrReplace(html, 'ogDescription', description);
    html = attrReplace(html, 'ogUrl', canonical);
    if (image) {
      html = attrReplace(html, 'ogImage', image);
      html = attrReplace(html, 'twitterImage', image);
    }
    html = attrReplace(html, 'twitterTitle', title);
    html = attrReplace(html, 'twitterDescription', description);

    const article = `<div class="head"><h1 class="title">${esc(title)}</h1><div class="meta"><span>👤 ${esc(story.author || 'অজ্ঞাত')}</span>${story.createdAt ? `<span>📅 ${new Date(story.createdAt).toLocaleDateString('bn-BD')}</span>` : ''}<span>👁 ${Number(story.views || 0).toLocaleString('bn-BD')}</span></div></div>${image ? `<img class="cover" src="${esc(image)}" alt="${esc(title)}" loading="eager" fetchpriority="high" decoding="async">` : ''}<article class="content">${story.content || ''}</article>`;
    html = html.replace(/<div id="app" class="loading">[\s\S]*?<\/div>/i, `<div id="app" class="article">${article}</div>`);

    const schema = {
      '@context':'https://schema.org', '@type':'Article', headline:title,
      description, url:canonical, inLanguage:'bn-BD', isAccessibleForFree:true,
      mainEntityOfPage:{'@type':'WebPage','@id':canonical},
      author:{'@type':'Person',name:story.author || 'Bangla Choti Kahinii'},
      publisher:{'@type':'Organization',name:'Bangla Choti Kahinii',url:SITE}
    };
    if (story.createdAt) schema.datePublished = new Date(story.createdAt).toISOString();
    if (story.updatedAt) schema.dateModified = new Date(story.updatedAt).toISOString();
    if (image) schema.image = [image];
    html = html.replace('</head>', `<script type="application/ld+json">${JSON.stringify(schema).replace(/</g,'\\u003c')}</script></head>`);
    html = html.replace('</body>', `<script>window.__SERVER_STORY__=${JSON.stringify(story).replace(/</g,'\\u003c')};</script></body>`);

    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type':'text/html; charset=UTF-8',
        'Cache-Control':'public, max-age=0, s-maxage=300, stale-while-revalidate=3600'
      }
    });
  } catch (e) {
    return new Response('Story not found', { status: 404, headers: {'Content-Type':'text/plain; charset=UTF-8'} });
  }
}
