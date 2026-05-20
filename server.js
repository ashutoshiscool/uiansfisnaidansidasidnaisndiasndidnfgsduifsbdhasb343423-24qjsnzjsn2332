const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = 3000;

app.use(express.static(path.join(__dirname, 'dashboard')));
app.use(express.json());

// API endpoint for dashboard data
app.get('/api/data', (req, res) => {
    let txs = [];
    if (fs.existsSync('transactions.json')) {
        try {
            txs = JSON.parse(fs.readFileSync('transactions.json', 'utf-8'));
        } catch (e) {}
    }
    res.json(txs);
});

// API endpoints for config
app.get('/api/config', (req, res) => {
    if (!fs.existsSync('config.json')) return res.status(404).json({ error: 'Config missing' });
    const config = JSON.parse(fs.readFileSync('config.json', 'utf-8'));
    // Remove sensitive info before sending to UI if needed, but here we'll keep it simple
    res.json(config);
});

app.post('/api/config', (req, res) => {
    const newConfig = req.body;
    if (!newConfig.ltc_address || !newConfig.email) return res.status(400).json({ error: 'Missing fields' });
    
    const currentConfig = JSON.parse(fs.readFileSync('config.json', 'utf-8'));
    const updatedConfig = { ...currentConfig, ...newConfig };
    
    fs.writeFileSync('config.json', JSON.stringify(updatedConfig, null, 2));
    res.json({ success: true });
});

app.post('/api/test-email', async (req, res) => {
    const { sendAlert } = require('./email_service');
    try {
        await sendAlert('System Test', 'Your LTC Miner Dashboard is correctly configured for alerts!');
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Serve transactions.json directly if needed
app.get('/transactions.json', (req, res) => {
    res.sendFile(path.join(__dirname, 'transactions.json'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`[SUCCESS] LTC Miner Dashboard is running at http://localhost:${PORT}`);
    console.log(`[INFO] If on a VPS, use http://YOUR_VPS_IP:${PORT}`);
});
