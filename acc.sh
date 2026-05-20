#!/bash
# LTC Miner - Account Addition Helper

echo "--- Add New Account ---"
read -p "Enter Email: " email
read -p "Enter Password: " password

if [[ -z "$email" || -z "$password" ]]; then
    echo "[ERROR] Email and Password cannot be empty."
    exit 1
fi

node add_account.js "$email" "$password"
