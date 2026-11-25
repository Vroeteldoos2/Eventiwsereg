import { test, expect } from '../../fixtures/baseTest.js';
import { readFile } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import { setupBudgetingTest } from '../utils/setup';

let budgetingPage;

function unzipEntries(buffer) {
    const endOfDirectory = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    expect(endOfDirectory).toBeGreaterThanOrEqual(0);
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
        const localFilenameLength = buffer.readUInt16LE(localOffset + 26);
        const localExtraLength = buffer.readUInt16LE(localOffset + 28);
        const dataOffset = localOffset + 30 + localFilenameLength + localExtraLength;
        const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);
        expect([0, 8]).toContain(compression);
        const data = compression === 8 ? inflateRawSync(compressed) : compressed;
        entries.set(filename, data.toString('utf8'));
        offset += 46 + filenameLength + extraLength + commentLength;
    }

    return entries;
}

function expectExportDate(filename) {
    const match = filename.match(/(\d{2})_(\d{2})_(\d{2}) \d{2}_\d{2}_\d{2}\.(?:pdf|xlsx)$/i);
    expect(match, `Expected a dated report filename, got "${filename}"`).not.toBeNull();
    const [, day, month, year] = match;
    const date = new Date(Date.UTC(2000 + Number(year), Number(month) - 1, Number(day)));
    expect(date.getUTCFullYear()).toBe(2000 + Number(year));
    expect(date.getUTCMonth()).toBe(Number(month) - 1);
    expect(date.getUTCDate()).toBe(Number(day));
    return `${day}_${month}_${year}`;
}

async function getReportDownload(page, reportName, format) {
    await page.getByRole('button', { name: /export/i }).last().click();
    const downloadPromise = page.waitForEvent('download');

    if (reportName === 'Internal Markup Report') {
        await page.getByRole('link', { name: reportName, exact: true }).click();
    } else {
        await page.getByText(reportName, { exact: true }).last().click();
        await expect(page.getByText('Download Report', { exact: true })).toBeVisible();
        await page.getByRole('button', { name: format, exact: true }).click();
    }

    const download = await downloadPromise;
    expect(await download.failure()).toBeNull();
    return download;
}

async function expectPdfDownload(download, reportName) {
    const filename = download.suggestedFilename();
    expect(filename).toContain(reportName);
    const filenameDate = expectExportDate(filename);
    const pdf = await readFile(await download.path());
    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1000);

    const creationDate = pdf.toString('latin1').match(/\/CreationDate \(D:(\d{4})(\d{2})(\d{2})/);
    expect(creationDate, 'PDF should contain its creation date').not.toBeNull();
    expect(filenameDate).toBe(`${creationDate[3]}_${creationDate[2]}_${creationDate[1].slice(-2)}`);
}

test.describe('Budget exports', () => {
    test.beforeEach(async ({ page }) => {
        ({ budgetingPage } = await setupBudgetingTest(page));
        await budgetingPage.gotoBudgetSummaryPage();
        await budgetingPage.selectBudgetVersion('A');
    });

    test('exports Budget Summary as PDF and checks the report date', async ({ page }) => {
        const download = await getReportDownload(page, 'Budget Summary', 'PDF');
        await expectPdfDownload(download, 'Budget Summary Report');
    });

    test('exports Budget Summary as Excel and matches the on-screen totals', async ({ page }) => {
        const revenue = await budgetingPage.getOverviewRow('Revenue');
        const costs = await budgetingPage.getOverviewRow('Costs');
        const profit = await budgetingPage.getOverviewRow('Profit');

        const download = await getReportDownload(page, 'Budget Summary', 'Excel');
        const filename = download.suggestedFilename();
        expect(filename).toContain('Budget Summary Report');
        expectExportDate(filename);

        const workbook = unzipEntries(await readFile(await download.path()));
        const sheet = workbook.get('xl/worksheets/sheet1.xml');
        expect(sheet, 'Excel report should contain its summary worksheet').toBeTruthy();
        const values = [...sheet.matchAll(/<v>([^<]+)<\/v>/g)].map((match) => Number(match[1]));
        expect(values.length).toBeGreaterThan(0);

        for (const expected of [
            revenue.fixed,
            revenue.budgeted,
            costs.fixed,
            costs.budgeted,
            profit.fixed,
            profit.budgeted,
        ]) {
            expect(
                values.some((actual) => Math.abs(actual - expected) < 0.005),
                `Expected the Excel summary to contain the on-screen value ${expected}`,
            ).toBe(true);
        }
    });

    test('exports Internal Markup Report as PDF', async ({ page }) => {
        const download = await getReportDownload(page, 'Internal Markup Report', 'PDF');
        await expectPdfDownload(download, 'Internal Markup Report');
    });

    for (const format of ['PDF', 'Excel']) {
        test(`exports External Report as ${format}`, async ({ page }) => {
            const download = await getReportDownload(page, 'External Report', format);
            const filename = download.suggestedFilename();
            expect(filename).toContain('External Report');
            expectExportDate(filename);

            if (format === 'PDF') {
                await expectPdfDownload(download, 'External Report');
                return;
            }

            const workbook = unzipEntries(await readFile(await download.path()));
            expect([...workbook.keys()].some((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))).toBe(true);
        });
    }
});
