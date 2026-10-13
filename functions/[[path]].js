export async function onRequest(context) {
  const url = new URL(context.request.url);
  const path = url.pathname.replace(/^\/+|\/+$/g, "");

  // Let homepage and actual static files pass through.
  if (!path || path.includes(".") || path === "admin" || path === "story") {
    return context.next();
  }

  // Decode the path segment so Bangla/Unicode slugs come through correctly.
  let slug;
  try { slug = decodeURIComponent(path); } catch(e) { slug = path; }

  // Single-segment manual post URL -> story.html?slug=<decoded slug>
  url.pathname = "/story.html";
  url.searchParams.set("slug", slug);

  return context.env.ASSETS.fetch(new Request(url.toString(), context.request));
}
