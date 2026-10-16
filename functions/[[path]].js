export async function onRequest(context) {
  const url = new URL(context.request.url);
  const path = url.pathname.replace(/^\/+|\/+$/g, "");

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
