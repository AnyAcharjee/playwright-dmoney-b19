import { test, expect, Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const API_URL = 'http://localhost:5000';
const AUTH_FILE = 'auth.json';
const OUTPUT_DIR = 'output';
const AMOUNT = '2000';

// unique suffix so re-runs don't collide on email/phone/nid
const suffix = String(Date.now()).slice(-6);
const agent = {
  name: 'Wallace Block Any',
  email: `anyacharjee+${suffix}@gmail.com`,
  password: '1234',
  phone_number: `01840${suffix}`,
  nid: `9876${suffix}`,
  role: 'Agent',
};

// phone number of the registered agent, reused for the SYSTEM deposit
let agentPhone = '';

const CUSTOMER = '01686606902';
const CASH_IN_AMOUNT = 500;
const OTP = '0000';

// local date as YYYY-MM-DD
const now = new Date();
const today = [
  now.getFullYear(),
  String(now.getMonth() + 1).padStart(2, '0'),
  String(now.getDate()).padStart(2, '0'),
].join('-');
const CSV_FILE = path.join(OUTPUT_DIR, `self_statement_${today}.csv`);

const toNumber = (text: string) => Number(text.replace(/[^0-9.-]/g, ''));

// header balance is hidden behind a "Balance" button until clicked
async function readHeaderBalance(page: Page) {
  const toggle = page.locator('header').getByRole('button', { name: /balance|৳/i });
  if (/^\s*balance\s*$/i.test((await toggle.innerText()).trim())) {
    await toggle.click();
  }
  await expect(toggle).toContainText('৳');
  return toNumber(await toggle.innerText());
}

const csvCell = (value: string) => `"${value.replace(/"/g, '""')}"`;

let startBalance = 0;
let balanceAfter = 0;
let statementHeaders: string[] = [];
let statementRows: string[][] = [];

test.describe.configure({ mode: 'serial' });

test.describe('Register agent, Admin activates, SYSTEM pays', () => {
  test('register a new agent', async ({ request }) => {
    const response = await request.post(`${API_URL}/user/register`, {
      headers: { 'Content-Type': 'application/json' },
      data: agent,
    });

    const body = await response.json();
    console.log(response.status(), JSON.stringify(body, null, 2));

    expect(response.ok()).toBeTruthy();
    agentPhone = agent.phone_number;

  });

  test('login as Admin and save session', async ({ browser }) => {
    // start clean: ignore any previously stored session
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();

    await page.goto('/');
    await page.getByRole('link', { name: 'Login' }).first().click();
    await expect(page).toHaveURL(/\/login/);

    await page.getByPlaceholder('Enter email or phone number').fill('admin@dmoney.com');
    await page.locator('input[type="password"]').fill('1234');
    await page.locator('input[type="password"]').press('Enter');

    // Verify Admin login is successful
    await expect(page).toHaveURL(/\/profile/);
    await expect(page.getByText('Admin Dashboard')).toBeVisible();

    await context.storageState({ path: AUTH_FILE });
    await context.close();
  });

  test('filter new agent, activate, verify and logout', async ({ page }) => {
    await page.goto('/profile');
    await page.getByRole('link', { name: 'User List' }).first().click();
    await expect(page).toHaveURL(/\/admin\/users/);

    // Filter the newly created agent by email
    await page.getByRole('combobox').first().click();
    await page.getByRole('option', { name: 'Search by Email' }).click();
    await page.getByRole('textbox').first().fill(agent.email);
    await page.keyboard.press('Enter');

    // Verify the new Agent appears in the Admin user list, as the 1st row
    const firstRow = page.locator('tbody tr').first();
    await expect(firstRow).toContainText(agent.email);
    await expect(firstRow).toContainText('Agent');

    // Verify the new Agent is initially inactive
    await expect(firstRow).toContainText(/pending/i);

    // Activate the agent: VIEW -> Edit User -> Status = Active -> Save
    await firstRow.getByRole('button', { name: 'VIEW' }).click();
    await expect(page).toHaveURL(/\/admin\/users\/\d+/);
    await page.getByRole('button', { name: 'Edit User' }).click();
    await page.getByRole('combobox').filter({ hasText: 'Pending' }).click();
    await page.getByRole('option', { name: 'Active', exact: true }).click();
    await page.getByRole('button', { name: 'Save Changes' }).click();

    // Verify Admin can activate the Agent
    await expect(page.getByText('ACTIVE', { exact: true })).toBeVisible();

    // Verify the Agent remains active after page reload
    await page.reload();
    await expect(page.getByText('ACTIVE', { exact: true })).toBeVisible();

    // Back in the list, the 1st filtered row is the Agent and is active
    await page.getByRole('button', { name: 'Back to User List' }).click();
    await page.getByRole('combobox').first().click();
    await page.getByRole('option', { name: 'Search by Email' }).click();
    await page.getByRole('textbox').first().fill(agent.email);
    await page.keyboard.press('Enter');
    const row = page.locator('tbody tr').first();
    await expect(row).toContainText(agent.email);
    await expect(row.locator('td').nth(5)).toHaveText('Agent');
    await expect(row).toContainText(/active/i);

    // Logout admin
    await page.locator('header').getByText('Admin', { exact: true }).first().click();
    await page.getByText(/log ?out|sign ?out/i).click();
    await expect(page).toHaveURL(/\/login|\/$/);
  });

  test('login as System and save session', async ({ browser }) => {
    // start clean: ignore any previously stored session
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();

    await page.goto('/');
    await page.getByRole('link', { name: 'Login' }).first().click();
    await expect(page).toHaveURL(/\/login/);

    await page.getByPlaceholder('Enter email or phone number').fill('SYSTEM');
    await page.locator('input[type="password"]').fill('1234');
    await page.locator('input[type="password"]').press('Enter');

    // Verify System login is successful
    await expect(page).toHaveURL(/\/profile/);
    await expect(page.getByText('ACTIVE', { exact: true })).toBeVisible();

    await context.storageState({ path: AUTH_FILE });
    await context.close();
  });

  test('SYSTEM deposits 2000 Tk to the new agent via API', async ({ request }) => {
    // fresh token: the JWT expires after 1h, so don't hardcode one
    const loginRes = await request.post(`${API_URL}/user/login`, {
      headers: { 'Content-Type': 'application/json' },
      data: { email: 'SYSTEM', password: '1234' },
    });
    expect(loginRes.ok()).toBeTruthy();
    const { token } = await loginRes.json();

    const response = await request.post(`${API_URL}/transaction/deposit`, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-AUTH-SECRET-KEY': 'ROADTOSDET',
      },
      data: {
        from_account: 'SYSTEM',
        to_account: agentPhone,
        amount: Number(AMOUNT),
      },
    });

    const body = await response.json();
    console.log(response.status(), JSON.stringify(body, null, 2));

    expect(response.ok()).toBeTruthy();
  });
});

test.describe('Agent cash in, Self Statement CSV, logout', () => {
  test('login as agent with OTP and save session', async ({ browser }) => {
    // start clean: ignore any previously stored session
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();

    await page.goto('/login?env=dev');
    await page.getByPlaceholder('Enter email or phone number').fill(agent.phone_number);
    await page.locator('input[type="password"]').fill(agent.password);
    await page.getByRole('button', { name: /^Login/ }).click();

    await page.getByPlaceholder('• • • •').fill(OTP);
    await page.getByRole('button', { name: /Verify OTP/ }).click();

    await expect(page).toHaveURL(/\/profile/);
    await expect(page.getByText('Agent Dashboard')).toBeVisible();

    await context.storageState({ path: AUTH_FILE });
    await context.close();
  });

  test('agent cashes in 500 Tk to an existing customer and balance updates', async ({ page }) => {
    await page.goto('/profile');
    startBalance = await readHeaderBalance(page);

    await page.getByRole('link', { name: 'Cash In' }).first().click();
    await expect(page).toHaveURL(/\/agent\/cash-in/);

    await page.getByPlaceholder("Enter customer's phone number").fill(CUSTOMER);
    await page.getByPlaceholder('Enter amount in BDT').fill(String(CASH_IN_AMOUNT));
    await page.getByRole('button', { name: /Cash In →/ }).click();

    await expect(page.getByText('Deposit successful')).toBeVisible();
    await expect(page.getByText('৳ 500.00').first()).toBeVisible();

    // balance shown on the receipt
    const receiptBalance = page.getByText('CURRENT BALANCE').locator('xpath=following-sibling::*[1]');
    balanceAfter = toNumber(await receiptBalance.innerText());

    // agent pays out 500 and earns a commission, so the balance must be below start and above start - 500
    expect(balanceAfter).toBeLessThan(startBalance);
    expect(balanceAfter).toBeGreaterThan(startBalance - CASH_IN_AMOUNT);
  });

  test('Self Statement has the cash in, saved to CSV', async ({ page }) => {
    await page.goto('/agent/self-statement');
    await expect(page.locator('tbody tr').first()).toBeVisible();

    // collect every page of the table
    statementHeaders = (await page.locator('thead th').allInnerTexts()).map((t) => t.trim());
    const nextPage = page.getByRole('button', { name: /next page/i });
    while (true) {
      const pageRows = await page.locator('tbody tr').evaluateAll((trs) =>
        trs.map((tr) =>
          Array.from(tr.querySelectorAll('td')).map((td) => (td as HTMLElement).innerText.trim()),
        ),
      );
      statementRows.push(...pageRows);
      if (!(await nextPage.count()) || !(await nextPage.isEnabled())) break;
      await nextPage.click();
    }

    expect(statementHeaders).toEqual([
      'Transaction ID',
      'Sender Account',
      'Receiver Account',
      'Type',
      'Debit',
      'Credit',
      'Balance',
      'Date',
    ]);

    // the cash in: agent -> customer, 500 debit, commission credit
    const cashIn = statementRows.find(
      (r) => r[1] === agent.phone_number && r[2] === CUSTOMER && toNumber(r[4]) === CASH_IN_AMOUNT,
    );
    expect(cashIn, 'cash in row in Self Statement').toBeDefined();
    const commission = toNumber(cashIn![5]);
    expect(commission).toBeGreaterThan(0);

    // balance is updated correctly: start - 500 + commission, and matches the statement
    expect(balanceAfter).toBeCloseTo(startBalance - CASH_IN_AMOUNT + commission, 2);
    expect(toNumber(cashIn![6])).toBeCloseTo(balanceAfter, 2);
    await expect(page.getByText(`Current Balance: BDT ${balanceAfter.toFixed(2)}`)).toBeVisible();

    // save to CSV
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const csv = [statementHeaders, ...statementRows]
      .map((row) => row.map(csvCell).join(','))
      .join('\r\n');
    fs.writeFileSync(CSV_FILE, csv + '\r\n', 'utf8');

    // verify the CSV file
    expect(fs.existsSync(CSV_FILE)).toBeTruthy();
    const saved = fs.readFileSync(CSV_FILE, 'utf8').trim().split(/\r\n/);
    expect(saved.length).toBe(statementRows.length + 1);
    expect(saved[0]).toBe(statementHeaders.map(csvCell).join(','));
    expect(saved.some((line) => line.includes(cashIn![0]) && line.includes(CUSTOMER))).toBeTruthy();
  });

  test('agent logs out', async ({ page }) => {
    await page.goto('/profile');
    await page.locator('header').getByText('Agent', { exact: true }).first().click();
    await page.getByText(/Logout/).click();

    await expect(page).toHaveURL(/\/login|\/$/);
    await expect(page.getByText('Agent Dashboard')).toHaveCount(0);
  });
});
