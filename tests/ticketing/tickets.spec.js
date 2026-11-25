// tickets.spec.js
// Ticketing > Tickets (bulk entry):
//   - ticket figures, the sales channels shown by "Expand all", row menus
//   - Reference, Rebate, Direct cost, Tax, Fixed, Available and Sold can be edited, and the changes saved
//   - Import (seller, template download, drop / click to upload, data imported correctly)
//   - Export (by ticket seller, entire event, data exported correctly)
//   - View Bank Transactions / Add Bank Transaction / Delete Ticket Sale
// Runs against TICKETING_TEST_EVENT_URL (an open event). Anything that is edited or deleted is done on a
// throw-away ticket (AutoTicket_<n>), which is removed afterwards; Sold edits on real tickets are put back.
import { test, expect } from '../../fixtures/baseTest.js';
import { readFile } from 'node:fs/promises';
import { TicketingPage } from '../../pages/ticketingPage.js';
import { TicketsPage } from '../../pages/ticketingTicketsPage.js';
import { TicketingDashboardPage } from '../../pages/ticketingDashboardPage.js';
import { TransactionsPage } from '../../pages/ticketingTransactionsPage.js';
import { parseCsv, readCsvRecords, readXlsx } from '../utils/spreadsheet.js';

const IMPORT_TEMPLATE = './fixtures/ticket-import-template.csv';

test.describe('Ticketing Tickets page', () => {

    let tickets;

    test.beforeEach(async ({ page }) => {
        tickets = new TicketsPage(page);
        await tickets.goto();
    });

    test('lists every ticket with its figures', async () => {
        const rows = await tickets.readTicketRows();
        expect(rows.length, 'The page lists tickets').toBeGreaterThan(0);
        expect(new Set(rows.map(row => row.name)).size, 'No duplicate tickets').toBe(rows.length);
        for (const row of rows) {
            for (const [field, value] of Object.entries(row)) {
                if (field !== 'name') expect(value, `${row.name} ${field} should be a number`).not.toBeNaN();
            }
            expect(row.available, `${row.name}: Fixed tickets are part of the available tickets`).toBeGreaterThanOrEqual(row.fixed);
            expect(row.available, `${row.name}: headcount is within the available tickets`).toBeGreaterThanOrEqual(row.headcount);
            expect(row.price, `${row.name} price`).toBeGreaterThanOrEqual(0);
        }
    });

    test('loads without console errors', async ({ page }) => {
        const errors = [];
        page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
        page.on('pageerror', error => errors.push(error.message));
        await tickets.goto();
        await tickets.expandAll();
        expect(errors, 'Console errors on the Tickets page').toEqual([]);
    });

    test('Expand all shows the sales channels: editable fields, Supplier is not editable, totals match the ticket', async () => {
        const rows = await tickets.readTicketRows();
        await tickets.expandAll();
        const channels = await tickets.readSalesChannels();
        expect(channels.length, 'Each ticket has at least one sales channel').toBeGreaterThanOrEqual(rows.length);

        for (const channel of channels) {
            const label = `${channel.ticket} / ${channel.supplier}`;
            expect(channel.supplier, `${label}: supplier shown`).not.toBe('');
            expect(channel.editable.supplier, `${label}: Supplier is not editable`).toBe(false);
            for (const field of ['reference', 'rebate', 'directCost', 'fixed', 'available', 'sold']) {
                expect(channel.editable[field], `${label}: ${field} is editable`).toBe(true);
            }
            expect(channel.taxIsButton, `${label}: tax rate can be chosen`).toBe(true);
            expect(channel.sold, `${label}: sold is within the available tickets`).toBeLessThanOrEqual(channel.available);
        }

        // A ticket's Fixed and Available figures are the sum over its sales channels.
        for (const row of rows) {
            const own = channels.filter(channel => channel.ticket === row.name);
            expect(own.reduce((sum, c) => sum + c.fixed, 0), `${row.name}: Fixed = sum of its sales channels`).toBe(row.fixed);
            expect(own.reduce((sum, c) => sum + c.available, 0), `${row.name}: Available = sum of its sales channels`).toBe(row.available);
        }
    });

    test('row menus: ticket "Delete Ticket Type"; sales channel bank / ticket transactions and Delete Ticket Sale', async ({ page }) => {
        const [first] = await tickets.readTicketRows();
        await expect(await tickets.openTicketMenu(first.name)).toContainText('Delete Ticket Type');
        await tickets.closeMenus();

        await tickets.expandAll();
        const [channel] = await tickets.readSalesChannels();
        const menu = await tickets.openChannelMenu(channel.ticket, channel.supplier);
        for (const item of ['View Bank Transactions', 'Add Bank Transaction', 'Add Ticket Transaction', 'Delete Ticket Sale']) {
            await expect(menu, `Sales channel menu offers "${item}"`).toContainText(item);
        }

        await test.step('View Bank Transactions lists the channel\'s bank transactions', async () => {
            await menu.getByText('View Bank Transactions', { exact: true }).click();
            const dialog = page.locator('.m-wrapper').filter({ hasText: 'Bank Transactions' }).last();
            await expect(dialog).toBeVisible();
            for (const column of ['From', 'Logged by', 'Date', 'Amount', 'Actions']) await expect(dialog).toContainText(column);
            await dialog.locator('button.m-close').click();
            await expect(dialog).toBeHidden();
        });

        await test.step('Add Bank Transaction opens the form (not saved)', async () => {
            const addMenu = await tickets.openChannelMenu(channel.ticket, channel.supplier);
            await addMenu.getByText('Add Bank Transaction', { exact: true }).click();
            const dialog = page.locator('.m-wrapper').filter({ hasText: 'Create Bank Transaction' }).last();
            await expect(dialog).toBeVisible();
            await expect(dialog).toContainText('You are adding a bank transaction for money received relating to a Ticket Sale.');
            for (const field of ['Bank Account', 'From', 'Name', 'Amount', 'Additional Notes']) await expect(dialog).toContainText(field);
            await dialog.locator('button.m-close').click();
            await expect(dialog).toBeHidden();
        });
    });

    test('Reference, Rebate, Direct cost, Tax, Fixed, Available and Sold can be edited and saved', async ({ page, budgetingPage, revenuePage }) => {
        test.setTimeout(240000);
        await tickets.deleteTestTickets();
        const name = await tickets.createTestTicket(budgetingPage, revenuePage);
        const reference = `Ref${Date.now().toString().slice(-5)}`;
        const edits = { reference, rebate: 3, directCost: 1, fixed: 110, available: 150, sold: 7 };
        try {
            await tickets.goto();
            await tickets.expandAll();
            await expect(tickets.unsavedChangesBanner()).toBeHidden();

            await test.step('Edit every field of the sales channel', async () => {
                for (const [field, value] of Object.entries(edits)) await tickets.setChannelValue(name, 'Direct Sales', field, value);
                await tickets.setChannelTax(name, 'Direct Sales', '5% Income');
            });

            await test.step('The page offers to save the changes', async () => {
                await expect(tickets.unsavedChangesBanner()).toBeVisible();
                await expect(page.getByRole('button', { name: 'Save Changes', exact: true })).toBeVisible();
                await tickets.saveChanges();
            });

            await test.step('The changes are kept after a reload', async () => {
                await tickets.goto();
                const row = (await tickets.readTicketRows()).find(ticket => ticket.name === name);
                await tickets.expandAll();
                const saved = (await tickets.readSalesChannels()).find(channel => channel.ticket === name && channel.supplier === 'Direct Sales');
                expect(saved).toMatchObject({ ...edits, tax: '5%' });
                expect(row.fixed, 'The ticket shows the new Fixed figure').toBe(edits.fixed);
                expect(row.available, 'The ticket shows the new Available figure').toBe(edits.available);
            });
        } finally {
            await tickets.deleteTestTickets();
        }
    });

    test('Edit Sold: unsaved changes banner, Save Changes, and Tickets Sold on the Dashboard follows', async ({ page }) => {
        await tickets.expandAll();
        const channels = await tickets.readSalesChannels();
        const channel = channels.find(c => c.sold < c.available) ?? channels[0];
        const original = channel.sold;
        const edited = original < channel.available ? original + 1 : original - 1;
        const dashboard = new TicketingDashboardPage(page);
        const soldOnDashboard = async () => {
            await dashboard.goto();
            return (await dashboard.readKpis())['Tickets Sold'].value;
        };
        const reopen = async () => {
            await tickets.goto();
            await tickets.expandAll();
        };

        const before = await soldOnDashboard();
        await reopen();
        try {
            await test.step('Changing Sold shows the unsaved changes banner', async () => {
                await expect(tickets.unsavedChangesBanner()).toBeHidden();
                await tickets.setChannelValue(channel.ticket, channel.supplier, 'sold', edited);
                await expect(tickets.unsavedChangesBanner()).toBeVisible();
                await expect(page.getByRole('button', { name: 'Save Changes', exact: true })).toBeVisible();
            });
            await test.step('Save Changes keeps it and the Dashboard follows', async () => {
                await tickets.saveChanges();
                await reopen();
                const saved = (await tickets.readSalesChannels()).find(c => c.ticket === channel.ticket && c.supplier === channel.supplier);
                expect(saved.sold, 'Sold was saved').toBe(edited);
                expect(await soldOnDashboard(), 'Tickets Sold on the Dashboard moves with it').toBe(before + (edited - original));
            });
        } finally {
            // Put the original figure back.
            await reopen();
            const current = (await tickets.readSalesChannels()).find(c => c.ticket === channel.ticket && c.supplier === channel.supplier);
            if (current.sold !== original) {
                await tickets.setChannelValue(channel.ticket, channel.supplier, 'sold', original);
                await tickets.saveChanges();
            }
        }
        await reopen();
        expect((await tickets.readSalesChannels()).find(c => c.ticket === channel.ticket && c.supplier === channel.supplier).sold,
            'Sold is back to its original figure').toBe(original);
    });

    test('Import ticket data: seller, template download, drop / click upload, and the data is imported correctly', async ({ page }) => {
        test.setTimeout(240000);
        const ticketing = new TicketingPage(page);
        const csv = await readCsvRecords(IMPORT_TEMPLATE);
        await ticketing.clickImportTicketData();
        const dialog = page.locator('.m-wrapper').filter({ hasText: 'Import Ticket Data' }).last();

        await test.step('Ticket seller can be selected', async () => {
            const sellers = await dialog.locator('select option').allInnerTexts();
            expect(sellers.length, 'Sellers to import for').toBeGreaterThan(0);
            expect(sellers).toContain('Direct Sales');
        });

        await test.step('Download Template is available and matches the import format', async () => {
            const download = page.waitForEvent('download', { timeout: 30000 });
            await dialog.getByRole('button', { name: 'Download Template' }).click();
            const file = await download;
            expect(file.suggestedFilename()).toBe('ticket_orders_template.csv');
            const [header] = parseCsv(await readFile(await file.path(), 'utf8'));
            expect(header, 'The template has the columns the import expects').toEqual(Object.keys(csv[0]));
        });

        await test.step('Drop / click to upload is offered (CSV per seller, XLSX for the entire event)', async () => {
            await expect(dialog.getByText('Drop a file here or click to upload').first()).toBeVisible();
            await expect(dialog.locator('input[type="file"][accept=".csv"]')).toHaveCount(1);
            await dialog.getByRole('button', { name: /Entire Event/ }).click();
            await expect(dialog.getByText('Drop a file here or click to upload').last()).toBeVisible();
            await expect(dialog.locator('input[type="file"][accept=".xlsx"]')).toHaveCount(1);
            await expect(dialog).toContainText('Append any transactions without replacing existing data');
            await dialog.getByRole('button', { name: 'Ticket Seller', exact: true }).click();
            await dialog.locator('button.m-close').click();
            await expect(dialog).toBeHidden();
        });

        await test.step('Import the template for Direct Sales', async () => {
            await tickets.importTemplate({ file: IMPORT_TEMPLATE });
        });

        await test.step('The imported data shows on the Tickets and Transactions pages', async () => {
            await tickets.goto();
            await tickets.expandAll();
            const channels = await tickets.readSalesChannels();
            const transactions = new TransactionsPage(page);
            await transactions.goto();
            const records = await transactions.readRecords();
            for (const row of csv) {
                const reference = row['Ticket Reference'];
                const quantity = Number(row['Quantity']);
                const channel = channels.find(c => c.supplier === 'Direct Sales' && c.reference === reference);
                expect(channel, `Direct Sales channel with reference ${reference}`).toBeTruthy();
                expect(channel.sold, `${reference}: Sold on the Tickets page`).toBe(quantity);
                const record = records.find(r => r.channel === 'Direct Sales' && r.reference === reference);
                expect(record, `${reference}: transaction record`).toBeTruthy();
                expect(record).toMatchObject({ recordType: 'Imported', status: 'Sale', quantity, quantityRefunded: 0 });
            }
        });
    });

    test('Export Data: by ticket seller and for the entire event, with the right data', async ({ page }) => {
        test.setTimeout(240000);
        const rows = await tickets.readTicketRows();
        await tickets.expandAll();
        const channels = await tickets.readSalesChannels();
        const dialog = await tickets.openExportDialog();

        await test.step('Ticket Seller export: the seller\'s sales as CSV', async () => {
            const sellers = await dialog.locator('select option').allInnerTexts();
            expect(sellers, 'Sellers to export').toContain('Direct Sales');
            await dialog.locator('select').selectOption({ label: 'Direct Sales' });
            const download = page.waitForEvent('download', { timeout: 30000 });
            await dialog.getByRole('button', { name: 'Export Data', exact: true }).click();
            const file = await download;
            expect(file.suggestedFilename()).toBe('Direct Sales_ticket_orders.csv');
            const exported = await readCsvRecords(await file.path());
            for (const channel of channels.filter(c => c.supplier === 'Direct Sales')) {
                const mine = exported.filter(record => record['Ticket Reference'] === channel.reference);
                const sold = mine.reduce((sum, record) => sum + Number(record['Quantity']) - Number(record['Qty Refunded'] || 0), 0);
                expect(sold, `${channel.reference}: exported quantity = Sold on the Tickets page`).toBe(channel.sold);
            }
        });

        await test.step('Entire Event export (new): choose the data and ticket types, and download the workbook', async () => {
            // The dialog stays open after an export.
            const entire = await dialog.isVisible() ? dialog : await tickets.openExportDialog();
            await entire.getByRole('button', { name: /Entire Event/ }).click();
            await expect(entire.locator('select'), 'No seller to choose').toBeHidden();
            for (const data of ['Summary', 'Sales Channels', 'Transactions']) await expect(entire).toContainText(data);
            for (const row of rows) await expect(entire.getByText(row.name, { exact: true })).toBeVisible();
            for (const checkbox of await entire.locator('input[type="checkbox"]').all()) await checkbox.check();
            const download = page.waitForEvent('download', { timeout: 30000 });
            await entire.getByRole('button', { name: 'Export Data', exact: true }).click();
            const file = await download;
            expect(file.suggestedFilename()).toMatch(/^Event Ticket Export - .*\.xlsx$/);

            const sheets = await readXlsx(await file.path());
            const names = Object.keys(sheets);
            expect(names[0]).toBe('Ticket Summary');

            // Summary: ID, Subcategory, Name, Price, Available, Collected, Received
            const summary = sheets['Ticket Summary'].slice(1);
            for (const row of rows) {
                const exported = summary.find(cells => cells[2] === row.name);
                expect(exported, `${row.name} in the Ticket Summary sheet`).toBeTruthy();
                expect(exported.slice(3).map(Number), `${row.name}: Price, Available, Collected, Received`)
                    .toEqual([row.price, row.available, row.collected, row.received]);
            }

            // Per ticket: "<id> | <name>" lists its sales channels; "<id>-<sale> | <seller>" holds that channel's sales.
            const ticketNames = Object.fromEntries(names.map(sheet => /^(\d+) \| (.+)$/.exec(sheet)).filter(Boolean).map(m => [m[1], m[2]]));
            for (const sheet of names) {
                const channelSheet = /^(\d+) \| (.+)$/.exec(sheet);
                if (!channelSheet || channelSheet[2] === undefined || !ticketNames[channelSheet[1]]) continue;
                for (const cells of sheets[sheet].slice(1)) {
                    const channel = channels.find(c => c.ticket === channelSheet[2] && c.supplier === cells[1]);
                    expect(channel, `${sheet}: ${cells[1]} channel`).toBeTruthy();
                    // ID, Sales Channel, Reference, Rebate, Direct Cost, Tax Rate, Available, Collected, Received
                    expect([cells[2], Number(cells[3]), Number(cells[4]), Math.round(Number(cells[5]) * 100), Number(cells[6])],
                        `${sheet}: ${cells[1]} reference, rebate, direct cost, tax rate, available`)
                        .toEqual([channel.reference, channel.rebate, channel.directCost, parseFloat(channel.tax), channel.available]);
                }
            }
            for (const sheet of names.filter(sheet => /^\d+-\d+ \| /.test(sheet))) {
                const [, ticketId, seller] = /^(\d+)-\d+ \| (.+)$/.exec(sheet);
                const channel = channels.find(c => c.ticket === ticketNames[ticketId] && c.supplier === seller);
                const sold = sheets[sheet].slice(1).reduce((sum, cells) => sum + Number(cells[2]) - Number(cells[5] || 0), 0);
                expect(sold, `${sheet}: exported sales = Sold on the Tickets page`).toBe(channel.sold);
            }
        });
    });

    test('Add Bank Transaction creates a bank transaction for money received; View Bank Transactions lists it', async ({ page, budgetingPage, revenuePage }) => {
        test.setTimeout(240000);
        await tickets.deleteTestTickets();
        const name = await tickets.createTestTicket(budgetingPage, revenuePage);
        const transaction = `AutoBankTx_${Date.now().toString().slice(-6)}`;
        try {
            await tickets.goto();
            await tickets.expandAll();
            await tickets.addBankTransaction(name, 'Direct Sales', { name: transaction, amount: 50 });

            const dialog = await tickets.openBankTransactions(name, 'Direct Sales');
            const listed = await tickets.readBankTransactions(dialog);
            expect(listed, 'One bank transaction is listed').toHaveLength(1);
            expect(listed[0]).toMatchObject({ from: 'Direct Sales', amount: 50 });
            expect(listed[0].loggedBy, 'Logged by').not.toBe('');
            expect(listed[0].date, 'Date').toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}:\d{2} [AP]M$/);
            await expect(dialog.locator('tbody tr').first().locator('button'), 'An action is available on the row').toHaveCount(1);
        } finally {
            await tickets.deleteTestBankTransactions(name).catch(() => {});
            await tickets.deleteTestTickets();
        }
    });

    // The delete button of a bank transaction ("Delete Transaction") does nothing when pressed: no request, no message.
    test('a bank transaction can be deleted from the list', async ({ page, budgetingPage, revenuePage }) => {
        test.setTimeout(240000);
        await tickets.deleteTestTickets();
        const name = await tickets.createTestTicket(budgetingPage, revenuePage);
        const transaction = `AutoBankTx_${Date.now().toString().slice(-6)}`;
        try {
            await tickets.goto();
            await tickets.expandAll();
            await tickets.addBankTransaction(name, 'Direct Sales', { name: transaction, amount: 50 });
            const dialog = await tickets.openBankTransactions(name, 'Direct Sales');
            page.on('dialog', confirm => confirm.accept());
            await dialog.locator('tbody tr').first().locator('button').click();
            await page.locator('.swal2-container').getByRole('button', { name: 'OK', exact: true }).click({ timeout: 2000 }).catch(() => {});
            await expect(dialog.locator('tbody tr'), 'The bank transaction is removed from the list').toHaveCount(0, { timeout: 8000 });
        } finally {
            await tickets.deleteTestBankTransactions(name).catch(() => {});
            await tickets.deleteTestTickets();
        }
    });

    // "Delete Ticket Sale" in a sales channel's menu does nothing when chosen: no request, no message.
    test('Delete Ticket Sale removes the selected ticket sale row', async ({ page, budgetingPage, revenuePage }) => {
        test.setTimeout(240000);
        await tickets.deleteTestTickets();
        const name = await tickets.createTestTicket(budgetingPage, revenuePage);
        try {
            await tickets.goto();
            await tickets.expandAll();
            const before = (await tickets.readSalesChannels()).filter(channel => channel.ticket === name);
            expect(before, 'The new ticket has a Direct Sales row').toHaveLength(1);

            page.on('dialog', confirm => confirm.accept());
            const menu = await tickets.openChannelMenu(name, 'Direct Sales');
            await menu.getByText('Delete Ticket Sale', { exact: true }).click();
            await page.locator('.swal2-container').getByRole('button', { name: 'OK', exact: true }).click({ timeout: 2000 }).catch(() => {});
            await expect.poll(async () => (await tickets.readSalesChannels()).filter(channel => channel.ticket === name).length,
                { message: 'The ticket sale row is removed', timeout: 8000 }).toBe(0);
            await tickets.goto();
            await tickets.expandAll();
            expect((await tickets.readSalesChannels()).filter(channel => channel.ticket === name), 'Still gone after a reload').toHaveLength(0);
        } finally {
            await tickets.deleteTestTickets();
        }
    });
});
