#!/bash
# LTC Miner Automation - VPS Setup Script

echo "[INFO] Starting fresh VPS setup..."

# Update and install basic dependencies
sudo apt-get update
sudo apt-get install -y curl wget git build-essential

# Install Node.js (v20)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Create project directory if it doesn't exist
mkdir -p ~/freeltc
cd ~/freeltc

# Install project dependencies
npm install playwright axios random-useragent nodemailer @googleapis/gmail google-auth-library express

# Install Playwright browsers and system dependencies
npx playwright install chromium
npx playwright install-deps chromium

# Create dummy account.txt and config.json if not exists
[ -f "account.txt" ] || touch account.txt
[ -f "config.json" ] || echo '{"email":"wallibear130@gmail.com","smtp_user":"YOUR_EMAIL@gmail.com","smtp_pass":"YOUR_APP_PASSWORD","smtp_host":"smtp.gmail.com","smtp_port":465}' > config.json

# Setup Cron Jobs
# 1. Withdrawal Check (runs every hour)
(crontab -l 2>/dev/null | grep -q "withdraw.js") || (crontab -l 2>/dev/null; echo "0 * * * * cd $(pwd) && /usr/bin/node withdraw.js >> withdraw.log 2>&1") | crontab -

# 2. Account Verification (runs every 10 minutes)
(crontab -l 2>/dev/null | grep -q "verify_accounts.js") || (crontab -l 2>/dev/null; echo "*/10 * * * * cd $(pwd) && /usr/bin/node verify_accounts.js >> verify.log 2>&1") | crontab -


echo "[SUCCESS] Setup complete! Add your accounts to account.txt and the system will handle the rest."
echo "[INFO] You can run 'node withdraw.js' manually anytime to check for due withdrawals."
