const fs = require('fs');

const ACCOUNT_FILE = 'account.txt';
const PROXY_FILE = 'working_proxies.txt';

async function addAccount() {
    const args = process.argv.slice(2);
    if (args.length < 2) {
        console.log('[ERROR] Usage: node add_account.js <email> <password>');
        process.exit(1);
    }

    const email = args[0];
    const password = args[1];

    // Load working proxies
    if (!fs.existsSync(PROXY_FILE)) {
        console.log(`[ERROR] ${PROXY_FILE} not found.`);
        process.exit(1);
    }
    const proxies = fs.readFileSync(PROXY_FILE, 'utf-8').split('\n').filter(l => l.trim());
    
    // Load existing accounts to avoid duplicate proxies
    const accounts = fs.existsSync(ACCOUNT_FILE) ? fs.readFileSync(ACCOUNT_FILE, 'utf-8').split('\n').filter(l => l.trim()) : [];
    const usedProxies = accounts.map(line => line.split(':')[2]).filter(Boolean);

    // Find a fresh proxy
    const freshProxies = proxies.filter(p => !usedProxies.includes(p));
    let selectedProxy = "";

    if (freshProxies.length > 0) {
        selectedProxy = freshProxies[Math.floor(Math.random() * freshProxies.length)];
    } else {
        console.log('[WARN] No fresh proxies left. Picking a random one from working list.');
        selectedProxy = proxies[Math.floor(Math.random() * proxies.length)];
    }

    const newLine = `${email}:${password}:${selectedProxy}`;
    
    if (fs.existsSync(ACCOUNT_FILE)) {
        const content = fs.readFileSync(ACCOUNT_FILE, 'utf-8');
        if (content.length > 0 && !content.endsWith('\n')) {
            fs.appendFileSync(ACCOUNT_FILE, '\n');
        }
    }
    
    fs.appendFileSync(ACCOUNT_FILE, newLine + '\n');

    console.log(`[SUCCESS] Account added: ${email}`);
    console.log(`[INFO] Assigned Proxy: ${selectedProxy}`);
}

addAccount();
