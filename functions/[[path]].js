const FIREBASE_URL = "https://jobs-33e35-default-rtdb.asia-southeast1.firebasedatabase.app";
const SITE_ORIGIN = "https://banglachoti.pages.dev";

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const path = decodeSafe(url.pathname.replace(/^\/+|\/+$/g, ""));

  if (path === "indexnow-submit") return context.next();
  if (path === "sitemap.xml" || path === "robots.txt") return context.next();

  // Keep assets/admin/legacy story routes on their original handlers.
  if (path.includes(".") || path === "admin" || path.startsWith("admin/") ||
      path === "story" || path === "story.html") {
    return context.next();
  }

  // Server-render the homepage and its category/search/page variants so the
  // first HTML response already contains story titles, excerpts and crawlable links.
  if (!path) {
    try {
      const [storiesResp, categoriesResp] = await Promise.all([
        fetch(`${FIREBASE_URL}/stories.json`),
        fetch(`${FIREBASE_URL}/categories.json`).catch(() => null)
      ]);
      if (!storiesResp.ok) return context.next();
      const rawStories = await storiesResp.json();
      const rawCategories = categoriesResp && categoriesResp.ok ? await categoriesResp.json() : {};
      const categories = Object.entries(rawCategories || {}).map(([id, c]) => ({ ...(c || {}), _id: (c && c._id) || id }));
      const categoryMap = {};
      for (const c of categories) if (c && c.slug) categoryMap[String(c.slug)] = c;

      const params = url.searchParams;
      const requestedCategory = params.get("category") || "";
      const requestedSearch = (params.get("search") || "").trim();
      const requestedPage = Math.max(1, parseInt(params.get("page") || "1", 10) || 1);
      let stories = Object.entries(rawStories || {}).map(([id, s]) => ({ ...(s || {}), _id: (s && s._id) || id }))
        .filter(s => s && s.status === "published" && (s.postLink || s.customLink || s.manualLink));
      if (requestedCategory) stories = stories.filter(s => Array.isArray(s.categories) && s.categories.includes(requestedCategory));
      if (requestedSearch) {
        const q = requestedSearch.toLocaleLowerCase();
        stories = stories.filter(s => [s.title, s.content, s.author, s.excerpt].some(v => String(v || "").toLocaleLowerCase().includes(q)));
      }
      stories.sort((a, b) => Number(b.createdOrder || new Date(b.createdAt || 0).getTime()) - Number(a.createdOrder || new Date(a.createdAt || 0).getTime()));
      const total = stories.length;
      const totalPages = Math.max(1, Math.ceil(total / 15));
      const page = Math.min(requestedPage, totalPages);
      const pageStories = stories.slice((page - 1) * 15, page * 15);
      const storyHref = item => {
        let value = String(item.postLink || item.customLink || item.manualLink || "").trim();
        if (/^https?:\/\//i.test(value)) { try { value = new URL(value).pathname; } catch {} }
        value = decodeSafe(value).replace(/^\/+|\/+$/g, "");
        if (!value || ["story", "story.html", "index.html", "admin"].includes(value)) return "/";
        return "/" + value.split("/").map(encodeURIComponent).join("/");
      };
      const cardHtml = pageStories.length ? pageStories.map(s => {
        const href = storyHref(s);
        const date = s.createdAt && !Number.isNaN(new Date(s.createdAt).getTime())
          ? new Date(s.createdAt).toLocaleDateString("bn-BD", { day: "2-digit", month: "2-digit", year: "numeric" }) : "";
        const catsHtml = (Array.isArray(s.categories) ? s.categories : []).map(slug => {
          const cat = categoryMap[slug] || { name: slug };
          return `<button type="button" class="story-cat" onclick="event.stopPropagation();filterCat(decodeURIComponent('${encodeURIComponent(String(slug))}'),this)">${cat.icon ? escapeHtml(cat.icon) + " " : ""}${escapeHtml(cat.name || slug)}</button>`;
        }).join("");
        return `<div class="story-card" data-story-id="${escapeHtml(s._id)}" onclick="openStory(this.dataset.storyId)"><div class="story-body"><div class="story-title"><a href="${href}" onclick="event.stopPropagation()">${escapeHtml(s.title || "গল্প")}</a></div><div class="story-meta"><span>👤 ${escapeHtml(s.author || "অজ্ঞাত")}</span>${date ? `<span>📅 ${escapeHtml(date)}</span>` : ""}<span>👁 ${Number(s.views || 0).toLocaleString("bn-BD")}</span></div><div class="story-excerpt">${escapeHtml(stripHtml(s.excerpt || stripHtml(s.content || "").slice(0, 180)))}</div><div class="story-cats">${catsHtml}</div></div><button class="bookmark-btn" onclick="toggleBookmark(event, '${escapeHtml(s._id)}')">🔖</button><div class="story-arrow">›</div></div>`;
      }).join("") : `<div class="loading-spinner">${requestedSearch || requestedCategory ? "কোনো গল্প পাওয়া যায়নি।" : "এখনও কোনো গল্প প্রকাশিত হয়নি।"}</div>`;
      let pages = [];
      if (totalPages <= 7) { for (let i = 1; i <= totalPages; i++) pages.push(i); }
      else { const left = Math.max(2, page - 1), right = Math.min(totalPages - 1, page + 1); pages.push(1); if (left > 2) pages.push("..."); for (let i = left; i <= right; i++) pages.push(i); if (right < totalPages - 1) pages.push("..."); pages.push(totalPages); }
      const pageHref = targetPage => {
        const nextUrl = new URL(url);
        if (requestedCategory) nextUrl.searchParams.set("category", requestedCategory); else nextUrl.searchParams.delete("category");
        if (requestedSearch) nextUrl.searchParams.set("search", requestedSearch); else nextUrl.searchParams.delete("search");
        if (targetPage > 1) nextUrl.searchParams.set("page", String(targetPage)); else nextUrl.searchParams.delete("page");
        return nextUrl.pathname + nextUrl.search;
      };
      const paginationHtml = totalPages <= 1 ? "" : `<div class="pagination-nums">${pages.map(p => p === "..." ? `<span class="page-dots">...</span>` : `<a class="page-btn ${p === page ? "active" : ""}" href="${pageHref(p)}"${p === page ? ' aria-current="page"' : ""}>${p}</a>`).join("")}</div><div class="pagination-nav">${page === 1 ? `<span class="page-prev disabled" aria-disabled="true">← Previous</span>` : `<a class="page-prev" href="${pageHref(page-1)}">← Previous</a>`}${page === totalPages ? `<span class="page-next disabled" aria-disabled="true">Next →</span>` : `<a class="page-next" href="${pageHref(page+1)}">Next →</a>`}</div>`;
      const filterHtml = `<button class="filter-tag${!requestedCategory ? " active" : ""}" onclick="filterCat('',this)">📚 সব গল্প</button>` + categories.filter(c => c && c.slug).map(c => `<button class="filter-tag${requestedCategory === String(c.slug) ? " active" : ""}" data-category="${escapeHtml(c.slug)}" onclick="filterCat(decodeURIComponent('${encodeURIComponent(String(c.slug))}'),this)">${escapeHtml(c.icon || "📖")} ${escapeHtml(c.name || c.slug)}</button>`).join("");
      const assetResp = await context.env.ASSETS.fetch(new Request(new URL("/", url), { headers: { "Accept": "text/html" } }));
      if (!assetResp.ok) return assetResp;
      let html = await assetResp.text();
      html = html.replace(/<div class="loading-spinner">\s*<div class="spinner"><\/div>\s*<div>গল্প লোড হচ্ছে...<\/div>\s*<\/div>/, cardHtml);
      html = html.replace('<div class="pagination" id="paginationWrap"></div>', `<div class="pagination" id="paginationWrap">${paginationHtml}</div>`);
      html = html.replace(/<div(?=[^>]*id="filterTags")[^>]*>[\s\S]*?<\/div>/, match => match.replace(/>[\s\S]*<\/div>$/, `>${filterHtml}</div>`));
      // Keep the SSR cards visible on first paint; client-side interactions still work.
      html = html.replace(/<script>\s*const firebaseConfig/, "<script>\nwindow.__SSR_HOME_RENDERED__ = true;\nconst firebaseConfig");
      html = html.replace("loadCategories().finally(() => loadStories(initialPage, initialCategory, initialSearch));", "loadCategories().finally(() => { if (!window.__SSR_HOME_RENDERED__) loadStories(initialPage, initialCategory, initialSearch); });");
      // Canonicalize homepage variants consistently: keep meaningful category and
      // pagination parameters, but do not canonicalize internal search queries.
      const canonicalParams = new URLSearchParams();
      if (requestedCategory) canonicalParams.set("category", requestedCategory);
      if (page > 1) canonicalParams.set("page", String(page));
      const canonical = SITE_ORIGIN + "/" + (canonicalParams.toString() ? "?" + canonicalParams.toString() : "");
      html = html.replace(/<link\b[^>]*rel=["']canonical["'][^>]*>/gi, "");
      html = html.replace("</head>", `<link id="canonicalLink" rel="canonical" href="${escapeHtml(canonical)}">\n</head>`);
      html = html.replace(/<meta property=["']og:url["'] content=["'][^"']*["']\s*\/?>/i, `<meta property="og:url" content="${escapeHtml(canonical)}">`);
      html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${requestedCategory && categoryMap[requestedCategory] ? escapeHtml(categoryMap[requestedCategory].name || requestedCategory) + " | " : ""}Bangla Choti Kahinii - বাংলা চটি গল্পের সবচেয়ে বড় ঠিকানা${page > 1 ? " - Page " + page : ""}</title>`);
      html = html.replace(/<meta name="description" content="[^"]*"\s*\/?>/i, `<meta name="description" content="বাংলা চটি গল্প, বাংলা গল্প ও বিভিন্ন ধরনের বাংলা গল্প পড়ুন Bangla Choti Kahinii-তে। নতুন গল্প, জনপ্রিয় গল্প ও বিভিন্ন বিভাগের গল্প এক জায়গায় পড়ুন.">`);
      return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=30, s-maxage=120", "X-Content-Type-Options": "nosniff" } });
    } catch (err) {
      console.error("SSR homepage render failed:", err);
      return context.next();
    }
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
    const content = processInlineStoryLinks(sanitizeStoryContent(found.content || ""));

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
      ? `<section class="category-end"><div class="category-title">Categories</div><div class="category-list">${storyCats.map(slug => {
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
      ? `<section class="series-box"><div class="series-title related-title">${parts.length ? '📖 আরও গল্প পড়ুন' : '📖 Related Posts'}</div><ol class="series-list">${relatedItems.map(item => `<li><a href="${storyHref(item)}">${escapeHtml(item.title || 'গল্প')}</a></li>`).join('')}</ol></section>` : '';

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
// Convert the editor's [[story-slug|Story Title]] syntax into clickable links
// during SSR too, because the client-side story loader is skipped on rendered pages.
function processInlineStoryLinks(input) {
  // Admin rich-text editors sometimes save brackets/pipes as HTML entities.
  // Normalize only these delimiter entities before parsing the custom syntax.
  const source = String(input || "")
    .replace(/&amp;(#0*91;|#x0*5b;|lbrack;)/gi, "&$1")
    .replace(/&amp;(#0*93;|#x0*5d;|rbrack;)/gi, "&$1")
    .replace(/&amp;(#0*124;|#x0*7c;|vert;|verbar;)/gi, "&$1")
    .replace(/&#0*91;|&#x0*5b;|&lbrack;/gi, "[")
    .replace(/&#0*93;|&#x0*5d;|&rbrack;/gi, "]")
    .replace(/&#0*124;|&#x0*7c;|&vert;|&verbar;/gi, "|");
  return source.replace(/\[\[\s*([^\]|]+?)\s*\|\s*([^\]]+?)\s*\]\]/g, (match, slug, title) => {
    const cleanSlug = String(slug || "").trim().replace(/^\/+|\/+$/g, "");
    const cleanTitle = String(title || "").trim();
    if (!cleanSlug || !cleanTitle) return match;
    const href = "/" + cleanSlug.split("/").filter(Boolean).map(part => encodeURIComponent(part)).join("/");
    return `<a class="inline-story-link" href="${href}">📖 ${escapeHtml(cleanTitle)}</a>`;
  });
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
