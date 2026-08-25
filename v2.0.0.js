const PROXY_PREFIX = '/go/';
const WISP_SERVER_URL = 'wss://wisp.mercurywork.shop/wisp/';

const XOR_KEY1 = 0x5A;
const XOR_KEY2 = 0x3C;
const XOR_KEY3 = 0xF1;
const XOR_KEYS = [XOR_KEY1, XOR_KEY2, XOR_KEY3];

const cndPart1 = 'https://cdn.';
const cndPart2 = 'jsdelivr.net/';
const cndPart3 = 'npm/libcurl.js';
const cndPart4 = '@latest/';
const cndPart5 = 'libcurl_full.js';

const libcurlUrl = cndPart1 + cndPart2 + cndPart3 + cndPart4 + cndPart5;

try {
    importScripts(libcurlUrl);
} catch (e) {}

let libcurlReady = false;
let libcurlLoadAttempts = 0;
const MAX_LIBCURL_ATTEMPTS = 10;

function checkLibcurlReady() {
    if (typeof libcurl !== 'undefined') {
        if (typeof libcurl.set_websocket === 'function') {
            libcurl.set_websocket(WISP_SERVER_URL);
        }
        
        if (libcurl.ready) {
            libcurlReady = true;
        } else {
            libcurl.onload = () => {
                libcurlReady = true;
            };
        }
        return true;
    }
    return false;
}

checkLibcurlReady();

if (!libcurlReady) {
    const checkInterval = setInterval(() => {
        libcurlLoadAttempts++;
        if (checkLibcurlReady() || libcurlLoadAttempts >= MAX_LIBCURL_ATTEMPTS) {
            clearInterval(checkInterval);
        }
    }, 500);
}

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

    safeDecode(encoded) {
        if (!encoded) return encoded;
        try {
            const decoded = this.decode(encoded);
            if (decoded && (decoded.startsWith('http://') || decoded.startsWith('https://') || 
                           decoded.startsWith('ws://') || decoded.startsWith('wss://') ||
                           decoded.startsWith('//') || decoded.includes('.'))) {
                return decoded;
            }
            try {
                const uriDecoded = decodeURIComponent(encoded);
                if (uriDecoded && (uriDecoded.startsWith('http://') || uriDecoded.startsWith('https://') ||
                                  uriDecoded.startsWith('ws://') || uriDecoded.startsWith('wss://') ||
                                  uriDecoded.startsWith('//') || uriDecoded.includes('.'))) {
                    return uriDecoded;
                }
            } catch(e) {}
            return encoded;
        } catch(e) {
            return encoded;
        }
    }
}

const xorCoder = new XORCoder();

class CookieJar {
    constructor() {
        this.cookieStore = new Map();
        this.cookieMetadata = new Map();
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
}

const cookieJar = new CookieJar();

const REWRITER_SCRIPT = `(function() {
    'use strict';
    
    if (window.__rewriter_initialized) return;
    window.__rewriter_initialized = true;

    const PROXY_PREFIX = '/go/';
    const PROXY_HOST = window.location.host;
    const PROXY_ORIGIN = window.location.origin;

    const XOR_KEYS = [0x5A, 0x3C, 0xF1];

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

    function safeXorDecode(encoded) {
        if (!encoded) return encoded;
        try {
            const decoded = xorDecode(encoded);
            if (decoded && (decoded.startsWith('http://') || decoded.startsWith('https://') || 
                           decoded.startsWith('ws://') || decoded.startsWith('wss://') ||
                           decoded.startsWith('//') || decoded.includes('.'))) {
                return decoded;
            }
            try {
                const uriDecoded = decodeURIComponent(encoded);
                if (uriDecoded && (uriDecoded.startsWith('http://') || uriDecoded.startsWith('https://') ||
                                  uriDecoded.startsWith('ws://') || uriDecoded.startsWith('wss://') ||
                                  uriDecoded.startsWith('//') || uriDecoded.includes('.'))) {
                    return uriDecoded;
                }
            } catch(e) {}
            return encoded;
        } catch(e) {
            return encoded;
        }
    }

    function getCurrentRemoteHref() {
        if (window.location.pathname.substr(0, PROXY_PREFIX.length) === PROXY_PREFIX) {
            return window.location.pathname.substr(PROXY_PREFIX.length) + 
                   window.location.search + 
                   window.location.hash;
        }
        return window.location.href;
    }

    function fixUrl(urlStr) {
        if (!urlStr || typeof urlStr !== 'string') return urlStr;
        
        if (urlStr.substr(0, PROXY_PREFIX.length) === PROXY_PREFIX) {
            return urlStr;
        }

        try {
            const currentRemoteHref = getCurrentRemoteHref();
            const url = new URL(urlStr, currentRemoteHref);

            if (url.origin === window.location.origin && 
                url.pathname.substr(0, PROXY_PREFIX.length) === PROXY_PREFIX) {
                return urlStr;
            }

            if (url.protocol !== "http:" && url.protocol !== "https:" && 
                url.protocol !== "ws:" && url.protocol !== "wss:") {
                return urlStr;
            }

            if (url.hostname === window.location.hostname) {
                const currentRemoteUrl = new URL(currentRemoteHref);
                url.host = currentRemoteUrl.host;
                url.protocol = currentRemoteUrl.protocol;
            }

            const encoded = xorEncode(url.href);
            return PROXY_PREFIX + encoded;
        } catch (e) {
            return urlStr;
        }
    }

    function unfixUrl(urlStr) {
        if (!urlStr || typeof urlStr !== 'string') return urlStr;
        if (urlStr.includes(PROXY_PREFIX)) {
            try {
                const parts = urlStr.split(PROXY_PREFIX);
                const encoded = parts[parts.length - 1];
                const decoded = safeXorDecode(encoded);
                if (decoded && decoded !== encoded) {
                    return decoded;
                }
            } catch (e) {}
        }
        return urlStr;
    }

    function patchXMLHttpRequest() {
        if (!window.XMLHttpRequest) return;
        const _XMLHttpRequest = window.XMLHttpRequest;

        window.XMLHttpRequest = function(opts) {
            const xhr = new _XMLHttpRequest(opts);
            const _open = xhr.open;
            xhr.open = function() {
                const args = Array.prototype.slice.call(arguments);
                args[1] = fixUrl(args[1]);
                return _open.apply(xhr, args);
            };
            return xhr;
        };
        window.XMLHttpRequest.prototype = _XMLHttpRequest.prototype;
    }

    function patchFetch() {
        if (!window.fetch) return;
        const _fetch = window.fetch;

        window.fetch = function(resource, init) {
            if (resource && typeof resource === 'object' && resource.url) {
                resource.url = fixUrl(resource.url);
            } else if (typeof resource === 'string' || resource instanceof URL) {
                resource = fixUrl(resource.toString());
            }
            return _fetch(resource, init);
        };
        window.fetch.prototype = _fetch.prototype;
    }

    function patchCreateElement() {
        if (!window.document || !window.document.createElement) return;
        const _createElement = window.document.createElement;

        window.document.createElement = function(tagName, options) {
            const element = _createElement.call(window.document, tagName, options);
            const tag = tagName.toLowerCase();
            
            if (['img', 'script', 'iframe', 'audio', 'video', 'embed', 'source', 'track'].includes(tag)) {
                const srcDescriptor = Object.getOwnPropertyDescriptor(element, 'src');
                if (srcDescriptor) {
                    Object.defineProperty(element, 'src', {
                        get: srcDescriptor.get,
                        set: function(value) {
                            srcDescriptor.set.call(this, fixUrl(value));
                        },
                        configurable: true
                    });
                }
            }
            
            if (['a', 'link', 'area', 'base'].includes(tag)) {
                const hrefDescriptor = Object.getOwnPropertyDescriptor(element, 'href');
                if (hrefDescriptor) {
                    Object.defineProperty(element, 'href', {
                        get: hrefDescriptor.get,
                        set: function(value) {
                            hrefDescriptor.set.call(this, fixUrl(value));
                        },
                        configurable: true
                    });
                }
            }
            
            if (tag === 'form') {
                const actionDescriptor = Object.getOwnPropertyDescriptor(element, 'action');
                if (actionDescriptor) {
                    Object.defineProperty(element, 'action', {
                        get: actionDescriptor.get,
                        set: function(value) {
                            actionDescriptor.set.call(this, fixUrl(value));
                        },
                        configurable: true
                    });
                }
            }
            
            return element;
        };
    }

    function patchWebSockets() {
        if (!window.WebSocket) return;
        const _WebSocket = window.WebSocket;

        window.WebSocket = function(url, protocols) {
            let fixedUrl = url;
            if (typeof url === 'string' && !url.includes(PROXY_PREFIX)) {
                fixedUrl = fixUrl(url);
            }
            return new _WebSocket(fixedUrl, protocols);
        };
        window.WebSocket.prototype = _WebSocket.prototype;
        
        for (const key in _WebSocket) {
            if (!window.WebSocket[key]) {
                window.WebSocket[key] = _WebSocket[key];
            }
        }
        window.WebSocket.CONNECTING = 0;
        window.WebSocket.OPEN = 1;
        window.WebSocket.CLOSING = 2;
        window.WebSocket.CLOSED = 3;
    }

    function patchHistory() {
        if (!window.history || !window.history.pushState) return;

        const _pushState = window.history.pushState;
        window.history.pushState = function(state, title, url) {
            if (url) {
                url = fixUrl(url);
            }
            return _pushState.call(window.history, state, title, url);
        };

        if (!window.history.replaceState) return;
        const _replaceState = window.history.replaceState;
        window.history.replaceState = function(state, title, url) {
            if (url) {
                url = fixUrl(url);
            }
            return _replaceState.call(window.history, state, title, url);
        };
    }

    function patchLocation() {
        const locationMock = new Proxy({}, {
            get(target, prop) {
                if (prop === 'reload') return () => window.location.reload();
                if (prop === 'replace') return (url) => {
                    window.location.replace(fixUrl(url));
                };
                if (prop === 'assign') return (url) => {
                    window.location.assign(fixUrl(url));
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
                    window.location.href = fixUrl(value);
                    return true;
                }
                return false;
            }
        });

        Object.defineProperty(window, 'location', { 
            get: () => locationMock, 
            set: (val) => { 
                if (typeof val === 'string') {
                    window.location.href = fixUrl(val);
                }
            },
            configurable: false
        });
        
        Object.defineProperty(document, 'location', { 
            get: () => locationMock, 
            set: (val) => { 
                if (typeof val === 'string') {
                    window.location.href = fixUrl(val);
                }
            },
            configurable: false
        });
    }

    function patchWindowOpen() {
        const _open = window.open;
        window.open = function(url, target, features) {
            if (url && typeof url === 'string') {
                url = fixUrl(url);
            }
            return _open.call(this, url, target, features);
        };
    }

    function patchDocumentCookie() {
        const cookieDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
        if (cookieDescriptor) {
            Object.defineProperty(document, 'cookie', {
                get: function() {
                    return cookieDescriptor.get.call(this) || '';
                },
                set: function(value) {
                    cookieDescriptor.set.call(this, value);
                },
                configurable: true
            });
        }
    }

    function handleFormSubmission(form, event) {
        try {
            if (!form) return false;
            
            let action = form.getAttribute('action') || window.location.href;
            const method = (form.getAttribute('method') || 'GET').toUpperCase();
            const enctype = form.getAttribute('enctype') || 'application/x-www-form-urlencoded';
            const formData = new FormData(form);
            
            action = fixUrl(action);
            form.setAttribute('action', action);
            
            if (method === 'GET') {
                const url = new URL(action);
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
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
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
                        'X-Form-Submission': 'true'
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
                
                fetch(action, options)
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
                    .catch(() => {});
                
                return true;
            }
            
            return false;
        } catch(e) {
            return false;
        }
    }

    function patchForms() {
        document.addEventListener('submit', function(event) {
            const form = event.target;
            if (form && form.tagName && form.tagName.toLowerCase() === 'form') {
                if (form.dataset.intercepted) return;
                form.dataset.intercepted = 'true';
                handleFormSubmission(form, event);
            }
        }, true);

        const _submit = HTMLFormElement.prototype.submit;
        HTMLFormElement.prototype.submit = function() {
            if (this.dataset && this.dataset.intercepted === 'true') {
                return _submit.call(this);
            }
            if (this.dataset) {
                this.dataset.intercepted = 'true';
            }
            const handled = handleFormSubmission(this);
            if (!handled) {
                if (this.dataset) {
                    delete this.dataset.intercepted;
                }
                return _submit.call(this);
            }
        };
    }

    function patchSetAttribute() {
        const _setAttribute = Element.prototype.setAttribute;
        Element.prototype.setAttribute = function(name, value) {
            const attr = name.toLowerCase();
            if (['href', 'src', 'action', 'formaction', 'data'].includes(attr)) {
                if (typeof value === 'string' && !value.includes('/rewriter.js')) {
                    value = fixUrl(value);
                }
            }
            return _setAttribute.call(this, name, value);
        };
    }

    function preventBreakout() {
        Object.defineProperty(window, 'top', { get: () => window, configurable: false });
        Object.defineProperty(window, 'parent', { get: () => window, configurable: false });
        Object.defineProperty(window, 'self', { get: () => window, configurable: false });
        Object.defineProperty(window, 'opener', { get: () => null, configurable: false });
        Object.defineProperty(window, 'frameElement', { get: () => null, configurable: false });
    }

    function initialize() {
        patchXMLHttpRequest();
        patchFetch();
        patchCreateElement();
        patchWebSockets();
        patchHistory();
        patchLocation();
        patchWindowOpen();
        patchDocumentCookie();
        patchForms();
        patchSetAttribute();
        preventBreakout();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }
})();`;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
    const requestUrl = new URL(event.request.url);

    if (requestUrl.pathname === '/rewriter.js') {
        event.respondWith(new Response(REWRITER_SCRIPT, { 
            headers: { 
                'Content-Type': 'application/javascript; charset=utf-8',
                'Cache-Control': 'no-cache, no-store, must-revalidate'
            } 
        }));
        return;
    }

    if (event.request.headers.get('X-Proxy-Loop-Guard')) {
        event.respondWith(fetch(event.request));
        return;
    }

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

                let targetUrl;
                try {
                    const decoded = xorCoder.safeDecode(encodedTarget);
                    if (decoded && (decoded.startsWith('http://') || decoded.startsWith('https://'))) {
                        targetUrl = new URL(decoded);
                    } else {
                        targetUrl = new URL(decodeURIComponent(encodedTarget));
                    }
                } catch(e) {
                    targetUrl = new URL(decodeURIComponent(encodedTarget));
                }
                
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

                const response = await libcurl.fetch(targetUrl.href, fetchOptions);
                const contentType = response.headers.get('content-type') || '';
                const responseHeaders = new Headers(response.headers);
                
                const setCookie = responseHeaders.get('set-cookie');
                if (setCookie) {
                    cookieJar.setCookies(targetUrl.href, setCookie);
                }
                
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
                
                if (responseHeaders.has('location')) {
                    const loc = responseHeaders.get('location');
                    try {
                        const absoluteLoc = new URL(loc, targetUrl.href).href;
                        const encoded = xorCoder.encode(absoluteLoc);
                        responseHeaders.set('location', `${self.location.origin}${PROXY_PREFIX}${encoded}`);
                    } catch (e) {}
                }

                if (contentType.includes('text/html')) {
                    let html = await response.text();
                    const rewriterUrl = `${self.location.origin}/rewriter.js`;
                    const injectorScript = `<script src="${rewriterUrl}"></script>`;
                    
                    if (html.match(/<head>/i)) {
                        html = html.replace(/<head>/i, `<head>${injectorScript}`);
                    } else if (html.match(/<html>/i)) {
                        html = html.replace(/<html>/i, `<html>${injectorScript}`);
                    } else {
                        html = injectorScript + html;
                    }
                    
                    html = proxyTextContent(html, targetUrl.origin);
                    return new Response(html, { 
                        status: response.status, 
                        statusText: response.statusText, 
                        headers: responseHeaders 
                    });
                }
                
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
                return new Response(generateErrorPage(err.message, 502), { 
                    status: 502, 
                    headers: { 'Content-Type': 'text/html' } 
                });
            }
        };

        event.respondWith(handleRequest());
        return;
    }

    event.respondWith(fetch(event.request));
});

function proxyTextContent(text, targetOrigin) {
    if (typeof text !== 'string') return text;
    
    try {
        const absoluteUrlPattern = /(https?:\/\/[a-zA-Z0-9\-._~:/?#[\]@!$&'()*+,;=]+)/g;
        let processed = text.replace(absoluteUrlPattern, (match) => {
            if (match.includes(PROXY_PREFIX) || match.startsWith(self.location.origin)) return match;
            if (match.includes('/rewriter.js')) return match;
            const encoded = xorCoder.encode(match);
            return `${self.location.origin}${PROXY_PREFIX}${encoded}`;
        });

        const attrPattern = /\b(href|src|action|formaction|data-url|data-href|data-src|navigation-url|codebase|archive|data|cite|longdesc|profile|usemap|manifest|ping|poster|background|icon|srcset|data|download|ping|integrity|referrerpolicy|sandbox|allow|allowfullscreen|allowpaymentrequest|loading|decoding|crossorigin|rel|type|media|sizes|as|fetchpriority|importance|blocking|nonce)=["']([^"']+)["']/gi;
        processed = processed.replace(attrPattern, (match, attr, val) => {
            if (val.startsWith('#') || val.startsWith('javascript:') || val.startsWith('data:') || 
                val.startsWith('blob:') || val.startsWith('about:') || val.includes(PROXY_PREFIX)) return match;
            if (val.includes('/rewriter.js')) return match;
            try {
                const resolved = new URL(val, targetOrigin).href;
                const encoded = xorCoder.encode(resolved);
                return `${attr}="${self.location.origin}${PROXY_PREFIX}${encoded}"`;
            } catch (e) { 
                try {
                    const resolved = new URL(val, targetOrigin + '/').href;
                    const encoded = xorCoder.encode(resolved);
                    return `${attr}="${self.location.origin}${PROXY_PREFIX}${encoded}"`;
                } catch(e2) {
                    return match;
                }
            }
        });

        const cssUrlPattern = /url\(["']?([^"')]+)["']?\)/gi;
        processed = processed.replace(cssUrlPattern, (match, url) => {
            if (url.startsWith('data:') || url.startsWith('blob:') || url.includes(PROXY_PREFIX)) return match;
            if (url.includes('/rewriter.js')) return match;
            try {
                const resolved = new URL(url, targetOrigin).href;
                const encoded = xorCoder.encode(resolved);
                return `url("${self.location.origin}${PROXY_PREFIX}${encoded}")`;
            } catch (e) {
                try {
                    const resolved = new URL(url, targetOrigin + '/').href;
                    const encoded = xorCoder.encode(resolved);
                    return `url("${self.location.origin}${PROXY_PREFIX}${encoded}")`;
                } catch(e2) {
                    return match;
                }
            }
        });

        const srcsetPattern = /srcset=["']([^"']+)["']/gi;
        processed = processed.replace(srcsetPattern, (match, srcset) => {
            const parts = srcset.split(',').map(part => {
                const trimmed = part.trim();
                const [url, size] = trimmed.split(/\s+/);
                try {
                    const resolved = new URL(url, targetOrigin).href;
                    const encoded = xorCoder.encode(resolved);
                    const newUrl = `${self.location.origin}${PROXY_PREFIX}${encoded}`;
                    return size ? `${newUrl} ${size}` : newUrl;
                } catch(e) {
                    return trimmed;
                }
            });
            return `srcset="${parts.join(', ')}"`;
        });

        return processed;
    } catch(e) {
        return text;
    }
}

function generateErrorPage(errorMessage, status) {
    return `<!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Proxy Error</title>
        <style>
            body { background: #111; color: #eee; font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; }
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
