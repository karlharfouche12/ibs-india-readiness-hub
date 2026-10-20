// Who is making the request?
//
// In Azure App Service with Entra ID authentication enabled, App Service signs the user in and
// sends their identity in the X-MS-CLIENT-PRINCIPAL-NAME header. This app trusts that header only
// because App Service strips any client-supplied copy and sets it itself. Do not expose the Node
// server directly without App Service in front of it.
//
// Outside Azure (local development), HUB_DEV_USER sets the identity. It is never used in production.

export function isProduction(env) {
  return Boolean(env.WEBSITE_SITE_NAME) || env.NODE_ENV === 'production';
}

// Returns the signed-in actor's name, or null if the request is not authenticated.
export function resolveActor(headers, env) {
  const principal = headers['x-ms-client-principal-name'];
  if (typeof principal === 'string' && principal.trim()) return principal.trim();
  if (isProduction(env)) return null;
  return env.HUB_DEV_USER || 'local-dev';
}
