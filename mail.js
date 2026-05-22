const axios = require('axios');

async function getDomain() {
    try {
        const response = await axios.get('https://api.mail.tm/domains');
        if (response.data && response.data['hydra:member'] && response.data['hydra:member'].length > 0) {
            return response.data['hydra:member'][0].domain;
        }
        return 'wshu.net'; // fallback
    } catch(e) {
        return 'wshu.net';
    }
}

async function createAccount(email, password) {
    try {
        const response = await axios.post('https://api.mail.tm/accounts', {
            address: email,
            password: password
        }, {
            headers: { 'Content-Type': 'application/json' }
        });
        return response.data;
    } catch (e) {
        console.error('[ERROR] Failed to create mail.tm account:', e.response ? e.response.data : e.message);
        throw e;
    }
}

async function getToken(email, password) {
    try {
        const response = await axios.post('https://api.mail.tm/token', {
            address: email,
            password: password
        }, {
            headers: { 'Content-Type': 'application/json' }
        });
        return response.data.token;
    } catch(e) {
        throw new Error('Failed to get token: ' + (e.response ? JSON.stringify(e.response.data) : e.message));
    }
}

async function getMessages(token) {
    try {
        const response = await axios.get('https://api.mail.tm/messages', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        return response.data['hydra:member'] || [];
    } catch(e) {
        throw new Error('Failed to get messages: ' + (e.response ? JSON.stringify(e.response.data) : e.message));
    }
}

async function getMessageContent(token, messageId) {
    try {
        const response = await axios.get(`https://api.mail.tm/messages/${messageId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        return response.data;
    } catch(e) {
        throw new Error('Failed to get message content: ' + (e.response ? JSON.stringify(e.response.data) : e.message));
    }
}

module.exports = {
    getDomain,
    createAccount,
    getToken,
    getMessages,
    getMessageContent
};
