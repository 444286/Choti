export async function onRequest(context) {
  const url = new URL(context.request.url);
  const path = url.pathname.replace(/^\/+|\/+$/g, "");

  // Let homepage and actual static files pass through.
  if (!path || path.includes(".") || path === "admin" || path === "story") {
    return context.next();
  }

  // Single-segment manual post URL -> story.html?slug=<manual slug>
  url.pathname = "/story.html";
  url.searchParams.set("slug", decodeURIComponent(path));

  return context.env.ASSETS.fetch(new Request(url.toString(), context.request));
}
