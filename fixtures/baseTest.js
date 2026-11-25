import { test as base } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { ApprovalsPage } from '../pages/approvalsPage.js';
import { BudgetingPage } from '../pages/budgetingPage.js';
import { DashboardPage } from '../pages/dashboardPage.js';
import { EventSettingsPage } from '../pages/eventSettingsPage.js';
import { LoginPage } from '../pages/loginPage.js';
import { newEventCreation } from '../pages/newEventCreation.js';
import { PurchasingPage } from '../pages/purchasingPage.js';
import { RevenuePage } from '../pages/revenuePage.js';
import { TeamMembersPage } from '../pages/teamMembers.js';
import { TicketingDashboardPage } from '../pages/ticketingDashboardPage.js';
import { TicketingPage } from '../pages/ticketingPage.js';
import { TicketsPage } from '../pages/ticketingTicketsPage.js';
import { TransactionsPage } from '../pages/ticketingTransactionsPage.js';
import { TrendsPage } from '../pages/ticketingTrendsPage.js';
import { TestHelpers } from '../tests/utils/test-helpers.js';

const filename = fileURLToPath(import.meta.url);
dotenv.config({ path: path.resolve(path.dirname(filename), '../.env') });

export const test = base.extend({
    loginPage: async ({ page }, use) => use(new LoginPage(page)),
    dashboardPage: async ({ page }, use) => use(new DashboardPage(page)),
    budgetingPage: async ({ page }, use) => use(new BudgetingPage(page)),
    helpers: async ({ page }, use) => use(new TestHelpers(page)),
    teamMembersPage: async ({ page }, use) => use(new TeamMembersPage(page)),
    ticketingPage: async ({ page }, use) => use(new TicketingPage(page)),
    ticketingDashboardPage: async ({ page }, use) => use(new TicketingDashboardPage(page)),
    ticketsPage: async ({ page }, use) => use(new TicketsPage(page)),
    transactionsPage: async ({ page }, use) => use(new TransactionsPage(page)),
    trendsPage: async ({ page }, use) => use(new TrendsPage(page)),
    revenuePage: async ({ page }, use) => use(new RevenuePage(page)),
    purchasingPage: async ({ page }, use) => use(new PurchasingPage(page)),
    eventSettingsPage: async ({ page }, use) => use(new EventSettingsPage(page)),
    approvalsPage: async ({ page }, use) => use(new ApprovalsPage(page)),
    newEventCreationPage: async ({ page }, use) => use(new newEventCreation(page)),
});

export { expect } from '@playwright/test';
