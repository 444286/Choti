export async function onRequest(context) {
  const url = new URL(context.request.url);
  const path = url.pathname.replace(/^\/+|\/+$/g, "");

  // Pass through: homepage, static files (.html/.js/.css etc), admin, story (the html file itself)
  if (!path || path.includes(".") || path === "admin" || path === "story" || path === "story.html") {
    return context.next();
  }

  // Any other single path segment = a story slug → serve story.html (URL stays clean, no query params)
  const rewrite = new URL(context.request.url);
  rewrite.pathname = "/story.html";
  rewrite.search = "";

  return context.env.ASSETS.fetch(new Request(rewrite.toString(), context.request));
}
