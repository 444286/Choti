export async function onRequest(context) {
  const request = context.request;
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\\/+|\\+$/g, "");
  if (!path || path.includes("/") || path.includes(".") || ["admin", "story", "index"].includes(path.toLowerCase())) return context.next();
  const rewrite = new URL(url.toString());
  rewrite.pathname = "/story.html";
  rewrite.searchParams.set("slug", path);
  return context.next({ request: new Request(rewrite.toString(), request) });
}
