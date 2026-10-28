const FIREBASE_URL = "https://jobs-33e35-default-rtdb.asia-southeast1.firebasedatabase.app";
const SITE_ORIGIN = "https://banglachoti.pages.dev";

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const path = decodeSafe(url.pathname.replace(/^\/+|\/+$/g, ""));

  if (path === "indexnow-submit") return context.next();
  if (path === "sitemap.xml" || path === "robots.txt") return context.next();

  // Homepage, known static files and the legacy /story route use the normal asset.
  if (!path || path.includes(".") || path === "admin" || path.startsWith("admin/") ||
      path === "story" || path === "story.html") {
    return context.next();
  }

  // Resolve a clean story slug directly from Firebase, then render the story
  // into the HTML template before sending the first response to Google/browser.
  try {
    const resp = await fetch(`${FIREBASE_URL}/stories.json`);
    if (!resp.ok) return new Response("Story database unavailable", { status: 502 });
    const all = await resp.json();
    const wanted = normalizeSlug(path);
    let found = null;

    for (const [id, item] of Object.entries(all || {})) {
      if (!item || item.status === "draft") continue;
      const candidates = [item.postLink, item.customLink, item.manualLink]
        .map(normalizeSlug).filter(Boolean);
      if (candidates.includes(wanted)) {
        found = { ...item, _id: item._id || id };
        break;
      }
    }

    if (!found) {
      const notFound = await context.env.ASSETS.fetch(new Request(new URL("/story.html", url)));
      const text = await notFound.text();
      return new Response(text.replace('গল্প লোড হচ্ছে...', 'গল্পটি পাওয়া যায়নি।'), {
        status: 404,
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }
      });
    }

    const assetUrl = new URL("/story.html", url);
    const assetResp = await context.env.ASSETS.fetch(new Request(assetUrl, {
      headers: { "Accept": "text/html" }
    }));
    if (!assetResp.ok) return assetResp;
    let html = await assetResp.text();

    const title = String(found.title || "বাংলা গল্প").trim();
    const description = String(found.excerpt || stripHtml(found.content).slice(0, 160) ||
      `${title} গল্পটি Bangla Choti Kahinii-তে পড়ুন।`).trim();
    const canonical = `${SITE_ORIGIN}/${wanted.split("/").map(encodeURIComponent).join("/")}`;
    const safeTitle = escapeHtml(title);
    const safeDescription = escapeHtml(description);
    const date = found.createdAt ? new Date(found.createdAt).toLocaleDateString("bn-BD") : "";
    const author = escapeHtml(found.author || "অজ্ঞাত");
    const views = Number(found.views) || 0;
    const content = sanitizeStoryContent(found.content || "");

    // Render the same supporting sections server-side too. Client-side loadStory()
    // is intentionally skipped for SSR pages, so these must be in the first HTML.
    const categoriesResp = await fetch(`${FIREBASE_URL}/categories.json`).catch(() => null);
    const categoriesData = categoriesResp && categoriesResp.ok ? await categoriesResp.json() : {};
    const categoryMap = {};
    for (const [cid, cat] of Object.entries(categoriesData || {})) {
      if (cat && cat.slug) categoryMap[cat.slug] = cat;
    }
    const storyCats = Array.isArray(found.categories) ? found.categories : [];
    const categoryHtml = storyCats.length
      ? `<section class="category-end"><div class="category-title">ক্যাটাগরি</div><div class="category-list">${storyCats.map(slug => {
          const cat = categoryMap[slug] || { name: slug };
          return `<a class="cat" href="/?category=${encodeURIComponent(slug)}">${escapeHtml(cat.name || slug)}</a>`;
        }).join(', ')}</div></section>` : '';

    const linksResp = await fetch(`${FIREBASE_URL}/stories/${encodeURIComponent(found._id)}/links.json`).catch(() => null);
    const linksData = linksResp && linksResp.ok ? (await linksResp.json() || {}) : {};
    const parts = linksData.series && Array.isArray(linksData.series.parts) ? linksData.series.parts : [];
    const storyHref = item => {
      let value = String(item && (item.postLink || item.customLink || item.manualLink) || '').trim();
      if (/^https?:\/\//i.test(value)) { try { value = new URL(value).pathname; } catch {} }
      value = decodeSafe(value).replace(/^\/+|\/+$/g, '');
      return value ? '/' + value.split('/').map(encodeURIComponent).join('/') : '#';
    };
    let relatedItems = [];
    if (parts.length < 5) {
      relatedItems = Object.entries(all || {}).map(([id, item]) => ({ ...item, _id: item && item._id || id }))
        .filter(item => item && item._id !== found._id && item.status !== 'draft' &&
          (item.postLink || item.customLink || item.manualLink) &&
          Array.isArray(item.categories) && storyCats.some(cat => item.categories.includes(cat)))
        .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
        .slice(0, Math.max(0, 5 - parts.length));
    }
    const partsHtml = parts.length
      ? `<section class="series-box"><div class="series-title">📚 এই গল্পের সকল পর্ব</div><ol class="series-list">${parts.map((item, i) => `<li><a href="${storyHref(item)}">${escapeHtml(item.title || `পর্ব ${item.part || i + 1}`)}</a></li>`).join('')}</ol></section>` : '';
    const relatedHtml = relatedItems.length
      ? `<section class="series-box"><div class="series-title related-title">${parts.length ? '📖 আরও গল্প পড়ুন' : '📖 একই বিভাগের আরও গল্প'}</div><ol class="series-list">${relatedItems.map(item => `<li><a href="${storyHref(item)}">${escapeHtml(item.title || 'গল্প')}</a></li>`).join('')}</ol></section>` : '';

    let prevNextHtml = '';
    const suffixMatch = normalizeSlug(found.postLink || found.customLink || found.manualLink).match(/^(.*)-(\d+)$/);
    if (suffixMatch) {
      const base = suffixMatch[1], num = Number(suffixMatch[2]);
      const findPart = target => Object.entries(all || {}).map(([id, item]) => ({ ...item, _id: item && item._id || id }))
        .find(item => item && item.status !== 'draft' &&
          [item.postLink, item.customLink, item.manualLink].some(link => normalizeSlug(link) === `${base}-${target}`));
      const prev = num > 1 ? findPart(num - 1) : null;
      const next = findPart(num + 1);
      if (prev || next) prevNextHtml = `<div class="porbo-nav">${prev ? `<a href="${storyHref(prev)}">← আগের পর্ব</a>` : ''}<div class="spacer"></div>${next ? `<a href="${storyHref(next)}">পরের পর্ব →</a>` : ''}</div>`;
    }
    const storyHtml = `<div class="head"><h1 class="title">${safeTitle}</h1><div class="meta"><span>👤 ${author}</span>${date ? `<span>📅 ${escapeHtml(date)}</span>` : ""}<span>👁 ${views.toLocaleString("bn-BD")}</span></div></div>${prevNextHtml}<article class="content">${content}</article>${prevNextHtml}${partsHtml}${relatedHtml}${categoryHtml}`;

    // Remove the client-side document.write canonical generator to avoid duplicate canonicals.
    html = html.replace(/<script>\s*\(function\(\)\{\s*\/\/ Worker passes slug[\s\S]*?<\/script>/i, "");
    html = html.replace(/<link\b[^>]*rel=["']canonical["'][^>]*>/gi, "");
    html = html.replace("</head>", `<link id="canonicalLink" rel="canonical" href="${canonical}">\n</head>`);
    html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${safeTitle} | Bangla Choti Kahinii</title>`);
    html = html.replace(/<meta name="description" content="[^"]*"\s*\/?>/i,
      `<meta name="description" content="${safeDescription}">`);
    html = html.replace(/<meta id="ogTitle" property="og:title" content="[^"]*"\s*\/?>/i,
      `<meta id="ogTitle" property="og:title" content="${safeTitle}">`);
    html = html.replace(/<meta id="ogDescription" property="og:description" content="[^"]*"\s*\/?>/i,
      `<meta id="ogDescription" property="og:description" content="${safeDescription}">`);
    html = html.replace(/<meta id="ogUrl" property="og:url" content="[^"]*"\s*\/?>/i,
      `<meta id="ogUrl" property="og:url" content="${canonical}">`);
    html = html.replace(/<meta id="twitterTitle" name="twitter:title" content="[^"]*"\s*\/?>/i,
      `<meta id="twitterTitle" name="twitter:title" content="${safeTitle}">`);
    html = html.replace(/<meta id="twitterDescription" name="twitter:description" content="[^"]*"\s*\/?>/i,
      `<meta id="twitterDescription" name="twitter:description" content="${safeDescription}">`);

    if (found.image) {
      const imageUrl = escapeHtml(new URL(found.image, SITE_ORIGIN).href);
      html = html.replace(/<meta id="ogImage" property="og:image" content="[^"]*"\s*\/?>/i,
        `<meta id="ogImage" property="og:image" content="${imageUrl}">`);
      html = html.replace(/<meta id="twitterImage" name="twitter:image" content="[^"]*"\s*\/?>/i,
        `<meta id="twitterImage" name="twitter:image" content="${imageUrl}">`);
    }

    const schema = {
      "@context": "https://schema.org",
      "@type": "Article",
      "headline": title,
      "description": description,
      "url": canonical,
      "inLanguage": "bn-BD",
      "author": { "@type": "Person", "name": found.author || "Bangla Choti Kahinii" },
      "publisher": { "@type": "Organization", "name": "Bangla Choti Kahinii", "url": SITE_ORIGIN + "/" },
      ...(found.createdAt ? { "datePublished": safeIso(found.createdAt) } : {}),
      ...(found.updatedAt ? { "dateModified": safeIso(found.updatedAt) } : {}),
      ...(found.image ? { "image": [new URL(found.image, SITE_ORIGIN).href] } : {})
    };
    html = html.replace("</head>", `<script type="application/ld+json">${JSON.stringify(schema).replace(/</g, "\\u003c")}</script>\n</head>`);
    html = html.replace('<div id="app" class="loading">গল্প লোড হচ্ছে...</div>', `<div id="app" class="article">${storyHtml}</div>`);
    // Prevent the browser JS from replacing the already-rendered server HTML with a loading state.
    html = html.replace('<script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js"></script>',
      '<script>window.__SSR_STORY_RENDERED__ = true;</script>\n<script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js"></script>');
    html = html.replace(/^\s*loadStory\(\);\s*$/m, 'if (!window.__SSR_STORY_RENDERED__) loadStory();');

    return new Response(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=60, s-maxage=300",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch (err) {
    console.error("SSR story render failed:", err);
    // Fallback to the original story template if the database temporarily fails.
    const fallbackUrl = new URL("/story.html", url);
    fallbackUrl.searchParams.set("slug", path);
    return context.env.ASSETS.fetch(new Request(fallbackUrl, context.request));
  }
}

function decodeSafe(v) { try { return decodeURIComponent(v); } catch { return v; } }
function normalizeSlug(value) {
  let v = String(value || "").trim();
  if (/^https?:\/\//i.test(v)) { try { v = new URL(v).pathname; } catch {} }
  v = decodeSafe(v).replace(/^\/+|\/+$/g, "");
  return v.split("/").filter(Boolean).pop() || "";
}
function escapeHtml(v) {
  return String(v ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
function stripHtml(v) {
  return String(v || "").replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
}
// Story content is intentionally HTML from the editor; remove executable/unsafe embeds
// while retaining common formatting, paragraphs, links and images.
function sanitizeStoryContent(v) {
  return String(v || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, "")
    .replace(/\son\w+\s*=\s*(["']).*?\1/gi, "")
    .replace(/javascript\s*:/gi, "");
}
function safeIso(v) { const d = new Date(v); return Number.isNaN(d.getTime()) ? undefined : d.toISOString(); }
