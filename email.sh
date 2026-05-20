#!/bash
# LTC Miner - Email Configuration Helper

CONFIG_FILE="config.json"

echo "--- LTC Miner Email Configuration ---"
echo "1. Set Recipient Email"
echo "2. Setup Gmail API (OAuth2)"
echo "3. Test Email"
echo "4. Exit"

read -p "Choose an option: " choice

case $choice in
    1)
        read -p "Enter recipient email: " email
        sed -i "s/\"email\": \".*\"/\"email\": \"$email\"/" $CONFIG_FILE
        echo "[SUCCESS] Recipient email updated to $email"
        ;;
    2)
        echo "[INFO] Starting Gmail API Setup..."
        echo "[IMPORTANT] Make sure you have placed 'credentials.json' in this directory."
        node setup_gmail.js
        ;;
    3)
        echo "[INFO] Sending test email..."
        node -e "require('./email_service').sendAlert('Test Alert', 'This is a test from your LTC Miner script.')"
        ;;
    4)
        exit 0
        ;;
    *)
        echo "[ERROR] Invalid option"
        ;;
esac
