import { createHash } from 'node:crypto';
import { URL } from 'node:url';

export function sha256hex16(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);
}

// URL正規化: クエリ除去・小文字化 → sha256先頭16桁
export function itemId(rawUrl) {
  try {
    const u = new URL(rawUrl);
    u.search = '';
    return sha256hex16(u.toString().toLowerCase());
  } catch {
    return sha256hex16(rawUrl.toLowerCase());
  }
}
