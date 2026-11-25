// budgetVActuals.spec.js
// Budget v Actuals module (its own sidebar module, /budget-v-actuals):
//   - Event Profit Overview calculations are correct and match the Budget Summary page
//   - There is no "Show manual estimates" view (Budget Summary has one)
//   - Revenue Streams / Cost Departments totals match the Budget Summary page, and the
//     Actual / Variance / Invoiced / Outstanding columns add up
// Read-only — runs against BVA_EVENT_URL (falls back to BUDGET_EVENT_URL).
import { test, expect } from '../../fixtures/baseTest.js';

const EVENT_URL = (process.env.BVA_EVENT_URL || process.env.BUDGET_EVENT_URL || '').replace(/\/$/, '');
const SECTIONS = [
    // Revenue variance = Actual − Budgeted; cost variance = Budgeted − Actual.
    { name: 'Revenue Streams', overviewRow: 'Revenue', variance: f => f.actual - f.budgeted },
    { name: 'Cost Departments', overviewRow: 'Costs', variance: f => f.budgeted - f.actual },
];
const COLUMNS = ['budgeted', 'actual', 'variance', 'invoiced', 'outstanding'];

async function readOverview(budgetingPage) {
    await budgetingPage.selectBudgetVersion('A');
    return {
        revenue: await budgetingPage.getOverviewRow('Revenue'),
        costs: await budgetingPage.getOverviewRow('Costs'),
        profit: await budgetingPage.getOverviewRow('Profit'),
    };
}

test.describe('Budget v Actuals', () => {

    test.beforeEach(async ({ budgetingPage }) => {
        if (!EVENT_URL) throw new Error('BVA_EVENT_URL / BUDGET_EVENT_URL is not set');
        test.setTimeout(300000); // the Budget page's overview can take 30s+ to calculate on a big event
        budgetingPage.eventBaseUrl = EVENT_URL;
    });

    test('Event Profit Overview calculations are correct and match the Budget page', async ({ budgetingPage }) => {
        await budgetingPage.gotoBudgetVActualsPage();
        const bva = await readOverview(budgetingPage);

        for (const key of ['fixed', 'budgeted']) {
            expect(bva.profit[key], `Profit ${key} = Revenue − Costs`).toBeCloseTo(bva.revenue[key] - bva.costs[key], 2);
        }
        for (const row of ['revenue', 'costs', 'profit']) {
            expect(bva[row].variance, `${row} variance = Budgeted − Fixed`).toBeCloseTo(bva[row].budgeted - bva[row].fixed, 2);
        }

        await budgetingPage.gotoBudgetSummaryPage();
        const budget = await readOverview(budgetingPage);
        for (const row of ['revenue', 'costs', 'profit']) {
            for (const key of ['fixed', 'budgeted', 'variance']) {
                expect(bva[row][key], `${row} ${key}: Budget v Actuals = Budget page`).toBeCloseTo(budget[row][key], 2);
            }
        }
    });

    test('There is no "Show manual estimates" view', async ({ page, budgetingPage }) => {
        await budgetingPage.gotoBudgetVActualsPage();
        await expect(page.getByText(/Show manual estimates/i)).toHaveCount(0);
        // The Budget page does offer it — confirms the check above is looking for the right label.
        await budgetingPage.gotoBudgetSummaryPage();
        await expect(page.getByText(/Show manual estimates/i).first()).toBeVisible({ timeout: 90000 }); // appears once the page's figures have loaded
    });

    test('Revenue Streams and Cost Departments totals match the Budget page', async ({ budgetingPage }) => {
        test.fail(true, 'Known bug: the Bar row excludes budget entries in Budget v Actuals - ClickUp: TODO');
        await budgetingPage.gotoBudgetVActualsPage();
        await budgetingPage.selectBudgetVersion('A');
        const overview = await readOverview(budgetingPage);
        const bva = {};
        for (const section of SECTIONS) bva[section.name] = await budgetingPage.getSectionFigures(section.name);

        // Budget Summary only shows Fixed/Budgeted by default — add Actual, Variance and
        // Markup Amount via "Customise columns" (Scenario left off), then restore.
        await budgetingPage.gotoBudgetSummaryPage();
        await budgetingPage.selectBudgetVersion('A');
        const previousColumns = await budgetingPage.setCustomColumns({ Actual: true, Variance: true, 'Markup Amount': true });
        const budget = {};
        try {
            for (const section of SECTIONS) budget[section.name] = await budgetingPage.getSectionFigures(section.name);
        } finally {
            await budgetingPage.setCustomColumns(previousColumns);
        }
        expect(budget['Cost Departments'].header, 'Markup Amount column shown on the Budget page').toHaveProperty('markup amount');

        for (const section of SECTIONS) {
            const { header, rows } = bva[section.name];
            console.log(`\n📋 ${section.name} (Budget v Actuals):`, header);

            await test.step(`${section.name}: each row's Budgeted / Actual / Variance match the Budget page`, async () => {
                const budgetRows = budget[section.name].rows;
                expect(Object.keys(rows).sort(), `${section.name} rows`).toEqual(Object.keys(budgetRows).sort());
                for (const [name, figures] of Object.entries(rows)) {
                    console.log(`  ${name}: Budgeted £${figures.budgeted} / Actual £${figures.actual} / Variance £${figures.variance}`
                        + ` (Budget page £${budgetRows[name].budgeted} / £${budgetRows[name].actual} / £${budgetRows[name].variance})`);
                    for (const column of ['budgeted', 'actual', 'variance']) {
                        expect(figures[column], `${name} ${column}: Budget v Actuals = Budget page`).toBeCloseTo(budgetRows[name][column], 2);
                    }
                }
            });

            await test.step(`${section.name}: totals match the rows, the Budget page and the overview`, async () => {
                for (const column of COLUMNS) {
                    const sum = Object.values(rows).reduce((total, figures) => total + (figures[column] ?? 0), 0);
                    expect(header[column], `${section.name} ${column} total = sum of rows`).toBeCloseTo(sum, 2);
                }
                for (const column of ['budgeted', 'actual', 'variance']) {
                    expect(header[column], `${section.name} ${column} total = Budget page`).toBeCloseTo(budget[section.name].header[column], 2);
                }
                expect(header.budgeted, `${section.name} Budgeted total = ${section.overviewRow} in Event Profit Overview`)
                    .toBeCloseTo(overview[section.overviewRow.toLowerCase()].budgeted, 2);
            });

            await test.step(`${section.name}: variance follows Budgeted and Actual`, async () => {
                expect(header.variance, `${section.name} total variance`).toBeCloseTo(section.variance(header), 2);
                for (const [name, figures] of Object.entries(rows)) {
                    expect(figures.variance, `${name} variance`).toBeCloseTo(section.variance(figures), 2);
                }
            });
        }
    });
});
