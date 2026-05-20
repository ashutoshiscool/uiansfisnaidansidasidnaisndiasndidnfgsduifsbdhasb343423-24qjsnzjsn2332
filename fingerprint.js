const randomUseragent = require('random-useragent');

const VIEWPORTS = [
    { width: 1920, height: 1080 },
    { width: 1366, height: 768 },
    { width: 1440, height: 900 },
    { width: 1536, height: 864 },
    { width: 2560, height: 1440 },
    { width: 1600, height: 900 },
    { width: 1280, height: 800 },
    { width: 1680, height: 1050 }
];

const LOCALES = ['en-US', 'en-GB', 'en-AU', 'en-CA', 'en-NZ', 'en-IN', 'en-ZA'];
const TIMEZONES = [
    'America/New_York', 'America/Chicago', 'America/Los_Angeles',
    'America/Denver', 'America/Phoenix', 'America/Toronto',
    'Europe/London', 'Europe/Berlin', 'Europe/Paris',
    'Australia/Sydney', 'Asia/Tokyo', 'Asia/Singapore'
];

const WEBGL_VENDORS = [
    'Google Inc. (NVIDIA)',
    'Google Inc. (AMD)',
    'Google Inc. (Intel)',
    'Google Inc. (ATI Technologies Inc.)',
];

const WEBGL_RENDERERS = [
    'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'ANGLE (NVIDIA, NVIDIA GeForce RTX 2060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
];

function getRandomFingerprint() {
    let userAgent = randomUseragent.getRandom(ua => {
        return (ua.browserName === 'Chrome' || ua.browserName === 'Firefox' || ua.browserName === 'Edge') &&
               parseFloat(ua.browserMajor) >= 100 &&
               ua.osName !== 'Android' && ua.osName !== 'iOS';
    });

    if (!userAgent) {
        userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    }

    const viewport = { ...VIEWPORTS[Math.floor(Math.random() * VIEWPORTS.length)] };
    const locale = LOCALES[Math.floor(Math.random() * LOCALES.length)];
    const timezoneId = TIMEZONES[Math.floor(Math.random() * TIMEZONES.length)];
    
    // Slight jitter to viewport
    if (Math.random() > 0.5) {
        viewport.width -= Math.floor(Math.random() * 80);
        viewport.height -= Math.floor(Math.random() * 60);
    }

    return {
        userAgent,
        viewport,
        locale,
        timezoneId,
        colorScheme: Math.random() > 0.5 ? 'dark' : 'light',
        deviceScaleFactor: Math.random() > 0.8 ? 2 : 1,
        hasTouch: false,
        // Deep fingerprint data
        webglVendor: WEBGL_VENDORS[Math.floor(Math.random() * WEBGL_VENDORS.length)],
        webglRenderer: WEBGL_RENDERERS[Math.floor(Math.random() * WEBGL_RENDERERS.length)],
        canvasSeed: Math.random(),
        audioSeed: Math.random(),
        hardwareConcurrency: [2, 4, 6, 8, 12, 16][Math.floor(Math.random() * 6)],
        deviceMemory: [2, 4, 8, 16][Math.floor(Math.random() * 4)],
        maxTouchPoints: 0,
        platform: 'Win32',
        screenColorDepth: [24, 32][Math.floor(Math.random() * 2)],
    };
}

/**
 * Injects anti-fingerprinting overrides into a Playwright page context.
 * This spoofs Canvas, WebGL, AudioContext, Navigator, WebRTC, and more.
 */
function getAntiFingerprintScript(fp) {
    return `
    // === CANVAS FINGERPRINT SPOOFING ===
    (function() {
        const seed = ${fp.canvasSeed};
        const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
        const origToBlob = HTMLCanvasElement.prototype.toBlob;
        const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;

        // Add subtle noise to canvas pixel data
        function addNoise(imageData) {
            const data = imageData.data;
            for (let i = 0; i < data.length; i += 4) {
                // Add tiny random noise based on seed so it's consistent per session but unique per fingerprint
                const noise = ((seed * 1000 + i) % 3) - 1; // -1, 0, or 1
                data[i] = Math.max(0, Math.min(255, data[i] + noise));     // R
                data[i+1] = Math.max(0, Math.min(255, data[i+1] + noise)); // G
            }
            return imageData;
        }

        CanvasRenderingContext2D.prototype.getImageData = function() {
            const imageData = origGetImageData.apply(this, arguments);
            return addNoise(imageData);
        };

        HTMLCanvasElement.prototype.toDataURL = function() {
            const ctx = this.getContext('2d');
            if (ctx) {
                try {
                    const imageData = origGetImageData.call(ctx, 0, 0, this.width, this.height);
                    addNoise(imageData);
                    ctx.putImageData(imageData, 0, 0);
                } catch(e) {}
            }
            return origToDataURL.apply(this, arguments);
        };

        HTMLCanvasElement.prototype.toBlob = function() {
            const ctx = this.getContext('2d');
            if (ctx) {
                try {
                    const imageData = origGetImageData.call(ctx, 0, 0, this.width, this.height);
                    addNoise(imageData);
                    ctx.putImageData(imageData, 0, 0);
                } catch(e) {}
            }
            return origToBlob.apply(this, arguments);
        };
    })();

    // === WEBGL FINGERPRINT SPOOFING ===
    (function() {
        const vendor = '${fp.webglVendor}';
        const renderer = '${fp.webglRenderer}';
        
        const getParameterOrig = WebGLRenderingContext.prototype.getParameter;
        WebGLRenderingContext.prototype.getParameter = function(param) {
            if (param === 37445) return vendor;   // UNMASKED_VENDOR_WEBGL
            if (param === 37446) return renderer;  // UNMASKED_RENDERER_WEBGL
            return getParameterOrig.call(this, param);
        };

        if (typeof WebGL2RenderingContext !== 'undefined') {
            const getParameterOrig2 = WebGL2RenderingContext.prototype.getParameter;
            WebGL2RenderingContext.prototype.getParameter = function(param) {
                if (param === 37445) return vendor;
                if (param === 37446) return renderer;
                return getParameterOrig2.call(this, param);
            };
        }
    })();

    // === AUDIOCTX FINGERPRINT SPOOFING ===
    (function() {
        const audioSeed = ${fp.audioSeed};
        if (typeof AudioBuffer !== 'undefined') {
            const origGetChannelData = AudioBuffer.prototype.getChannelData;
            AudioBuffer.prototype.getChannelData = function(channel) {
                const data = origGetChannelData.call(this, channel);
                // Add tiny noise to audio fingerprint
                for (let i = 0; i < Math.min(data.length, 100); i++) {
                    data[i] += (audioSeed * 0.00001 * ((i % 7) - 3));
                }
                return data;
            };
        }
    })();

    // === NAVIGATOR OVERRIDES ===
    (function() {
        Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => ${fp.hardwareConcurrency} });
        Object.defineProperty(navigator, 'deviceMemory', { get: () => ${fp.deviceMemory} });
        Object.defineProperty(navigator, 'maxTouchPoints', { get: () => ${fp.maxTouchPoints} });
        Object.defineProperty(navigator, 'platform', { get: () => '${fp.platform}' });
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        Object.defineProperty(navigator, 'vendor', { get: () => 'Google Inc.' });
        Object.defineProperty(navigator, 'productSub', { get: () => '20030107' });
        
        // Hide automation indicators
        Object.defineProperty(navigator, 'languages', { get: () => ['${fp.locale}', '${fp.locale.split('-')[0]}'] });
        
        // window.chrome spoofing
        window.chrome = {
            runtime: {},
            loadTimes: function() {},
            csi: function() {},
            app: {}
        };

        // Plugin spoofing
        Object.defineProperty(navigator, 'plugins', { get: () => {
            const plugins = [
                { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
                { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: 'Google Chrome PDF Viewer' },
                { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' }
            ];
            plugins.item = (i) => plugins[i];
            plugins.namedItem = (n) => plugins.find(p => p.name === n);
            return plugins;
        }});
    })();

    // === WEBRTC IP LEAK PREVENTION ===
    (function() {
        if (typeof RTCPeerConnection !== 'undefined') {
            const origRTC = RTCPeerConnection;
            window.RTCPeerConnection = function(config) {
                if (config && config.iceServers) {
                    config.iceServers = [];
                }
                return new origRTC(config);
            };
            window.RTCPeerConnection.prototype = origRTC.prototype;
        }
        // Also block mozRTC and webkit variants
        if (typeof webkitRTCPeerConnection !== 'undefined') {
            window.webkitRTCPeerConnection = undefined;
        }
    })();

    // === SCREEN PROPERTIES ===
    (function() {
        Object.defineProperty(screen, 'colorDepth', { get: () => ${fp.screenColorDepth} });
        Object.defineProperty(screen, 'pixelDepth', { get: () => ${fp.screenColorDepth} });
        Object.defineProperty(screen, 'width', { get: () => ${fp.viewport.width} });
        Object.defineProperty(screen, 'height', { get: () => ${fp.viewport.height} });
        Object.defineProperty(screen, 'availWidth', { get: () => ${fp.viewport.width} });
        Object.defineProperty(screen, 'availHeight', { get: () => ${fp.viewport.height - 40} });
    })();

    // === PERMISSION API SPOOFING ===
    (function() {
        if (navigator.permissions) {
            const origQuery = navigator.permissions.query;
            navigator.permissions.query = function(desc) {
                if (desc.name === 'notifications') {
                    return Promise.resolve({ state: 'prompt' });
                }
                return origQuery.call(this, desc);
            };
        }
    })();
    `;
}

/**
 * Apply anti-fingerprint script to a browser context so every new page gets it.
 */
async function applyAntiFingerprint(context, fp) {
    await context.addInitScript(getAntiFingerprintScript(fp));
}

module.exports = { getRandomFingerprint, applyAntiFingerprint };
