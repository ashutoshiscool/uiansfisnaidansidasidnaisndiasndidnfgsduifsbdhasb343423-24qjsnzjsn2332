const fs = require('fs');
const https = require('https');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');
const crypto = require('crypto');

const PROXY_FILE = 'proxy.txt';
const WORKING_FILE = 'working_proxies.txt';
const TEST_URL = 'https://ltcminer.com';
const TIMEOUT_MS = 1500; // Ultra-strict timeout for massive speed improvements
const CONCURRENCY = 2500; // Extremely high concurrency

// Increase max listeners to avoid Node warnings
require('events').EventEmitter.defaultMaxListeners = CONCURRENCY + 100;

async function checkProxy(proxyStr) {
    return new Promise((resolve) => {
        let agent;
        const agentOpts = { keepAlive: false, timeout: TIMEOUT_MS };
        
        try {
            if (proxyStr.startsWith('http://') || proxyStr.startsWith('https://')) {
                agent = new HttpsProxyAgent(proxyStr, agentOpts);
            } else if (proxyStr.startsWith('socks4://') || proxyStr.startsWith('socks5://')) {
                agent = new SocksProxyAgent(proxyStr, agentOpts);
            } else {
                agent = new HttpsProxyAgent(`http://${proxyStr}`, agentOpts);
            }
        } catch (e) {
            return resolve(false);
        }

        const req = https.get(TEST_URL, {
            agent,
            timeout: TIMEOUT_MS,
            headers: {
                'Connection': 'close',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => {
                data += chunk.toString();
                // Early exit on success detection
                if (data.toLowerCase().includes('ltc') || data.toLowerCase().includes('miner')) {
                    req.destroy();
                    resolve(true);
                }
            });
            res.on('end', () => {
                const status = res.statusCode;
                if (status === 200 || status === 403 || status === 503) {
                    const str = data.toLowerCase();
                    if (str.includes('ltc') || str.includes('miner') || str.includes('crypto') || str.includes('cloudflare')) {
                        return resolve(true);
                    }
                }
                resolve(false);
            });
            res.on('error', () => resolve(false));
        });

        req.on('error', () => resolve(false));
        req.on('timeout', () => {
            req.destroy();
            resolve(false);
        });
    });
}

async function verifyProxies() {
    if (!fs.existsSync(PROXY_FILE)) {
        console.log(`[ERROR] ${PROXY_FILE} not found. Run scraper first.`);
        return;
    }

    const proxies = fs.readFileSync(PROXY_FILE, 'utf-8').split('\n').map(p => p.trim()).filter(p => p);
    // Remove duplicates
    const uniqueProxies = [...new Set(proxies)];
    console.log(`[INFO] Loaded ${uniqueProxies.length} unique proxies for HIGH-SPEED verification.`);
    
    // Backup and clear working file
    if (fs.existsSync(WORKING_FILE)) {
        fs.writeFileSync(`${WORKING_FILE}.bak`, fs.readFileSync(WORKING_FILE));
    }
    fs.writeFileSync(WORKING_FILE, '');
    
    // Shuffle proxies to avoid hitting the same subnets sequentially
    uniqueProxies.sort(() => Math.random() - 0.5);

    let workingCount = 0;
    let checkedCount = 0;
    let currentIndex = 0;
    const totalProxies = uniqueProxies.length;
    const startTime = Date.now();
    
    const validProxies = [];
    const deadProxies = [];

    // Worker function
    async function worker() {
        while (currentIndex < totalProxies) {
            const index = currentIndex++;
            if (index >= totalProxies) break;
            
            const proxy = uniqueProxies[index];
            const isWorking = await checkProxy(proxy);
            
            checkedCount++;
            if (isWorking) {
                fs.appendFileSync(WORKING_FILE, proxy + '\n');
                workingCount++;
                validProxies.push(proxy);
            } else {
                deadProxies.push(proxy);
            }

            if (checkedCount % 100 === 0 || checkedCount === totalProxies) {
                const elapsedSec = (Date.now() - startTime) / 1000;
                const speed = (checkedCount / elapsedSec).toFixed(1);
                process.stdout.write(`\r[INFO] Progress: ${checkedCount} / ${totalProxies} | Working: ${workingCount} | Speed: ${speed} prox/sec `);
            }
        }
    }

    const workers = [];
    const actualConcurrency = Math.min(CONCURRENCY, totalProxies);
    for (let i = 0; i < actualConcurrency; i++) {
        workers.push(worker());
    }

    await Promise.all(workers);

    const totalTimeSec = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n[INFO] Verification complete in ${totalTimeSec}s. Found ${workingCount} working proxies.`);
    
    // Crucial: Update the original proxy list so dead ones are completely removed!
    if (validProxies.length > 0) {
        fs.writeFileSync(PROXY_FILE, validProxies.join('\n') + '\n');
        console.log(`[INFO] Cleaned proxy.txt! Removed ${deadProxies.length} dead proxies. ${validProxies.length} remaining.`);
    } else {
        console.log(`[WARNING] No working proxies found. Did not overwrite proxy.txt.`);
    }
}

verifyProxies();
