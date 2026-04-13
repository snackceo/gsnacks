#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const readmePath = path.resolve(process.cwd(), 'README.md');
const text = fs.readFileSync(readmePath, 'utf8');

const markdownLinkRegex = /\[[^\]]+\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const missing = [];

for (const match of text.matchAll(markdownLinkRegex)) {
  const rawHref = match[1].trim();
  const href = rawHref.split('#')[0].split('?')[0];

  if (!href) continue;
  if (href.startsWith('#')) continue;
  if (/^(?:[a-z]+:)?\/\//i.test(href)) continue;
  if (/^(mailto:|tel:)/i.test(href)) continue;

  const localPath = path.resolve(path.dirname(readmePath), href);
  if (!fs.existsSync(localPath)) {
    missing.push(href);
  }
}

if (missing.length) {
  const unique = [...new Set(missing)].sort();
  console.error('README.md has links to missing local paths:');
  for (const p of unique) {
    console.error(`- ${p}`);
  }
  process.exit(1);
}

console.log('README.md local links check passed.');
