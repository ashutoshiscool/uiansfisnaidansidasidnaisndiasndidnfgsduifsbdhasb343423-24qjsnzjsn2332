# LTC Miner Automation & Monitoring Dashboard

An advanced, stealth-oriented, multi-account automated mining, withdrawal, and verification suite for `ltcminer.com`. It features rotating browser fingerprints, public Dutch SMS gate polling for OTP verification, self-healing proxy validation pipelines, and an interactive monitoring dashboard.

---

## Architecture & File Roles

### 🐚 Shell Scripts (`.sh`)
- **[start.sh](file:///root/freeltc/start.sh)**: **System Setup script**. Automates the complete installation of Node.js v20, Playwright browser dependencies, cron jobs, and folder structures on clean Debian/Ubuntu VPS environments.
- **[acc.sh](file:///root/freeltc/acc.sh)**: **Account Addition wizard**. Prompts for account email/password via terminal and invokes `add_account.js` to allocate a fresh proxy from the working list.
- **[email.sh](file:///root/freeltc/email.sh)**: **Alert & Notifications configuration utility**. Configures target recipient emails, triggers Google OAuth2 setup (`setup_gmail.js`), or runs SMTP connectivity tests.
- **[number.sh](file:///root/freeltc/number.sh)**: **Manual verification assistant**. Writes interactive country selections, phone numbers, and manual OTP codes into temporary bridge files for Playwright.

### ⚡ JavaScript Scripts (`.js`)
- **[register.js](file:///root/freeltc/register.js)**: **Automated Registration bot**. Generates clean, randomized credentials, uses rotating proxies, and bypasses Cloudflare/Turnstile. Integrates an automated Dutch SMS gate parser (`sms24.me`) to poll and fetch verification codes dynamically.
- **[withdraw.js](file:///root/freeltc/withdraw.js)**: **Automated Withdrawal engine**. Runs hourly via cron. Cycles through all accounts in `account.txt` to execute withdrawals if the 25-hour timer has elapsed, utilizing stealth browser anti-fingerprinting.
- **[verify_accounts.js](file:///root/freeltc/verify_accounts.js)**: **Account Health auditor**. Periodically logs into all listed accounts to inspect if they have been restricted, restricted by country, or banned, triggering instant email alerts.
- **[add_account.js](file:///root/freeltc/add_account.js)**: Helper to add a new account to `account.txt` while pairing it with an unused proxy.
- **[clean_working_proxies.js](file:///root/freeltc/clean_working_proxies.js)**: De-duplicates proxy entries and filters out bad formatted IPs from `working_proxies.txt`.
- **[proxy_scraper.js](file:///root/freeltc/proxy_scraper.js)**: Scrapes hundreds of free HTTPS/SOCKS proxies from open online providers.
- **[proxy_verifier.js](file:///root/freeltc/proxy_verifier.js)**: Multi-threaded verification pipeline that tests scraped proxies against target domains and writes healthy nodes to `working_proxies.txt`.
- **[fingerprint.js](file:///root/freeltc/fingerprint.js)**: Core stealth library. Patches Playwright contexts to mask canvas, WebGL, screen size, user-agent, hardware concurrency, and device dimensions.
- **[login.js](file:///root/freeltc/login.js)**: Reusable stealth login controller with integrated Turnstile waits.
- **[email_service.js](file:///root/freeltc/email_service.js)**: Reusable alerts module. Supports sending emails through secure Google OAuth2 Gmail API or standard SMTP transporters.
- **[setup_gmail.js](file:///root/freeltc/setup_gmail.js)**: Visual token generator for Gmail API OAuth2 integration.
- **[server.js](file:///root/freeltc/server.js)**: Backend API/Web server powering the live monitoring interface.
- **[dump.js](file:///root/freeltc/dump.js)**: Debugging script to log specific page markup states.
- **[test_buttons.js](file:///root/freeltc/test_buttons.js)** / **[test_click.js](file:///root/freeltc/test_click.js)** / **[test_restriction.js](file:///root/freeltc/test_restriction.js)**: Interactive sandbox automation scripts for verifying CSS selectors and Cloudflare bypass parameters.

---

## Live Monitoring Dashboards

The repository provides two versions of visual dashboards to inspect withdrawal pipelines, histories, and account status logs:

### 1. Simple Web Dashboard (`/dashboard`)
A lightweight, fast, vanilla HTML/CSS/JS dashboard that runs directly on `server.js`.
- **To Start**: Run `node server.js`
- **Port**: Default is `3000` (or as configured in `.env`).

### 2. Next.js Dashboard (`/dashboard-next`)
A modern, rich, premium application built with Next.js, Framer Motion, and Tailwind CSS.
- **Features**: Visual widgets, real-time analytics graphs, filters, and status alerts.
- **To Run**:
  ```bash
  cd dashboard-next
  npm run dev
  ```

---

## Getting Started

### 1. Quick VPS Installation
Set up your host system, dependencies, and automatic background cron jobs with a single command:
```bash
bash start.sh
```

### 2. Add Proxies
Before running registration or actions, scrap and filter your proxy nodes:
```bash
node proxy_scraper.js
node proxy_verifier.js
```
*Successfully verified IPs will be stored in `working_proxies.txt`.*

### 3. Add Accounts
Register new automated accounts:
```bash
node register.js
```
Or manually link your existing pre-registered accounts using the wizard:
```bash
bash acc.sh
```

### 4. Setup Cron Actions
The `start.sh` setup script automatically installs these cron schedules. Verify them with `crontab -l`:
- **Hourly Withdrawal Runs**: `node withdraw.js`
- **Ten-minute Account Integrity Inspections**: `node verify_accounts.js`

---

## 🔒 Security Information & Exclusions

To keep your credentials, payout parameters, and IP routes safe, the following files are strictly excluded from source control (configured in `.gitignore`):
- `account.txt` — Plaintext automated accounts (`email:password:proxy`)
- `config.json` — SMTP configurations, personal emails, and Litecoin payout addresses
- `proxy.txt` & `working_proxies.txt` — Proxy lists
- `transactions.json` & `withdraw_history.json` — Account histories and transaction IDs
- `screenshots/` — Automated browser screenshot dumps
