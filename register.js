const { firefox } = require('playwright');
const path = require('path');
const fs = require('fs');
const { getRandomFingerprint, applyAntiFingerprint } = require('./fingerprint');

const TIMEOUT = 35000;
const RETRIES = 10;
const HUMAN_DELAY_MIN = 100;
const HUMAN_DELAY_MAX = 300;

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
        await acceptBtn.click({ force: true }).catch(() => {});
        await humanDelay(page, 1000, 2000);
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

async function getDutchNumbersFromSMS24(smsPage) {
    console.log('[INFO] Navigating to https://sms24.me/en/countries/nl...');
    await smsPage.goto('https://sms24.me/en/countries/nl', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await smsPage.waitForTimeout(3000);

    const numbers = await smsPage.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a'));
        return links
            .filter(a => a.innerText.trim().includes('+31') || a.href.includes('/number/'))
            .map(a => ({
                phone: a.innerText.trim().replace(/[^\d+]/g, ''),
                url: a.href
            }))
            .filter(n => n.phone.startsWith('+31'));
    });

    console.log(`[INFO] Found ${numbers.length} Netherlands numbers from sms24.me.`);
    return numbers;
}

async function pollForOTPSMS24(smsPage, numberUrl) {
    console.log(`[INFO] Navigating to messages list page: ${numberUrl}`);
    await smsPage.goto(numberUrl, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await smsPage.waitForTimeout(3000);

    const maxPollAttempts = 24; // 24 * 5s = 2 minutes poll time limit
    for (let attempt = 1; attempt <= maxPollAttempts; attempt++) {
        console.log(`[INFO] Polling messages attempt ${attempt}/${maxPollAttempts}...`);
        
        const otpCode = await smsPage.evaluate(() => {
            const elements = Array.from(document.querySelectorAll('div, td, tr, p')).map(el => el.innerText.trim());
            
            // Search specifically for "LTCMiner" OTP
            for (const text of elements) {
                if (text && (text.toLowerCase().includes('ltcminer') || text.toLowerCase().includes('miner'))) {
                    // Match a 6-digit OTP code in the text
                    const match = text.match(/\b(\d{6})\b/);
                    if (match) {
                        return match[1];
                    }
                }
            }
            return null;
        });

        if (otpCode) {
            console.log(`[SUCCESS] Found LTCMiner verification OTP: ${otpCode}`);
            return otpCode;
        }

        await smsPage.waitForTimeout(5000);
        
        // Refresh page to load newer messages
        console.log('[INFO] Refreshing message feed...');
        await smsPage.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
        await smsPage.waitForTimeout(2000);
    }
    return null;
}

async function handlePhoneVerificationFlow(page, context) {
    console.log('[INFO] Checking for WITHDRAW verification prompts...');
    const withdrawBtn = page.getByRole('button', { name: /WITHDRAW/i }).first();
    await safeClick(page, withdrawBtn);
    await humanDelay(page, 2000, 3000);

    const countrySelectPrompt = await page.locator('button, select, [role="combobox"]').filter({ hasText: /Choose Your Country/i }).count();
    const otpPromptCount = await page.locator('input[placeholder*="000"]').count();

    if (countrySelectPrompt === 0 && otpPromptCount === 0) {
        console.log('[INFO] Account does not require phone verification. Proceeding...');
        return true;
    }

    console.log('[INFO] ⚠️ PHONE VERIFICATION DETECTED! Opening automated SMS24 tab...');
    const smsPage = await context.newPage();
    const numbersList = await getDutchNumbersFromSMS24(smsPage);

    if (numbersList.length === 0) {
        console.error('[ERROR] No Netherlands numbers found from sms24.me.');
        await smsPage.close();
        return false;
    }

    for (let i = 0; i < Math.min(numbersList.length, 5); i++) {
        const candidate = numbersList[i];
        const rawNumber = candidate.phone; // e.g. +3197058046903
        const localNumber = rawNumber.replace('+31', '').trim(); // e.g. 97058046903
        console.log(`\n[INFO] --- Attempting verification with Dutch number [${i + 1}/5]: ${rawNumber} ---`);

        try {
            // Select country on LTCminer
            const select = page.locator('select').first();
            const trigger = page.locator('button, [role="combobox"]').filter({ hasText: /Choose Your Country/i }).first();
            
            if (await select.count() > 0) {
                await select.selectOption({ label: 'Netherlands' });
            } else if (await trigger.count() > 0) {
                await trigger.click({ force: true });
                await humanDelay(page, 1000, 2000);
                await page.getByText('Netherlands', { exact: true }).first().click();
            } else {
                await page.getByText('Choose Your Country').first().click({ force: true });
                await humanDelay(page, 1000, 2000);
                await page.getByText('Netherlands', { exact: true }).first().click();
            }

            // Enter phone number
            const numInput = page.locator('input').filter({ has: page.locator('xpath=..').locator('text=+') }).first().or(page.locator('input[placeholder*="000"]')).first().or(page.locator('input').last());
            await numInput.click();
            await numInput.clear();
            await safeFill(page, numInput, localNumber);

            console.log('[INFO] Submitting phone number...');
            const continueBtn = page.getByRole('button', { name: /CONTINUE/i }).first();
            await safeClick(page, continueBtn);
            await humanDelay(page, 3000, 4000);

            // Wait 20 seconds for SMS gate transmission
            console.log('[INFO] Waiting 20 seconds for SMS to transmit...');
            await page.waitForTimeout(20000);

            // Poll SMS24 page for the code
            const otpCode = await pollForOTPSMS24(smsPage, candidate.url);

            if (!otpCode) {
                console.log(`[WARN] No OTP found for number ${rawNumber}. Retrying next number.`);
                continue;
            }

            // Fill OTP
            console.log(`[INFO] Submitting OTP verification code: ${otpCode}`);
            const otpInput = page.locator('input[type="text"]').last();
            await safeFill(page, otpInput, otpCode);

            const sendCodeBtn = page.getByRole('button', { name: /SEND CODE|CONTINUE/i }).last();
            await safeClick(page, sendCodeBtn);
            await humanDelay(page, 5000, 8000);

            // Check if verified successfully
            const hasVerifyElements = await page.locator('input[placeholder*="000"], button:has-text("SEND CODE")').count();
            if (hasVerifyElements === 0) {
                console.log('[SUCCESS] ✅ Phone verification completed successfully!');
                await smsPage.close();
                return true;
            } else {
                console.log(`[WARN] Code rejected or number already flagged. Retrying next number...`);
            }

        } catch (err) {
            console.error(`[WARN] Error occurred during verification attempt: ${err.message}`);
        }
    }

    await smsPage.close();
    return false;
}

(async () => {
    console.log('[INFO] Starting Registration script with Advanced Stealth and SMS24 verification...');
    cleanupScreenshots('screenshots/register');

    let proxies = [];
    if (fs.existsSync('working_proxies.txt')) {
        proxies = fs.readFileSync('working_proxies.txt', 'utf-8').split('\n').map(p => p.trim()).filter(p => p);
    }

    if (proxies.length === 0) {
        console.log('[WARN] No proxies found.');
        process.exit(1);
    }
    
    console.log(`[INFO] Loaded ${proxies.length} proxies.`);

    // Filter out used proxies
    if (fs.existsSync('account.txt')) {
        const accountLines = fs.readFileSync('account.txt', 'utf-8').split('\n').filter(l => l.trim());
        const usedProxies = accountLines.map(line => {
            const parts = line.split(':');
            return parts.slice(2).join(':').trim();
        }).filter(p => p);
        
        if (usedProxies.length > 0) {
            const freshProxies = proxies.filter(p => !usedProxies.includes(p));
            console.log(`[INFO] Filtered out ${proxies.length - freshProxies.length} used proxies. ${freshProxies.length} fresh proxies available.`);
            proxies = freshProxies;
        }
    }

    if (proxies.length === 0) {
        console.log('[ERROR] All proxies have been used. Add more proxies to working_proxies.txt.');
        process.exit(1);
    }

    for (let attempt = 1; attempt <= RETRIES; attempt++) {
        let selectedProxy = proxies[Math.floor(Math.random() * proxies.length)];
        console.log(`\n[INFO] --- Attempt ${attempt} of ${RETRIES} | Proxy: ${selectedProxy} ---`);

        let launchOptions = { headless: true };
        if (selectedProxy.startsWith('http') || selectedProxy.startsWith('socks')) {
            launchOptions.proxy = { server: selectedProxy };
        }

        const browser = await firefox.launch(launchOptions);
        const fp = getRandomFingerprint();
        
        console.log(`[INFO] Device Profile -> Viewport: ${fp.viewport.width}x${fp.viewport.height}, OS: ${fp.platform}`);

        const context = await browser.newContext({
            viewport: fp.viewport,
            userAgent: fp.userAgent,
            locale: fp.locale,
            timezoneId: fp.timezoneId,
            colorScheme: fp.colorScheme
        });

        await applyAntiFingerprint(context, fp);
        const page = await context.newPage();

        try {
            console.log('[INFO] Navigating to https://ltcminer.com');
            await page.goto('https://ltcminer.com', { waitUntil: 'commit', timeout: TIMEOUT }).catch(e => console.log(`[WARN] goto commit timeout/error: ${e.message}`));
            await page.waitForLoadState('domcontentloaded', { timeout: TIMEOUT }).catch(() => {});
            await page.waitForLoadState('networkidle').catch(() => {});
            await humanDelay(page, 2000, 4000);
            await clearOverlay(page);

            const domains = ['zoho.com'];
            const users = [
                randomString(8) + Math.floor(Math.random()*999),
                randomString(5) + '.' + randomString(5),
                randomString(10),
                'user' + Math.floor(Math.random()*100000) + randomString(3)
            ];
            const email = users[Math.floor(Math.random()*users.length)] + '@' + domains[0];
            const password = randomPassword();
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

            const dashboardUrl = 'https://ltcminer.com/dashboard';
            if (!page.url().includes('/dashboard')) {
                await page.goto(dashboardUrl, { waitUntil: 'domcontentloaded', timeout: TIMEOUT }).catch(() => null);
                await page.waitForLoadState('networkidle').catch(() => {});
            }
            await clearOverlay(page);
            
            if (page.url().includes('/dashboard')) {
                const restriction = await page.locator('text=RESTRICTIONS DETECTED, .bg-red-50, .text-red-700').filter({ hasText: /RESTRICTIONS|VERIFY/i }).count();
                
                if (restriction > 0) {
                    console.log('[WARNING] ⚠️ BANNED IMMEDIATELY. Proxy or Fingerprint flagged.');
                    await page.screenshot({ path: `screenshots/register/restricted_${email.split('@')[0]}.png`, fullPage: true });
                } else {
                    console.log('[SUCCESS] Clean registration achieved! Executing integrated SMS verification...');
                    
                    const isVerified = await handlePhoneVerificationFlow(page, context);
                    
                    if (isVerified) {
                        console.log('[SUCCESS] ✅ FULLY VERIFIED CLEAN ACCOUNT CREATED!');
                        fs.appendFileSync('account.txt', `${email}:${password}:${selectedProxy}\n`);
                        await page.screenshot({ path: `screenshots/register/clean_verified_${email.split('@')[0]}.png`, fullPage: true });
                        break; // Exit registration loops upon success
                    } else {
                        console.log('[ERROR] Registration succeeded but phone verification failed.');
                    }
                }
            } else {
                console.log('[ERROR] Failed to reach dashboard.');
            }

        } catch (e) {
            console.error(`[ERROR] Attempt failed: ${e.message}`);
        } finally {
            await browser.close();
        }
    }
})();
