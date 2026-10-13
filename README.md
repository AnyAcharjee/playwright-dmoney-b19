# playwright-dmoney-b19

End-to-end test automation for the **dMoney** QA practice platform (a mobile-money web app), written with [Playwright](https://playwright.dev) and TypeScript.

The suite runs one business flow from start to finish: it registers a new Agent, has an Admin activate the Agent, funds the Agent from SYSTEM, then logs in as the Agent to cash in to a customer, export the Self Statement to CSV and log out.

## Features

- **Agent registration (API):** `POST /user/register` with unique phone, email and NID on every run, so re-runs don't collide.
- **Admin activation (UI):** Admin logs in, finds the new Agent in User List, changes the status from Pending to Active, verifies it and logs out.
- **SYSTEM funding (API):** SYSTEM logs in and deposits 2000 Tk to the Agent via `POST /transaction/deposit`.
- **Agent login with OTP (UI):** phone and password, then OTP `0000` (dev environment), and the session is saved to `auth.json`.
- **Cash In (UI):** the Agent sends 500 Tk to customer `01686606902`.
- **Balance check:** the new balance must equal start balance − 500 + commission, and match the Self Statement.
- **Self Statement extraction:** every row of the table, across all pages, is read and checked for the cash-in transaction.
- **CSV export:** the statement is saved to `output/self_statement_<YYYY-MM-DD>.csv`, and the file is verified (header, row count, cash-in row).
- **Logout check:** the Agent logs out and is returned to the login or home page.

## Project structure

```
.
├── tests/
│   └── dmoneyapi.spec.ts     # all tests (serial): register -> activate -> fund -> cash in -> statement CSV -> logout
├── playwright.config.ts      # base URL, storageState (auth.json), Firefox project, 1 worker
├── auth.json                 # saved login session (generated, git-ignored)
├── output/                   # generated CSV files (git-ignored)
├── playwright-report/        # HTML report (generated, git-ignored)
└── package.json
```

## Prerequisites

- Node.js 18 or newer and npm
- The dMoney **frontend** running at `http://localhost:3000`
- The dMoney **API** running at `http://localhost:5000`
- Seeded accounts: Admin (`admin@dmoney.com`) and SYSTEM (`SYSTEM`), both with password `1234`
- An existing customer account with phone `01686606902`

## Setup

```bash
git clone https://github.com/AnyAcharjee/playwright-dmoney-b19.git
cd playwright-dmoney-b19
npm install
npx playwright install firefox
```

## Usage

Run the whole suite (headed Firefox, as set in the config):

```bash
npx playwright test
```

Open the HTML report afterwards:

```bash
npx playwright show-report
```

Useful variations:

```bash
npx playwright test --headed=false      # run without a browser window
npx playwright test --debug             # step through with the Playwright Inspector
npx playwright test -g "Self Statement" # run tests whose title matches
```

### Important: the tests depend on each other

The tests run in order inside one serial block. Later tests use the Agent created by the first one, so run the whole file. Running a single later test on its own will fail, because the Agent it needs won't exist yet.

### Output

- `auth.json`: the browser session (cookies and localStorage). Playwright reuses it through `storageState` in the config. The file is overwritten by each login step and holds a live token, so don't commit it.
- `output/self_statement_<date>.csv`: columns are Transaction ID, Sender Account, Receiver Account, Type, Debit, Credit, Balance, Date. Each run overwrites the file for that day.

## Configuration

Settings live in [playwright.config.ts](playwright.config.ts):

| Setting | Value |
| --- | --- |
| `baseURL` | `http://localhost:3000` |
| `storageState` | `auth.json` |
| Browser project | Firefox (Chromium and WebKit are commented out) |
| `workers` | 1 |
| `headless` | `false` |

The API address, test credentials, customer phone and amounts are constants at the top of [tests/dmoneyapi.spec.ts](tests/dmoneyapi.spec.ts).

## Database information

The test suite doesn't connect to a database and has no database configuration. All data is created and read through the dMoney API and UI:

- Test data (Agent name, email, phone, NID) is generated in memory on each run.
- Accounts and transactions are stored by the dMoney backend, whose database is not part of this repository.
- Each run adds a new Agent, a 2000 Tk SYSTEM top-up, and a 500 Tk cash-in to customer `01686606902` (with a commission paid to the Agent). These records stay in the backend after the run, so the customer's balance grows with every run.

If you need to check or reset data directly in the backend database, use the dMoney backend's own setup and credentials.

## Test Report

<img width="1231" height="827" alt="test_report" src="https://github.com/user-attachments/assets/02d01c88-9680-496a-82a5-b300043957b6" />

## Automation Video

https://github.com/user-attachments/assets/bf63c302-e1e6-4535-87de-b415c9da7239



