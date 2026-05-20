const fs = require('fs');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');

const PROXY_FILE = 'proxy.txt';
const WORKING_FILE = 'working_proxies.txt';
const TEST_URL = 'https://ltcminer.com';
const TIMEOUT_MS = 5000;
const CONCURRENCY = 1500; // Increased concurrency to support up to 1500 parallel workers for maximum speed

async function checkProxy(proxyStr) {
    try {
        let agent;
        const agentOpts = { keepAlive: false, timeout: TIMEOUT_MS };
        if (proxyStr.startsWith('http://') || proxyStr.startsWith('https://')) {
            agent = new HttpsProxyAgent(proxyStr, agentOpts);
        } else if (proxyStr.startsWith('socks4://') || proxyStr.startsWith('socks5://')) {
            agent = new SocksProxyAgent(proxyStr, agentOpts);
        } else {
            agent = new HttpsProxyAgent(`http://${proxyStr}`, agentOpts);
        }

        const response = await axios.get(TEST_URL, {
            httpsAgent: agent,
            httpAgent: agent,
            timeout: TIMEOUT_MS,
            headers: {
                'Connection': 'close',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            validateStatus: () => true
        });

        const dataStr = (response.data || '').toString().toLowerCase();

        if (response.status === 200) {
            if (dataStr.includes('ltc') || dataStr.includes('miner') || dataStr.includes('crypto')) {
                return true;
            }
        } else if (response.status === 403 || response.status === 503) {
             if (dataStr.includes('cloudflare') || dataStr.includes('just a moment') || dataStr.includes('turnstile')) {
                 return true;
             }
        }
        return false;
    } catch (e) {
        return false;
    }
}

async function verifyProxies() {
    if (!fs.existsSync(PROXY_FILE)) {
        console.log(`[ERROR] ${PROXY_FILE} not found. Run scraper first.`);
        return;
    }

    const proxies = fs.readFileSync(PROXY_FILE, 'utf-8').split('\n').map(p => p.trim()).filter(p => p);
    console.log(`[INFO] Loaded ${proxies.length} proxies for verification.`);
    
    // Clear the working proxies file at the start
    fs.writeFileSync(WORKING_FILE, '');
    
    let workingCount = 0;
    let checkedCount = 0;
    let currentIndex = 0;
    const totalProxies = proxies.length;
    
    // Shuffle proxies to distribute different host ranges and avoid target throttling
    proxies.sort(() => Math.random() - 0.5);

    const startTime = Date.now();

    async function worker() {
        while (currentIndex < totalProxies) {
            const index = currentIndex++;
            if (index >= totalProxies) break;
            
            const proxy = proxies[index];
            const isWorking = await checkProxy(proxy);
            
            checkedCount++;
            if (isWorking) {
                fs.appendFileSync(WORKING_FILE, proxy + '\n');
                workingCount++;
                console.log(`[SUCCESS] Proxy working: ${proxy}`);
            }

            if (checkedCount % 50 === 0 || checkedCount === totalProxies) {
                const elapsedSec = (Date.now() - startTime) / 1000;
                const speed = (checkedCount / elapsedSec).toFixed(1);
                process.stdout.write(`\r[INFO] Progress: ${checkedCount} / ${totalProxies} | Working: ${workingCount} | Speed: ${speed} prox/sec`);
            }
        }
    }

    // Spawn the worker pool with the specified concurrency
    const workers = [];
    const actualConcurrency = Math.min(CONCURRENCY, totalProxies);
    for (let i = 0; i < actualConcurrency; i++) {
        workers.push(worker());
    }

    await Promise.all(workers);

    const totalTimeSec = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n[INFO] Verification complete in ${totalTimeSec}s. Found ${workingCount} working proxies.`);
}

verifyProxies();
