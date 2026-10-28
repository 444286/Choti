export async function onRequest(context) {
  const url = new URL(context.request.url);
  const path = url.pathname.replace(/^\/+|\/+$/g, "");

  // ===== INDEXNOW URL SUBMISSION =====
  if (path === "indexnow-submit") {
    return handleIndexNowSubmit(context);
  }

  // ===== SITEMAP.XML =====
  if (path === "sitemap.xml") {
    return handleSitemap(context, url);
  }

  // ===== ROBOTS.TXT =====
  if (path === "robots.txt") {
    return handleRobots(url);
  }

  // Pass through homepage, static assets, admin and direct story.html file.
  // IMPORTANT: older routing may send clean story URLs to /story?slug=...
  // In that case, this function must SSR the query slug instead of returning
  // the empty client-side loading shell.
  const querySlug = url.searchParams.get("slug") || "";
  if (!path || path.includes(".") || path === "admin" || path === "admin/" || (path === "story" && !querySlug)) {
    return context.next();
  }

  // ===== STORY PAGE — server-render story HTML for crawlers =====
  let slug;
  try { slug = decodeURIComponent(querySlug || path); } catch(e) { slug = querySlug || path; }

  const rewrite = new URL(context.request.url);
  rewrite.pathname = "/story.html";
  rewrite.search = "?slug=" + encodeURIComponent(slug);

  const originalResp = await context.env.ASSETS.fetch(
    new Request(rewrite.toString(), context.request)
  );
  const contentType = originalResp.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return originalResp;

  let html = await originalResp.text();
  const canonicalUrl = `https://banglachoti.pages.dev/${slug.split("/").map(encodeURIComponent).join("/")}`;

  // Read the published story directly from Firebase on the server, so the initial
  // HTML response already contains the complete article (not only a loading box).
  try {
    const fb = await fetch("https://jobs-33e35-default-rtdb.asia-southeast1.firebasedatabase.app/stories.json");
    if (fb.ok) {
      const all = await fb.json();
      const normalize = value => {
        let v = String(value || "").trim();
        if (/^https?:\/\//i.test(v)) { try { v = new URL(v).pathname; } catch(e) {} }
        try { v = decodeURIComponent(v); } catch(e) {}
        return v.replace(/^\/+|\/+$/g, "").split("/").pop() || "";
      };
      const wanted = normalize(slug);
      let story = null;
      if (all && typeof all === "object") {
        for (const [id, item] of Object.entries(all)) {
          if (!item || item.status === "draft") continue;
          const links = [item.postLink, item.customLink, item.manualLink].map(normalize);
          if (links.includes(wanted)) { story = { ...item, _id: item._id || id }; break; }
        }
      }
      if (story) {
        const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
        const title = String(story.title || "বাংলা গল্প").trim();
        const plain = String(story.excerpt || String(story.content || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160) || `${title} গল্পটি পড়ুন।`).trim();
        const date = story.createdAt ? new Date(story.createdAt).toLocaleDateString("bn-BD", { timeZone: "Asia/Dhaka" }) : "";
        const image = story.image ? new URL(story.image, "https://banglachoti.pages.dev/").href : "";
        const articleHtml = `<div class="article"><div class="head"><h1 class="title">${esc(title)}</h1><div class="meta"><span>👤 ${esc(story.author || "অজ্ঞাত")}</span>${date ? `<span>📅 ${esc(date)}</span>` : ""}<span>👁 ${Number(story.views || 0).toLocaleString("bn-BD")}</span></div></div>${image ? `<img class="cover" src="${esc(image)}" alt="${esc(title)}">` : ""}<article class="content">${String(story.content || "")}</article></div>`;
        html = html.replace(/<div id="app"[^>]*>[\s\S]*?<\/div>/i, articleHtml);
        html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${esc(title)} | Bangla Choti Kahinii</title>`);
        html = html.replace(/<meta name="description" content="[^"]*">/i, `<meta name="description" content="${esc(plain)}">`);
        html = html.replace(/<meta id="ogTitle"[^>]*>/i, `<meta id="ogTitle" property="og:title" content="${esc(title)} | Bangla Choti Kahinii">`);
        html = html.replace(/<meta id="ogDescription"[^>]*>/i, `<meta id="ogDescription" property="og:description" content="${esc(plain)}">`);
        html = html.replace(/<meta id="ogUrl"[^>]*>/i, `<meta id="ogUrl" property="og:url" content="${canonicalUrl}">`);
        html = html.replace(/<meta id="twitterTitle"[^>]*>/i, `<meta id="twitterTitle" name="twitter:title" content="${esc(title)} | Bangla Choti Kahinii">`);
        html = html.replace(/<meta id="twitterDescription"[^>]*>/i, `<meta id="twitterDescription" name="twitter:description" content="${esc(plain)}">`);
        if (image) {
          html = html.replace(/<meta id="ogImage"[^>]*>/i, `<meta id="ogImage" property="og:image" content="${esc(image)}">`);
          html = html.replace(/<meta id="twitterImage"[^>]*>/i, `<meta id="twitterImage" name="twitter:image" content="${esc(image)}">`);
        }
        const schema = {"@context":"https://schema.org","@type":"Article","headline":title,"description":plain,"url":canonicalUrl,"inLanguage":"bn-BD","author":{"@type":"Person","name":story.author || "Bangla Choti Kahinii"},"datePublished":story.createdAt ? new Date(story.createdAt).toISOString() : undefined,"image":image || undefined,"articleBody":String(story.content || "").replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim()};
        html = html.replace(/<script data-server-story-schema>[\s\S]*?<\/script>/i, "");
        html = html.replace(/<\/head>/i, `<script type="application/ld+json" data-server-story-schema>${JSON.stringify(schema).replace(/</g,"\\u003c")}</script></head>`);
      }
    }
  } catch (err) {
    // Keep the client-side Firebase renderer as a fallback if server rendering fails.
    console.error("Story SSR failed:", err);
  }

  // Keep exactly one canonical tag in the response (avoid duplicate canonicals).
  html = html.replace(/<link\b[^>]*rel=["']canonical["'][^>]*>/gi, "");
  html = html.replace(/<\/head>/i, `<link id="canonicalLink" rel="canonical" href="${canonicalUrl}"></head>`);
  html = html.replace(/<meta id="ogUrl"[^>]*>/i, `<meta id="ogUrl" property="og:url" content="${canonicalUrl}">`);

  const newHeaders = new Headers(originalResp.headers);
  newHeaders.set("Cache-Control", "public, max-age=60, s-maxage=300");
  return new Response(html, { status: originalResp.status, headers: newHeaders });
}

// ===== ROBOTS.TXT =====
function handleRobots(url) {
  const origin = url.origin;
  const body = `User-agent: *
Allow: /

Disallow: /admin
Disallow: /admin/
Disallow: /*.json$

Sitemap: ${origin}/sitemap.xml
`;
  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    },
  });
}

// ===== SITEMAP.XML =====
async function handleSitemap(context, url) {
  const origin = url.origin;
  const FIREBASE_URL =
    "https://jobs-33e35-default-rtdb.asia-southeast1.firebasedatabase.app";

  const staticUrls = [
    { loc: `${origin}/`, priority: "1.0", changefreq: "daily" },
  ];

  let storyUrls = [];
  let categoryUrls = [];

  try {
    const catResp = await fetch(`${FIREBASE_URL}/categories.json`);
    if (catResp.ok) {
      const cats = await catResp.json();
      if (cats && typeof cats === "object") {
        for (const [id, cat] of Object.entries(cats)) {
          if (!cat || !cat.slug) continue;
          categoryUrls.push({
            loc: `${origin}/?category=${encodeURIComponent(cat.slug)}`,
            priority: "0.7",
            changefreq: "daily",
          });
        }
      }
    }

    const storiesResp = await fetch(`${FIREBASE_URL}/stories.json`);
    if (storiesResp.ok) {
      const stories = await storiesResp.json();
      if (stories && typeof stories === "object") {
        for (const [id, story] of Object.entries(stories)) {
          if (!story || story.status === "draft") continue;

          let slug = story.postLink || story.customLink || story.manualLink || "";
          if (!slug) continue;

          if (/^https?:\/\//i.test(slug)) {
            try { slug = new URL(slug).pathname; } catch(e) {}
          }
          slug = slug.replace(/^\/+|\/+$/g, "");
          if (!slug || slug === "story" || slug === "admin" || slug === "story.html") continue;

          const encodedSlug = slug.split("/").map(encodeURIComponent).join("/");
          const lastmod = (story.updatedAt || story.createdAt)
            ? new Date(story.updatedAt || story.createdAt).toISOString().split("T")[0]
            : new Date().toISOString().split("T")[0];

          storyUrls.push({
            loc: `${origin}/${encodedSlug}`,
            lastmod,
            priority: "0.8",
            changefreq: "weekly",
          });
        }
      }
    }
  } catch (err) {
    console.error("Sitemap error:", err);
  }

  const allUrls = [...staticUrls, ...categoryUrls, ...storyUrls];

  const urlsXml = allUrls.map((u) => {
    const lastmodTag = u.lastmod ? `\n    <lastmod>${u.lastmod}</lastmod>` : "";
    return `  <url>
    <loc>${escapeXml(u.loc)}</loc>${lastmodTag}
    <changefreq>${u.changefreq || "weekly"}</changefreq>
    <priority>${u.priority || "0.5"}</priority>
  </url>`;
  }).join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset
  xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.sitemaps.org/schemas/sitemap/0.9
    http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd">
${urlsXml}
</urlset>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
      "X-Robots-Tag": "noindex",
    },
  });
}

function escapeXml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}


// ===== INDEXNOW SUBMISSION ENDPOINT =====
// This endpoint only submits URLs belonging to this site.
async function handleIndexNowSubmit(context) {
  const request = context.request;
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  };

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "POST required" }), { status: 405, headers });
  }

  let body;
  try { body = await request.json(); }
  catch (e) { return new Response(JSON.stringify({ ok: false, error: "Invalid JSON" }), { status: 400, headers }); }

  const rawUrls = Array.isArray(body.urlList) ? body.urlList : (body.url ? [body.url] : []);
  if (!rawUrls.length || rawUrls.length > 10) {
    return new Response(JSON.stringify({ ok: false, error: "Send between 1 and 10 URLs" }), { status: 400, headers });
  }

  const host = "banglachoti.pages.dev";
  const urlList = [];
  for (const raw of rawUrls) {
    let u;
    try { u = new URL(String(raw)); } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: "Invalid URL" }), { status: 400, headers });
    }
    if (u.protocol !== "https:" || u.hostname !== host || u.username || u.password) {
      return new Response(JSON.stringify({ ok: false, error: "Only HTTPS URLs on " + host + " are allowed" }), { status: 403, headers });
    }
    if (u.pathname === "/admin" || u.pathname.startsWith("/admin/") || /\.(txt|xml|json)$/i.test(u.pathname)) {
      return new Response(JSON.stringify({ ok: false, error: "This URL type cannot be submitted" }), { status: 400, headers });
    }
    urlList.push(u.href);
  }

  const key = "bd73d30349c63b520fcd33bbdba7ca0e";
  const keyLocation = `https://${host}/${key}.txt`;
  try {
    const response = await fetch("https://api.indexnow.org/indexnow", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ host, key, keyLocation, urlList: [...new Set(urlList)] }),
    });
    const responseText = await response.text().catch(() => "");
    if (response.status === 200 || response.status === 202) {
      return new Response(JSON.stringify({ ok: true, status: response.status, submitted: [...new Set(urlList)].length }), { status: 200, headers });
    }
    return new Response(JSON.stringify({ ok: false, status: response.status, error: responseText.slice(0, 500) || "IndexNow rejected the request" }), { status: 502, headers });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: "Could not reach IndexNow service" }), { status: 502, headers });
  }
}
