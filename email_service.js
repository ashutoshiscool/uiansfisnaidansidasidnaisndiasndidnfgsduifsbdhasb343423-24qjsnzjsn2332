const fs = require('fs');
const { google } = require('googleapis');
const nodemailer = require('nodemailer');

async function sendAlert(subject, message) {
    if (!fs.existsSync('config.json')) {
        console.log('[ERROR] config.json missing.');
        return;
    }
    const config = JSON.parse(fs.readFileSync('config.json', 'utf-8'));

    // Check for Gmail API (Token method)
    if (fs.existsSync('token.json') && fs.existsSync('credentials.json')) {
        await sendViaGmailAPI(subject, message, config.email);
    } else {
        await sendViaSMTP(subject, message, config);
    }
}

async function sendViaGmailAPI(subject, message, recipient) {
    const credentials = JSON.parse(fs.readFileSync('credentials.json'));
    const token = JSON.parse(fs.readFileSync('token.json'));
    const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
    
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
    oAuth2Client.setCredentials(token);

    const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });
    const str = [
        'Content-Type: text/plain; charset="UTF-8"\n',
        'MIME-Version: 1.0\n',
        'Content-Transfer-Encoding: 7bit\n',
        `to: ${recipient}\n`,
        `subject: ${subject}\n\n`,
        message
    ].join('');

    const encodedMail = Buffer.from(str).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');

    try {
        await gmail.users.messages.send({
            userId: 'me',
            resource: { raw: encodedMail }
        });
        console.log('[INFO] Alert sent via Gmail API.');
    } catch (err) {
        console.error('[ERROR] Gmail API failed:', err.message);
    }
}

async function sendViaSMTP(subject, message, config) {
    if (config.smtp_pass === 'YOUR_APP_PASSWORD') {
        console.log('[WARN] SMTP not configured. Skipping alert.');
        return;
    }

    let transporter = nodemailer.createTransport({
        host: config.smtp_host,
        port: config.smtp_port,
        secure: true,
        auth: { user: config.smtp_user, pass: config.smtp_pass }
    });

    try {
        await transporter.sendMail({
            from: `"LTC Miner Alert" <${config.smtp_user}>`,
            to: config.email,
            subject: subject,
            text: message
        });
        console.log('[INFO] Alert sent via SMTP.');
    } catch (err) {
        console.error('[ERROR] SMTP failed:', err.message);
    }
}

module.exports = { sendAlert };
