import mongoose from 'mongoose';
import { env } from '../../config/env';
import { AppError } from '../../common/errors/AppError';
import { geminiLlmService } from '../../common/services/geminiLlm.service';
import { PROMPT_VERSIONS } from '../../common/observability/aiTelemetry.service';
import { logger } from '../../common/utils/logger';
import { WorkspaceModel } from '../workspace/workspace.model';
import { searchService, SearchResultPassage } from '../search/search.service';
import { IWebSource, WebSourceModel } from './webSource.model';
import {
  computeDomainCredibility,
  fetchAndExtractWebPage,
} from './htmlExtractor.util';
import {
  FetchUrlsBodyInput,
  HybridResearchBodyInput,
  WebSearchBodyInput,
} from './webResearch.schema';

export interface RawWebSearchHit {
  title: string;
  url: string;
  snippet: string;
  extractedText?: string;
  relevanceScore?: number;
}

export class WebResearchService {
  private async verifyWorkspaceOwnership(
    userId: string,
    workspaceId: string,
  ): Promise<void> {
    const workspace = await WorkspaceModel.findById(workspaceId);
    if (!workspace) {
      throw AppError.notFound('Workspace not found');
    }
    if (String(workspace.userId) !== userId) {
      throw AppError.forbidden('You do not have permission to access this workspace');
    }
  }

  /**
   * Queries external search provider:
   * 1. Tavily API (if TAVILY_API_KEY configured)
   * 2. Serper Google Search API (if SERPER_API_KEY configured)
   * 3. DuckDuckGo HTML search fallback
   */
  private async queryExternalSearchProvider(
    query: string,
    maxResults: number,
  ): Promise<RawWebSearchHit[]> {
    // 1. Tavily Search API
    if (env.TAVILY_API_KEY?.trim()) {
      try {
        const res = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: env.TAVILY_API_KEY.trim(),
            query,
            max_results: maxResults,
            include_raw_content: false,
          }),
        });

        if (res.ok) {
          const data = (await res.json()) as {
            results?: Array<{
              title: string;
              url: string;
              content: string;
              score?: number;
            }>;
          };
          return (data.results ?? []).map((r) => ({
            title: r.title,
            url: r.url,
            snippet: r.content,
            extractedText: r.content,
            relevanceScore: r.score ?? 0.85,
          }));
        }
      } catch (err) {
        logger.warn('Tavily search failed, trying fallback provider', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // 2. Serper.dev Google Search API
    if (env.SERPER_API_KEY?.trim()) {
      try {
        const res = await fetch('https://google.serper.dev/search', {
          method: 'POST',
          headers: {
            'X-API-KEY': env.SERPER_API_KEY.trim(),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ q: query, num: maxResults }),
        });

        if (res.ok) {
          const data = (await res.json()) as {
            organic?: Array<{
              title: string;
              link: string;
              snippet: string;
              position?: number;
            }>;
          };
          return (data.organic ?? []).slice(0, maxResults).map((r, idx) => ({
            title: r.title,
            url: r.link,
            snippet: r.snippet ?? '',
            relevanceScore: Number(Math.max(0.5, 0.95 - idx * 0.06).toFixed(2)),
          }));
        }
      } catch (err) {
        logger.warn('Serper search failed, trying DuckDuckGo HTML fallback', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // 3. DuckDuckGo HTML Lite fallback
    try {
      const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const res = await fetch(searchUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      });

      if (res.ok) {
        const html = await res.text();
        const hits: RawWebSearchHit[] = [];
        const linkRegex =
          /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
        const snippetRegex =
          /<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;

        const links: Array<{ url: string; title: string }> = [];
        let match: RegExpExecArray | null;

        while ((match = linkRegex.exec(html)) !== null && links.length < maxResults) {
          let href = match[1];
          const uddgMatch = /[?&]uddg=([^&]+)/.exec(href);
          if (uddgMatch) {
            href = decodeURIComponent(uddgMatch[1]);
          }
          const title = match[2].replace(/<[^>]+>/g, '').trim();
          if (href.startsWith('http')) {
            links.push({ url: href, title });
          }
        }

        const snippets: string[] = [];
        while ((match = snippetRegex.exec(html)) !== null && snippets.length < links.length) {
          snippets.push(match[1].replace(/<[^>]+>/g, '').trim());
        }

        for (let i = 0; i < links.length; i++) {
          hits.push({
            title: links[i].title,
            url: links[i].url,
            snippet: snippets[i] ?? '',
            relevanceScore: Number(Math.max(0.5, 0.92 - i * 0.06).toFixed(2)),
          });
        }

        return hits;
      }
    } catch (err) {
      logger.warn('DuckDuckGo HTML search failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return [];
  }

  /**
   * Searches external web, fetches & extracts readable content, deduplicates,
   * evaluates credibility, optionally summarizes, and stores in `web_sources`.
   */
  async searchAndExtractWeb(
    userId: string,
    workspaceId: string,
    input: WebSearchBodyInput,
  ): Promise<{
    query: string;
    sources: IWebSource[];
    overallSummary: string | null;
  }> {
    await this.verifyWorkspaceOwnership(userId, workspaceId);

    const maxResults = input.maxResults ?? env.WEB_SEARCH_MAX_RESULTS;
    const rawHits = await this.queryExternalSearchProvider(input.query, maxResults);

    const seenUrls = new Set<string>();
    const seenHashes = new Set<string>();
    const savedSources: IWebSource[] = [];

    for (const hit of rawHits) {
      const normalizedUrl = hit.url.split('#')[0].trim();
      if (seenUrls.has(normalizedUrl)) continue;
      seenUrls.add(normalizedUrl);

      let extractedText = hit.extractedText ?? '';
      let title = hit.title;
      let domain = '';
      let credibilityScore = 0.7;
      let contentHash = '';

      try {
        const page = await fetchAndExtractWebPage(normalizedUrl);
        extractedText = page.readableText || hit.snippet;
        title = page.title || hit.title;
        domain = page.domain;
        credibilityScore = page.credibilityScore;
        contentHash = page.contentHash;
      } catch {
        try {
          const u = new URL(normalizedUrl);
          domain = u.hostname.replace(/^www\./i, '').toLowerCase();
          credibilityScore = computeDomainCredibility(
            domain,
            u.protocol === 'https:',
            hit.snippet.length,
          );
          extractedText = hit.snippet;
          contentHash = Buffer.from(normalizedUrl).toString('base64').slice(0, 48);
        } catch {
          continue;
        }
      }

      if (seenHashes.has(contentHash)) continue;
      seenHashes.add(contentHash);

      let summary = hit.snippet;
      if (input.summarize && extractedText.length > 120 && env.GEMINI_API_KEY?.trim()) {
        try {
          const sumRes = await geminiLlmService.generateText(
            `Summarize the key facts from this web page relevant to "${input.query}" in 2-4 concise sentences:\n\nTitle: ${title}\nURL: ${normalizedUrl}\nContent:\n${extractedText.slice(0, 4000)}`,
            {
              temperature: 0.2,
              operation: 'webSourceSummary',
              promptVersion: PROMPT_VERSIONS.WEB_SUMMARY,
              userId,
              workspaceId,
            },
          );
          summary = sumRes.text;
        } catch {
          // Keep snippet if summary call fails
        }
      }

      const sourceDoc = await WebSourceModel.findOneAndUpdate(
        {
          workspaceId: new mongoose.Types.ObjectId(workspaceId),
          url: normalizedUrl,
        },
        {
          $set: {
            userId: new mongoose.Types.ObjectId(userId),
            query: input.query,
            domain,
            title,
            snippet: hit.snippet,
            extractedText: extractedText.slice(0, 15000),
            summary,
            credibilityScore,
            relevanceScore: hit.relevanceScore ?? 0.75,
            contentHash,
            fetchedAt: new Date(),
          },
        },
        { upsert: true, new: true },
      );

      savedSources.push(sourceDoc);
    }

    // Rank by combined relevance + credibility
    savedSources.sort(
      (a, b) =>
        b.relevanceScore * 0.65 +
        b.credibilityScore * 0.35 -
        (a.relevanceScore * 0.65 + a.credibilityScore * 0.35),
    );

    let overallSummary: string | null = null;
    if (input.summarize && savedSources.length > 0 && env.GEMINI_API_KEY?.trim()) {
      const combined = savedSources
        .map(
          (s, idx) =>
            `[Web #${idx + 1}: ${s.title} (${s.url})] (Credibility: ${s.credibilityScore})\n${s.summary || s.snippet}`,
        )
        .join('\n\n');

      try {
        const res = await geminiLlmService.generateText(
          `Synthesize a concise research summary answering "${input.query}" based on these web sources. Cite sources inline as [Web #N: domain]:\n\n${combined}`,
          {
            temperature: 0.2,
            operation: 'webOverallSummary',
            promptVersion: PROMPT_VERSIONS.WEB_SUMMARY,
            userId,
            workspaceId,
          },
        );
        overallSummary = res.text;
      } catch {
        overallSummary = null;
      }
    }

    return {
      query: input.query,
      sources: savedSources,
      overallSummary,
    };
  }

  /**
   * Fetches and extracts readable content from specific URLs and stores them in `web_sources`.
   */
  async fetchUrls(
    userId: string,
    workspaceId: string,
    input: FetchUrlsBodyInput,
  ): Promise<IWebSource[]> {
    await this.verifyWorkspaceOwnership(userId, workspaceId);

    const results: IWebSource[] = [];
    for (const url of input.urls) {
      const page = await fetchAndExtractWebPage(url);
      let summary = page.description || page.readableText.slice(0, 300);

      if (input.summarize && page.readableText.length > 120 && env.GEMINI_API_KEY?.trim()) {
        try {
          const sumRes = await geminiLlmService.generateText(
            `Summarize the main findings of this web page in 3-4 sentences:\n\nTitle: ${page.title}\nContent:\n${page.readableText.slice(0, 5000)}`,
            {
              temperature: 0.2,
              operation: 'webFetchSummary',
              promptVersion: PROMPT_VERSIONS.WEB_SUMMARY,
              userId,
              workspaceId,
            },
          );
          summary = sumRes.text;
        } catch {
          // Keep default summary
        }
      }

      const saved = await WebSourceModel.findOneAndUpdate(
        {
          workspaceId: new mongoose.Types.ObjectId(workspaceId),
          url: page.url,
        },
        {
          $set: {
            userId: new mongoose.Types.ObjectId(userId),
            query: 'direct_url_fetch',
            domain: page.domain,
            title: page.title,
            snippet: page.description || page.readableText.slice(0, 250),
            extractedText: page.readableText,
            summary,
            credibilityScore: page.credibilityScore,
            relevanceScore: 0.9,
            contentHash: page.contentHash,
            fetchedAt: new Date(),
          },
        },
        { upsert: true, new: true },
      );

      results.push(saved);
    }

    return results;
  }

  /**
   * Combines uploaded workspace documents AND external web research to answer a question
   * with full source attribution for both internal documents and external web URLs.
   */
  async hybridResearchAsk(
    userId: string,
    workspaceId: string,
    input: HybridResearchBodyInput,
  ): Promise<{
    question: string;
    answer: string;
    documentSources: SearchResultPassage[];
    webSources: IWebSource[];
  }> {
    await this.verifyWorkspaceOwnership(userId, workspaceId);

    let documentSources: SearchResultPassage[] = [];
    let webSources: IWebSource[] = [];

    if (input.includeDocuments !== false) {
      const docSearch = await searchService
        .searchWorkspace(userId, workspaceId, {
          query: input.question,
          topK: input.topKDocuments ?? 5,
          minScore: 0.5,
        })
        .catch(() => ({ results: [] as SearchResultPassage[] }));
      documentSources = docSearch.results;
    }

    if (input.includeWeb !== false) {
      const webSearch = await this.searchAndExtractWeb(userId, workspaceId, {
        query: input.question,
        maxResults: input.maxWebResults ?? 4,
        summarize: true,
        storeSources: true,
      });
      webSources = webSearch.sources;
    }

    const docContextBlocks = documentSources.map(
      (d, idx) =>
        `<document_source index="${idx + 1}" file="${d.metadata.originalName}" chunk="${d.chunkIndex}" score="${d.score}">\n${d.text}\n</document_source>`,
    );

    const webContextBlocks = webSources.map(
      (w, idx) =>
        `<web_source index="${idx + 1}" title="${w.title}" url="${w.url}" domain="${w.domain}" credibility="${w.credibilityScore}">\n${w.summary || w.extractedText.slice(0, 2000)}\n</web_source>`,
    );

    const prompt = `<context>
<uploaded_documents>
${docContextBlocks.length > 0 ? docContextBlocks.join('\n\n') : 'No uploaded document passages matched.'}
</uploaded_documents>

<external_web_sources>
${webContextBlocks.length > 0 ? webContextBlocks.join('\n\n') : 'No external web sources fetched.'}
</external_web_sources>
</context>

Research Question: ${input.question}

Instructions:
1. Synthesize findings from BOTH uploaded documents and external web sources where available.
2. Cite uploaded documents as [Doc: <filename>, Chunk #<index>] and web sources as [Web: <title> (<url>)].
3. Clearly distinguish between internal document evidence and external web evidence.`;

    const llmResult = await geminiLlmService.generateText(prompt, {
      systemInstruction:
        'You are a senior AI Research Analyst combining internal uploaded documents with verified external web sources. Always cite every factual claim.',
      temperature: 0.2,
      operation: 'hybridResearchAsk',
      userId,
      workspaceId,
    });

    return {
      question: input.question,
      answer: llmResult.text,
      documentSources,
      webSources,
    };
  }

  async listWorkspaceWebSources(
    userId: string,
    workspaceId: string,
  ): Promise<IWebSource[]> {
    await this.verifyWorkspaceOwnership(userId, workspaceId);
    return WebSourceModel.find({
      workspaceId: new mongoose.Types.ObjectId(workspaceId),
    }).sort({ createdAt: -1 });
  }

  async deleteWebSource(userId: string, sourceId: string): Promise<void> {
    const source = await WebSourceModel.findById(sourceId);
    if (!source) {
      throw AppError.notFound('Web source not found');
    }
    if (String(source.userId) !== userId) {
      throw AppError.forbidden('You do not have permission to delete this web source');
    }
    await source.deleteOne();
  }
}

export const webResearchService = new WebResearchService();

