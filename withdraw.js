const { firefox, chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { getRandomFingerprint, applyAntiFingerprint } = require('./fingerprint');
const { getSms24Number, waitForOtp, markNumberUsed } = require('./number');
const mail = require('./mail');

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

        // Check for hard bans on dashboard
        const dashboardText = await page.evaluate(() => document.body ? document.body.innerText.toUpperCase() : '');
        if (dashboardText.includes('BANNED IMMEDIATELY') || dashboardText.includes('ACCOUNT BANNED') || dashboardText.includes('ACCOUNT RESTRICTIONS DETECTED') || dashboardText.includes('ONLY ONE FREE ACCOUNT IS PERMITTED')) {
            console.log('[WARNING] ⚠️ ACCOUNT BANNED. Removing from account.txt and skipping.');
            try {
                let accounts = fs.readFileSync('account.txt', 'utf-8').split('\n').filter(Boolean);
                accounts = accounts.filter(line => !line.startsWith(email + ':'));
                fs.writeFileSync('account.txt', accounts.join('\n') + '\n');
            } catch(e) {
                console.error('[ERROR] Failed to remove banned account from account.txt:', e.message);
            }
            return 'restricted';
        }

        console.log('[INFO] Initiating Withdrawal...');
        const withdrawBtn = page.getByRole('button', { name: /WITHDRAW/i }).first();
        await safeClick(page, withdrawBtn);
        await humanDelay(page, 2000, 3000);

        // Check if the withdrawal triggered a Phone Verification screen
        const modalText = await page.evaluate(() => {
            const modal = document.querySelector('.modal, [role="dialog"]');
            return modal ? modal.innerText.toUpperCase() : document.body.innerText.toUpperCase();
        });
        
        if (modalText.includes('PHONE VERIFICATION') || modalText.includes('VERIFY YOUR MOBILE NUMBER')) {
             console.log('[INFO] Phone verification required! Initiating sms24.me automation...');
             await page.screenshot({ path: `screenshots/withdraw/verify_triggered_${email.split('@')[0]}.png` }).catch(() => {});
             
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
                 const smsBrowser = await chromium.launch({ headless: true });
                 smsData = await getSms24Number(smsBrowser);
             } catch(e) {
                 console.log('[ERROR] Failed to get number from sms24.me:', e.message);
                 await page.screenshot({ path: `screenshots/withdraw/sms_error_${email.split('@')[0]}.png` }).catch(() => {});
                 return 'fail';
             }
             
             // 3. Enter number
             console.log(`[INFO] Entering formatted number: ${smsData.number}`);
             const phoneInput = page.locator('input[type="tel"], input[placeholder*="phone" i], input').filter({ has: page.locator('xpath=..').locator('text=+') }).first();
             await safeFill(page, phoneInput, smsData.number);
             
             let otp = null;
             let maxResends = 2; // Try initial + 2 resends
             
             for (let attempt = 0; attempt <= maxResends; attempt++) {
                 if (attempt === 0) {
                     console.log('[INFO] Clicking SEND CODE to submit phone number...');
                     await phoneInput.press('Enter'); // Fallback
                     const sendCodeBtn = page.locator('button, a, span, div, input').filter({ hasText: /SEND CODE|CONTINUE|SUBMIT|SEND/i }).last();
                     await safeClick(page, sendCodeBtn).catch(() => {});
                     
                     // Scroll down the page and any modal to reveal RESEND button
                     await humanDelay(page, 2000, 3000);
                     await page.evaluate(() => {
                         const modal = document.querySelector('.modal, [role="dialog"], .modal-body, .modal-content');
                         if (modal) modal.scrollTop = modal.scrollHeight;
                         window.scrollBy(0, 800);
                     });
                     await humanDelay(page, 1000, 2000);
                     
                     // Take a screenshot so we can debug what's on screen
                     await page.screenshot({ path: `screenshots/withdraw/after_send_code_${email.split('@')[0]}.png` }).catch(() => {});
                     
                     // Check for Email Verification required error
                     const modalTextAfterSend = await page.evaluate(() => {
                         const modal = document.querySelector('.modal, [role="dialog"]');
                         return modal ? modal.innerText.toUpperCase() : document.body.innerText.toUpperCase();
                     });
                     
                     if (modalTextAfterSend.includes('PLEASE VERIFY YOUR ACCOUNT') || modalTextAfterSend.includes('EMAIL SENT')) {
                         console.log('[WARNING] ⚠️ ACCOUNT REQUIRES EMAIL VERIFICATION. Removing from account.txt and skipping.');
                         try {
                             let accounts = fs.readFileSync('account.txt', 'utf-8').split('\n').filter(Boolean);
                             accounts = accounts.filter(line => !line.startsWith(email + ':'));
                             fs.writeFileSync('account.txt', accounts.join('\n') + '\n');
                         } catch(e) {
                             console.error('[ERROR] Failed to remove unverified account from account.txt:', e.message);
                         }
                         
                         await smsData.smsPage.context().browser().close().catch(()=>{});
                         return 'restricted';
                     }
                     
                     // Log all buttons on the page for debugging
                     const allButtons = await page.evaluate(() => {
                         const btns = document.querySelectorAll('button, a, span, div, p');
                         return Array.from(btns).map(b => b.innerText.trim()).filter(t => t.length > 0 && t.length < 50);
                     });
                     console.log(`[DEBUG] Buttons on page after SEND CODE: ${JSON.stringify(allButtons.slice(0, 20))}`);
                     
                     console.log(`[INFO] Forcing immediate RESEND click to trigger OTP...`);
                     try {
                         const resendBtn = page.locator('button, a, span, div, p').filter({ hasText: /RESEND/i }).last();
                         await resendBtn.waitFor({ state: 'attached', timeout: 65000 });
                         await resendBtn.scrollIntoViewIfNeeded().catch(()=>{});
                         await resendBtn.click({ force: true });
                         console.log('[INFO] Clicked initial force RESEND.');
                     } catch(e) {
                         console.log('[WARN] Could not find RESEND button during initial force attempt. Error:', e.message.substring(0, 100));
                     }
                 } else {
                     console.log(`[INFO] Clicking RESEND (Attempt ${attempt}/${maxResends})...`);
                     
                     // Scroll down again
                     await page.evaluate(() => {
                         const modal = document.querySelector('.modal, [role="dialog"], .modal-body, .modal-content');
                         if (modal) modal.scrollTop = modal.scrollHeight;
                         window.scrollBy(0, 800);
                     });
                     
                     try {
                         const resendBtn = page.locator('button, a, span, div, p').filter({ hasText: /RESEND/i }).last();
                         await resendBtn.waitFor({ state: 'attached', timeout: 65000 });
                         await resendBtn.scrollIntoViewIfNeeded().catch(()=>{});
                         await resendBtn.click({ force: true });
                         console.log(`[INFO] Successfully clicked RESEND (Attempt ${attempt}).`);
                     } catch(e) {
                         console.log('[WARN] Could not find RESEND button.');
                     }
                 }
                 
                 await humanDelay(page, 3000, 5000);
                 
                 // 4. Wait for OTP
                 otp = await waitForOtp(smsData.smsPage, smsData.numberUrl);
                 
                 if (otp) {
                     break; // Got the OTP!
                 }
                 console.log('[WARN] OTP failed to arrive.');
             }
             
             await smsData.smsPage.context().browser().close().catch(()=>{}); // Close SMS browser
             
             if (!otp) {
                 console.log(`[ERROR] OTP did not arrive after ${maxResends} resends. Marking number as bad.`);
                 markNumberUsed(smsData.fullNumber);
                 await page.screenshot({ path: `screenshots/withdraw/otp_timeout_${email.split('@')[0]}.png` }).catch(() => {});
                 return 'fail';
             }
             
             // Mark number used since it successfully got an OTP for this account
             markNumberUsed(smsData.fullNumber);
             
             // 5. Enter OTP
             const otpInput = page.locator('input[type="text"]').last();
             await safeFill(page, otpInput, otp);
             await safeClick(page, page.getByRole('button', { name: /CONTINUE|VERIFY/i }).last());
             await humanDelay(page, 5000, 8000);
             console.log('[SUCCESS] Phone verified!');
             
             // Proceed to withdraw
             await page.goto('https://ltcminer.com/dashboard', { waitUntil: 'domcontentloaded' });
             await humanDelay(page, 3000, 5000);
             console.log('[INFO] Initiating actual withdrawal after verification...');
             const withdrawBtn2 = page.getByRole('button', { name: /WITHDRAW/i }).first();
             await safeClick(page, withdrawBtn2);
             await humanDelay(page, 2000, 3000);
        }

        console.log('[INFO] Initiating Withdrawal...');
        const withdrawBtnFinal = page.getByRole('button', { name: /WITHDRAW/i }).first();
        await safeClick(page, withdrawBtnFinal);
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
        
        // Update account.txt with the working proxy so it doesn't fail next time
        if (currentProxy !== assignedProxy) {
            try {
                let accounts = fs.readFileSync('account.txt', 'utf-8').split('\n').filter(Boolean);
                const accIndex = accounts.findIndex(line => line.startsWith(email + ':'));
                if (accIndex !== -1) {
                    accounts[accIndex] = `${email}:${password}:${currentProxy}`;
                    fs.writeFileSync('account.txt', accounts.join('\n') + '\n');
                    console.log(`[INFO] Replaced dead proxy with new working proxy in account.txt for ${email}`);
                }
            } catch(e) {
                console.error('[ERROR] Failed to save new proxy to account.txt:', e.message);
            }
        }
        
        history[email] = new Date().toISOString();
        saveHistory(history);
        return 'success';

    } catch (e) {
        if (e.message.includes('Timeout') || e.message.includes('ERR_') || e.message.includes('NS_ERROR_')) {
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
            
            // Auto Fallback logic using existing clean proxies
            let retries = 0;
            const maxRetries = 3;
            
            while ((status === 'proxy_fail' || status === 'no_proxies') && retries < maxRetries) {
                retries++;
                console.log(`[WARN] Proxy failed for ${email}. Retrying with a clean proxy from working_proxies.txt (Attempt ${retries}/${maxRetries})...`);
                
                const proxies = getWorkingProxies();
                if (proxies.length === 0) {
                    console.log(`[WARN] No clean proxies left in working_proxies.txt! Triggering full proxy scrape...`);
                    scrapeFreshProxies();
                }
                
                status = await processAccount(email, password, null); // Passing null forces it to pick a random clean proxy
            }
            
            if (status === 'proxy_fail' || status === 'no_proxies') {
                console.log(`[ERROR] All ${maxRetries} proxy retries failed for ${email}. Skipping to next account.`);
            }
        }
    }

    console.log(`[INFO] Run finished.`);
    process.exit(0);
})();
