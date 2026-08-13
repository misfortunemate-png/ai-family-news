import { fetchText } from './fetch.mjs';

// URL → HTML取得 → タグ除去 → 先頭4000字。失敗時はnullを返す
export async function fetchArticle(url) {
  try {
    const html = await fetchText(url);
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&[a-z#0-9]+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return text.slice(0, 4000);
  } catch {
    return null;
  }
}
