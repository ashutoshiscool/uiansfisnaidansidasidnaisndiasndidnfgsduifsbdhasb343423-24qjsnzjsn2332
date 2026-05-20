#!/bin/bash

echo "--- LTCMiner Phone Verification ---"
echo "Cleaning up old info files..."
rm -f phone_info.txt otp_info.txt

echo ""
read -p "Enter Country (e.g., Armenia, Australia): " country
read -p "Enter Phone Number: " number

# Write country and number to file for the playwright script to pick up
echo "$country:$number" > phone_info.txt
echo "[SUCCESS] Saved country and number. Waiting for OTP to be sent to your phone..."

echo ""
read -p "Enter OTP when received: " otp

# Write OTP to file for the playwright script to pick up
echo "$otp" > otp_info.txt
echo "[SUCCESS] Saved OTP. The automation script will now submit it."
