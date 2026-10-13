export async function onRequest(context) {
  const url = new URL(context.request.url);
  const path = url.pathname.replace(/^\/+|\/+$/g, "");

  // Homepage and static files — pass through as-is
  if (!path || path.includes(".") || path === "admin") {
    return context.next();
  }

  // Rewrite to story.html — NO query params, story.html reads pathname itself
  const rewrite = new URL(context.request.url);
  rewrite.pathname = "/story.html";
  rewrite.search = "";

  return context.env.ASSETS.fetch(new Request(rewrite.toString(), context.request));
}
