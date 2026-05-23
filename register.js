const { firefox, chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { getRandomFingerprint, applyAntiFingerprint } = require('./fingerprint');
const axios = require('axios');
const readline = require('readline');
const { execSync } = require('child_process');
const mail = require('./mail');
const { getSms24Number, waitForOtp, markNumberUsed } = require('./number');

const TIMEOUT = 30000;
const HUMAN_DELAY_MIN = 100;
const HUMAN_DELAY_MAX = 300;

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function randomString(length) {
    const chars = 'abcdefghijklmnopqrstuvwxyz';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

function randomPassword(length = 14) {
    const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const lower = 'abcdefghijklmnopqrstuvwxyz';
    const nums = '0123456789';
    const special = '!@#$%^&*()_+-=[]{}|;.,<>?';
    const all = upper + lower + nums + special;

    let pass = '';
    pass += upper[Math.floor(Math.random() * upper.length)];
    pass += lower[Math.floor(Math.random() * lower.length)];
    pass += nums[Math.floor(Math.random() * nums.length)];
    pass += special[Math.floor(Math.random() * special.length)];

    for (let i = 4; i < length; i++) {
        pass += all[Math.floor(Math.random() * all.length)];
    }
    return pass.split('').sort(() => 0.5 - Math.random()).join('');
}

async function humanDelay(page, min = HUMAN_DELAY_MIN, max = HUMAN_DELAY_MAX) {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    await page.waitForTimeout(delay);
}

async function safeClick(page, locator, options = {}) {
    await locator.waitFor({ state: 'visible', timeout: TIMEOUT });
    await locator.scrollIntoViewIfNeeded();
    await humanDelay(page, 500, 1000);
    try {
        await locator.click({ ...options, timeout: 5000 });
    } catch (e) {
        await locator.click({ ...options, force: true, timeout: 5000 });
    }
}

async function clearOverlay(page) {
    const acceptBtn = page.getByRole('button', { name: /ACCEPT/i });
    if (await acceptBtn.count() > 0) {
        console.log('[INFO] Clearing notification overlay...');
        await acceptBtn.click({ force: true }).catch(() => { });
        await humanDelay(page, 1000, 2000);
    }
}

async function safeFill(page, locator, text) {
    await locator.waitFor({ state: 'visible', timeout: TIMEOUT });
    await locator.scrollIntoViewIfNeeded();
    await locator.click();
    await humanDelay(page, 200, 500);
    for (const char of text) {
        await locator.pressSequentially(char, { delay: Math.floor(Math.random() * 50) + 10 });
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

function loadProxies() {
    let proxies = [];
    if (fs.existsSync('working_proxies.txt')) {
        proxies = fs.readFileSync('working_proxies.txt', 'utf-8').split('\n').map(p => p.trim()).filter(p => p);
    }

    // Filter out used proxies
    if (fs.existsSync('account.txt')) {
        const accountLines = fs.readFileSync('account.txt', 'utf-8').split('\n').filter(l => l.trim());
        const usedProxies = accountLines.map(line => {
            const parts = line.split(':');
            return parts.slice(2).join(':').trim();
        }).filter(p => p);

        if (usedProxies.length > 0) {
            const freshProxies = proxies.filter(p => !usedProxies.includes(p));
            console.log(`[INFO] Filtered out ${proxies.length - freshProxies.length} used proxies.`);
            proxies = freshProxies;
        }
    }
    return proxies;
}

function runAutoScraper(remainingAccounts) {
    console.log('[WARNING] Proxies depleted! Running auto-scraper sequence...');
    try {
        console.log('[INFO] 1/3: Running proxy_scraper.js...');
        execSync('node proxy_scraper.js', { stdio: 'inherit' });
        console.log('[INFO] 2/3: Running proxy_verifier.js (FAST MODE)...');
        execSync('node proxy_verifier.js', { stdio: 'inherit' });
        console.log(`[INFO] 3/3: Running clean_working_proxies.js (Targeting ${remainingAccounts} proxies)...`);
        execSync(`node clean_working_proxies.js ${remainingAccounts}`, { stdio: 'inherit' });
        console.log('[SUCCESS] Proxy scraping and verification completed.');
    } catch (e) {
        console.error('[ERROR] Failed to scrape fresh proxies automatically:', e.message);
    }
}

(async () => {
    rl.question('How many accounts do you want to create? ', async (answer) => {
        const targetAccounts = parseInt(answer.trim(), 10);
        if (isNaN(targetAccounts) || targetAccounts <= 0) {
            console.log('[ERROR] Please enter a valid positive number.');
            process.exit(1);
        }

        console.log(`[INFO] Target: ${targetAccounts} accounts.`);
        let accountsCreated = 0;

        console.log('[INFO] Starting Registration script with Advanced Stealth...');
        cleanupScreenshots('screenshots/register');

        let proxies = loadProxies();

        while (accountsCreated < targetAccounts) {
            if (proxies.length === 0) {
                runAutoScraper(targetAccounts - accountsCreated);
                proxies = loadProxies();
                if (proxies.length === 0) {
                    console.log('[ERROR] Even after scraping, no proxies are available. Exiting.');
                    process.exit(1);
                }
            }

            console.log(`\n[INFO] === Creating Account ${accountsCreated + 1} of ${targetAccounts} ===`);
            let selectedProxy = proxies[Math.floor(Math.random() * proxies.length)];
            console.log(`[INFO] Selected Proxy: ${selectedProxy}`);

            let launchOptions = { headless: true };
            if (selectedProxy.startsWith('http')) {
                launchOptions.proxy = { server: selectedProxy };
            } else if (selectedProxy.startsWith('socks')) {
                launchOptions.proxy = { server: selectedProxy };
            }

            const browser = await firefox.launch(launchOptions);
            const fp = getRandomFingerprint();

            console.log(`[INFO] Device Profile -> Viewport: ${fp.viewport.width}x${fp.viewport.height}, OS: ${fp.platform}`);
            console.log(`[INFO] Anti-Fingerprint -> WebGL: ${fp.webglRenderer.substring(0, 50)}...`);

            const context = await browser.newContext({
                viewport: fp.viewport,
                userAgent: fp.userAgent,
                locale: fp.locale,
                timezoneId: fp.timezoneId,
                colorScheme: fp.colorScheme
            });

            await applyAntiFingerprint(context, fp);
            const page = await context.newPage();

            // Block heavy resources to make slow proxies run 10x faster
            await page.route('**/*', route => {
                const type = route.request().resourceType();
                if (['image', 'stylesheet', 'font', 'media'].includes(type)) {
                    route.abort();
                } else {
                    route.continue();
                }
            });

            try {
                console.log('[INFO] Navigating to https://ltcminer.com');
                try {
                    await page.goto('https://ltcminer.com', { waitUntil: 'commit', timeout: 15000 });
                    await page.waitForLoadState('domcontentloaded', { timeout: 15000 });
                    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => { });
                } catch (e) {
                    throw new Error(`Navigation failed (${e.message}). Skipping this proxy.`);
                }
                await humanDelay(page, 2000, 4000);
                await clearOverlay(page);

                // Generate Mail.tm Email Account
                console.log('[INFO] Fetching valid temp mail domain...');
                const domain = await mail.getDomain();
                const randomUser = randomString(10);
                const email = randomUser + '@' + domain;
                const password = randomPassword();
                
                console.log(`[INFO] Creating inbox for ${email}...`);
                try {
                    await mail.createAccount(email, password);
                } catch(e) {
                    throw new Error(`Failed to create mail.tm account for ${email}. Skipping.`);
                }
                
                console.log(`[INFO] Generated Credentials -> Email: ${email}`);

                console.log('[INFO] Clicking Sign Up...');
                const signUpBtn = page.locator('button').filter({ hasText: /^Sign Up$/i }).first();
                await safeClick(page, signUpBtn);

                console.log('[INFO] Waiting for Modal...');
                const emailInput = page.locator('input[type="text"][placeholder*="text-slate-400" i], input[type="text"].w-full.h-14').first();
                await emailInput.waitFor({ state: 'visible', timeout: 10000 });
                await humanDelay(page, 1000, 2000);

                console.log('[INFO] Filling form with human speed...');
                await safeFill(page, emailInput, email);

                const passInputs = page.locator('input[type="password"]');
                await safeFill(page, passInputs.nth(0), password);
                await safeFill(page, passInputs.nth(1), password);

                console.log('[INFO] Ticking ToS...');
                const checkbox = page.locator('input[type="checkbox"]').first();
                await checkbox.check({ force: true });
                await humanDelay(page, 500, 1000);

                console.log('[INFO] Clicking Create Account...');
                const createBtn = page.locator('button').filter({ hasText: /Create Account/i }).first();
                await safeClick(page, createBtn);

                await page.waitForLoadState('networkidle');
                await humanDelay(page, 5000, 8000);
                
                // Check if restricted immediately
                const dashboardUrl = 'https://ltcminer.com/dashboard';
                if (!page.url().includes('/dashboard')) {
                    await page.goto(dashboardUrl, { waitUntil: 'domcontentloaded', timeout: TIMEOUT }).catch(() => null);
                    await page.waitForLoadState('networkidle').catch(() => { });
                }
                await clearOverlay(page);

                if (page.url().includes('/dashboard')) {
                    await humanDelay(page, 2000, 3000); // Wait for dynamic restriction banners to render

                    const isRestricted = await page.evaluate(() => {
                        const text = document.body ? document.body.innerText.toUpperCase() : '';
                        return text.includes('RESTRICTION') || text.includes('BANNED') || text.includes('VERIFY');
                    });

                    if (isRestricted) {
                        console.log('[WARNING] ⚠️ BANNED IMMEDIATELY. Proxy or Fingerprint flagged.');
                        await page.screenshot({ path: `screenshots/register/restricted_${email.split('@')[0]}.png`, fullPage: true });
                        // Remove proxy from pool so it doesn't get retried
                        proxies = proxies.filter(p => p !== selectedProxy);
                    } else {
                        console.log('[INFO] Account is clean! Proceeding to trigger SMS verification by clicking Withdraw...');
                        
                        try {
                            console.log('[INFO] Initiating Withdrawal click to trigger SMS prompt...');
                            const withdrawBtn = page.getByRole('button', { name: /WITHDRAW/i }).first();
                            await safeClick(page, withdrawBtn);
                            await humanDelay(page, 2000, 3000);
                            
                            const modalText = await page.evaluate(() => {
                                const modal = document.querySelector('.modal, [role="dialog"]');
                                return modal ? modal.innerText.toUpperCase() : document.body.innerText.toUpperCase();
                            });
                            
                            if (modalText.includes('PHONE VERIFICATION') || modalText.includes('VERIFY YOUR MOBILE NUMBER')) {
                                console.log('[INFO] Phone verification required! Initiating sms24.me automation...');
                                await page.screenshot({ path: `screenshots/register/verify_triggered_${email.split('@')[0]}.png` }).catch(() => {});
                                
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
                                
                                // 2. Get SMS Number
                                let smsData;
                                try {
                                    const smsBrowser = await chromium.launch({ headless: true });
                                    smsData = await getSms24Number(smsBrowser);
                                } catch(e) {
                                    console.log('[ERROR] Failed to get number from sms24.me:', e.message);
                                    throw new Error('Failed to get number from sms24.me');
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
                                        
                                        await humanDelay(page, 2000, 3000);
                                        await page.evaluate(() => {
                                            const modal = document.querySelector('.modal, [role="dialog"], .modal-body, .modal-content');
                                            if (modal) modal.scrollTop = modal.scrollHeight;
                                            window.scrollBy(0, 800);
                                        });
                                        await humanDelay(page, 1000, 2000);
                                        
                                        // Take a screenshot so we can debug what's on screen
                                        await page.screenshot({ path: `screenshots/register/after_send_code_${email.split('@')[0]}.png` }).catch(() => {});
                                        
                                        console.log(`[INFO] Forcing immediate RESEND click to trigger OTP...`);
                                        try {
                                            const resendBtn = page.locator('button, a, span, div, p').filter({ hasText: /RESEND/i }).last();
                                            await resendBtn.waitFor({ state: 'attached', timeout: 65000 });
                                            await resendBtn.scrollIntoViewIfNeeded().catch(()=>{});
                                            await resendBtn.click({ force: true });
                                            console.log('[INFO] Clicked initial force RESEND.');
                                        } catch(e) {
                                            console.log('[WARN] Could not find RESEND button during initial force attempt.');
                                        }
                                    } else {
                                        console.log(`[INFO] Clicking RESEND (Attempt ${attempt}/${maxResends})...`);
                                        
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
                                    await page.screenshot({ path: `screenshots/register/otp_timeout_${email.split('@')[0]}.png` }).catch(() => {});
                                    throw new Error('OTP failed to arrive');
                                }
                                
                                // Mark number used since it successfully got an OTP for this account
                                markNumberUsed(smsData.fullNumber);
                                
                                // 5. Enter OTP
                                const otpInput = page.locator('input[placeholder*="OTP" i], input[placeholder*="Code" i], input[type="tel"], input[type="text"]').last();
                                await safeFill(page, otpInput, otp);
                                await safeClick(page, page.getByRole('button', { name: /CONTINUE|VERIFY/i }).last());
                                await humanDelay(page, 5000, 8000);
                                console.log('[SUCCESS] Phone verified during registration!');
                            } else if (modalText.includes('PLEASE VERIFY YOUR ACCOUNT') || modalText.includes('EMAIL SENT')) {
                                console.log('[INFO] Email verification requested instead of SMS. Skipping SMS for now.');
                                // Just log it, we don't handle email here anymore based on instructions.
                            } else {
                                console.log('[INFO] No SMS verification prompted upon withdrawal click. Account is clean.');
                            }
                        } catch(e) {
                            console.error('[ERROR] Failed during SMS verification flow:', e.message);
                            await page.screenshot({ path: `screenshots/register/sms_flow_failed_${email.split('@')[0]}.png`, fullPage: true }).catch(() => {});
                            throw new Error('SMS Verification Flow Failed. Retrying account creation.');
                        }

                        console.log('[SUCCESS] ✅ CLEAN & VERIFIED ACCOUNT CREATED!');
                        accountsCreated++; // Increment success counter

                        let prefix = '\n';
                        try {
                            const content = fs.readFileSync('account.txt', 'utf-8');
                            if (content.endsWith('\n') || content.length === 0) prefix = '';
                        } catch (e) { }

                        fs.appendFileSync('account.txt', `${prefix}${email}:${password}:${selectedProxy}\n`);
                        await page.screenshot({ path: `screenshots/register/clean_${email.split('@')[0]}.png`, fullPage: true });
                    }
                } else {
                    console.log('[ERROR] Failed to reach dashboard. Navigation got stuck or redirected.');
                }

            } catch (e) {
                console.error(`[ERROR] Attempt failed: ${e.message}`);
                // Aggressively remove proxies that timeout or fail at any stage
                if (e.message.includes('Navigation failed') || e.message.includes('Timeout') || e.message.includes('closed') || e.message.includes('ERR_')) {
                    proxies = proxies.filter(p => p !== selectedProxy);
                    console.log(`[INFO] Dropped failing proxy from pool. Remaining proxies: ${proxies.length}`);
                }
            } finally {
                await browser.close();
            }
        }

        console.log(`\n[SUCCESS] Goal reached! Successfully created ${accountsCreated} accounts.`);
        process.exit(0);
    });
})();

