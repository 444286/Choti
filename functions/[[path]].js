export async function onRequest(context) {
  const url = new URL(context.request.url);
  const parts = url.pathname.split('/').filter(Boolean);
  // Keep the homepage and ordinary static assets untouched. Two path segments
  // such as /category/story-title/ are rewritten internally to story.html.
  if (parts.length === 2 && !parts.some(p => p.includes('.'))) {
    const rewrite = new URL(url);
    rewrite.pathname = '/story.html';
    rewrite.searchParams.set('slug', decodeURIComponent(parts[1]));
    rewrite.searchParams.set('category', decodeURIComponent(parts[0]));
    return context.next({ request: new Request(rewrite, context.request) });
  }
  return context.next();
}
