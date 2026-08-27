function appRedirect(request, status) {
  const url = new URL('/', request.url);
  url.searchParams.set('drive', status);
  return Response.redirect(url.href, 302);
}

export async function onRequestGet({ request }) {
  return appRedirect(request, 'retired');
}
