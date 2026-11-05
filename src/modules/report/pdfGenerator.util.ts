import { IReport, IReportSections } from './report.model';

const SECTION_LABELS: Array<{ key: keyof IReportSections; title: string }> = [
  { key: 'executiveSummary', title: '1. Executive Summary' },
  { key: 'researchObjective', title: '2. Research Objective & Introduction' },
  { key: 'methodology', title: '3. Methodology' },
  { key: 'keyFindings', title: '4. Key Findings' },
  { key: 'marketAnalysis', title: '5. Market & Domain Analysis' },
  { key: 'competitorComparison', title: '6. Competitor Comparison & Statistics' },
  { key: 'opportunities', title: '7. Strategic Opportunities' },
  { key: 'risks', title: '8. Risks & Challenges' },
  { key: 'recommendations', title: '9. Recommendations' },
  { key: 'conclusion', title: '10. Conclusion' },
  { key: 'references', title: '11. References & Citations' },
];

/**
 * Formats a Report document into a clean, professional Markdown string.
 */
export function renderReportToMarkdown(report: IReport): string {
  const lines: string[] = [
    `# ${report.title}`,
    '',
    `**Research Objective:** ${report.objective}`,
    `**Generated At:** ${report.createdAt.toISOString()}`,
    `**Version:** v${report.version}`,
    '',
    '---',
    '',
  ];

  for (const sec of SECTION_LABELS) {
    const content = report.sections[sec.key]?.trim();
    if (content) {
      lines.push(`## ${sec.title}`, '', content, '', '---', '');
    }
  }

  return lines.join('\n');
}

function escapePdfText(text: string): string {
  return text
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function wrapTextLines(text: string, maxCharsPerLine = 82): string[] {
  const result: string[] = [];
  const paragraphs = text.replace(/\r\n/g, '\n').split('\n');

  for (const para of paragraphs) {
    const cleaned = para.replace(/^[#*>-]+\s*/, '').trim();
    if (!cleaned) {
      result.push('');
      continue;
    }

    const words = cleaned.split(/\s+/);
    let currentLine = '';

    for (const word of words) {
      if ((currentLine + ' ' + word).trim().length > maxCharsPerLine) {
        if (currentLine) result.push(currentLine);
        currentLine = word;
      } else {
        currentLine = currentLine ? `${currentLine} ${word}` : word;
      }
    }
    if (currentLine) {
      result.push(currentLine);
    }
  }

  return result;
}

/**
 * Generates a valid multi-page PDF 1.4 binary buffer from a Report without requiring
 * external native binaries or headless browsers.
 */
export function renderReportToPdfBuffer(report: IReport): Buffer {
  const allLines: Array<{ text: string; isHeading?: boolean }> = [
    { text: report.title.toUpperCase(), isHeading: true },
    { text: `Objective: ${report.objective}` },
    { text: `Generated: ${report.createdAt.toISOString().split('T')[0]} | Version: v${report.version}` },
    { text: '' },
  ];

  for (const sec of SECTION_LABELS) {
    const content = report.sections[sec.key]?.trim();
    if (!content) continue;

    allLines.push({ text: '' });
    allLines.push({ text: sec.title, isHeading: true });
    for (const wrapped of wrapTextLines(content, 84)) {
      allLines.push({ text: wrapped });
    }
  }

  const linesPerPage = 44;
  const pages: Array<Array<{ text: string; isHeading?: boolean }>> = [];
  for (let i = 0; i < allLines.length; i += linesPerPage) {
    pages.push(allLines.slice(i, i + linesPerPage));
  }
  if (pages.length === 0) {
    pages.push([{ text: report.title, isHeading: true }]);
  }

  const objects: string[] = [];
  // Obj 1: Catalog, Obj 2: Pages, Obj 3: Font Helvetica, Obj 4: Font Helvetica-Bold
  const pageObjectIds: number[] = [];
  const contentObjectIds: number[] = [];

  let nextObjId = 5;
  for (let i = 0; i < pages.length; i++) {
    pageObjectIds.push(nextObjId++);
    contentObjectIds.push(nextObjId++);
  }

  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  objects.push(
    `2 0 obj\n<< /Type /Pages /Kids [${pageObjectIds
      .map((id) => `${id} 0 R`)
      .join(' ')}] /Count ${pages.length} >>\nendobj\n`,
  );
  objects.push(
    '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  );
  objects.push(
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n',
  );

  for (let i = 0; i < pages.length; i++) {
    const pageId = pageObjectIds[i];
    const contentId = contentObjectIds[i];
    const pageLines = pages[i];

    const streamOps: string[] = ['BT', '50 750 Td', '15 TL'];

    for (const line of pageLines) {
      if (line.isHeading) {
        streamOps.push('/F2 12 Tf');
        streamOps.push(`(${escapePdfText(line.text)}) Tj`);
        streamOps.push('T*');
        streamOps.push('/F1 10 Tf');
      } else {
        streamOps.push('/F1 10 Tf');
        streamOps.push(`(${escapePdfText(line.text)}) Tj`);
        streamOps.push('T*');
      }
    }

    streamOps.push('ET');
    const streamContent = streamOps.join('\n');

    objects.push(
      `${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>\nendobj\n`,
    );
    objects.push(
      `${contentId} 0 obj\n<< /Length ${Buffer.byteLength(
        streamContent,
        'ascii',
      )} >>\nstream\n${streamContent}\nendstream\nendobj\n`,
    );
  }

  let pdfBody = '%PDF-1.4\n';
  const offsets: number[] = [0];

  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdfBody, 'ascii'));
    pdfBody += obj;
  }

  const xrefOffset = Buffer.byteLength(pdfBody, 'ascii');
  pdfBody += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    const padded = String(offsets[i]).padStart(10, '0');
    pdfBody += `${padded} 00000 n \n`;
  }

  pdfBody += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdfBody, 'ascii');
}

