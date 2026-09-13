import { join } from 'node:path';

const immutable = 'public, max-age=31536000, immutable';

const securityHeaders = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
};

function assetFor(pathname: string) {
  if (pathname === '/' || pathname === '/index.html') return { name: 'index.html', cache: 'no-store' };
  if (pathname === '/favicon.svg') return { name: 'favicon.svg', cache: 'no-store' };
  const asset = pathname.match(/^\/assets\/([\w-]+\.(?:js|css|woff2|svg))$/);
  return asset ? { name: `assets/${asset[1]}`, cache: immutable } : null;
}

export async function serveAsset(dist: string, pathname: string) {
  const asset = assetFor(pathname);
  if (!asset) return new Response('Not found', { status: 404 });
  const file = Bun.file(join(dist, asset.name));
  if (!(await file.exists())) return new Response('The interface is not built. Run bun run build, or start with bun run dev.', { status: 503 });
  return new Response(file, { headers: { 'Cache-Control': asset.cache, ...securityHeaders } });
}
