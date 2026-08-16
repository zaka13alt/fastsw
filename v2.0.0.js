// ==========================================
// idk why ur here but do something ig with it
// ==========================================
const PROXY_PREFIX = '/go/';
const WISP_SERVER_URL = 'wss://wisp.mercurywork.shop/wisp/'; 

// XOR Encryption Keys
const XOR_KEY1 = 0x5A;
const XOR_KEY2 = 0x3C;
const XOR_KEY3 = 0xF1;
const XOR_KEYS = [XOR_KEY1, XOR_KEY2, XOR_KEY3];

// CDN parts for libcurl
const cndPart1 = 'https://cdn.';
const cndPart2 = 'jsdelivr.net/';
const cndPart3 = 'npm/libcurl.js';
const cndPart4 = '@latest/';
const cndPart5 = 'libcurl_full.js';

const libcurlUrl = cndPart1 + cndPart2 + cndPart3 + cndPart4 + cndPart5;

try {
    importScripts(libcurlUrl);
} catch (e) {
    console.error("[sw-helper] Failed to load libcurl.js dependency.", e);
}

let libcurlReady = false;

if (typeof libcurl !== 'undefined') {
    if (typeof libcurl.set_websocket === 'function') {
        libcurl.set_websocket(WISP_SERVER_URL);
    }
    
    if (libcurl.ready) {
        libcurlReady = true;
    } else {
        libcurl.onload = () => {
            console.log("[sw-helper] libcurl WebAssembly components initialized successfully.");
            libcurlReady = true;
        };
    }
} else {
    console.warn("[sw-helper] libcurl library is not globally accessible yet.");
}

// ==========================================
// XOR ENCODING/DECODING UTILITIES
// ==========================================
class XORCoder {
    constructor() {
        this.keys = XOR_KEYS;
    }

    encode(str) {
        if (!str) return str;
        try {
            const bytes = new TextEncoder().encode(str);
            const encoded = new Uint8Array(bytes.length);
            for (let i = 0; i < bytes.length; i++) {
                encoded[i] = bytes[i] ^ this.keys[i % this.keys.length];
            }
            return btoa(String.fromCharCode(...encoded));
        } catch (e) {
            return str;
        }
    }

    decode(encoded) {
        if (!encoded) return encoded;
        try {
            const binary = atob(encoded);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i) ^ this.keys[i % this.keys.length];
            }
            return new TextDecoder().decode(bytes);
        } catch (e) {
            return encoded;
        }
    }

    encodeURL(url) {
        if (!url) return url;
        return this.encode(url);
    }

    decodeURL(encoded) {
        if (!encoded) return encoded;
        return this.decode(encoded);
    }
}

const xorCoder = new XORCoder();

// ==========================================
// ADVANCED COOKIE JAR WITH DOMAIN ISOLATION
// ==========================================
class CookieJar {
    constructor() {
        this.cookieStore = new Map();
        this.cookieMetadata = new Map();
        this.domainContext = new Map();
        this.sessionCookieStore = new Map();
    }

    getDomainKey(url) {
        try {
            const urlObj = new URL(url);
            let hostname = urlObj.hostname;
            if (hostname.match(/^\d+\.\d+\.\d+\.\d+$/)) {
                return hostname;
            }
            const parts = hostname.split('.');
            if (parts.length > 2) {
                const publicSuffixes = ['com', 'org', 'net', 'gov', 'edu', 'co', 'uk', 'au', 'ca', 'de', 'fr', 'jp', 'cn', 'ru', 'br', 'in', 'it', 'nl', 'es', 'se', 'no', 'fi', 'dk', 'pl', 'cz', 'at', 'ch', 'be', 'ie', 'nz', 'za', 'mx', 'ar', 'cl', 'pe', 've', 'my', 'ph', 'sg', 'th', 'vn', 'id', 'tr', 'gr', 'pt', 'il', 'sa', 'ae', 'eg', 'ng', 'ke', 'gh', 'za', 'ma', 'dz', 'tn', 'jo', 'lb', 'kw', 'bh', 'qa', 'om', 'ye', 'sy', 'iq', 'ly', 'sd', 'so', 'dj', 'er', 'et', 'tz', 'ug', 'zm', 'zw', 'mw', 'mz', 'ao', 'cm', 'ci', 'sn', 'ml', 'bf', 'ne', 'td', 'cf', 'cg', 'ga', 'gq', 'st', 'cv', 'sc', 'mu', 'km', 'mg', 're', 'yt', 'tf', 'wf', 'pf', 'nc', 'vu', 'sb', 'ki', 'tv', 'nr', 'pw', 'fm', 'mh', 'to', 'ws', 'fj', 'pg', 'tl', 'bn', 'kh', 'la', 'mm', 'bt', 'np', 'mv', 'lk', 'bd', 'pk', 'af', 'tj', 'tm', 'kg', 'uz', 'az', 'ge', 'am', 'md', 'ua', 'by', 'lt', 'lv', 'ee', 'si', 'hr', 'ba', 'rs', 'me', 'mk', 'al', 'bg', 'ro', 'hu', 'sk'];
                const lastPart = parts[parts.length - 1];
                if (publicSuffixes.includes(lastPart)) {
                    return parts.slice(-2).join('.');
                }
                return parts.slice(-2).join('.');
            }
            return hostname;
        } catch (e) {
            return 'default';
        }
    }

    parseCookieString(cookieStr) {
        const cookies = [];
        if (!cookieStr) return cookies;
        
        const cookieParts = cookieStr.split(';');
        let mainCookie = null;
        let attributes = {};
        
        cookieParts.forEach((part, index) => {
            const trimmed = part.trim();
            if (!trimmed) return;
            
            const [name, ...valueParts] = trimmed.split('=');
            const value = valueParts.join('=');
            
            if (index === 0) {
                mainCookie = { name: name.trim(), value: value };
            } else {
                const attrName = name.trim().toLowerCase();
                if (attrName === 'expires') {
                    attributes.expires = new Date(value);
                } else if (attrName === 'max-age') {
                    const maxAge = parseInt(value);
                    if (!isNaN(maxAge)) {
                        attributes.expires = new Date(Date.now() + maxAge * 1000);
                    }
                } else if (attrName === 'domain') {
                    attributes.domain = value;
                } else if (attrName === 'path') {
                    attributes.path = value;
                } else if (attrName === 'secure') {
                    attributes.secure = true;
                } else if (attrName === 'httponly') {
                    attributes.httpOnly = true;
                } else if (attrName === 'samesite') {
                    attributes.sameSite = value;
                }
            }
        });
        
        if (mainCookie) {
            cookies.push({
                ...mainCookie,
                ...attributes
            });
        }
        
        return cookies;
    }

    serializeCookies(cookies) {
        return cookies.map(cookie => {
            let str = `${cookie.name}=${cookie.value}`;
            if (cookie.expires) {
                str += `; Expires=${cookie.expires.toUTCString()}`;
            }
            if (cookie.domain) {
                str += `; Domain=${cookie.domain}`;
            }
            if (cookie.path) {
                str += `; Path=${cookie.path}`;
            }
            if (cookie.secure) {
                str += `; Secure`;
            }
            if (cookie.httpOnly) {
                str += `; HttpOnly`;
            }
            if (cookie.sameSite) {
                str += `; SameSite=${cookie.sameSite}`;
            }
            return str;
        }).join('; ');
    }

    setCookies(url, cookieString) {
        const domain = this.getDomainKey(url);
        if (!domain) return;
        
        if (!this.cookieStore.has(domain)) {
            this.cookieStore.set(domain, new Map());
            this.cookieMetadata.set(domain, new Map());
        }
        
        const domainCookies = this.cookieStore.get(domain);
        const domainMetadata = this.cookieMetadata.get(domain);
        const parsedCookies = this.parseCookieString(cookieString);
        
        parsedCookies.forEach(cookie => {
            if (!cookie.name) return;
            
            if (cookie.expires && cookie.expires < new Date()) {
                domainCookies.delete(cookie.name);
                domainMetadata.delete(cookie.name);
                return;
            }
            
            domainCookies.set(cookie.name, cookie.value);
            
            const metadata = {
                expires: cookie.expires || null,
                domain: cookie.domain || domain,
                path: cookie.path || '/',
                secure: cookie.secure || false,
                httpOnly: cookie.httpOnly || false,
                sameSite: cookie.sameSite || 'Lax'
            };
            domainMetadata.set(cookie.name, metadata);
        });
    }

    getCookies(url, cookieNames = null) {
        const domain = this.getDomainKey(url);
        if (!domain || !this.cookieStore.has(domain)) return '';
        
        const domainCookies = this.cookieStore.get(domain);
        const domainMetadata = this.cookieMetadata.get(domain);
        const cookiePairs = [];
        
        const toRemove = [];
        for (const [name, metadata] of domainMetadata) {
            if (metadata.expires && metadata.expires < new Date()) {
                toRemove.push(name);
            }
        }
        toRemove.forEach(name => {
            domainCookies.delete(name);
            domainMetadata.delete(name);
        });
        
        if (cookieNames) {
            const names = Array.isArray(cookieNames) ? cookieNames : [cookieNames];
            names.forEach(name => {
                if (domainCookies.has(name)) {
                    cookiePairs.push(`${name}=${domainCookies.get(name)}`);
                }
            });
        } else {
            const urlPath = new URL(url).pathname || '/';
            for (const [name, value] of domainCookies) {
                const metadata = domainMetadata.get(name);
                if (metadata) {
                    if (metadata.path && !urlPath.startsWith(metadata.path)) {
                        continue;
                    }
                    if (metadata.secure && new URL(url).protocol !== 'https:') {
                        continue;
                    }
                }
                cookiePairs.push(`${name}=${value}`);
            }
        }
        
        return cookiePairs.join('; ');
    }

    getCookieObjects(url) {
        const domain = this.getDomainKey(url);
        if (!domain || !this.cookieStore.has(domain)) return [];
        
        const domainCookies = this.cookieStore.get(domain);
        const domainMetadata = this.cookieMetadata.get(domain);
        const cookies = [];
        
        for (const [name, value] of domainCookies) {
            const metadata = domainMetadata.get(name) || {};
            cookies.push({
                name,
                value,
                ...metadata
            });
        }
        
        return cookies;
    }

    deleteCookie(url, name) {
        const domain = this.getDomainKey(url);
        if (!domain || !this.cookieStore.has(domain)) return;
        
        this.cookieStore.get(domain).delete(name);
        this.cookieMetadata.get(domain).delete(name);
    }

    clearDomainCookies(url) {
        const domain = this.getDomainKey(url);
        if (!domain) return;
        
        this.cookieStore.delete(domain);
        this.cookieMetadata.delete(domain);
    }

    clearAllCookies() {
        this.cookieStore.clear();
        this.cookieMetadata.clear();
    }

    getDomainContext(clientId) {
        return this.domainContext.get(clientId) || null;
    }

    setDomainContext(clientId, domain) {
        if (domain) {
            this.domainContext.set(clientId, domain);
        } else {
            this.domainContext.delete(clientId);
        }
    }

    hasCookie(url, name) {
        const domain = this.getDomainKey(url);
        if (!domain || !this.cookieStore.has(domain)) return false;
        return this.cookieStore.get(domain).has(name);
    }

    getCookieValue(url, name) {
        const domain = this.getDomainKey(url);
        if (!domain || !this.cookieStore.has(domain)) return null;
        return this.cookieStore.get(domain).get(name) || null;
    }

    getSessionCookies(sessionId) {
        return this.sessionCookieStore.get(sessionId) || null;
    }

    setSessionCookies(sessionId, cookies) {
        this.sessionCookieStore.set(sessionId, cookies);
    }
}

const cookieJar = new CookieJar();

// ==========================================
// COMPLETE REWRITER WITH LIBCURL.JS INTEGRATION
// ==========================================
const REWRITER_SCRIPT = `(function() {
    'use strict';
    
    if (window.__rewriter_initialized) return;
    window.__rewriter_initialized = true;
    window.__rewriter_version = '8.0.0-LIBCURL';

    const PROXY_PREFIX = '/go/';
    const PROXY_HOST = window.location.host;
    const PROXY_ORIGIN = window.location.origin;

    // XOR Keys
    const XOR_KEYS = [0x5A, 0x3C, 0xF1];

    // ----- XOR ENCODING -----
    function xorEncode(str) {
        if (!str) return str;
        try {
            const bytes = new TextEncoder().encode(str);
            const encoded = new Uint8Array(bytes.length);
            for (let i = 0; i < bytes.length; i++) {
                encoded[i] = bytes[i] ^ XOR_KEYS[i % XOR_KEYS.length];
            }
            return btoa(String.fromCharCode(...encoded));
        } catch (e) {
            return str;
        }
    }

    function xorDecode(encoded) {
        if (!encoded) return encoded;
        try {
            const binary = atob(encoded);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i) ^ XOR_KEYS[i % XOR_KEYS.length];
            }
            return new TextDecoder().decode(bytes);
        } catch (e) {
            return encoded;
        }
    }

    // ----- URL FUNCTIONS -----
    const urlCache = new Map();
    const MAX_CACHE_SIZE = 2000;

    function rewriteUrl(url) {
        if (!url || typeof url !== 'string') return url;
        
        if (urlCache.has(url)) {
            return urlCache.get(url);
        }
        
        const trimmed = url.trim();
        if (trimmed.startsWith('data:') || trimmed.startsWith('blob:') || 
            trimmed.startsWith('javascript:') || trimmed.startsWith('about:') ||
            trimmed.startsWith('chrome-extension:') || trimmed.startsWith('file:') ||
            trimmed.startsWith(PROXY_PREFIX) || trimmed.startsWith(PROXY_ORIGIN + PROXY_PREFIX) ||
            trimmed.includes('/rewriter.js')) {
            return url;
        }
        
        try {
            const baseContext = window.location.href;
            const resolved = new URL(trimmed, baseContext).href;
            const encoded = xorEncode(resolved);
            const result = PROXY_PREFIX + encoded;
            
            if (urlCache.size < MAX_CACHE_SIZE) {
                urlCache.set(url, result);
            }
            return result;
        } catch (e) {
            return url;
        }
    }

    function unproxyUrl(url) {
        if (!url || typeof url !== 'string') return url;
        if (url.includes(PROXY_PREFIX)) {
            try {
                const parts = url.split(PROXY_PREFIX);
                const encoded = parts[parts.length - 1];
                try {
                    const decoded = xorDecode(encoded);
                    if (decoded && decoded.startsWith('http')) {
                        return decoded;
                    }
                } catch(e) {}
                try {
                    return decodeURIComponent(encoded);
                } catch(e) {}
            } catch (e) {}
        }
        return url;
    }

    function getCurrentDomain() {
        try {
            const url = unproxyUrl(window.location.href);
            if (url) {
                return new URL(url).hostname;
            }
        } catch (e) {}
        return 'default';
    }

    // ----- LIBCURL.JS INTEGRATION -----
    function createLibCurlSession() {
        try {
            // Create a new HTTP session with cookie support
            const session = new libcurl.HTTPSession({
                enable_cookies: true,
                cookie_jar: ''
            });
            
            // Set the base URL for relative URLs
            const currentUrl = unproxyUrl(window.location.href);
            if (currentUrl) {
                const urlObj = new URL(currentUrl);
                session.base_url = urlObj.origin;
            }
            
            return session;
        } catch(e) {
            console.error('[sw-helper] Failed to create libcurl session:', e);
            return null;
        }
    }

    // ----- WEBSOCKET TUNNELING WITH LIBCURL -----
    function createProxiedWebSocket(url, protocols) {
        try {
            const targetUrl = new URL(url, window.location.href);
            const domain = getCurrentDomain();
            const encodedTarget = xorEncode(targetUrl.href);
            
            // Get cookies for this domain
            let cookieHeader = '';
            try {
                cookieHeader = document.cookie;
            } catch(e) {}
            
            // Use libcurl.CurlWebSocket for proper WebSocket tunneling
            const ws = new libcurl.CurlWebSocket(targetUrl.href, protocols || [], {
                verbose: 1,
                headers: {
                    'Cookie': cookieHeader || '',
                    'User-Agent': navigator.userAgent,
                    'X-Proxied-Domain': domain,
                    'X-Original-URL': targetUrl.href,
                    'Origin': targetUrl.origin
                }
            });
            
            // Create a proxy that mimics the native WebSocket API
            const handlers = {
                _ws: ws,
                _listeners: new Map(),
                _readyState: 0
            };
            
            // Map libcurl events to native events
            ws.onopen = function(event) {
                handlers._readyState = 1;
                handlers._listeners.forEach((listeners, type) => {
                    if (type === 'open') {
                        listeners.forEach(listener => {
                            try {
                                listener(event);
                            } catch(e) {}
                        });
                    }
                });
                console.log('[sw-helper] WebSocket connected to:', targetUrl.href);
            };
            
            ws.onmessage = function(data) {
                handlers._listeners.forEach((listeners, type) => {
                    if (type === 'message') {
                        listeners.forEach(listener => {
                            try {
                                listener({ data: data, origin: targetUrl.origin });
                            } catch(e) {}
                        });
                    }
                });
            };
            
            ws.onerror = function(error) {
                handlers._listeners.forEach((listeners, type) => {
                    if (type === 'error') {
                        listeners.forEach(listener => {
                            try {
                                listener(error);
                            } catch(e) {}
                        });
                    }
                });
                console.error('[sw-helper] WebSocket error:', error);
            };
            
            ws.onclose = function(event) {
                handlers._readyState = 3;
                handlers._listeners.forEach((listeners, type) => {
                    if (type === 'close') {
                        listeners.forEach(listener => {
                            try {
                                listener({ code: 1000, reason: '', wasClean: true });
                            } catch(e) {}
                        });
                    }
                });
                console.log('[sw-helper] WebSocket closed');
            };
            
            // Return a proxy that handles the native WebSocket API
            return new Proxy(ws, {
                get(target, prop) {
                    if (prop === 'send') {
                        return function(data) {
                            if (ws && typeof ws.send === 'function') {
                                try {
                                    ws.send(data);
                                } catch(e) {
                                    console.error('[sw-helper] WebSocket send error:', e);
                                }
                            }
                        };
                    }
                    if (prop === 'close') {
                        return function(code, reason) {
                            if (ws && typeof ws.close === 'function') {
                                try {
                                    ws.close(code, reason);
                                } catch(e) {}
                            }
                        };
                    }
                    if (prop === 'addEventListener') {
                        return function(type, listener, options) {
                            if (!handlers._listeners.has(type)) {
                                handlers._listeners.set(type, new Set());
                            }
                            handlers._listeners.get(type).add(listener);
                        };
                    }
                    if (prop === 'removeEventListener') {
                        return function(type, listener, options) {
                            if (handlers._listeners.has(type)) {
                                handlers._listeners.get(type).delete(listener);
                            }
                        };
                    }
                    if (prop === 'readyState') {
                        return handlers._readyState;
                    }
                    if (prop === 'url') {
                        return targetUrl.href;
                    }
                    if (prop === 'protocol') {
                        return protocols && protocols.length > 0 ? protocols[0] : '';
                    }
                    if (prop === 'onopen' || prop === 'onmessage' || prop === 'onerror' || prop === 'onclose') {
                        return function(listener) {
                            if (prop === 'onopen') {
                                ws.onopen = listener;
                            } else if (prop === 'onmessage') {
                                ws.onmessage = listener;
                            } else if (prop === 'onerror') {
                                ws.onerror = listener;
                            } else if (prop === 'onclose') {
                                ws.onclose = listener;
                            }
                        };
                    }
                    return target[prop];
                }
            });
        } catch(e) {
            console.error('[sw-helper] WebSocket tunneling error:', e);
            // Fallback to native WebSocket
            if (window.__native_websocket) {
                return new window.__native_websocket(url, protocols);
            }
            return null;
        }
    }

    // ----- INTERCEPT WEBSOCKET -----
    function interceptWebSocket() {
        window.__native_websocket = window.WebSocket;
        
        window.WebSocket = function(url, protocols) {
            try {
                if (url && typeof url === 'string' && !url.includes('/rewriter.js')) {
                    if (!url.startsWith(PROXY_PREFIX) && !url.startsWith(PROXY_ORIGIN + PROXY_PREFIX)) {
                        return createProxiedWebSocket(url, protocols);
                    }
                }
            } catch(e) {
                console.error('[sw-helper] WebSocket interception error:', e);
            }
            return new window.__native_websocket(url, protocols);
        };
        
        window.WebSocket.prototype = window.__native_websocket.prototype;
        window.WebSocket.prototype.constructor = window.WebSocket;
        
        for (const key in window.__native_websocket) {
            if (!window.WebSocket[key]) {
                window.WebSocket[key] = window.__native_websocket[key];
            }
        }
        
        window.WebSocket.CONNECTING = 0;
        window.WebSocket.OPEN = 1;
        window.WebSocket.CLOSING = 2;
        window.WebSocket.CLOSED = 3;
    }

    // ----- INTERCEPT FETCH WITH LIBCURL -----
    function interceptFetch() {
        const nativeFetch = window.fetch;
        window.fetch = function(input, init) {
            try {
                let url = typeof input === 'string' ? input : input.url;
                
                if (typeof input === 'string' && !input.includes('/rewriter.js')) {
                    if (!input.startsWith(PROXY_PREFIX) && !input.startsWith(PROXY_ORIGIN + PROXY_PREFIX)) {
                        input = rewriteUrl(input);
                    }
                } else if (input instanceof Request) {
                    const requestUrl = input.url;
                    if (!requestUrl.startsWith(PROXY_PREFIX) && !requestUrl.startsWith(PROXY_ORIGIN + PROXY_PREFIX)) {
                        const newUrl = rewriteUrl(requestUrl);
                        if (newUrl !== requestUrl) {
                            input = new Request(newUrl, input);
                        }
                    }
                }
                
                // Add cookies to request
                if (init) {
                    init.headers = new Headers(init.headers || {});
                    try {
                        const cookies = document.cookie;
                        if (cookies) {
                            init.headers.set('Cookie', cookies);
                        }
                    } catch(e) {}
                }
                
                return nativeFetch.call(this, input, init);
            } catch(e) {
                return nativeFetch.call(this, input, init);
            }
        };
        window.fetch.prototype = nativeFetch.prototype;
    }

    // ----- INTERCEPT XMLHttpRequest -----
    function interceptXHR() {
        const nativeXHROpen = XMLHttpRequest.prototype.open;
        const nativeXHRSend = XMLHttpRequest.prototype.send;
        const xhrMap = new WeakMap();

        XMLHttpRequest.prototype.open = function(method, url, async, user, password) {
            try {
                let originalUrl = url;
                if (url && typeof url === 'string' && !url.includes('/rewriter.js')) {
                    if (!url.startsWith(PROXY_PREFIX) && !url.startsWith(PROXY_ORIGIN + PROXY_PREFIX)) {
                        url = rewriteUrl(url);
                    }
                    xhrMap.set(this, { method, originalUrl, proxiedUrl: url });
                }
            } catch(e) {}
            return nativeXHROpen.call(this, method, url, async, user, password);
        };

        XMLHttpRequest.prototype.send = function(body) {
            try {
                // Add cookies
                try {
                    const cookies = document.cookie;
                    if (cookies) {
                        this.setRequestHeader('Cookie', cookies);
                    }
                } catch(e) {}
                
                // Intercept FormData
                if (body instanceof FormData) {
                    const entries = Array.from(body.entries());
                    let needsRewrite = false;
                    const newEntries = entries.map(([key, value]) => {
                        if (typeof value === 'string' && (value.includes('http://') || value.includes('https://'))) {
                            try {
                                new URL(value);
                                needsRewrite = true;
                                return [key, rewriteUrl(value)];
                            } catch(e) {}
                        }
                        return [key, value];
                    });
                    
                    if (needsRewrite) {
                        const newFormData = new FormData();
                        newEntries.forEach(([key, value]) => {
                            newFormData.append(key, value);
                        });
                        body = newFormData;
                    }
                }
                
                this.setRequestHeader('X-Proxied', 'true');
            } catch(e) {}
            return nativeXHRSend.call(this, body);
        };
    }

    // ----- INTERCEPT DOCUMENT.COOKIE -----
    function interceptDocumentCookie() {
        const cookieDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
        if (cookieDescriptor) {
            Object.defineProperty(document, 'cookie', {
                get: function() {
                    try {
                        // Get cookies from the cookie jar via service worker
                        const domain = getCurrentDomain();
                        const url = window.location.href;
                        // Use synchronous method to get cookies
                        return cookieJarClient.getCookiesSync();
                    } catch(e) {
                        return '';
                    }
                },
                set: function(value) {
                    try {
                        // Set cookies in the cookie jar via service worker
                        cookieJarClient.setCookies(value);
                    } catch(e) {}
                    return value;
                },
                configurable: true
            });
        }
    }

    // ----- COOKIE JAR CLIENT INTERFACE -----
    const cookieJarClient = {
        getCookiesSync() {
            try {
                const domain = getCurrentDomain();
                const url = window.location.href;
                // Send synchronous message to service worker
                if (navigator.serviceWorker && navigator.serviceWorker.controller) {
                    const channel = new MessageChannel();
                    let result = '';
                    channel.port1.onmessage = (event) => {
                        result = event.data || '';
                    };
                    try {
                        navigator.serviceWorker.controller.postMessage({
                            type: 'getCookiesSync',
                            domain: domain,
                            url: url
                        }, [channel.port2]);
                        // Wait for response (synchronous wait)
                        const start = Date.now();
                        while (result === '' && Date.now() - start < 100) {
                            // Busy wait for response
                        }
                        return result;
                    } catch(e) {
                        return '';
                    }
                }
                return '';
            } catch(e) {
                return '';
            }
        },

        getCookies() {
            return new Promise((resolve) => {
                try {
                    const domain = getCurrentDomain();
                    const url = window.location.href;
                    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
                        const channel = new MessageChannel();
                        channel.port1.onmessage = (event) => {
                            resolve(event.data || '');
                        };
                        navigator.serviceWorker.controller.postMessage({
                            type: 'getCookies',
                            domain: domain,
                            url: url
                        }, [channel.port2]);
                    } else {
                        resolve('');
                    }
                } catch(e) {
                    resolve('');
                }
            });
        },

        setCookies(cookieString) {
            try {
                const domain = getCurrentDomain();
                const url = window.location.href;
                if (navigator.serviceWorker && navigator.serviceWorker.controller) {
                    navigator.serviceWorker.controller.postMessage({
                        type: 'setCookies',
                        domain: domain,
                        url: url,
                        cookies: cookieString
                    });
                }
            } catch(e) {}
        },

        deleteCookie(name) {
            try {
                const domain = getCurrentDomain();
                const url = window.location.href;
                if (navigator.serviceWorker && navigator.serviceWorker.controller) {
                    navigator.serviceWorker.controller.postMessage({
                        type: 'deleteCookie',
                        domain: domain,
                        url: url,
                        name: name
                    });
                }
            } catch(e) {}
        }
    };

    // ----- COMPLETE FORM HANDLING -----
    function handleFormSubmission(form, event) {
        try {
            if (!form) return false;
            
            const action = form.getAttribute('action') || window.location.href;
            const method = (form.getAttribute('method') || 'GET').toUpperCase();
            const enctype = form.getAttribute('enctype') || 'application/x-www-form-urlencoded';
            const formData = new FormData(form);
            
            if (method === 'GET') {
                const url = new URL(rewriteUrl(action));
                for (let [key, value] of formData.entries()) {
                    if (typeof value === 'string') {
                        url.searchParams.append(key, value);
                    }
                }
                
                if (event) {
                    event.preventDefault();
                    event.stopPropagation();
                }
                
                fetch(url.href, {
                    method: 'GET',
                    headers: {
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                        'User-Agent': navigator.userAgent
                    },
                    credentials: 'include'
                })
                .then(response => {
                    if (response.redirected) {
                        window.location.href = response.url;
                        return;
                    }
                    return response.text().then(html => {
                        const contentType = response.headers.get('content-type') || '';
                        if (contentType.includes('text/html')) {
                            document.open();
                            document.write(html);
                            document.close();
                            if (window.history && window.history.pushState) {
                                window.history.pushState({}, '', url.href);
                            }
                        }
                    });
                })
                .catch(() => {
                    window.location.href = url.href;
                });
                
                return true;
            }
            
            if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
                if (event) {
                    event.preventDefault();
                    event.stopPropagation();
                }
                
                const options = {
                    method: method,
                    headers: {
                        'X-Form-Submission': 'true',
                        'User-Agent': navigator.userAgent
                    },
                    credentials: 'include'
                };
                
                if (enctype === 'multipart/form-data') {
                    options.body = formData;
                } else if (enctype === 'application/x-www-form-urlencoded') {
                    options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
                    const params = new URLSearchParams();
                    for (let [key, value] of formData.entries()) {
                        if (typeof value === 'string') {
                            params.append(key, value);
                        }
                    }
                    options.body = params.toString();
                } else if (enctype === 'application/json') {
                    options.headers['Content-Type'] = 'application/json';
                    const json = {};
                    for (let [key, value] of formData.entries()) {
                        json[key] = value;
                    }
                    options.body = JSON.stringify(json);
                } else {
                    options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
                    const params = new URLSearchParams();
                    for (let [key, value] of formData.entries()) {
                        if (typeof value === 'string') {
                            params.append(key, value);
                        }
                    }
                    options.body = params.toString();
                }
                
                const targetUrl = rewriteUrl(action);
                fetch(targetUrl, options)
                    .then(response => {
                        if (response.redirected) {
                            window.location.href = response.url;
                            return;
                        }
                        return response.text().then(html => {
                            const contentType = response.headers.get('content-type') || '';
                            if (contentType.includes('text/html')) {
                                document.open();
                                document.write(html);
                                document.close();
                            }
                        });
                    })
                    .catch(error => {
                        console.error('[sw-helper] Form submission failed:', error);
                    });
                
                return true;
            }
            
            return false;
        } catch(e) {
            console.error('[sw-helper] Form handling error:', e);
            return false;
        }
    }

    // ----- INTERCEPT FORM SUBMISSIONS -----
    function setupFormInterception() {
        document.addEventListener('submit', function(event) {
            const form = event.target;
            if (form && form.tagName && form.tagName.toLowerCase() === 'form') {
                if (form.dataset.intercepted) return;
                form.dataset.intercepted = 'true';
                handleFormSubmission(form, event);
            }
        }, true);

        const originalSubmit = HTMLFormElement.prototype.submit;
        HTMLFormElement.prototype.submit = function() {
            if (this.dataset && this.dataset.intercepted === 'true') {
                return originalSubmit.call(this);
            }
            if (this.dataset) {
                this.dataset.intercepted = 'true';
            }
            const handled = handleFormSubmission(this);
            if (!handled) {
                if (this.dataset) {
                    delete this.dataset.intercepted;
                }
                return originalSubmit.call(this);
            }
        };
    }

    // ----- INTERCEPT DOM ELEMENTS -----
    function interceptDOMElements() {
        const originalCreateElement = document.createElement;
        document.createElement = function(tagName, options) {
            const el = originalCreateElement.call(this, tagName, options);
            const tag = tagName.toLowerCase();
            
            const originalSetAttribute = el.setAttribute;
            el.setAttribute = function(name, value) {
                try {
                    const attr = name.toLowerCase();
                    if (['href', 'src', 'action', 'formaction'].includes(attr)) {
                        if (typeof value === 'string' && !value.includes('/rewriter.js')) {
                            value = rewriteUrl(value);
                        }
                    }
                } catch(e) {}
                return originalSetAttribute.call(this, name, value);
            };
            
            ['src', 'href', 'action', 'formaction'].forEach(attr => {
                if (el[attr] !== undefined) {
                    Object.defineProperty(el, attr, {
                        get: function() {
                            const val = this.getAttribute(attr);
                            return unproxyUrl(val) || val;
                        },
                        set: function(val) {
                            if (typeof val === 'string' && !val.includes('/rewriter.js')) {
                                val = rewriteUrl(val);
                            }
                            this.setAttribute(attr, val);
                        },
                        configurable: true
                    });
                }
            });
            
            if (tag === 'form') {
                el.addEventListener('submit', function(event) {
                    if (this.dataset && this.dataset.intercepted === 'true') {
                        return;
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    handleFormSubmission(this, event);
                }, true);
            }
            
            return el;
        };

        const nativeSetAttribute = Element.prototype.setAttribute;
        Element.prototype.setAttribute = function(name, value) {
            try {
                const attr = name.toLowerCase();
                if (['href', 'src', 'action', 'formaction'].includes(attr)) {
                    if (typeof value === 'string' && !value.includes('/rewriter.js')) {
                        value = rewriteUrl(value);
                    }
                }
            } catch(e) {}
            return nativeSetAttribute.call(this, name, value);
        };
    }

    // ----- INTERCEPT LOCATION -----
    function interceptLocation() {
        const locationMock = new Proxy({}, {
            get(target, prop) {
                if (prop === 'reload') return () => window.location.reload();
                if (prop === 'replace') return (url) => {
                    if (url && typeof url === 'string' && !url.includes('/rewriter.js')) {
                        url = rewriteUrl(url);
                    }
                    window.location.replace(url);
                };
                if (prop === 'assign') return (url) => {
                    if (url && typeof url === 'string' && !url.includes('/rewriter.js')) {
                        url = rewriteUrl(url);
                    }
                    window.location.assign(url);
                };
                if (prop === 'href') {
                    return window.location.href;
                }
                if (prop === 'toString') {
                    return () => window.location.href;
                }
                return window.location[prop];
            },
            set(target, prop, value) {
                if (prop === 'href' && typeof value === 'string') {
                    if (!value.includes('/rewriter.js')) {
                        value = rewriteUrl(value);
                    }
                    window.location.href = value;
                    return true;
                }
                return false;
            }
        });

        Object.defineProperty(window, 'location', { 
            get: () => locationMock, 
            set: (val) => { 
                if (typeof val === 'string' && !val.includes('/rewriter.js')) {
                    val = rewriteUrl(val);
                }
                window.location.href = val; 
            },
            configurable: false
        });
        
        Object.defineProperty(document, 'location', { 
            get: () => locationMock, 
            set: (val) => { 
                if (typeof val === 'string' && !val.includes('/rewriter.js')) {
                    val = rewriteUrl(val);
                }
                window.location.href = val; 
            },
            configurable: false
        });
    }

    // ----- INTERCEPT HISTORY -----
    function interceptHistory() {
        const nativePushState = window.history.pushState;
        window.history.pushState = function(state, title, url) {
            if (url && typeof url === 'string' && !url.includes('/rewriter.js')) {
                url = rewriteUrl(url);
            }
            return nativePushState.call(this, state, title, url);
        };

        const nativeReplaceState = window.history.replaceState;
        window.history.replaceState = function(state, title, url) {
            if (url && typeof url === 'string' && !url.includes('/rewriter.js')) {
                url = rewriteUrl(url);
            }
            return nativeReplaceState.call(this, state, title, url);
        };
    }

    // ----- INTERCEPT WINDOW.OPEN -----
    function interceptWindowOpen() {
        const nativeOpen = window.open;
        window.open = function(url, target, features) {
            if (url && typeof url === 'string' && !url.includes('/rewriter.js')) {
                url = rewriteUrl(url);
            }
            return nativeOpen.call(this, url, target, features);
        };
    }

    // ----- PREVENT FRAME BREAKOUT -----
    function preventBreakout() {
        Object.defineProperty(window, 'top', { get: () => window, configurable: false });
        Object.defineProperty(window, 'parent', { get: () => window, configurable: false });
        Object.defineProperty(window, 'self', { get: () => window, configurable: false });
        Object.defineProperty(window, 'opener', { get: () => null, configurable: false });
        Object.defineProperty(window, 'frameElement', { get: () => null, configurable: false });
    }

    // ----- INITIALIZE -----
    function initialize() {
        console.log('[sw-helper] running');
        console.log('[sw-helper] libcurl.js version:', libcurl.version ? libcurl.version.lib : 'unknown');
        
        interceptWebSocket();
        interceptFetch();
        interceptXHR();
        interceptDocumentCookie();
        setupFormInterception();
        interceptDOMElements();
        interceptLocation();
        interceptHistory();
        interceptWindowOpen();
        preventBreakout();
        
        console.log('[sw-helper] loaded part 1');
        console.log('[sw-helper] loaded part 2');
        console.log('[sw-helper] loaded part 3 ');
        console.log('[sw-helper] loaded part 4, Done!');
    }

    // Run initialization
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }
})();`;

// ==========================================
// SERVICE WORKER - MESSAGE HANDLING FOR COOKIE JAR
// ==========================================
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// Handle messages from the client for cookie operations
self.addEventListener('message', (event) => {
    const data = event.data;
    
    if (data.type === 'getCookies' || data.type === 'getCookiesSync') {
        const { domain, url } = data;
        const cookies = cookieJar.getCookies(url);
        event.ports[0].postMessage(cookies);
        return;
    }
    
    if (data.type === 'setCookies') {
        const { domain, url, cookies } = data;
        cookieJar.setCookies(url, cookies);
        event.ports[0].postMessage({ success: true });
        return;
    }
    
    if (data.type === 'deleteCookie') {
        const { domain, url, name } = data;
        cookieJar.deleteCookie(url, name);
        event.ports[0].postMessage({ success: true });
        return;
    }
    
    if (data.type === 'clearDomainCookies') {
        const { domain, url } = data;
        cookieJar.clearDomainCookies(url);
        event.ports[0].postMessage({ success: true });
        return;
    }
});

// ==========================================
// SERVICE WORKER - FETCH HANDLER
// ==========================================
self.addEventListener('fetch', (event) => {
    const requestUrl = new URL(event.request.url);

    // Serve rewriter script
    if (requestUrl.pathname === '/rewriter.js') {
        event.respondWith(new Response(REWRITER_SCRIPT, { 
            headers: { 
                'Content-Type': 'application/javascript; charset=utf-8',
                'Cache-Control': 'no-cache, no-store, must-revalidate'
            } 
        }));
        return;
    }

    // Handle WebSocket upgrade requests
    if (requestUrl.pathname === '/ws/') {
        const targetParam = requestUrl.searchParams.get('target');
        const domain = requestUrl.searchParams.get('domain');
        
        if (!targetParam) {
            event.respondWith(new Response('No target specified', { status: 400 }));
            return;
        }

        let targetUrl;
        try {
            const decoded = xorCoder.decode(targetParam);
            if (decoded && decoded.startsWith('http')) {
                targetUrl = new URL(decoded);
            } else {
                targetUrl = new URL(decodeURIComponent(targetParam));
            }
        } catch(e) {
            targetUrl = new URL(decodeURIComponent(targetParam));
        }

        const handleWebSocket = async () => {
            try {
                while (!libcurlReady) {
                    await new Promise(resolve => setTimeout(resolve, 50));
                }

                // Get cookies for this domain
                const cookies = cookieJar.getCookies(targetUrl.href);
                
                // Create libcurl WebSocket using the documented API
                const ws = new libcurl.CurlWebSocket(targetUrl.href, [], {
                    verbose: 1,
                    headers: {
                        'Cookie': cookies || '',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
                        'Origin': targetUrl.origin,
                        'Referer': targetUrl.origin,
                        'X-Proxied-Domain': domain || targetUrl.hostname
                    }
                });

                // Store connection
                const connectionId = Date.now() + Math.random().toString(36);
                const connection = {
                    ws: ws,
                    targetUrl: targetUrl,
                    domain: domain || targetUrl.hostname
                };
                
                // Handle WebSocket events
                ws.onopen = () => {
                    console.log('[sw-helper] WebSocket connected to:', targetUrl.href);
                };

                ws.onmessage = (data) => {
                    console.log('[sw-helper] WebSocket message received:', data.length, 'bytes');
                    // Forward to client if needed
                };

                ws.onerror = (error) => {
                    console.error('[sw-helper] WebSocket error:', error);
                };

                ws.onclose = (event) => {
                    console.log('[sw-helper] WebSocket closed');
                };

                return new Response('WebSocket connected', {
                    status: 101,
                    statusText: 'Switching Protocols',
                    headers: {
                        'Connection': 'Upgrade',
                        'Upgrade': 'websocket',
                        'Sec-WebSocket-Accept': 'dGhlIHNhbXBsZSBub25jZQ==',
                        'X-WebSocket-Id': connectionId
                    }
                });
            } catch (err) {
                console.error('[sw-helper] WebSocket error:', err);
                return new Response('WebSocket connection failed: ' + err.message, { status: 502 });
            }
        };

        event.respondWith(handleWebSocket());
        return;
    }

    // Skip loop guard
    if (event.request.headers.get('X-Proxy-Loop-Guard')) {
        event.respondWith(fetch(event.request));
        return;
    }

    // Handle proxy requests with XOR decoding
    if (requestUrl.pathname.startsWith(PROXY_PREFIX)) {
        const encodedTarget = requestUrl.pathname.substring(PROXY_PREFIX.length);
        if (!encodedTarget) {
            event.respondWith(new Response('No target specified', { status: 400 }));
            return;
        }

        const handleRequest = async () => {
            try {
                while (!libcurlReady) {
                    await new Promise(resolve => setTimeout(resolve, 50));
                }

                // Decode the target URL using XOR
                let targetUrl;
                try {
                    const decoded = xorCoder.decode(encodedTarget);
                    if (decoded && decoded.startsWith('http')) {
                        targetUrl = new URL(decoded);
                    } else {
                        targetUrl = new URL(decodeURIComponent(encodedTarget));
                    }
                } catch(e) {
                    targetUrl = new URL(decodeURIComponent(encodedTarget));
                }
                
                // Get cookies for this domain from the cookie jar
                const cookies = cookieJar.getCookies(targetUrl.href);
                
                const modifiedHeaders = new Headers(event.request.headers);
                modifiedHeaders.delete('accept-encoding');
                modifiedHeaders.set('X-Proxy-Loop-Guard', 'true');
                
                if (cookies) {
                    modifiedHeaders.set('Cookie', cookies);
                }

                let fetchMode = event.request.mode;
                if (fetchMode === 'same-origin' || fetchMode === 'navigate') fetchMode = 'cors';

                const fetchOptions = {
                    method: event.request.method,
                    headers: modifiedHeaders,
                    redirect: 'follow',
                    mode: fetchMode,
                    credentials: 'omit'
                };

                if (!['GET', 'HEAD'].includes(event.request.method)) {
                    fetchOptions.body = event.request.body;
                    if (event.request.body) fetchOptions.duplex = 'half';
                }

                // Use libcurl.fetch for the request
                const response = await libcurl.fetch(targetUrl.href, fetchOptions);
                const contentType = response.headers.get('content-type') || '';
                const responseHeaders = new Headers(response.headers);
                
                // Handle cookies from response
                const setCookie = responseHeaders.get('set-cookie');
                if (setCookie) {
                    cookieJar.setCookies(targetUrl.href, setCookie);
                }
                
                // Remove security headers
                responseHeaders.delete('content-security-policy');
                responseHeaders.delete('content-security-policy-report-only');
                responseHeaders.delete('x-content-security-policy');
                responseHeaders.delete('x-webkit-csp');
                responseHeaders.delete('x-frame-options');
                responseHeaders.delete('cross-origin-opener-policy');
                responseHeaders.delete('cross-origin-embedder-policy');
                responseHeaders.delete('cross-origin-resource-policy');
                responseHeaders.delete('x-xss-protection');
                responseHeaders.delete('x-content-type-options');
                responseHeaders.set('Access-Control-Allow-Origin', '*');
                responseHeaders.set('Access-Control-Allow-Methods', '*');
                responseHeaders.set('Access-Control-Allow-Headers', '*');
                responseHeaders.set('Access-Control-Allow-Credentials', 'true');
                
                // Handle redirects
                if (responseHeaders.has('location')) {
                    const loc = responseHeaders.get('location');
                    try {
                        const absoluteLoc = new URL(loc, targetUrl.href).href;
                        const encoded = xorCoder.encode(absoluteLoc);
                        responseHeaders.set('location', `${self.location.origin}${PROXY_PREFIX}${encoded}`);
                    } catch (e) {}
                }

                // Handle HTML content
                if (contentType.includes('text/html')) {
                    let html = await response.text();
                    
                    // Inject rewriter script
                    const rewriterUrl = `${self.location.origin}/rewriter.js`;
                    const injectorScript = `<script src="${rewriterUrl}"></script>`;
                    
                    if (html.match(/<head>/i)) {
                        html = html.replace(/<head>/i, `<head>${injectorScript}`);
                    } else if (html.match(/<html>/i)) {
                        html = html.replace(/<html>/i, `<html>${injectorScript}`);
                    } else {
                        html = injectorScript + html;
                    }
                    
                    // Rewrite URLs in HTML using XOR encoding
                    html = proxyTextContent(html, targetUrl.origin);
                    return new Response(html, { 
                        status: response.status, 
                        statusText: response.statusText, 
                        headers: responseHeaders 
                    });
                }
                
                // Handle JavaScript and CSS
                if (contentType.includes('application/javascript') || contentType.includes('text/css')) {
                    let text = await response.text();
                    text = proxyTextContent(text, targetUrl.origin);
                    return new Response(text, { 
                        status: response.status, 
                        statusText: response.statusText, 
                        headers: responseHeaders 
                    });
                }

                return new Response(response.body, { 
                    status: response.status, 
                    statusText: response.statusText, 
                    headers: responseHeaders 
                });
            } catch (err) {
                console.error('[sw-helper] Proxy error:', err);
                return new Response(generateErrorPage(err.message, 502), { 
                    status: 502, 
                    headers: { 'Content-Type': 'text/html' } 
                });
            }
        };

        event.respondWith(handleRequest());
        return;
    }

    // Handle other requests normally
    event.respondWith(fetch(event.request));
});

// ==========================================
// HELPER FUNCTIONS
// ==========================================

function proxyTextContent(text, targetOrigin) {
    if (typeof text !== 'string') return text;
    
    try {
        // Rewrite absolute URLs with XOR encoding
        const absoluteUrlPattern = /(https?:\/\/[a-zA-Z0-9\-._~:/?#[\]@!$&'()*+,;=]+)/g;
        let processed = text.replace(absoluteUrlPattern, (match) => {
            if (match.includes(PROXY_PREFIX) || match.startsWith(self.location.origin)) return match;
            if (match.includes('/rewriter.js')) return match;
            const encoded = xorCoder.encode(match);
            return `${self.location.origin}${PROXY_PREFIX}${encoded}`;
        });

        // Rewrite all URL attributes with XOR encoding
        const attrPattern = /\b(href|src|action|formaction|data-url|data-href|data-src|navigation-url|codebase|archive|data|cite|longdesc|profile|usemap|manifest|ping|poster|background|icon|srcset)=["']([^"']+)["']/gi;
        processed = processed.replace(attrPattern, (match, attr, val) => {
            if (val.startsWith('#') || val.startsWith('javascript:') || val.startsWith('data:') || 
                val.startsWith('blob:') || val.startsWith('about:') || val.includes(PROXY_PREFIX)) return match;
            if (val.includes('/rewriter.js')) return match;
            try {
                const resolved = new URL(val, targetOrigin).href;
                const encoded = xorCoder.encode(resolved);
                return `${attr}="${self.location.origin}${PROXY_PREFIX}${encoded}"`;
            } catch (e) { return match; }
        });

        // Rewrite CSS URLs with XOR encoding
        const cssUrlPattern = /url\(["']?([^"')]+)["']?\)/gi;
        processed = processed.replace(cssUrlPattern, (match, url) => {
            if (url.startsWith('data:') || url.startsWith('blob:') || url.includes(PROXY_PREFIX)) return match;
            if (url.includes('/rewriter.js')) return match;
            try {
                const resolved = new URL(url, targetOrigin).href;
                const encoded = xorCoder.encode(resolved);
                return `url("${self.location.origin}${PROXY_PREFIX}${encoded}")`;
            } catch (e) { return match; }
        });

        return processed;
    } catch(e) {
        return text;
    }
}

function generateErrorPage(errorMessage, status) {
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Proxy Error</title>
        <style>
            body { background: #111; color: #eee; font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
            .card { background: #1a1a1a; padding: 40px; border-radius: 12px; border: 1px solid #333; max-width: 500px; width: 100%; text-align: center; }
            h1 { color: #ff4a4a; font-size: 24px; margin-top: 0; }
            p { color: #aaa; font-size: 15px; line-height: 1.6; margin-bottom: 25px; }
            .badge { background: #2a1b1b; color: #ff6b6b; padding: 6px 12px; border-radius: 4px; font-family: monospace; font-size: 13px; display: inline-block; margin-bottom: 20px; border: 1px solid #4a2222; }
            button { background: #0070f3; color: white; border: none; padding: 12px 24px; border-radius: 6px; font-weight: 600; cursor: pointer; font-size: 14px; transition: background 0.2s; }
            button:hover { background: #0051cb; }
        </style>
    </head>
    <body>
        <div class="card">
            <div class="badge">Status ${status || 502}</div>
            <h1>Failed to Load Page</h1>
            <p>${errorMessage || 'An error occurred while trying to load the page.'}</p>
            <button onclick="window.location.reload()">Retry</button>
        </div>
    </body>
    </html>`;
}
