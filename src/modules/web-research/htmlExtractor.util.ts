import crypto from 'crypto';
import { env } from '../../config/env';
import { AppError } from '../../common/errors/AppError';

export interface ExtractedWebPage {
  url: string;
  domain: string;
  title: string;
  description: string;
  readableText: string;
  credibilityScore: number;
  contentHash: string;
}

const PRIVATE_HOST_REGEX =
  /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+|169\.254\.\d+\.\d+|0\.0\.0\.0|\[::1\])$/i;

/**
 * Validates that a URL is a public HTTP/HTTPS URL (SSRF protection).
 */
export function validatePublicUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw AppError.badRequest(`Invalid URL: ${rawUrl}`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw AppError.badRequest('Only HTTP and HTTPS URLs are supported');
  }

  if (PRIVATE_HOST_REGEX.test(parsed.hostname)) {
    throw AppError.forbidden('Fetching private or local network URLs is prohibited');
  }

  return parsed;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(Number(code)));
}

/**
 * Strips boilerplate HTML tags (<script>, <style>, <nav>, <footer>, <header>, <aside>)
 * and extracts clean readable article text.
 */
export function extractReadableContentFromHtml(
  html: string,
  url: string,
): ExtractedWebPage {
  const parsedUrl = new URL(url);
  const domain = parsedUrl.hostname.replace(/^www\./i, '').toLowerCase();

  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const rawTitle = titleMatch ? decodeHtmlEntities(titleMatch[1]).trim() : domain;

  const metaDescMatch =
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i.exec(html) ||
    /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i.exec(html);
  const description = metaDescMatch ? decodeHtmlEntities(metaDescMatch[1]).trim() : '';

  // Remove non-content elements
  const cleanedHtml = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|iframe|nav|footer|header|aside|form)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|p|div|section|article|li|h[1-6]|tr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');

  const readableText = decodeHtmlEntities(cleanedHtml)
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 25)
    .join('\n')
    .slice(0, 20000);

  const credibilityScore = computeDomainCredibility(domain, parsedUrl.protocol === 'https:', readableText.length);
  const contentHash = crypto
    .createHash('sha256')
    .update(readableText || rawTitle || url)
    .digest('hex');

  return {
    url,
    domain,
    title: rawTitle || domain,
    description,
    readableText,
    credibilityScore,
    contentHash,
  };
}

export function computeDomainCredibility(
  domain: string,
  isHttps: boolean,
  contentLength: number,
): number {
  let score = isHttps ? 0.65 : 0.45;

  if (/\.(gov|edu|ac\.uk|ac\.in)$/i.test(domain)) {
    score += 0.25;
  } else if (
    /\.(org)$/i.test(domain) ||
    /(wikipedia\.org|arxiv\.org|nature\.com|ieee\.org|acm\.org|github\.com|developer\.mozilla\.org|react\.dev|vuejs\.org)/i.test(
      domain,
    )
  ) {
    score += 0.2;
  } else if (/\.(com|io|dev|ai|net)$/i.test(domain)) {
    score += 0.1;
  }

  if (contentLength > 1500) {
    score += 0.08;
  } else if (contentLength < 200) {
    score -= 0.15;
  }

  return Number(Math.max(0.1, Math.min(0.99, score)).toFixed(2));
}

export async function fetchAndExtractWebPage(rawUrl: string): Promise<ExtractedWebPage> {
  const parsedUrl = validatePublicUrl(rawUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.WEB_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(parsedUrl.toString(), {
      method: 'GET',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; AIResearchAssistantBot/1.0; +https://localhost)',
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} when fetching ${rawUrl}`);
    }

    const html = await response.text();
    return extractReadableContentFromHtml(html, parsedUrl.toString());
  } finally {
    clearTimeout(timeout);
  }
}

