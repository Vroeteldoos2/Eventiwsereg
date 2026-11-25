// trends.spec.js
// Ticketing > Trends (the weekly / monthly sales graph, Summary, Sales Targets and Detailed View):
//   - Weekly / Monthly views, Sales / Revenue views
//   - Sales Targets: Stretch / Sellout / Breakeven / Average appear in the Detailed View table and Summary
//   - "Showing all ticket types": ticket types can be selected
//   - Create a sales target with the + (shows in the table and graph, can be edited and deleted)
//   - Prioritise tickets for the breakeven target: Ordered / Cheapest
//   - Breakeven amount = total budgeted costs − budgeted amount of the non-ticket revenue streams
//   - Annotations on the weekly / monthly graph: add, stay visible, remove
// Runs against TICKETING_TEST_EVENT_URL (an open event). Targets and annotations it creates are removed.
import { test, expect } from '../../fixtures/baseTest.js';
import { TicketingPage, getTicketingTestPageUrl } from '../../pages/ticketingPage.js';
import { TrendsPage, toNumber } from '../../pages/ticketingTrendsPage.js';
import { cleanupWithWarning } from '../utils/test-helpers.js';

const TARGET_PREFIX = 'AutoTarget_';
const BUILT_IN_TARGETS = {
    'Stretch Target': /average number of tickets or revenue required to sell out the event from week one/i,
    'Sellout Target': /number of tickets or revenue required to sell out the event from the current period onwards/i,
    'Breakeven Targets': /breakeven point.*order you have them listed.*cheapest ticket/i,
    'Average': /average number of tickets or revenue over a six week cycle/i,
};

const eventBaseUrl = () => getTicketingTestPageUrl('trends').replace(/\/tickets\/trends$/, '');

// The Detailed View column groups other than the always-present "Current Sales" / "Variance".
const targetGroups = view => view.groups.map(g => g.name).filter(name => !['Current Sales', 'Variance'].includes(name));

test.describe('Ticketing Trends', () => {

    let trends;

    test.beforeEach(async ({ page }) => {
        trends = new TrendsPage(page);
        await trends.goto();
    });

    test('Weekly and Monthly views show the same year-to-date sales', async () => {
        const weekly = await trends.readSummary();
        expect(weekly.periodLabel).toBe('This Week');
        const weeklyView = await trends.readDetailedView();
        expect(weeklyView.rows.length).toBeGreaterThan(0);
        for (const row of weeklyView.rows) expect(row.label, 'weekly row label').toMatch(/^Week \d+/);
        expect(weeklyView.totals.label).toBe('Totals');

        await trends.selectPeriod('Monthly');
        const monthly = await trends.readSummary();
        expect(monthly.periodLabel).toBe('This Month');
        const monthlyView = await trends.readDetailedView();
        for (const row of monthlyView.rows) expect(row.label, 'monthly row label').toMatch(/^[A-Z][a-z]+ \d{4}/);
        expect(monthly.rows['Actual Sales'][1], 'YTD actual sales are the same in both views').toBe(weekly.rows['Actual Sales'][1]);
        expect(toNumber(monthlyView.totals.cells[2]), 'Detailed View totals = YTD actual sales').toBe(monthly.rows['Actual Sales'][1]);
    });

    test('Revenue view shows the Summary in pounds', async () => {
        await trends.selectView('Revenue');
        const summary = await trends.summarySection().innerText();
        expect(summary, 'Actual Sales shown as currency').toMatch(/Actual Sales\s*£[\d,]+\.\d{2}\s*£[\d,]+\.\d{2}/);
        await trends.selectView('Sales');
        expect(await trends.summarySection().innerText(), 'Sales view shows ticket counts').not.toContain('£');
    });

    test('Stretch, Sellout, Breakeven and Average targets are listed with an explanation', async () => {
        for (const [name, help] of Object.entries(BUILT_IN_TARGETS)) {
            await expect(trends.targetRow(name), `${name} should be listed`).toBeVisible();
            expect(await trends.getTargetHelpText(name), `${name} explanation`).toMatch(help);
            // Not ticked until chosen — the weekly table only has Current Sales to begin with.
            expect(await trends.isTargetSelected(name), `${name} is not selected by default`).toBe(false);
        }
        expect(targetGroups(await trends.readDetailedView()), 'No targets in the table until ticked').toEqual([]);
    });

    test('ticked Stretch, Sellout and Breakeven targets show in the weekly sales table and Summary', async ({ budgetingPage }) => {
        budgetingPage.eventBaseUrl = eventBaseUrl();
        await budgetingPage.gotoRevenueBudgetPage();
        await budgetingPage.selectBudgetVersion('A');
        const ticketRevenueBudget = (await budgetingPage.getSectionFigures('Revenue Streams')).rows['Tickets']?.budgeted;
        await trends.goto();

        await test.step('Stretch Target', async () => {
            await trends.setTargetSelected('Stretch Target', true);
            const view = await trends.readDetailedView();
            expect(targetGroups(view)).toEqual(['Stretch Target']);
            expect(view.groups.map(g => g.name), 'Variance columns appear').toContain('Variance');
            const summary = await trends.readSummary();
            const stretchRow = Object.keys(summary.rows).find(label => /Stretch target/i.test(label));
            expect(stretchRow, 'Summary has a Stretch target row').toBeTruthy();
            expect(summary.rows[stretchRow].every(value => !Number.isNaN(value))).toBe(true);

            // The stretch target builds up to the budgeted ticket revenue by the last week.
            const revenue = TrendsPage.column(view, 'Stretch Target', 1);
            const counts = TrendsPage.column(view, 'Stretch Target', 0);
            expect(counts.weeks.every(week => week.value >= 0)).toBe(true);
            if (ticketRevenueBudget !== undefined) {
                expect(revenue.weeks.at(-1).value, 'Stretch revenue in the final week = budgeted ticket revenue')
                    .toBeCloseTo(ticketRevenueBudget, 0);
            }
        });

        await test.step('Sellout Target', async () => {
            await trends.setTargetSelected('Sellout Target', true);
            const view = await trends.readDetailedView();
            expect(targetGroups(view)).toEqual(['Stretch Target', 'Sellout Target']);
            const counts = TrendsPage.column(view, 'Sellout Target', 0);
            expect(counts.weeks.every(week => week.value >= 0)).toBe(true);
        });

        await test.step('Breakeven Target', async () => {
            await trends.setTargetSelected('Breakeven Targets', true);
            const view = await trends.readDetailedView();
            expect(targetGroups(view)).toEqual(['Stretch Target', 'Sellout Target', 'Breakeven Target (Ordered)']);
        });

        await test.step('Unticking removes them again', async () => {
            for (const name of ['Stretch Target', 'Sellout Target', 'Breakeven Targets']) await trends.setTargetSelected(name, false);
            expect(targetGroups(await trends.readDetailedView())).toEqual([]);
        });
    });

    test('Ticket types can be selected under "Showing all ticket types"', async ({ page }) => {
        const ticketing = new TicketingPage(page);
        await expect(trends.ticketTypesTrigger()).toHaveText('Showing all ticket types');
        const total = (await trends.readSummary()).rows['Actual Sales'][1];

        let picker = await trends.openTicketTypePicker();
        const types = await trends.readTicketTypePicker(picker);
        expect(types.length, 'ticket types listed').toBeGreaterThan(0);
        expect(types.every(type => type.selected), 'all ticket types are selected to begin with').toBe(true);
        for (const type of types) expect(Number.isInteger(type.order) && type.order >= 1, `${type.name} has an order`).toBe(true);
        await trends.closeTicketTypePicker(picker);

        // Same ticket types as the Tickets page.
        await ticketing.navigateToTicketingPage(getTicketingTestPageUrl('bulk'));
        const ticketNames = (await ticketing.readTicketRows()).map(row => row.name).sort();
        expect(types.map(type => type.name).sort()).toEqual(ticketNames);
        await trends.goto();

        // Choosing one ticket type at a time: each count is part of the total, and together they make it.
        // (The selection is remembered by the browser, so set every checkbox explicitly each time.)
        const perType = {};
        for (const type of types) {
            picker = await trends.openTicketTypePicker();
            for (const other of types) await trends.setTicketTypeSelected(picker, other.name, other.name === type.name);
            await trends.closeTicketTypePicker(picker);
            await expect(trends.ticketTypesTrigger()).toHaveText(/^\s*Showing 1 ticket types?\s*$/);
            perType[type.name] = (await trends.readSummary()).rows['Actual Sales'][1];
        }
        picker = await trends.openTicketTypePicker();
        for (const type of types) await trends.setTicketTypeSelected(picker, type.name, true);
        await trends.closeTicketTypePicker(picker);
        await expect(trends.ticketTypesTrigger()).toHaveText('Showing all ticket types');
        expect((await trends.readSummary()).rows['Actual Sales'][1], 'Choosing all ticket types again restores the total').toBe(total);
        console.log('🎟️ YTD sales per ticket type:', perType, '| all:', total);
        for (const [name, sold] of Object.entries(perType)) expect(sold, `${name} sales are part of the total`).toBeLessThanOrEqual(total);
        expect(Object.values(perType).reduce((sum, sold) => sum + sold, 0), 'Ticket types add up to the total').toBe(total);
    });

    test('create a sales target with +: weekly Detailed View has no NaN values', async ({ page }) => {
        test.fail(true, 'Known bug: custom sales targets show NaN in weekly Detailed View - ClickUp: TODO');
        const name = `${TARGET_PREFIX}${Date.now().toString().slice(-6)}`;
        await cleanupWithWarning('leftover sales targets', () => trends.deleteTargetsMatching(new RegExp(`^${TARGET_PREFIX}`)));

        try {
            await trends.createTarget({ name, type: 'Weekly' });
            await expect(trends.targetRow(name)).toContainText('Weekly');
            await expect(trends.targetRow(name).locator('button:has(i.mdi-pencil)'), 'can be edited').toBeVisible();
            await expect(trends.targetRow(name).locator('td').last().locator('button').last(), 'can be deleted').toBeVisible();

            await trends.setTargetSelected(name, true);
            await expect.poll(async () => targetGroups(await trends.readDetailedView())).toEqual([name]);
            const view = await trends.readDetailedView();
            expect(targetGroups(view), 'Detailed View has a column group for the target').toEqual([name]);
            const group = view.groups.find(g => g.name === name);
            const cells = view.rows.concat(view.totals).flatMap(row => row.cells.slice(group.start - 1, group.start - 1 + group.colspan));
            expect(cells.filter(cell => /NaN/.test(cell)), 'No NaN figures in the target\'s columns').toEqual([]);
        } finally {
            await cleanupWithWarning('sales target', () => trends.deleteTargetsMatching(new RegExp(`^${TARGET_PREFIX}`)));
        }
    });

    test('create a sales target with +: ticking it changes the graph', async ({ page }) => {
        test.fail(true, 'Known bug: ticking a custom target does not show it on the graph - ClickUp: TODO');
        const name = `${TARGET_PREFIX}${Date.now().toString().slice(-6)}`;
        const graph = page.locator('canvas').first();
        await cleanupWithWarning('leftover sales targets', () => trends.deleteTargetsMatching(new RegExp(`^${TARGET_PREFIX}`)));

        try {
            await trends.createTarget({ name, type: 'Weekly' });
            await expect(trends.targetRow(name)).toContainText('Weekly');
            const before = await graph.screenshot();
            await trends.setTargetSelected(name, true);
            await expect.poll(async () => Buffer.compare(before, await graph.screenshot()), {
                message: 'Graph updates after selecting the sales target',
            }).not.toBe(0);
        } finally {
            await cleanupWithWarning('sales target', () => trends.deleteTargetsMatching(new RegExp(`^${TARGET_PREFIX}`)));
        }
    });

    test('create, rename and delete a weekly sales target', async () => {
        const name = `${TARGET_PREFIX}${Date.now().toString().slice(-6)}`;
        const edited = `${name}_edited`;
        await cleanupWithWarning('leftover sales targets', () => trends.deleteTargetsMatching(new RegExp(`^${TARGET_PREFIX}`)));

        try {
            await trends.createTarget({ name, type: 'Weekly' });
            await trends.renameTarget(name, edited);

            await expect.poll(() => trends.getCustomTargetNames()).toContain(edited);
            await expect.poll(() => trends.getCustomTargetNames()).not.toContain(name);
            await trends.setTargetSelected(edited, true);
            await expect.poll(async () => targetGroups(await trends.readDetailedView())).toContain(edited);

            await trends.deleteTarget(edited);
            await trends.goto();
            const remainingTargets = await trends.getCustomTargetNames();
            expect(remainingTargets, 'Renamed target is deleted after reload').not.toContain(edited);
            expect(remainingTargets, 'Original target name stays deleted').not.toContain(name);
        } finally {
            await cleanupWithWarning('renamed sales target', () => trends.deleteTargetsMatching(new RegExp(`^${TARGET_PREFIX}`)));
        }
    });

    // The wizard says the value entered in step 1 is the target's total ("…cannot exceed your maximum
    // available tickets"), but on most events step 2 shows the number already sold instead.
    test('Create Ticket Target wizard uses the quantity entered', async () => {
        test.fail(true, 'Known bug: Ticket Target wizard ignores the entered quantity on most events - ClickUp: TODO');
        const modal = await trends.openCreateTargetWizard();
        const quantityInput = modal.locator('input[type="number"]');
        const max = Number(await quantityInput.getAttribute('max'));
        expect(await quantityInput.inputValue(), 'Pre-filled with the maximum available tickets').toBe(String(max));
        const quantity = Math.max(1, Math.floor(max / 2));
        await quantityInput.click({ clickCount: 3 });
        await trends.page.keyboard.type(String(quantity), { delay: 30 });
        await modal.getByRole('button', { name: 'Next', exact: true }).click();
        await expect(modal.getByText(/This target is for a total of/)).toContainText(`total of ${quantity} tickets`);
        await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
        await modal.waitFor({ state: 'hidden' });
    });

    test('Prioritise tickets: Ordered and Cheapest options for the breakeven target', async () => {
        await trends.setTargetSelected('Breakeven Targets', true);
        expect(await trends.getBreakevenPriority(), 'Ordered is the default').toBe('Ordered');
        expect(targetGroups(await trends.readDetailedView())).toEqual(['Breakeven Target (Ordered)']);

        const menu = await trends.openBreakevenPriorityMenu();
        await expect(menu).toContainText('Ordered');
        await expect(menu).toContainText('Prioritise tickets in the order that you have set them up');
        await expect(menu).toContainText('Cheapest');
        await expect(menu).toContainText('Prioritise tickets starting from the cheapest moving up');
        await menu.getByText('Cheapest', { exact: true }).click();
        await expect(trends.priorityTrigger()).toContainText('Cheapest');

        expect(await trends.getBreakevenPriority()).toBe('Cheapest');
        const cheapest = await trends.readDetailedView();
        expect(targetGroups(cheapest)).toEqual(['Breakeven Target (Cheapest)']);

        await trends.setBreakevenPriority('Ordered');
        expect(targetGroups(await trends.readDetailedView())).toEqual(['Breakeven Target (Ordered)']);
    });

    test('Breakeven amount = total budgeted costs − budgeted non-ticket revenue; weekly count is zero once passed', async ({ budgetingPage }) => {
        test.fail(true, 'Known bug: breakeven target amount is incorrect on some events - ClickUp: TODO');
        budgetingPage.eventBaseUrl = eventBaseUrl();
        await budgetingPage.gotoBudgetSummaryPage();
        await budgetingPage.selectBudgetVersion('A');
        await budgetingPage.expandAllSections();
        const revenue = await budgetingPage.getOverviewRow('Revenue');
        const costs = await budgetingPage.getOverviewRow('Costs');
        const ticketRevenue = (await budgetingPage.getSectionFigures('Revenue Streams')).rows['Tickets']?.budgeted ?? 0;
        const nonTicketRevenue = Number((revenue.budgeted - ticketRevenue).toFixed(2));
        const expected = Number((costs.budgeted - nonTicketRevenue).toFixed(2));
        console.log(`💷 budgeted costs £${costs.budgeted} − non-ticket revenue £${nonTicketRevenue} = breakeven £${expected}`);

        await trends.goto();
        await trends.setTargetSelected('Breakeven Targets', true);
        const view = await trends.readDetailedView();
        const counts = TrendsPage.column(view, 'Breakeven Target (Ordered)', 0);
        const breakevenRevenue = TrendsPage.column(view, 'Breakeven Target (Ordered)', 1);
        const soldRevenue = TrendsPage.column(view, 'Current Sales', 3);          // Current Sales > Total > Revenue (Gross)
        console.log('💷 breakeven revenue on the page:', breakevenRevenue.total, '| weekly counts:', counts.weeks.map(w => w.value));

        if (expected > 0) {
            expect(breakevenRevenue.total, 'Breakeven amount = costs − non-ticket revenue').toBeCloseTo(expected, 1);
        }
        if (expected <= 0 || soldRevenue.total >= expected) {
            // Breakeven has already been passed: nothing more has to be sold.
            expect(counts.weeks.map(week => week.value), 'Breakeven weekly count is zero once passed').toEqual(counts.weeks.map(() => 0));
        }
    });

    for (const period of ['Weekly', 'Monthly']) {
        test(`${period} graph annotations: add with a comment, stay visible, remove`, async ({ page }) => {
            const ticketing = new TicketingPage(page);
            const comment = `sgautomation${Math.floor(Math.random() * 900) + 100}`;
            if (period === 'Monthly') await trends.selectPeriod('Monthly');

            await test.step('The + button is at the top right of the graph and toggles annotation mode', async () => {
                const button = trends.annotationButton();
                await expect(button).toBeVisible();
                await expect(button).toHaveAttribute('title', 'Enable annotation mode');
                const chart = await page.locator('canvas').first().boundingBox();
                const box = await button.boundingBox();
                expect(box.x, '+ is in the right half of the graph').toBeGreaterThan(chart.x + chart.width / 2);
                expect(box.y, '+ is at the top of the graph').toBeLessThan(chart.y + 60);
                await button.hover();
                await button.click();
                await expect(trends.annotationButton()).toHaveAttribute('title', 'Disable annotation mode');
                await trends.annotationButton().click();
                await expect(trends.annotationButton()).toHaveAttribute('title', 'Enable annotation mode');
            });

            const reopen = async () => {
                await trends.goto();
                if (period === 'Monthly') await trends.selectPeriod('Monthly');
            };
            // The annotation point is on the graph when clicking it opens the "Remove Annotation" dialog.
            const expectPointOnGraph = async message => {
                expect(await trends.findAnnotationDot(), message).not.toBeNull();
                await trends.removeAnnotationDialog().locator('button').first().click();       // × — keep the annotation
                await expect(page.getByText('Remove Annotation')).toBeHidden();
            };

            try {
                await test.step('Add an annotation with a comment', async () => {
                    await ticketing.addChartAnnotation(comment);
                    expect(await trends.listAnnotations(period.toLowerCase()), 'annotation is saved')
                        .toEqual(expect.arrayContaining([expect.objectContaining({ text: comment })]));
                    await expectPointOnGraph('The annotation point should be on the graph');
                });

                await test.step('The annotation stays visible after the page is reloaded', async () => {
                    await reopen();
                    expect(await trends.listAnnotations(period.toLowerCase())).toEqual(expect.arrayContaining([expect.objectContaining({ text: comment })]));
                    await expectPointOnGraph('The annotation point should still be on the graph');
                });

                await test.step('Click the annotation point to remove it', async () => {
                    expect(await trends.findAnnotationDot()).not.toBeNull();
                    const removed = page.waitForResponse(r => r.request().method() === 'DELETE' && /\/annotations\/\d+$/.test(r.url()));
                    await page.getByRole('button', { name: /^Remove$/i }).last().click();
                    expect((await removed).status()).toBe(204);
                    await reopen();
                    expect(await trends.listAnnotations(period.toLowerCase())).not.toEqual(expect.arrayContaining([expect.objectContaining({ text: comment })]));
                    expect(await trends.findAnnotationDot(), 'The annotation point should be gone').toBeNull();
                });
            } finally {
                await cleanupWithWarning('test annotations', () => trends.deleteTestAnnotations());
            }
        });
    }
});
