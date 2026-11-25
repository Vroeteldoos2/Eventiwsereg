// Reading the files the app exports: CSV (ticket seller export / import template) and XLSX (entire-event export).
import { readFile } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';

// Quoted CSV → array of rows (each an array of strings). No embedded line breaks are expected.
export function parseCsv(text) {
    return text.split(/\r?\n/).filter(line => line.length).map(line => {
        const cells = [];
        let cell = '';
        let quoted = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (quoted) {
                if (ch === '"' && line[i + 1] === '"') { cell += '"'; i++; }
                else if (ch === '"') quoted = false;
                else cell += ch;
            } else if (ch === '"') quoted = true;
            else if (ch === ',') { cells.push(cell); cell = ''; }
            else cell += ch;
        }
        cells.push(cell);
        return cells;
    });
}

// CSV file → [{ header: value, ... }] using its first row as the header.
export async function readCsvRecords(filePath) {
    const [header, ...rows] = parseCsv(await readFile(filePath, 'utf8'));
    return rows.map(row => Object.fromEntries(header.map((name, i) => [name, row[i] ?? ''])));
}

function unzipEntries(buffer) {
    const endOfDirectory = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (endOfDirectory < 0) throw new Error('Not a zip / xlsx file');
    const count = buffer.readUInt16LE(endOfDirectory + 10);
    let offset = buffer.readUInt32LE(endOfDirectory + 16);
    const entries = new Map();
    for (let index = 0; index < count; index += 1) {
        const filenameLength = buffer.readUInt16LE(offset + 28);
        const extraLength = buffer.readUInt16LE(offset + 30);
        const commentLength = buffer.readUInt16LE(offset + 32);
        const filename = buffer.toString('utf8', offset + 46, offset + 46 + filenameLength);
        const compression = buffer.readUInt16LE(offset + 10);
        const compressedSize = buffer.readUInt32LE(offset + 20);
        const localOffset = buffer.readUInt32LE(offset + 42);
        const dataOffset = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
        const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);
        entries.set(filename, (compression === 8 ? inflateRawSync(compressed) : compressed).toString('utf8'));
        offset += 46 + filenameLength + extraLength + commentLength;
    }
    return entries;
}

const decodeXml = text => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const columnIndex = ref => [...ref.replace(/\d+/g, '')].reduce((total, ch) => total * 26 + ch.charCodeAt(0) - 64, 0) - 1;

// XLSX file → { 'Sheet name': [[cell, cell, ...], ...] } (text and numbers as strings; dates as Excel serials).
export async function readXlsx(filePath) {
    const entries = unzipEntries(await readFile(filePath));
    const names = [...entries.get('xl/workbook.xml').matchAll(/<sheet [^>]*name="([^"]*)"/g)].map(match => decodeXml(match[1]));
    const shared = entries.has('xl/sharedStrings.xml')
        ? [...entries.get('xl/sharedStrings.xml').matchAll(/<si>(.*?)<\/si>/gs)]
            .map(si => decodeXml([...si[1].matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map(t => t[1]).join('')))
        : [];
    const sheets = {};
    names.forEach((name, i) => {
        const xml = entries.get(`xl/worksheets/sheet${i + 1}.xml`);
        sheets[name] = [...xml.matchAll(/<row[^>]*>(.*?)<\/row>/gs)].map(row => {
            const cells = [];
            for (const cell of row[1].matchAll(/<c ([^>]*?)(?:\/>|>(.*?)<\/c>)/gs)) {
                const attrs = cell[1];
                const inner = cell[2] ?? '';
                const type = /\bt="(\w+)"/.exec(attrs)?.[1];
                const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
                let value = '';
                if (type === 'inlineStr') value = decodeXml(/<t[^>]*>([^<]*)<\/t>/.exec(inner)?.[1] ?? '');
                else {
                    const raw = /<v>([^<]*)<\/v>/.exec(inner)?.[1];
                    if (raw !== undefined) value = type === 's' ? shared[Number(raw)] : raw;
                }
                cells[ref ? columnIndex(ref) : cells.length] = value;
            }
            return Array.from(cells, cell => cell ?? '');
        });
    });
    return sheets;
}
