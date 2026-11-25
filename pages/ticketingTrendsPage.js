import { expect } from '@playwright/test';
import { TicketingPage, getTicketingTestPageUrl } from './ticketingPage.js';

// "£1,234.50" → 1234.5, "7,600" → 7600, "NaN" → NaN, "" → NaN
export function toNumber(text) {
    const cleaned = String(text ?? '').replace(/[£,\s]/g, '');
    return cleaned === '' ? NaN : Number(cleaned);
}

// Ticketing > Trends: the weekly / monthly sales graph, Summary, Sales Targets and Detailed View.
export class TrendsPage {

    constructor(page) {
        this.page = page;
        this.ticketing = new TicketingPage(page);
    }

    // ── NAVIGATION ───────────────────────────────────────────────────────────────

    async goto() {
        await this.ticketing.navigateToTicketingPage(getTicketingTestPageUrl('trends'));
        await expect(this.page.getByRole('heading', { name: /^(Weekly|Monthly) Sales$/ })).toBeVisible({ timeout: 20000 });
        // Park the mouse: hovering the left edge of the page opens the sidebar over the content.
        await this.page.mouse.move(1000, 900);
    }

    // 'Weekly' | 'Monthly'
    async selectPeriod(period) {
        await this.page.getByRole('button', { name: period, exact: true }).click();
        await expect(this.page.getByRole('heading', { name: `${period} Sales` })).toBeVisible({ timeout: 10000 });
        await this.page.waitForTimeout(800);
    }

    // 'Sales' | 'Revenue'
    async selectView(view) {
        await this.page.locator('button').filter({ hasText: new RegExp(`^\\s*${view}\\s*$`) }).first().click();
        await this.page.waitForTimeout(1000);
    }

    // ── SUMMARY ──────────────────────────────────────────────────────────────────

    summarySection() {
        return this.page.getByRole('heading', { name: 'Summary', exact: true }).locator('xpath=ancestor::div[.//table][1]');
    }

    // { periodLabel: 'This Week', rows: { 'Actual Sales': [0, 287], 'Fixed Sales Stretch target': [380, 7600] } }
    async readSummary() {
        const rows = await this.summarySection().locator('tr').evaluateAll(trs =>
            trs.map(tr => [...tr.children].map(cell => cell.innerText.trim().replace(/\s+/g, ' '))));
        const [header, ...body] = rows;
        return {
            periodLabel: header[1],
            rows: Object.fromEntries(body.map(([label, ...values]) => [label, values.map(toNumber)])),
        };
    }

    // ── SALES TARGETS ────────────────────────────────────────────────────────────

    targetsCard() {
        return this.page.getByRole('heading', { name: 'Sales Targets', exact: true })
            .locator('xpath=ancestor::div[.//input[@type="checkbox"]][1]');
    }

    // The row of a target (custom or built-in: Stretch Target, Sellout Target, Breakeven Targets, Average).
    targetRow(name) {
        return this.targetsCard().getByText(name, { exact: true }).first()
            .locator('xpath=ancestor::*[.//input[@type="checkbox"]][1]');
    }

    // Names of the custom targets (the rows that have edit / delete buttons).
    async getCustomTargetNames() {
        const rows = this.targetsCard().locator('tr').filter({ has: this.page.locator('button:has(i.mdi-pencil)') });
        const names = [];
        for (let i = 0; i < await rows.count(); i++) names.push((await rows.nth(i).locator('td').nth(1).innerText()).trim());
        return names;
    }

    async setTargetSelected(name, selected) {
        await this.targetRow(name).locator('input[type="checkbox"]').first().setChecked(selected, { force: true });
        await this.page.waitForTimeout(1200);
    }

    async isTargetSelected(name) {
        return this.targetRow(name).locator('input[type="checkbox"]').first().isChecked();
    }

    // The explanation shown when hovering a target's name.
    async getTargetHelpText(name) {
        await this.targetRow(name).getByText(name, { exact: true }).first().hover();
        const popper = this.page.locator('.v-popper__popper--shown').last();
        await popper.waitFor({ state: 'visible', timeout: 5000 });
        const text = (await popper.innerText()).trim();
        await this.page.mouse.move(1000, 900);
        await popper.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
        return text;
    }

    async openCreateTargetWizard() {
        await this.targetsCard().locator('button:has(i.mdi-plus)').first().click();
        const modal = this.page.locator('.m-wrapper').filter({ hasText: 'Create Ticket Target' }).last();
        await modal.waitFor({ state: 'visible', timeout: 10000 });
        return modal;
    }

    // Step 1: quantity (pre-filled with the maximum available tickets); step 2: name + type, Save Target.
    async createTarget({ name, type = 'Weekly', quantity }) {
        const modal = await this.openCreateTargetWizard();
        if (quantity !== undefined) {
            await modal.locator('input[type="number"]').click({ clickCount: 3 });
            await this.page.keyboard.type(String(quantity), { delay: 30 });
        }
        await modal.getByRole('button', { name: 'Next', exact: true }).click();
        await modal.getByPlaceholder('Target Name').fill(name);
        if (type !== 'Weekly') await modal.getByRole('button', { name: type, exact: true }).click();
        await modal.getByRole('button', { name: 'Save Target', exact: true }).click();
        await modal.waitFor({ state: 'hidden', timeout: 15000 });
        await this.targetRow(name).waitFor({ state: 'visible', timeout: 10000 });
        console.log(`✅ Sales target created: ${name}`);
    }

    async renameTarget(name, newName) {
        await this.targetRow(name).locator('button:has(i.mdi-pencil)').click();
        const modal = this.page.locator('.m-wrapper').filter({ hasText: 'Create Ticket Target' }).last();
        const input = modal.getByPlaceholder('Target Name');
        await expect(input).toHaveValue(name, { timeout: 20000 });     // the edit form loads before it fills
        await input.fill(newName);
        await modal.getByRole('button', { name: 'Save Target', exact: true }).click();
        await modal.waitFor({ state: 'hidden', timeout: 15000 });
        await this.targetRow(newName).waitFor({ state: 'visible', timeout: 10000 });
    }

    async deleteTarget(name) {
        await this.targetRow(name).locator('td').last().locator('button').last().click();
        await this.page.locator('.swal2-container').getByRole('button', { name: 'OK', exact: true }).click();
        await expect(this.targetsCard().getByText(name, { exact: true })).toHaveCount(0, { timeout: 10000 });
        console.log(`🗑️ Sales target deleted: ${name}`);
    }

    // Deletes every custom target whose name matches `pattern` (clean-up after / before a run).
    async deleteTargetsMatching(pattern) {
        for (const name of await this.getCustomTargetNames()) {
            if (pattern.test(name)) await this.deleteTarget(name);
        }
    }

    // ── BREAKEVEN: PRIORITISE TICKETS (Ordered / Cheapest) ───────────────────────

    priorityTrigger() {
        return this.targetRow('Breakeven Targets').getByText(/Ordered|Cheapest/).first();
    }

    async getBreakevenPriority() {
        return (await this.priorityTrigger().innerText()).trim();
    }

    async openBreakevenPriorityMenu() {
        await this.priorityTrigger().click();
        const menu = this.page.locator('.v-popper__popper--shown').last();
        await menu.waitFor({ state: 'visible', timeout: 5000 });
        return menu;
    }

    // 'Ordered' | 'Cheapest'
    async setBreakevenPriority(option) {
        const menu = await this.openBreakevenPriorityMenu();
        await menu.getByText(option, { exact: true }).click();
        await this.page.waitForTimeout(1500);
    }

    // ── DETAILED VIEW ────────────────────────────────────────────────────────────

    detailedViewTable() {
        return this.page.getByRole('heading', { name: 'Detailed View' })
            .locator('xpath=ancestor::div[.//table][1]').locator('table').first();
    }

    // { groups: [{ name, start, colspan }], rows: [{ label, cells }], totals: { label, cells } }
    // Cell indexes in `cells` follow the column order; `start` of a group is its first column.
    async readDetailedView() {
        const table = this.detailedViewTable();
        await table.waitFor({ state: 'visible', timeout: 10000 });
        const raw = await table.evaluate(el => {
            const text = cell => cell.innerText.trim().replace(/\s+/g, ' ');
            const shown = tr => tr.offsetParent !== null;
            return {
                header: [...el.querySelectorAll('thead tr')].map(tr => [...tr.children].map(cell => ({
                    text: text(cell), colspan: Number(cell.getAttribute('colspan') || 1),
                }))),
                body: [...el.querySelectorAll('tbody tr')].filter(shown).map(tr => [...tr.children].map(text)),
                foot: [...el.querySelectorAll('tfoot tr')].filter(shown).map(tr => [...tr.children].map(text)),
            };
        });
        // The first header cell is the blank corner above the row labels; columns start at 1.
        let start = 1;
        const groups = raw.header[0].slice(1).map(({ text, colspan }) => {
            const group = { name: text, start, colspan };
            start += colspan;
            return group;
        });
        const toRow = ([label, ...cells]) => ({ label, cells });
        return { groups, rows: raw.body.map(toRow), totals: raw.foot[0] ? toRow(raw.foot[0]) : null };
    }

    // Values of one column of a group: group 'Stretch Target', offset 0 = Weekly Count, 1 = Total Revenue.
    // → { weeks: [{ label, value }], total }
    static column(view, groupName, offset = 0) {
        const group = view.groups.find(g => g.name === groupName);
        if (!group) {
            throw new Error(`Detailed View has no "${groupName}" columns (has: ${view.groups.map(g => g.name).join(', ')})`);
        }
        const index = group.start - 1 + offset;       // cells exclude the row label
        return {
            weeks: view.rows.map(row => ({ label: row.label, value: toNumber(row.cells[index]) })),
            total: view.totals ? toNumber(view.totals.cells[index]) : NaN,
        };
    }

    // ── TICKET TYPES ("Showing all ticket types") ────────────────────────────────

    ticketTypesTrigger() {
        return this.page.getByText(/Showing .*ticket types?/i).first();
    }

    async openTicketTypePicker() {
        await this.ticketTypesTrigger().click();
        const picker = this.page.locator('.m-wrapper').filter({ hasText: 'Select Ticket Types' }).last();
        await picker.waitFor({ state: 'visible', timeout: 10000 });
        return picker;
    }

    // [{ name: 'Earlybird', selected: true, order: 1 }, ...]
    // Ticket types are listed per ticket category (the order restarts at 1 in each category);
    // categories without tickets show an empty row, which is skipped.
    async readTicketTypePicker(picker) {
        return picker.locator('tr').evaluateAll(rows => rows
            .filter(row => row.querySelector('input[type="checkbox"]'))
            .map(row => ({
                name: row.children[1].innerText.trim(),
                selected: row.querySelector('input[type="checkbox"]').checked,
                order: Number(row.querySelector('input[type="number"]')?.value),
            })));
    }

    async setTicketTypeSelected(picker, name, selected) {
        await picker.locator('tr').filter({ hasText: name }).locator('input[type="checkbox"]').setChecked(selected, { force: true });
        await this.page.waitForTimeout(700);
    }

    // Only the X button closes the picker (Escape doesn't).
    async closeTicketTypePicker(picker) {
        await picker.locator('button.m-close').click();
        await picker.waitFor({ state: 'hidden', timeout: 10000 });
        await this.page.waitForTimeout(1500);
    }

    // ── ANNOTATIONS ──────────────────────────────────────────────────────────────

    // The "+" at the top right of the graph: title "Enable annotation mode" / "Disable annotation mode".
    annotationButton() {
        return this.page.locator('button[title$="annotation mode"]');
    }

    // The dialog that opens when an annotation point is clicked ("Remove Annotation").
    removeAnnotationDialog() {
        return this.page.getByText('Remove Annotation').first().locator('xpath=ancestor::div[.//button][1]');
    }

    // Annotation points snap to the nearest data point, so on the monthly graph (few, widely spaced
    // points) the point can be far from where it was clicked. Scan the line the point was placed on
    // (60% of the graph height), outwards from the centre, until a click opens the Remove dialog.
    // Returns { x, y } with that dialog open, or null when there is no annotation point.
    async findAnnotationDot() {
        const box = await this.page.locator('canvas').first().boundingBox();
        const y = box.y + box.height * 0.6;
        const centre = box.x + box.width / 2;
        const title = this.page.getByText('Remove Annotation').first();
        for (let distance = 0; distance <= box.width / 2; distance += 6) {
            for (const x of distance === 0 ? [centre] : [centre + distance, centre - distance]) {
                await this.page.mouse.click(x, y);
                await this.page.waitForTimeout(60);
                if (await title.isVisible()) return { x, y };
            }
        }
        return null;
    }

    // The annotations saved for a graph: [{ id, text, x_label }]. period: 'weekly' | 'monthly'.
    async listAnnotations(period) {
        return this.page.evaluate(async ({ period }) => {
            const account = location.pathname.match(/\/account\/(\d+)/)[1];
            const event = location.pathname.match(/\/event\/(\d+)/)[1];
            const xsrf = decodeURIComponent((document.cookie.match(/XSRF-TOKEN=([^;]+)/) || [])[1] || '');
            const response = await fetch(`/api/account/${account}/annotations?chart_key=event_${event}_ticketSales_${period}_sales`, {
                headers: { Accept: 'application/json', 'X-XSRF-TOKEN': xsrf, 'X-Requested-With': 'XMLHttpRequest' },
                credentials: 'same-origin',
            });
            // The API answers with an object keyed by annotation id.
            return Object.entries(await response.json()).map(([id, annotation]) => ({
                id: Number(id), text: annotation.text, x_label: annotation.x_label,
            }));
        }, { period });
    }

    // Clean-up: deletes the annotations the tests create — and only those (comment "sgautomation<digits>").
    async deleteTestAnnotations() {
        const deleted = await this.page.evaluate(async () => {
            const account = location.pathname.match(/\/account\/(\d+)/)[1];
            const event = location.pathname.match(/\/event\/(\d+)/)[1];
            const xsrf = decodeURIComponent((document.cookie.match(/XSRF-TOKEN=([^;]+)/) || [])[1] || '');
            const headers = { Accept: 'application/json', 'X-XSRF-TOKEN': xsrf, 'X-Requested-With': 'XMLHttpRequest' };
            const removed = [];
            for (const period of ['weekly', 'monthly']) {
                const response = await fetch(`/api/account/${account}/annotations?chart_key=event_${event}_ticketSales_${period}_sales`, { headers, credentials: 'same-origin' });
                for (const [id, annotation] of Object.entries(await response.json())) {
                    if (!/^sgautomation\d+$/.test(annotation?.text ?? '')) continue;
                    await fetch(`/api/account/${account}/annotations/${id}`, { method: 'DELETE', headers, credentials: 'same-origin' });
                    removed.push(`${period}:${annotation.text}`);
                }
            }
            return removed;
        });
        if (deleted.length) console.log(`🗑️ Test annotations deleted: ${deleted.join(', ')}`);
    }
}
