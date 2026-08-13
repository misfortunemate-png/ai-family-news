#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { load as parseYaml } from 'js-yaml';
import { XMLParser } from 'fast-xml-parser';
import { fetchText, fetchJson } from './lib/fetch.mjs';
import { itemId } from './lib/hash.mjs';
import { appendJsonl } from './lib/jsonl.mjs';

const DATE = new Date().toISOString().slice(0, 10);
const ITEMS_FILE = join('data', 'items', `${DATE}.jsonl`);
const REJECTS_FILE = join('logs', 'rejects', `${DATE}-collect.jsonl`);

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  processEntities: false,
});

function truncate(str, len = 300) {
  if (!str) return '';
  return str.length > len ? str.slice(0, len) : str;
}

function parseDate(raw) {
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function normalizeItem(rawUrl, title, summary, pubDate, sourceId, category, fixed = false) {
  return {
    id: itemId(rawUrl),
    url: rawUrl,
    source_id: sourceId,
    category,
    fixed,
    title: (title ?? '').trim().slice(0, 200),
    summary: truncate(summary?.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()),
    published_at: parseDate(pubDate),
    collected_at: new Date().toISOString(),
  };
}

async function reject(sourceId, url, reason) {
  await appendJsonl(REJECTS_FILE, {
    ts: new Date().toISOString(),
    source_id: sourceId,
    url: url ?? null,
    reason,
  });
}

async function processRss(source) {
  const raw = await fetchText(source.url);
  let parsed;
  try {
    parsed = xmlParser.parse(raw);
  } catch (e) {
    await reject(source.id, source.url, 'parse_error');
    return [];
  }

  // RSS 2.0, Atom, または RSS 1.0 (RDF)
  const rdf = parsed?.['rdf:RDF'];
  const channel = parsed?.rss?.channel ?? parsed?.feed ?? null;

  let arr;
  if (rdf) {
    // RSS 1.0: items are at rdf:RDF.item (top-level, not under channel)
    const entries = rdf.item ?? [];
    arr = Array.isArray(entries) ? entries : [entries];
  } else if (channel) {
    const entries = channel.item ?? channel.entry ?? [];
    arr = Array.isArray(entries) ? entries : [entries];
  } else {
    await reject(source.id, source.url, 'parse_error');
    return [];
  }
  const items = [];

  for (const e of arr) {
    // Atom: <link href="..."/> → object with @_href; RSS: string or {#text}
    const rawLink = e.link;
    const url = (typeof rawLink === 'string' ? rawLink
      : rawLink?.['@_href'] ?? rawLink?.['#text'] ?? null)
      ?? (typeof e.id === 'string' ? e.id : null);
    if (!url || typeof url !== 'string') continue;
    const title = e.title?.['#text'] ?? e.title ?? '';
    const summary = e.description?.['#text'] ?? e.description
                 ?? e.summary?.['#text'] ?? e.summary
                 ?? e['content:encoded'] ?? '';
    const pubDate = e.pubDate ?? e.published ?? e.updated ?? null;
    items.push(normalizeItem(url, title, summary, pubDate, source.id, source.category));
  }
  return items;
}

async function processJson(source) {
  // 気象庁JSON: 今日・明日の予報から最初のエリアの概況を抽出
  const data = await fetchJson(source.url);
  const items = [];
  try {
    for (const forecast of data) {
      const area = forecast.timeSeries?.[0]?.areas?.[0];
      const areaName = area?.area?.name ?? '東京';
      const weathers = area?.weathers ?? [];
      const ts = forecast.timeSeries?.[0]?.timeDefines ?? [];
      for (let i = 0; i < Math.min(weathers.length, 2); i++) {
        const url = `${source.url}#${ts[i] ?? i}`;
        const title = `${areaName} 天気 ${(ts[i] ?? '').slice(0, 10)}`;
        const summary = weathers[i] ?? '';
        items.push(normalizeItem(url, title, summary, ts[i] ?? null, source.id, 'weather', true));
      }
    }
  } catch (e) {
    await reject(source.id, source.url, 'parse_error');
  }
  return items;
}

async function main() {
  const yaml = await readFile('sources.yaml', 'utf8');
  const { sources } = parseYaml(yaml);
  const enabled = sources.filter(s => s.enabled !== false);

  let total = 0;
  for (const source of enabled) {
    console.log(`[collect] ${source.id} (${source.type})`);
    try {
      let items;
      if (source.type === 'json') {
        items = await processJson(source);
      } else {
        items = await processRss(source);
      }
      for (const item of items) {
        await appendJsonl(ITEMS_FILE, item);
      }
      total += items.length;
      console.log(`  → ${items.length}件`);
    } catch (e) {
      console.error(`  → fetch_error: ${e.message}`);
      await reject(source.id, source.url, 'fetch_error');
    }
  }
  console.log(`[collect] 合計 ${total}件 → ${ITEMS_FILE}`);
}

main().catch(e => { console.error(e); process.exit(1); });
