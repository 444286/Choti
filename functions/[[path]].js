export async function onRequest(context) {
  const url = new URL(context.request.url);
  const path = url.pathname.replace(/^\/+|\/+$/g, "");

  // Homepage and existing files
  if (
    !path ||
    path.includes(".") ||
    path === "admin" ||
    path === "story"
  ) {
    return context.next();
  }

  // Clean story URL: /amar-bouer-porokiya-14
  url.pathname = "/story.html";
  url.searchParams.set("slug", path);

  return context.env.ASSETS.fetch(
    new Request(url.toString(), context.request)
  );
}
