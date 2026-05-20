// Dashboard Logic - Control Center Edition
const ACC_EARNING_DAILY = 0.00015;

document.addEventListener('DOMContentLoaded', () => {
    updateDate();
    setupTabs();
    setupCalculator();
    fetchData();
    fetchConfig();
});

// --- Tab Logic ---
function setupTabs() {
    const links = document.querySelectorAll('.nav-links li');
    const contents = document.querySelectorAll('.tab-content');
    const pageTitle = document.getElementById('pageTitle');

    links.forEach(link => {
        link.addEventListener('click', () => {
            const target = link.getAttribute('data-tab');
            
            // Update Active Link
            links.forEach(l => l.classList.remove('active'));
            link.classList.add('active');

            // Update Page Title
            pageTitle.innerText = link.innerText;

            // Show Content
            contents.forEach(content => {
                content.classList.remove('active');
                if (content.id === `${target}-tab`) {
                    content.classList.add('active');
                }
            });
        });
    });
}

// --- Data Fetching ---
async function fetchData() {
    try {
        const response = await fetch('/api/data').catch(() => null);
        let data = [];
        if (response && response.ok) {
            data = await response.json();
        } else {
            // Dummy data for preview
            data = [
                { email: "retard@xrgosecurities.space", timestamp: new Date().toISOString(), amount: 0.00021469, proxy: "Direct" },
                { email: "thomas.rodriguez7154@hotmail.com", timestamp: new Date(Date.now() - 86400).toISOString(), amount: 0.00015500, proxy: "103.157.200.126" }
            ];
        }

        updateStats(data);
        renderTables(data);
    } catch (error) {
        console.error("Error fetching data:", error);
    }
}

async function fetchConfig() {
    try {
        const response = await fetch('/api/config');
        if (response.ok) {
            const config = await response.json();
            document.getElementById('ltcAddressInput').value = config.ltc_address;
            document.getElementById('alertEmailInput').value = config.email;
            
            // Update Gmail Status Indicator (simplified check)
            const indicator = document.getElementById('gmailStatus');
            if (config.smtp_pass && config.smtp_pass !== 'YOUR_APP_PASSWORD') {
                indicator.classList.add('ready');
                indicator.innerHTML = '<span class="dot"></span> Gmail API: Ready';
            }
        }
    } catch (e) {}
}

async function saveConfig() {
    const ltc_address = document.getElementById('ltcAddressInput').value;
    const email = document.getElementById('alertEmailInput').value;
    
    if (!ltc_address || !email) return alert("Please fill all fields");

    const btn = document.querySelector('#settings-tab .btn-primary');
    btn.innerText = 'Saving...';

    try {
        const response = await fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ltc_address, email })
        });
        
        if (response.ok) {
            alert("Settings saved successfully!");
        } else {
            alert("Failed to save settings.");
        }
    } catch (e) {
        alert("Error saving settings.");
    } finally {
        btn.innerText = 'Save Changes';
    }
}

async function testEmail() {
    const btn = document.querySelector('.btn-secondary');
    const originalText = btn.innerText;
    btn.innerText = 'Sending...';

    try {
        const response = await fetch('/api/test-email', { method: 'POST' });
        if (response.ok) {
            alert("Test email sent! Check your inbox.");
        } else {
            alert("Failed to send test email. Check your SMTP/Gmail settings.");
        }
    } catch (e) {
        alert("Error sending test email.");
    } finally {
        btn.innerText = originalText;
    }
}

// --- UI Updates ---
function updateStats(data) {
    const total = data.reduce((sum, tx) => sum + tx.amount, 0);
    const accounts = new Set(data.map(tx => tx.email)).size;
    const estMonthly = accounts * ACC_EARNING_DAILY * 30;

    document.getElementById('totalWithdrawn').innerText = `${total.toFixed(8)} LTC`;
    document.getElementById('activeAccounts').innerText = accounts;
    document.getElementById('monthlyProfit').innerText = `${estMonthly.toFixed(4)} LTC`;
}

function renderTables(data) {
    const shortBody = document.getElementById('txBody');
    const fullBody = document.getElementById('fullTxBody');
    
    shortBody.innerHTML = '';
    fullBody.innerHTML = '';

    const sortedData = [...data].reverse();

    sortedData.slice(0, 10).forEach(tx => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${tx.email}</td>
            <td>${new Date(tx.timestamp).toLocaleString()}</td>
            <td style="color: var(--accent); font-weight: 600;">${tx.amount.toFixed(8)}</td>
            <td><span class="status-badge">Completed</span></td>
        `;
        shortBody.appendChild(row);
    });

    sortedData.forEach(tx => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${tx.email}</td>
            <td>${new Date(tx.timestamp).toLocaleString()}</td>
            <td>${tx.amount.toFixed(8)}</td>
            <td>${tx.proxy || 'Direct'}</td>
        `;
        fullBody.appendChild(row);
    });
}

function setupCalculator() {
    const slider = document.getElementById('accCount');
    const valueDisplay = document.getElementById('accCountValue');
    const dailyEst = document.getElementById('dailyEst');
    const monthlyEst = document.getElementById('monthlyEst');

    slider.addEventListener('input', (e) => {
        const count = e.target.value;
        valueDisplay.innerText = count;
        const daily = count * ACC_EARNING_DAILY;
        const monthly = daily * 30;
        dailyEst.innerText = `${daily.toFixed(5)} LTC`;
        monthlyEst.innerText = `${monthly.toFixed(4)} LTC`;
    });
}

function updateDate() {
    const options = { month: 'long', day: 'numeric', year: 'numeric' };
    document.getElementById('currentDate').innerText = new Date().toLocaleDateString('en-US', options);
}

function refreshData() {
    fetchData();
}
