export async function onRequest(context) {
  const url = new URL(context.request.url);
  const path = url.pathname.replace(/^\/+|\/+$/g, "");

  // ===== SITEMAP.XML =====
  if (path === "sitemap.xml") {
    return handleSitemap(context, url);
  }

  // ===== ROBOTS.TXT =====
  if (path === "robots.txt") {
    return handleRobots(url);
  }

  // Pass through: homepage, static files, admin, story page itself
  if (!path || path.includes(".") || path === "admin" || path === "story" || path === "story.html") {
    return context.next();
  }

  // ===== STORY PAGE — canonical fix =====
  // Rewrite to story.html and inject correct canonical URL
  let slug;
  try { slug = decodeURIComponent(path); } catch(e) { slug = path; }

  const rewrite = new URL(context.request.url);
  rewrite.pathname = "/story.html";
  rewrite.search = "?slug=" + encodeURIComponent(slug);

  const originalResp = await context.env.ASSETS.fetch(
    new Request(rewrite.toString(), context.request)
  );

  // Only modify HTML responses
  const contentType = originalResp.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) {
    return originalResp;
  }

  // Inject correct canonical URL into the HTML before Google sees it
  const canonicalUrl = `https://banglachoti.pages.dev/${path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;

  let html = await originalResp.text();

  // Replace the default homepage canonical with the actual story URL
  html = html.replace(
    `<link id="canonicalLink" rel="canonical" href="https://banglachoti.pages.dev/">`,
    `<link id="canonicalLink" rel="canonical" href="${canonicalUrl}">`
  );

  // Also fix og:url default
  html = html.replace(
    `<meta id="ogUrl" property="og:url" content="https://banglachoti.pages.dev/">`,
    `<meta id="ogUrl" property="og:url" content="${canonicalUrl}">`
  );

  return new Response(html, {
    status: originalResp.status,
    headers: originalResp.headers,
  });
}

// ===== ROBOTS.TXT =====
function handleRobots(url) {
  const origin = url.origin;
  const body = `User-agent: *
Allow: /

# Admin panel crawl করবে না
Disallow: /admin
Disallow: /admin/
Disallow: /*.json$

# Sitemap
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
