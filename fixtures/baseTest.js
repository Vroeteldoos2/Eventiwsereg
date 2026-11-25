

import { test as base } from '@playwright/test';
import { LoginPage } from '../pages/loginPage.js';
import { DashboardPage } from '../pages/dashboardPage.js';
import { BudgetingPage } from '../pages/budgetingPage.js';
import { TestHelpers } from '../tests/utils/test-helpers.js';
import { TeamMembersPage } from '../pages/teamMembers.js';
import { TicketingPage } from '../pages/ticketingPage.js';
import { RevenuePage } from '../pages/revenuePage.js';
import { PurchasingPage } from '../pages/purchasingPage.js';
import { EventSettingsPage } from '../pages/eventSettingsPage.js';



// 1. Load .env at the very top of the fixture file

// --- ES MODULE FIX ---
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// These two lines recreate __dirname for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// This points to the .env in your root folder
dotenv.config({ path: path.resolve(__dirname, '../.env') });


export const test = base.extend({
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },

  dashboardPage: async ({ page }, use) => {
    await use(new DashboardPage(page));
  },

  // This fixture provides the Budgeting Module page object to the tests

    budgetingPage: async ({ page }, use) => {
    await use(new BudgetingPage(page));
  },
  
// Define 'helpers' as a fixture
    helpers: async ({ page }, use) => {
        const helpers = new TestHelpers(page);
        await use(helpers);
    },

    teamMembersPage: async ({ page }, use) => {
        await use(new TeamMembersPage(page));
    },

    ticketingPage: async ({ page }, use) => {
        await use(new TicketingPage(page));
    },

    revenuePage: async ({ page }, use) => {
        await use(new RevenuePage(page));
    },

    purchasingPage: async ({ page }, use) => {
        await use(new PurchasingPage(page));
    },

    eventSettingsPage: async ({ page }, use) => {
        await use(new EventSettingsPage(page));
    },

});

export { expect } from '@playwright/test';

// export expect so tests can use the same one
// export const expect = baseExpect;












