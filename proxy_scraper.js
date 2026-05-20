const fs = require('fs');
const axios = require('axios');

const PROXY_API_URLS = [
    'https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=10000&country=all&ssl=all&anonymity=all',
    'https://api.proxyscrape.com/v2/?request=displayproxies&protocol=socks4&timeout=10000&country=all&ssl=all&anonymity=all',
    'https://api.proxyscrape.com/v2/?request=displayproxies&protocol=socks5&timeout=10000&country=all&ssl=all&anonymity=all',
    'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt',
    'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks4.txt',
    'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks5.txt'
];

async function scrapeProxies() {
    console.log('[INFO] Starting proxy scraper...');
    let allProxies = new Set();

    // Read existing proxies
    if (fs.existsSync('proxy.txt')) {
        const existing = fs.readFileSync('proxy.txt', 'utf-8').split('\n').map(p => p.trim()).filter(p => p);
        existing.forEach(p => allProxies.add(p));
        console.log(`[INFO] Loaded ${existing.length} existing proxies from proxy.txt`);
    }

    // Scrape from APIs
    for (const url of PROXY_API_URLS) {
        try {
            console.log(`[INFO] Fetching from ${url.split('/').pop().split('?')[0]}...`);
            const response = await axios.get(url, { timeout: 15000 });
            if (response.data) {
                const proxies = response.data.split('\n').map(p => p.trim()).filter(p => p && p.includes(':'));
                let count = 0;
                
                // Determine protocol
                let protocol = 'http';
                if (url.includes('socks4')) protocol = 'socks4';
                if (url.includes('socks5')) protocol = 'socks5';

                proxies.forEach(p => {
                    // Prepend protocol if it doesn't have one
                    const formattedProxy = p.includes('://') ? p : `${protocol}://${p}`;
                    if (!allProxies.has(formattedProxy)) {
                        allProxies.add(formattedProxy);
                        count++;
                    }
                });
                console.log(`[INFO] Successfully added ${count} new proxies.`);
            }
        } catch (error) {
            console.log(`[ERROR] Failed to fetch from ${url}: ${error.message}`);
        }
    }

    // Save to file
    const proxyList = Array.from(allProxies).join('\n') + '\n';
    fs.writeFileSync('proxy.txt', proxyList);
    console.log(`[INFO] Scraper finished. Total unique proxies in proxy.txt: ${allProxies.size}`);
}

scrapeProxies();
