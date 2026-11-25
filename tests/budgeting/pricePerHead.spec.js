// pricePerHead.spec.js
// Revenue Budget > Bar > Price Per Head Configuration.
// A per-head stream's figures are driven by the ticket types selected in each entry's
// Price Per Head Settings and the attrition rate:
//   Per Head Fixed    = Σ selected ticket types' Fixed qty     × (1 − attrition) × net amount per head
//   Per Head Budgeted = Σ selected ticket types' Available qty × (1 − attrition) × net amount per head
// (No ticket types selected = all ticket types included.)
// The test creates its own entry (BarMainTest), changes that entry's ticket selection
// and attrition rate, and checks the Bar figures move by exactly that entry's share.
// The entry is deleted afterwards so existing entries are never touched.
import { test, expect } from '../../fixtures/baseTest.js';
import { setupBudgetingTest } from '../utils/setup';

const STREAM = process.env.PPH_STREAM || 'Bar';
const TICKET_TYPES = (process.env.PPH_TICKET_TYPES || 'Main,EarlyBird').split(',').map(s => s.trim()).filter(Boolean);
const ATTRITION = Number(process.env.PPH_ATTRITION_RATE || 10);

const ENTRY = {
    name: 'BarMainTest',
    category: 'Bar Main',
    customer: 'Asahi',
    taxRate: '20% Income',
    grossAmount: 25,
};
const TAX_PERCENT = 20;

let budgetingPage;

test.describe('Budgeting - Price Per Head Configuration', () => {

    // Runs on its own open event (PRICE_PER_HEAD_EVENT_URL) — saving price per head
    // settings is forbidden on a closed event. Falls back to BUDGET_EVENT_URL.
    test.beforeEach(async ({ page }) => {
        ({ budgetingPage } = await setupBudgetingTest(page));
        const eventUrl = process.env.PRICE_PER_HEAD_EVENT_URL;
        if (eventUrl) budgetingPage.eventBaseUrl = eventUrl.replace(/\/$/, '');
    });

    test(`${STREAM} fixed/budgeted follow the selected ticket types and attrition rate`, async () => {
        test.setTimeout(300000);

        await budgetingPage.gotoRevenueBudgetPage();
        const tickets = await budgetingPage.getTicketTypeQuantities();
        console.log('🎟️ Ticket types:', tickets);

        const openConfig = async () => {
            await budgetingPage.gotoRevenueBudgetPage();
            await budgetingPage.openPricePerHeadConfiguration(STREAM);
        };
        const readStreamFigures = async () => {
            await budgetingPage.gotoRevenueBudgetPage();
            return {
                fixed: await budgetingPage.getRevenueStreamFigure(STREAM, 'Fixed'),
                budgeted: await budgetingPage.getRevenueStreamFigure(STREAM, 'Budgeted'),
            };
        };

        // Clear leftovers from an earlier failed run, then take the baseline that
        // the other (untouched) entries contribute.
        await openConfig();
        await budgetingPage.deletePricePerHeadEntries(ENTRY.name);
        const baseline = await readStreamFigures();
        console.log(`📋 ${STREAM} baseline — Fixed £${baseline.fixed}, Budgeted £${baseline.budgeted}`);

        try {
            let ticketTypes;
            // On Create the app derives Net Amount from gross and tax and stores it to
            // 2 decimals (£25 @ 20% → £20.83); per-head figures use that stored value.
            const netPerHead = Math.round(ENTRY.grossAmount / (1 + TAX_PERCENT / 100) * 100) / 100;

            await test.step(`Create price per head entry ${ENTRY.name}`, async () => {
                await openConfig();
                await budgetingPage.createPricePerHeadEntry(ENTRY);
                const row = budgetingPage.pricePerHeadEntryRow(ENTRY.name);
                await expect(row).toContainText(ENTRY.category);
                await expect(row).toContainText(ENTRY.customer);
                await expect(row).toContainText(ENTRY.taxRate);
                await expect(row).toContainText(`£${netPerHead.toFixed(2)}`);
                await expect(row).toContainText(`£${ENTRY.grossAmount.toFixed(2)}`);

                // Ticket type spelling varies between events ("EarlyBird" vs "Earlybird") —
                // resolve the configured names to the ones this event uses.
                await budgetingPage.openPricePerHeadSettings(ENTRY.name);
                const { ticketTypes: offered } = await budgetingPage.getPricePerHeadSettings();
                await budgetingPage.pricePerHeadSettingsModal().getByRole('button', { name: 'Close', exact: true }).click();
                ticketTypes = TICKET_TYPES.map(wanted => {
                    const match = Object.keys(offered).find(name => name.toLowerCase() === wanted.toLowerCase());
                    if (!match) throw new Error(`Ticket type "${wanted}" not offered in Price Per Head Settings (have: ${Object.keys(offered).join(', ')})`);
                    return match;
                });
            });

            const verify = async (types, attritionRate) => {
                await openConfig();
                await budgetingPage.configurePricePerHead({ ticketTypes: types, attritionRate, entry: ENTRY.name });

                const sum = key => types.reduce((total, name) => {
                    if (!tickets[name]) throw new Error(`Ticket type "${name}" not found on the Tickets stream`);
                    return total + tickets[name][key];
                }, 0);
                const factor = (1 - attritionRate / 100) * netPerHead;
                const expected = {
                    fixed: baseline.fixed + sum('fixed') * factor,
                    budgeted: baseline.budgeted + sum('available') * factor,
                };

                const actual = await readStreamFigures();
                console.log(`  [${types.join(', ')}] @ ${attritionRate}% → Fixed £${actual.fixed} (expected £${expected.fixed.toFixed(2)}), Budgeted £${actual.budgeted} (expected £${expected.budgeted.toFixed(2)})`);

                expect(actual.fixed, `${STREAM} Per Head Fixed`).toBeCloseTo(expected.fixed, 2);
                expect(actual.budgeted, `${STREAM} Per Head Budgeted`).toBeCloseTo(expected.budgeted, 2);
            };

            await test.step(`Select ${TICKET_TYPES.join(' + ')} with ${ATTRITION}% attrition`, async () => {
                await verify(ticketTypes, ATTRITION);
            });

            await test.step(`Removing the ${ATTRITION}% attrition rate updates the ${STREAM} figures`, async () => {
                await verify(ticketTypes, 0);
            });

            await test.step(`Changing the ticket types updates the ${STREAM} figures`, async () => {
                await verify(ticketTypes.slice(0, 1), ATTRITION);
            });
        } finally {
            // Remove the test entry; log rather than throw so a cleanup failure
            // doesn't hide the assertion that failed above.
            await openConfig()
                .then(() => budgetingPage.deletePricePerHeadEntries(ENTRY.name))
                .catch(error => console.log(`⚠️ Could not delete ${ENTRY.name}: ${error.message}`));
        }
    });
});
