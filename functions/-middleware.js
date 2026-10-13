export async function onRequest(context) {
  const request = context.request;
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/+|\/+$/g, "");

  // Let homepage, existing files, admin and static assets pass through.
  if (!path || path.includes("/") || path.includes(".") || ["admin", "story", "index"].includes(path.toLowerCase())) {
    return context.next();
  }

  // Clean story URL: /story-title -> /story.html?slug=story-title
  const rewrite = new URL(url);
  rewrite.pathname = "/story.html";
  rewrite.searchParams.set("slug", decodeURIComponent(path));
  return context.next({ request: new Request(rewrite.toString(), request) });
}
