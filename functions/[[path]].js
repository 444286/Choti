export async function onRequest(context) {
  const url = new URL(context.request.url);
  const path = url.pathname.replace(/^\/+|\/+$/g, "");

  // ===== SITEMAP.XML — Dynamic, Firebase থেকে সব story URL =====
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

  // Rewrite to story.html — pass slug as query param (internal only)
  // Browser URL stays clean because this is a SERVER-SIDE rewrite, not redirect
  let slug;
  try { slug = decodeURIComponent(path); } catch(e) { slug = path; }

  const rewrite = new URL(context.request.url);
  rewrite.pathname = "/story.html";
  rewrite.search = "?slug=" + encodeURIComponent(slug);

  return context.env.ASSETS.fetch(new Request(rewrite.toString(), context.request));
}

// ===== ROBOTS.TXT HANDLER =====
function handleRobots(url) {
  const origin = url.origin; // e.g. https://banglachoti.pages.dev
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
      "Cache-Control": "public, max-age=86400", // 1 দিন cache
    },
  });
}

// ===== SITEMAP.XML HANDLER =====
async function handleSitemap(context, url) {
  const origin = url.origin;
  const FIREBASE_URL =
    "https://jobs-33e35-default-rtdb.asia-southeast1.firebasedatabase.app";

  // Static pages
  const staticUrls = [
    { loc: `${origin}/`, priority: "1.0", changefreq: "daily" },
  ];

  // Firebase থেকে stories ও categories fetch করো
  let storyUrls = [];
  let categoryUrls = [];

  try {
    // Stories fetch
    const storiesResp = await fetch(
      `${FIREBASE_URL}/stories.json?orderBy="status"&equalTo="published"&limitToLast=500`,
      { cf: { cacheTtl: 300 } } // 5 মিনিট Cloudflare cache
    );
    if (storiesResp.ok) {
      const stories = await storiesResp.json();
      if (stories && typeof stories === "object") {
        for (const [id, story] of Object.entries(stories)) {
          if (!story || story.status !== "published") continue;

          // postLink থেকে slug বের করো
          let slug =
            story.postLink || story.customLink || story.manualLink || "";
          if (!slug) continue;

          // Full URL হলে path নাও
          if (/^https?:\/\//i.test(slug)) {
            try {
              slug = new URL(slug).pathname;
            } catch (e) {}
          }
          slug = slug.replace(/^\/+|\/+$/g, "");
          if (!slug || slug === "story" || slug === "admin") continue;

          const encodedSlug = slug
            .split("/")
            .map(encodeURIComponent)
            .join("/");

          const lastmod = story.updatedAt || story.createdAt
            ? new Date(story.updatedAt || story.createdAt)
                .toISOString()
                .split("T")[0]
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

    // Categories fetch — category filter pages
    const catResp = await fetch(`${FIREBASE_URL}/categories.json`, {
      cf: { cacheTtl: 600 },
    });
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
  } catch (err) {
    // Firebase fail করলেও static sitemap return করো
    console.error("Sitemap Firebase error:", err);
  }

  // সব URL একসাথে করো
  const allUrls = [...staticUrls, ...categoryUrls, ...storyUrls];

  // XML তৈরি করো
  const urlsXml = allUrls
    .map((u) => {
      const lastmodTag = u.lastmod ? `\n    <lastmod>${u.lastmod}</lastmod>` : "";
      return `  <url>
    <loc>${escapeXml(u.loc)}</loc>${lastmodTag}
    <changefreq>${u.changefreq || "weekly"}</changefreq>
    <priority>${u.priority || "0.5"}</priority>
  </url>`;
    })
    .join("\n");

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
      "Cache-Control": "public, max-age=3600", // 1 ঘণ্টা cache
      "X-Robots-Tag": "noindex", // sitemap.xml নিজে index হবে না
    },
  });
}

// XML special characters escape
function escapeXml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
