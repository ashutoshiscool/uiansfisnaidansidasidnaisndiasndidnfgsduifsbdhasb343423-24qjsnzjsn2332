const { firefox, chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { getRandomFingerprint, applyAntiFingerprint } = require('./fingerprint');

const TIMEOUT = 30000;
const WAIT_HOURS = 25;
const HISTORY_FILE = 'withdraw_history.json';
const TRANSACTIONS_FILE = 'transactions.json';
const CONFIG_FILE = 'config.json';
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
    try {
        await locator.click({ timeout: 5000 });
    } catch(e) {
        await locator.click({ force: true, timeout: 5000 });
    }
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
        await locator.press(char, { delay: Math.floor(Math.random() * 50) + 10 });
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

function getWorkingProxies() {
    if (!fs.existsSync(WORKING_PROXIES_FILE)) return [];
    return fs.readFileSync(WORKING_PROXIES_FILE, 'utf-8').split('\n').map(p => p.trim()).filter(p => p);
}

function scrapeFreshProxies() {
    console.log('[WARNING] Proxies depleted or failing! Automatically scraping and verifying fresh proxies...');
    try {
        console.log('[INFO] Running proxy_scraper.js...');
        execSync('node proxy_scraper.js', { stdio: 'inherit' });
        console.log('[INFO] Running proxy_verifier.js (FAST MODE)...');
        execSync('node proxy_verifier.js', { stdio: 'inherit' });
        console.log('[SUCCESS] Proxy scraping and verification completed.');
    } catch (e) {
        console.error('[ERROR] Failed to scrape fresh proxies automatically:', e.message);
    }
}

// ==========================================
// SMS24.ME AUTOMATION LOGIC
// ==========================================
async function getSms24Number(browser) {
    const page = await browser.newPage();
    console.log('[INFO] [SMS] Visiting sms24.me to get a Netherlands number...');
    await page.goto('https://sms24.me/en/countries/nl', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await humanDelay(page, 2000, 3000);
    
    const numberLinks = page.locator('a[href*="/en/numbers/"]');
    await numberLinks.first().waitFor({ state: 'visible', timeout: TIMEOUT });
    
    const count = await numberLinks.count();
    if (count === 0) throw new Error("No numbers found on sms24.me");
    
    // Pick a number from the top 5
    const randomIndex = Math.floor(Math.random() * Math.min(count, 5));
    const targetLink = numberLinks.nth(randomIndex);
    
    const href = await targetLink.getAttribute('href');
    const numberUrl = 'https://sms24.me' + href;
    
    // Go to the number's message page
    await page.goto(numberUrl, { waitUntil: 'domcontentloaded' });
    await humanDelay(page, 2000, 3000);
    
    // The number is typically in an h1 or breadcrumb, but we can extract it from URL
    const urlParts = numberUrl.split('/');
    let number = urlParts[urlParts.length - 1];
    
    // It might be formatted, e.g. 3197010260270, ensure it starts with + for standard input if needed
    if (!number.startsWith('+')) number = '+' + number;
    
    console.log(`[INFO] [SMS] Selected Number: ${number} | Page: ${numberUrl}`);
    return { number, numberUrl, smsPage: page };
}

async function waitForOtp(smsPage, numberUrl) {
    console.log('[INFO] [SMS] Waiting 20 seconds for LTCminer SMS to arrive...');
    await humanDelay(smsPage, 20000, 22000);
    
    for (let attempt = 1; attempt <= 3; attempt++) {
        console.log(`[INFO] [SMS] Refreshing SMS page (Attempt ${attempt}/3)...`);
        await smsPage.goto(numberUrl, { waitUntil: 'domcontentloaded' });
        await humanDelay(smsPage, 3000, 5000);
        
        const bodyText = await smsPage.evaluate(() => document.body.innerText);
        
        // Look for: "XXXXXX is your LTCMiner verification code."
        const match = bodyText.match(/(\d{4,6})\s+is your LTCMiner/i) || 
                      bodyText.match(/LTCMiner.*?(\d{4,6})/i);
                      
        if (match && match[1]) {
            console.log(`[SUCCESS] [SMS] Extracted OTP: ${match[1]}`);
            return match[1];
        }
        console.log('[INFO] [SMS] OTP not found yet, waiting 10 more seconds...');
        await humanDelay(smsPage, 10000, 12000);
    }
    return null;
}

// ==========================================
// MAIN PROCESSING LOGIC
// ==========================================
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
            return 'skipped';
        }
    }

    console.log(`[INFO] Withdrawal DUE for ${email}. Starting...`);

    // Setup Proxy
    let proxies = getWorkingProxies();
    let currentProxy = assignedProxy;
    
    // If assigned proxy is dead or not provided, pick random from working proxies
    if (!currentProxy || !currentProxy.includes(':')) {
        if (proxies.length === 0) return 'no_proxies';
        currentProxy = proxies[Math.floor(Math.random() * proxies.length)];
    }
    
    console.log(`[INFO] Using Proxy: ${currentProxy}`);

    let launchOptions = { headless: true };
    if (currentProxy) {
        launchOptions.proxy = { server: currentProxy };
    }

    const browser = await firefox.launch(launchOptions);
    const fp = getRandomFingerprint();
    const context = await browser.newContext({
        viewport: fp.viewport,
        userAgent: fp.userAgent,
        locale: fp.locale,
        timezoneId: fp.timezoneId
    });

    await applyAntiFingerprint(context, fp);
    const page = await context.newPage();

    try {
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
            await page.goto('https://ltcminer.com/login', { waitUntil: 'domcontentloaded' }).catch(() => {});
            await clearOverlay(page);
        }

        const emailInput = page.locator('input[type="text"], input[placeholder*="Email" i]').first();
        const passInput = page.locator('input[type="password"]').first();

        await safeFill(page, emailInput, email);
        await safeFill(page, passInput, password);

        const submitBtn = page.locator('button').filter({ hasText: /^Log In$/i }).last();
        await safeClick(page, submitBtn);

        await page.waitForLoadState('networkidle');
        await humanDelay(page, 3000, 5000);

        if (page.url().includes('login') || (await page.locator('button').filter({ hasText: /^Log In$/i }).count() > 1)) {
             await page.screenshot({ path: `screenshots/withdraw/login_failed_${email.split('@')[0]}.png` });
             console.log("[ERROR] Login failed - still on login page. IP might be flagged.");
             return 'proxy_fail';
        }

        console.log('[INFO] Navigating to Dashboard...');
        await page.goto('https://ltcminer.com/dashboard', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
        await page.waitForLoadState('networkidle').catch(() => {});
        await humanDelay(page, 3000, 5000);
        await clearOverlay(page);

        // Check for restrictions
        const bodyText = await page.evaluate(() => document.body ? document.body.innerText.toUpperCase() : '');
        if (bodyText.includes('RESTRICTION') || bodyText.includes('BANNED') || bodyText.includes('VERIFY')) {
             console.log('[WARNING] ⚠️ ACCOUNT RESTRICTION DETECTED. Trying to bypass or verify...');
             await page.screenshot({ path: `screenshots/withdraw/restricted_${email.split('@')[0]}.png` });
             
             // Check if it's the Phone Verification screen
             const phoneInput = page.locator('input').filter({ has: page.locator('xpath=..').locator('text=+') }).first().or(page.locator('input[placeholder*="000"]')).first();
             if (await phoneInput.count() > 0 || bodyText.includes('PHONE NUMBER')) {
                 console.log('[INFO] Phone verification required! Initiating sms24.me automation...');
                 
                 // 1. Pick Country (Netherlands)
                 try {
                     const select = page.locator('select').first();
                     if (await select.count() > 0) {
                         await select.selectOption({ label: 'Netherlands' });
                     } else {
                         const trigger = page.locator('button, [role="combobox"]').filter({ hasText: /Country/i }).first();
                         await trigger.click({ force: true });
                         await humanDelay(page, 500, 1000);
                         await page.getByText('Netherlands', { exact: true }).first().click();
                     }
                 } catch(e) {}
                 
                 const continueBtn1 = page.getByRole('button', { name: /CONTINUE/i }).first();
                 await safeClick(page, continueBtn1).catch(() => {});
                 await humanDelay(page, 1000, 2000);
                 
                 // 2. Get SMS Number from sms24.me
                 let smsData;
                 try {
                     // We launch a fresh direct browser for SMS24 to avoid proxy blocks
                     const smsBrowser = await chromium.launch({ headless: true });
                     smsData = await getSms24Number(smsBrowser);
                 } catch(e) {
                     console.log('[ERROR] Failed to get number from sms24.me:', e.message);
                     return 'fail';
                 }
                 
                 // 3. Enter number
                 await safeFill(page, phoneInput, smsData.number);
                 const sendCodeBtn = page.getByRole('button', { name: /SEND CODE|CONTINUE/i }).last();
                 await safeClick(page, sendCodeBtn);
                 await humanDelay(page, 3000, 5000);
                 
                 // 4. Wait for OTP
                 const otp = await waitForOtp(smsData.smsPage, smsData.numberUrl);
                 await smsData.smsPage.context().browser().close().catch(()=>{}); // Close SMS browser
                 
                 if (!otp) {
                     console.log('[ERROR] OTP did not arrive in time.');
                     return 'fail';
                 }
                 
                 // 5. Enter OTP
                 const otpInput = page.locator('input[type="text"]').last();
                 await safeFill(page, otpInput, otp);
                 await safeClick(page, page.getByRole('button', { name: /CONTINUE|VERIFY/i }).last());
                 await humanDelay(page, 5000, 8000);
                 console.log('[SUCCESS] Phone verified!');
                 
                 // Proceed to withdraw
                 await page.goto('https://ltcminer.com/dashboard', { waitUntil: 'domcontentloaded' });
                 await humanDelay(page, 3000, 5000);
             } else {
                 return 'restricted'; // Hard restricted
             }
        }

        console.log('[INFO] Initiating Withdrawal...');
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
        const transaction = {
            email,
            timestamp: new Date().toISOString(),
            amount: parseFloat(amountText) || 0.0001,
            proxy: currentProxy
        };
        
        let txs = [];
        if (fs.existsSync(TRANSACTIONS_FILE)) {
            try { txs = JSON.parse(fs.readFileSync(TRANSACTIONS_FILE, 'utf-8')); } catch(e) {}
        }
        txs.push(transaction);
        fs.writeFileSync(TRANSACTIONS_FILE, JSON.stringify(txs, null, 2));

        console.log(`[SUCCESS] Withdrawal completed for ${email}!`);
        
        history[email] = new Date().toISOString();
        saveHistory(history);
        return 'success';

    } catch (e) {
        if (e.message.includes('Timeout') || e.message.includes('ERR_')) {
            console.error(`[ERROR] Network error for ${email}: ${e.message}. Will flag proxy.`);
            return 'proxy_fail';
        }
        console.error(`[ERROR] ${email} failed: ${e.message}`);
        await page.screenshot({ path: `screenshots/withdraw/error_withdraw_${email.split('@')[0]}.png` }).catch(() => {});
        return 'fail';
    } finally {
        await browser.close().catch(()=>{});
    }
}

(async () => {
    if (!fs.existsSync('account.txt')) {
        console.log('[ERROR] account.txt not found.');
        return;
    }

    const lines = fs.readFileSync('account.txt', 'utf-8').split('\n').filter(l => l.trim());
    console.log(`[INFO] Checking ${lines.length} accounts for due withdrawals...`);

    for (let i = 0; i < lines.length; i++) {
        const parts = lines[i].split(':');
        const email = parts[0]?.trim();
        const password = parts[1]?.trim();
        const assignedProxy = parts.slice(2).join(':').trim(); // Assigned proxy if it exists
        
        if (email && password) {
            let status = await processAccount(email, password, assignedProxy);
            
            // Auto Fallback logic
            if (status === 'proxy_fail' || status === 'no_proxies') {
                console.log(`[WARN] Proxy failed for ${email}. Triggering automatic proxy scrape and retry...`);
                scrapeFreshProxies();
                
                // Retry once with fresh proxies
                console.log(`[INFO] Retrying ${email} with fresh proxies...`);
                status = await processAccount(email, password, null);
                if (status === 'proxy_fail') {
                    console.log(`[ERROR] Second attempt failed for ${email}. Skipping to next account.`);
                }
            }
        }
    }

    console.log(`[INFO] Run finished.`);
    process.exit(0);
})();
