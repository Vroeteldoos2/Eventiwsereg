// Extracts the visible text of a PDF (all pages, joined with spaces) using pdf.js.
// Eventwise PDFs store text as font glyph codes, so a raw byte search can't find it.
import { readFile } from 'node:fs/promises';

export async function readPdfText(filePath) {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const data = new Uint8Array(await readFile(filePath));
    const pdf = await getDocument({ data, useSystemFonts: true, isEvalSupported: false }).promise;
    const pages = [];
    for (let number = 1; number <= pdf.numPages; number++) {
        const content = await (await pdf.getPage(number)).getTextContent();
        pages.push(content.items.map(item => item.str).join(' '));
    }
    await pdf.destroy();
    return pages.join(' ').replace(/\s+/g, ' ');
}
