export interface RawChunk {
  chunkIndex: number;
  text: string;
  startChar: number;
  endChar: number;
  tokenCount: number;
}

export interface ChunkOptions {
  chunkSize?: number;
  chunkOverlap?: number;
}

/**
 * Estimates token count based on standard average of ~4 characters per token.
 */
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.trim().length / 4);
}

/**
 * Divides long text into coherent, overlapping chunks using recursive boundaries:
 * Paragraphs (\n\n) -> Sentences ([.!?]\s+) -> Words (\s+) -> Characters.
 */
export function splitTextIntoChunks(
  text: string,
  options: ChunkOptions = {},
): RawChunk[] {
  const chunkSize = options.chunkSize && options.chunkSize > 100 ? options.chunkSize : 1000;
  const chunkOverlap =
    options.chunkOverlap !== undefined && options.chunkOverlap < chunkSize
      ? options.chunkOverlap
      : 200;

  const cleanText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!cleanText) {
    return [];
  }

  if (cleanText.length <= chunkSize) {
    return [
      {
        chunkIndex: 0,
        text: cleanText,
        startChar: 0,
        endChar: cleanText.length,
        tokenCount: estimateTokenCount(cleanText),
      },
    ];
  }

  const chunks: RawChunk[] = [];
  let currentStart = 0;
  let chunkIndex = 0;

  while (currentStart < cleanText.length) {
    let idealEnd = currentStart + chunkSize;

    if (idealEnd >= cleanText.length) {
      const finalSlice = cleanText.substring(currentStart).trim();
      if (finalSlice.length > 0) {
        chunks.push({
          chunkIndex,
          text: finalSlice,
          startChar: currentStart,
          endChar: cleanText.length,
          tokenCount: estimateTokenCount(finalSlice),
        });
      }
      break;
    }

    // Try finding the best natural break near idealEnd
    const lookbackWindow = Math.min(250, Math.floor(chunkSize * 0.3));
    const searchStart = Math.max(currentStart + 50, idealEnd - lookbackWindow);
    const searchRegion = cleanText.substring(searchStart, idealEnd + 50);

    let splitOffset = -1;

    // 1. Try double newline (paragraph break)
    const paragraphBreak = searchRegion.lastIndexOf('\n\n');
    if (paragraphBreak !== -1) {
      splitOffset = searchStart + paragraphBreak + 2;
    } else {
      // 2. Try sentence ending (.!?) followed by space or newline
      const sentenceRegex = /[.!?]\s+/g;
      let match: RegExpExecArray | null;
      let lastSentenceEnd = -1;

      while ((match = sentenceRegex.exec(searchRegion)) !== null) {
        lastSentenceEnd = match.index + match[0].length;
      }

      if (lastSentenceEnd !== -1) {
        splitOffset = searchStart + lastSentenceEnd;
      } else {
        // 3. Try single newline
        const lineBreak = searchRegion.lastIndexOf('\n');
        if (lineBreak !== -1) {
          splitOffset = searchStart + lineBreak + 1;
        } else {
          // 4. Try space (word boundary)
          const spaceBreak = searchRegion.lastIndexOf(' ');
          if (spaceBreak !== -1) {
            splitOffset = searchStart + spaceBreak + 1;
          }
        }
      }
    }

    // Fallback if no natural break found
    const actualEnd = splitOffset > currentStart ? splitOffset : idealEnd;
    const chunkText = cleanText.substring(currentStart, actualEnd).trim();

    if (chunkText.length > 0) {
      chunks.push({
        chunkIndex,
        text: chunkText,
        startChar: currentStart,
        endChar: actualEnd,
        tokenCount: estimateTokenCount(chunkText),
      });
      chunkIndex++;
    }

    // Advance start position with overlap
    currentStart = actualEnd - chunkOverlap;
    if (currentStart <= (chunks[chunks.length - 1]?.startChar ?? 0)) {
      currentStart = actualEnd;
    }
  }

  return chunks;
}

