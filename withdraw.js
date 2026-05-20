const { firefox } = require('playwright');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { getRandomFingerprint, applyAntiFingerprint } = require('./fingerprint');

const TIMEOUT = 35000;
const WAIT_HOURS = 25;
const HISTORY_FILE = 'withdraw_history.json';
const TRANSACTIONS_FILE = 'transactions.json';
const CONFIG_FILE = 'config.json';
const ACCOUNT_FILE = 'account.txt';
const WORKING_PROXIES_FILE = 'working_proxies.txt';

function getConfig() {
    if (!fs.existsSync(CONFIG_FILE)) return { ltc_address: 'LSv2G3oTAVZGENN12LcTSR6X9WXovpPQrG' };
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
}

async function humanDelay(page, min = 1000, max = 2000) {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    await page.waitForTimeout(delay);
}

async function safeClick(page, locator) {
    await locator.waitFor({ state: 'visible', timeout: TIMEOUT });
    await locator.scrollIntoViewIfNeeded();
    await humanDelay(page, 500, 1000);
    await locator.click();
}

async function clearOverlay(page) {
    const acceptBtn = page.getByRole('button', { name: /ACCEPT/i });
    if (await acceptBtn.count() > 0) {
        console.log('[INFO] Clearing notification overlay...');
        await acceptBtn.click({ force: true }).catch(() => {});
        await humanDelay(page, 1000, 2000);
    }
}

function cleanupScreenshots(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const now = Date.now();
    const files = fs.readdirSync(dir);
    for (const file of files) {
        if (file.endsWith('.png')) {
            const filePath = path.join(dir, file);
            const stats = fs.statSync(filePath);
            if (now - stats.mtimeMs > 20 * 60 * 1000) {
                fs.unlinkSync(filePath);
                console.log(`[INFO] Deleted old screenshot: ${file}`);
            }
        }
    }
}

async function safeFill(page, locator, text) {
    await locator.waitFor({ state: 'visible', timeout: TIMEOUT });
    await locator.scrollIntoViewIfNeeded();
    await locator.click();
    await humanDelay(page, 200, 500);
    for (const char of text) {
        await locator.press(char, { delay: Math.floor(Math.random() * 100) + 50 });
    }
}

function getHistory() {
    if (!fs.existsSync(HISTORY_FILE)) return {};
    try {
        return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
    } catch (e) {
        return {};
    }
}

function saveHistory(history) {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
}

function runProxyPipeline() {
    console.log('[WARNING] ⚠️ ALL PROXIES EXHAUSTED! Launching self-healing proxy scraper and verifier pipeline...');
    try {
        console.log('[INFO] 1/3 Spawning proxy_scraper.js...');
        execSync('node proxy_scraper.js', { stdio: 'inherit' });
        console.log('[INFO] 2/3 Spawning proxy_verifier.js...');
        execSync('node proxy_verifier.js', { stdio: 'inherit' });
        console.log('[INFO] 3/3 Spawning clean_working_proxies.js...');
        execSync('node clean_working_proxies.js', { stdio: 'inherit' });
        console.log('[SUCCESS] Proxy pipeline successfully refreshed working_proxies.txt!');
    } catch (e) {
        console.error('[ERROR] Self-healing proxy pipeline failed:', e.message);
    }
}

function updateAccountProxyInFile(email, newProxy) {
    if (!fs.existsSync(ACCOUNT_FILE)) return;
    const lines = fs.readFileSync(ACCOUNT_FILE, 'utf-8').split('\n');
    const updatedLines = lines.map(line => {
        const parts = line.split(':');
        if (parts[0] && parts[0].trim() === email.trim()) {
            return `${parts[0]}:${parts[1]}:${newProxy}`;
        }
        return line;
    });
    fs.writeFileSync(ACCOUNT_FILE, updatedLines.join('\n'));
    console.log(`[INFO] Synchronized account.txt -> Assigned new proxy for ${email}: ${newProxy}`);
}

async function performWithdrawalFlow(page, email) {
    console.log('[INFO] Navigating to home page...');
    await page.goto('https://ltcminer.com', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await page.waitForLoadState('networkidle').catch(() => {});
    await humanDelay(page, 2000, 4000);
    await clearOverlay(page);

    console.log('[INFO] Opening Login modal...');
    const loginBtn = page.getByText('Log In').first();
    await loginBtn.click({ force: true });
    await humanDelay(page, 2000, 4000);

    if (await page.locator('input[type="text"]').count() === 0) {
        console.log('[INFO] Modal didn\'t open, trying direct /login...');
        await page.goto('https://ltcminer.com/login', { waitUntil: 'domcontentloaded' }).catch(() => {});
        await clearOverlay(page);
    }

    const emailInput = page.locator('input[type="text"], input[placeholder*="Email" i]').first();
    const passInput = page.locator('input[type="password"]').first();

    const parts = fs.readFileSync(ACCOUNT_FILE, 'utf-8').split('\n').find(l => l.startsWith(email)).split(':');
    const password = parts[1];

    await safeFill(page, emailInput, email);
    await safeFill(page, passInput, password);

    const submitBtn = page.locator('button').filter({ hasText: /^Log In$/i }).last();
    await safeClick(page, submitBtn);

    await page.waitForLoadState('networkidle');
    await humanDelay(page, 3000, 5000);

    if (page.url().includes('login') || (await page.locator('button').filter({ hasText: /^Log In$/i }).count() > 1)) {
         throw new Error("Login failed - credentials or Turnstile blocking");
    }

    console.log('[INFO] Navigating to Dashboard...');
    await page.goto('https://ltcminer.com/dashboard', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await page.waitForLoadState('networkidle').catch(() => {});
    await humanDelay(page, 3000, 5000);
    await clearOverlay(page);

    const withdrawBtn = page.getByRole('button', { name: /WITHDRAW/i }).first();
    await safeClick(page, withdrawBtn);
    await humanDelay(page, 2000, 3000);

    const maxBtn = page.getByRole('button', { name: /MAX/i }).first();
    await safeClick(page, maxBtn);
    await humanDelay(page, 1000, 1500);

    const addressInput = page.locator('input[placeholder*="LTC Destination Address"]').first();
    await safeFill(page, addressInput, getConfig().ltc_address);

    console.log('[INFO] Confirming Withdrawal...');
    const confirmBtn = page.getByRole('button', { name: /CONFIRM WITHDRAWAL/i }).first();
    await safeClick(page, confirmBtn);

    await page.waitForLoadState('networkidle');
    await humanDelay(page, 3000, 5000);
    
    const amountText = await page.locator('input').first().inputValue().catch(() => "0.0001");
    return parseFloat(amountText) || 0.0001;
}

async function processAccount(email, password, assignedProxy) {
    cleanupScreenshots('screenshots/withdraw');
    console.log(`\n[INFO] --- PROCESSING: ${email} ---`);
    
    const history = getHistory();
    const lastWithdraw = history[email] ? new Date(history[email]) : null;
    const now = new Date();

    if (lastWithdraw) {
        const diffMs = now - lastWithdraw;
        const diffHours = diffMs / (1000 * 60 * 60);
        if (diffHours < WAIT_HOURS) {
            console.log(`[INFO] Skipped: ${email}. Last withdrawal was ${diffHours.toFixed(1)}h ago. Need ${WAIT_HOURS}h.`);
            return false;
        }
    }

    console.log(`[INFO] Withdrawal DUE for ${email}. Starting...`);

    // Build the proxy candidate list starting with the assigned proxy
    let proxyCandidates = [];
    if (assignedProxy && assignedProxy !== 'DIRECT') {
        proxyCandidates.push(assignedProxy);
    }

    // Load available working proxies
    if (fs.existsSync(WORKING_PROXIES_FILE)) {
        const workingList = fs.readFileSync(WORKING_PROXIES_FILE, 'utf-8').split('\n').map(p => p.trim()).filter(p => p && p !== assignedProxy);
        proxyCandidates = proxyCandidates.concat(workingList);
    }

    let success = false;
    let proxyIndex = 0;

    while (!success) {
        // Self-heal pipeline if candidates are exhausted
        if (proxyIndex >= proxyCandidates.length) {
            runProxyPipeline();
            if (fs.existsSync(WORKING_PROXIES_FILE)) {
                proxyCandidates = fs.readFileSync(WORKING_PROXIES_FILE, 'utf-8').split('\n').map(p => p.trim()).filter(p => p);
                proxyIndex = 0;
            }
            if (proxyCandidates.length === 0) {
                console.error('[ERROR] Proxy self-healing failed to yield working proxies. Skipping account.');
                return false;
            }
        }

        const selectedProxy = proxyCandidates[proxyIndex];
        console.log(`[INFO] Attempting withdrawal using proxy Candidate [${proxyIndex + 1}/${proxyCandidates.length}]: ${selectedProxy}`);

        let launchOptions = { headless: true };
        if (selectedProxy && selectedProxy !== 'DIRECT') {
            launchOptions.proxy = { server: selectedProxy };
        }

        let browser;
        try {
            browser = await firefox.launch(launchOptions);
            const fp = getRandomFingerprint();
            const context = await browser.newContext({
                viewport: fp.viewport,
                userAgent: fp.userAgent,
                locale: fp.locale,
                timezoneId: fp.timezoneId
            });

            await applyAntiFingerprint(context, fp);
            const page = await context.newPage();

            const amount = await performWithdrawalFlow(page, email);

            // Log transaction on success
            const transaction = {
                email,
                timestamp: new Date().toISOString(),
                amount,
                proxy: selectedProxy || 'Direct'
            };
            
            let txs = [];
            if (fs.existsSync(TRANSACTIONS_FILE)) {
                try { txs = JSON.parse(fs.readFileSync(TRANSACTIONS_FILE, 'utf-8')); } catch(e) {}
            }
            txs.push(transaction);
            fs.writeFileSync(TRANSACTIONS_FILE, JSON.stringify(txs, null, 2));

            console.log(`[SUCCESS] Withdrawal completed successfully for ${email}!`);
            
            // Save to account history
            history[email] = new Date().toISOString();
            saveHistory(history);

            // Update assigned proxy in DB if it was changed
            if (selectedProxy !== assignedProxy) {
                updateAccountProxyInFile(email, selectedProxy);
            }

            success = true;
            return true;

        } catch (e) {
            console.error(`[WARN] Candidate proxy [${selectedProxy}] failed: ${e.message}`);
            proxyIndex++; // Move to next candidate proxy
        } finally {
            if (browser) await browser.close().catch(() => {});
        }
    }
}

(async () => {
    if (!fs.existsSync(ACCOUNT_FILE)) {
        console.log('[ERROR] account.txt not found.');
        return;
    }

    const lines = fs.readFileSync(ACCOUNT_FILE, 'utf-8').split('\n').filter(l => l.trim());
    console.log(`[INFO] Checking ${lines.length} accounts for due withdrawals...`);

    for (const line of lines) {
        const parts = line.split(':');
        const email = parts[0];
        const password = parts[1];
        const assignedProxy = parts.slice(2).join(':').trim();
        
        if (email && password) {
            await processAccount(email.trim(), password.trim(), assignedProxy);
        }
    }

    console.log(`[INFO] Run finished.`);
    process.exit(0);
})();
