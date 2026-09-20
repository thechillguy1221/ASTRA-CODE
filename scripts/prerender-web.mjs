import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '..');
const distRoot = resolve(repositoryRoot, 'apps/web/dist');
const source = await readFile(resolve(distRoot, 'index.html'), 'utf8');
const { publicRoutes } = await import('../apps/web/src/routes.ts');
const siteUrl = (
  globalThis.process?.env.VITE_ASTRA_PUBLIC_SITE_URL ?? 'https://lyntar.dev'
).replace(/\/$/, '');

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function staticBody(route) {
  const heading = escapeHtml(route.title);
  const description = escapeHtml(route.description);
  const kind = route.category === 'comparison' ? 'Comparison' : 'Astra AI';
  return `<main class="page prerendered-page"><span class="eyebrow">${kind}</span><h1>${heading}</h1><p class="lede">${description}</p><p>Astra AI is a desktop AI coding agent for local Windows projects, bounded actions, model choice, and verified results.</p><nav aria-label="Page actions"><a href="/download/windows">Download Astra</a><a href="/pricing">See pricing</a></nav></main>`;
}

function render(route) {
  const title = escapeHtml(`${route.title} — Astra AI`);
  const description = escapeHtml(route.description);
  const canonical = `${siteUrl}${route.path}`;
  const schema = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': route.category === 'comparison' ? 'Article' : 'WebPage',
    name: route.title,
    description: route.description,
    url: canonical,
    isPartOf: { '@type': 'WebSite', name: 'Astra AI', url: siteUrl },
  }).replaceAll('<', '\\u003c');
  return source
    .replace(/<title>.*?<\/title>/s, `<title>${title}</title>`)
    .replace(
      /<meta\s+name="description"\s+content="[^"]*"\s*\/>/,
      `<meta name="description" content="${description}" />`,
    )
    .replace(
      /<meta\s+property="og:url"\s+content="[^"]*"\s*\/>/,
      `<meta property="og:url" content="${canonical}" />`,
    )
    .replace(
      /<link\s+rel="canonical"\s+href="[^"]*"\s*\/>/,
      `<link rel="canonical" href="${canonical}" />`,
    )
    .replace(/<div id="root"><\/div>/, `<div id="root">${staticBody(route)}</div>`)
    .replace(/<\/head>/, `<script type="application/ld+json">${schema}</script></head>`);
}

for (const route of publicRoutes.filter((candidate) => candidate.published !== false)) {
  const relative =
    route.path === '/' ? 'index.html' : `${route.path.replace(/^\//, '')}/index.html`;
  const target = resolve(distRoot, relative);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, render(route), 'utf8');
}

globalThis.console.log(
  `[web-prerender] generated ${publicRoutes.filter((route) => route.published !== false).length} crawlable route documents`,
);
