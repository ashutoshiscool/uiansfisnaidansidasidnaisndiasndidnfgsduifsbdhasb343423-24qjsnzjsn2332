const { chromium } = require('playwright');
const fs = require('fs');

const WORKING_FILE = 'working_proxies.txt';
const TARGET_URL = 'https://ltcminer.com';
const TIMEOUT_MS = 15000;
const CONCURRENCY = 5; // Lower concurrency since each test launches a browser

async function checkProxyWithBrowser(proxyStr) {
    let browser;
    try {
        let formattedProxy = proxyStr;
        // Playwright proxy option expects the protocol, host, and port
        browser = await chromium.launch({
            headless: true,
            proxy: { server: formattedProxy }
        });
        
        const context = await browser.newContext({
            bypassCSP: true,
            ignoreHTTPSErrors: true
        });
        const page = await context.newPage();
        
        // Navigate and wait until domcontentloaded
        await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
        
        // Wait up to 3 seconds for dynamic content to render if needed
        await page.waitForTimeout(2000);
        
        const isValid = await page.evaluate(() => {
            const bodyText = document.body ? document.body.innerText.toLowerCase() : '';
            const isCloudflare = bodyText.includes('cloudflare') || 
                                 bodyText.includes('just a moment') || 
                                 bodyText.includes('turnstile') || 
                                 bodyText.includes('ddos');
            
            // Check for actual registration, login, or dashboard elements
            const hasInputs = !!document.querySelector('input[type="password"]') || 
                              !!document.querySelector('input[placeholder*="email" i]') ||
                              !!document.querySelector('input[placeholder*="address" i]');
                              
            const hasButtons = Array.from(document.querySelectorAll('button, a')).some(el => {
                const t = (el.innerText || '').toLowerCase();
                return t.includes('sign up') || t.includes('create account') || t.includes('log in') || t.includes('dashboard');
            });
            
            return (hasInputs || hasButtons) && !isCloudflare;
        }).catch(() => false);
        
        await context.close();
        await browser.close();
        
        return isValid;
    } catch (e) {
        if (browser) await browser.close().catch(() => {});
        return false;
    }
}

async function cleanWorkingProxies() {
    if (!fs.existsSync(WORKING_FILE)) {
        console.log(`[ERROR] ${WORKING_FILE} not found.`);
        return;
    }

    const originalContent = fs.readFileSync(WORKING_FILE, 'utf-8');
    const proxies = originalContent.split('\n').map(p => p.trim()).filter(p => p);
    
    if (proxies.length === 0) {
        console.log(`[INFO] No proxies found in ${WORKING_FILE}.`);
        return;
    }

    console.log(`[INFO] Loaded ${proxies.length} proxies for BROWSER-LEVEL verification.`);
    
    // Create a backup of the original file to prevent data loss
    const backupFile = `${WORKING_FILE}.bak`;
    fs.writeFileSync(backupFile, originalContent);
    console.log(`[INFO] Created backup at ${backupFile}`);
    console.log(`[INFO] Progressive verification started. Results will be saved to ${WORKING_FILE} in real-time...\n`);
    
    // Clear/truncate the working file to start writing verified proxies progressively
    fs.writeFileSync(WORKING_FILE, '');
    
    let workingCount = 0;
    let checkedCount = 0;
    
    for (let i = 0; i < proxies.length; i += CONCURRENCY) {
        const chunk = proxies.slice(i, i + CONCURRENCY);
        
        const results = await Promise.allSettled(chunk.map(async (proxy) => {
            const isWorking = await checkProxyWithBrowser(proxy);
            return { proxy, isWorking };
        }));

        for (const result of results) {
            if (result.status === 'fulfilled') {
                const { proxy, isWorking } = result.value;
                if (isWorking) {
                    workingCount++;
                    fs.appendFileSync(WORKING_FILE, proxy + '\n');
                    console.log(`[SUCCESS] ${proxy} (${workingCount} working)`);
                } else {
                    console.log(`[REMOVED] ${proxy}`);
                }
            }
        }

        checkedCount += chunk.length;
        console.log(`[PROGRESS] Checked ${checkedCount} / ${proxies.length} | Active Working: ${workingCount}\n`);
    }

    console.log(`[DONE] Verification complete. Kept ${workingCount} working proxies out of ${proxies.length} in ${WORKING_FILE}.`);
    console.log(`[INFO] If you need to restore the original list, refer to ${backupFile}`);
}

cleanWorkingProxies();

