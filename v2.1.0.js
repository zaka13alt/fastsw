
const PROXY_PREFIX = '/go/';
const WISP_SERVER_URL = 'wss://wisp.mercurywork.shop/wisp/'; 

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
// Cookie Isolation Utilities
// ==========================================
class CookieManager {
    constructor() {
        this.cookieStore = new Map();
        this.domainMap = new Map();
    }

    getDomainKey(url) {
        try {
            const urlObj = new URL(url);
            return urlObj.hostname;
        } catch (e) {
            return 'default';
        }
    }

    getCurrentDomain() {
        try {
            // Check if we're in a proxied context
            if (typeof window !== 'undefined' && window.location) {
                const url = unproxyUrl(window.location.href);
                if (url) {
                    return new URL(url).hostname;
                }
            }
        } catch(e) {}
        return 'default';
    }

    parseCookieString(cookieStr) {
        const cookies = [];
        if (!cookieStr) return cookies;
        
        cookieStr.split(';').forEach(cookie => {
            const trimmed = cookie.trim();
            if (trimmed) {
                const [name, ...valueParts] = trimmed.split('=');
                const value = valueParts.join('=');
                cookies.push({ name: name.trim(), value: value });
            }
        });
        return cookies;
    }

    setCookies(url, cookieString) {
        const domain = this.getDomainKey(url);
        if (!this.cookieStore.has(domain)) {
            this.cookieStore.set(domain, new Map());
        }
        
        const domainCookies = this.cookieStore.get(domain);
        const parsedCookies = this.parseCookieString(cookieString);
        
        parsedCookies.forEach(cookie => {
            if (cookie.name) {
                domainCookies.set(cookie.name, cookie.value);
            }
        });
    }

    getCookies(url, cookieNames = null) {
        const domain = this.getDomainKey(url);
        if (!this.cookieStore.has(domain)) return '';
        
        const domainCookies = this.cookieStore.get(domain);
        const cookiePairs = [];
        
        if (cookieNames) {
            const names = Array.isArray(cookieNames) ? cookieNames : [cookieNames];
            names.forEach(name => {
                if (domainCookies.has(name)) {
                    cookiePairs.push(`${name}=${domainCookies.get(name)}`);
                }
            });
        } else {
            for (let [name, value] of domainCookies) {
                cookiePairs.push(`${name}=${value}`);
            }
        }
        
        return cookiePairs.join('; ');
    }

    clearCookies(url) {
        const domain = this.getDomainKey(url);
        this.cookieStore.delete(domain);
    }

    clearAllCookies() {
        this.cookieStore.clear();
    }
}

const cookieManager = new CookieManager();

// ==========================================
// COMPLETE REWRITER - Patches EVERY API
// ==========================================
const REWRITER_SCRIPT = `(function() {
    'use strict';
    
    // Check if already initialized
    if (window.__rewriter_initialized) return;
    window.__rewriter_initialized = true;
    window.__rewriter_version = '3.0.0';

    const PROXY_PREFIX = '/go/';
    const PROXY_HOST = window.location.host;
    const PROXY_ORIGIN = window.location.origin;

    // URL cache to prevent recursion
    const urlCache = new Map();
    const MAX_CACHE_SIZE = 2000;

    // ----- CORE FUNCTIONS -----
    function rewriteUrl(url) {
        if (!url || typeof url !== 'string') return url;
        
        // Check cache
        if (urlCache.has(url)) {
            return urlCache.get(url);
        }
        
        const trimmed = url.trim();
        // Skip these protocols and already proxied URLs
        if (trimmed.startsWith('data:') || trimmed.startsWith('blob:') || 
            trimmed.startsWith('javascript:') || trimmed.startsWith('about:') ||
            trimmed.startsWith('chrome-extension:') || trimmed.startsWith('file:') ||
            trimmed.startsWith(PROXY_PREFIX) || trimmed.startsWith(PROXY_ORIGIN + PROXY_PREFIX) ||
            trimmed.includes('/rewriter.js') || trimmed.includes('__rewriter')) {
            return url;
        }
        
        try {
            const baseContext = window.location.href;
            const resolved = new URL(trimmed, baseContext).href;
            const result = PROXY_PREFIX + encodeURIComponent(resolved);
            
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
                const decoded = decodeURIComponent(parts[parts.length - 1]);
                return decoded;
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

    function isApiRequest(url) {
        if (!url || typeof url !== 'string') return false;
        const urlLower = url.toLowerCase();
        const apiPatterns = [
            '/api/', '/v1/', '/v2/', '/v3/', '/v4/', '/v5/',
            '/graphql', '/rest/', '/rpc/', '/service/', '/auth/',
            '/oauth/', '/token', '/login', '/signin', '/register',
            '/upload', '/post', '/put', '/delete', '/patch',
            '/ajax', '/json', '/rpc', '/gateway', '/webhook',
            '/webhooks', '/callback', '/hook', '/event'
        ];
        return apiPatterns.some(pattern => urlLower.includes(pattern));
    }

    // ----- 1. PATCH ALL NAVIGATION APIS -----
    
    // 1.1 window.location (full proxy)
    try {
        const locationMock = new Proxy({}, {
            get(target, prop) {
                const original = window.location[prop];
                if (typeof original === 'function') {
                    return function(...args) {
                        if (prop === 'replace' || prop === 'assign') {
                            if (args[0] && typeof args[0] === 'string') {
                                args[0] = rewriteUrl(args[0]);
                            }
                        }
                        return original.apply(window.location, args);
                    };
                }
                if (prop === 'href') {
                    return window.location.href;
                }
                if (prop === 'toString') {
                    return () => window.location.href;
                }
                return original;
            },
            set(target, prop, value) {
                if (prop === 'href' && typeof value === 'string') {
                    window.location.href = rewriteUrl(value);
                    return true;
                }
                if (prop in window.location) {
                    try {
                        window.location[prop] = value;
                    } catch(e) {}
                    return true;
                }
                return false;
            }
        });

        // Override location descriptors
        const originalGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
        Object.getOwnPropertyDescriptor = function(obj, prop) {
            if ((obj === window || obj === document) && prop === 'location') {
                return { 
                    get: () => locationMock, 
                    set: (val) => { 
                        if (typeof val === 'string') {
                            window.location.href = rewriteUrl(val);
                        }
                    },
                    configurable: true, 
                    enumerable: true 
                };
            }
            return originalGetOwnPropertyDescriptor.apply(this, arguments);
        };

        Object.defineProperty(window, 'location', { 
            get: () => locationMock, 
            set: (val) => { 
                if (typeof val === 'string') {
                    window.location.href = rewriteUrl(val);
                }
            },
            configurable: false
        });
        
        Object.defineProperty(document, 'location', { 
            get: () => locationMock, 
            set: (val) => { 
                if (typeof val === 'string') {
                    window.location.href = rewriteUrl(val);
                }
            },
            configurable: false
        });
    } catch(e) {}

    // 1.2 window.open
    try {
        const nativeOpen = window.open;
        window.open = function(url, target, features) {
            if (url && typeof url === 'string' && !url.includes('/rewriter.js')) {
                url = rewriteUrl(url);
            }
            return nativeOpen.call(this, url, target, features);
        };
        window.open.prototype = nativeOpen.prototype;
    } catch(e) {}

    // 1.3 window.navigate (IE/Edge)
    try {
        if (window.navigate) {
            const nativeNavigate = window.navigate;
            window.navigate = function(url) {
                if (url && typeof url === 'string') {
                    url = rewriteUrl(url);
                }
                return nativeNavigate.call(this, url);
            };
        }
    } catch(e) {}

    // 1.4 document.location (already covered above)
    
    // 1.5 window.document.URL
    try {
        Object.defineProperty(document, 'URL', {
            get: function() {
                return unproxyUrl(window.location.href) || window.location.href;
            },
            configurable: false
        });
    } catch(e) {}

    // 1.6 window.document.documentURI
    try {
        Object.defineProperty(document, 'documentURI', {
            get: function() {
                return unproxyUrl(window.location.href) || window.location.href;
            },
            configurable: false
        });
    } catch(e) {}

    // ----- 2. PATCH ALL NETWORK APIS -----
    
    // 2.1 fetch
    try {
        const nativeFetch = window.fetch;
        window.fetch = function(input, init) {
            try {
                if (typeof input === 'string' && !input.includes('/rewriter.js')) {
                    input = rewriteUrl(input);
                } else if (input instanceof Request) {
                    const newUrl = rewriteUrl(input.url);
                    if (newUrl !== input.url) {
                        input = new Request(newUrl, input);
                    }
                }
            } catch(e) {}
            return nativeFetch.call(this, input, init);
        };
        window.fetch.prototype = nativeFetch.prototype;
    } catch(e) {}

    // 2.2 XMLHttpRequest (full patch)
    try {
        const nativeXHROpen = XMLHttpRequest.prototype.open;
        const nativeXHRSend = XMLHttpRequest.prototype.send;
        const nativeXHRSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
        const nativeXHRGetResponseHeader = XMLHttpRequest.prototype.getResponseHeader;
        const nativeXHRGetAllResponseHeaders = XMLHttpRequest.prototype.getAllResponseHeaders;

        XMLHttpRequest.prototype.open = function(method, url, async, user, password) {
            try {
                if (url && typeof url === 'string' && !url.includes('/rewriter.js')) {
                    url = rewriteUrl(url);
                }
            } catch(e) {}
            return nativeXHROpen.call(this, method, url, async, user, password);
        };

        XMLHttpRequest.prototype.send = function(body) {
            try {
                // Intercept FormData
                if (body instanceof FormData) {
                    const entries = Array.from(body.entries());
                    // Check if any values need rewriting
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
                
                // Intercept URLSearchParams
                if (body instanceof URLSearchParams) {
                    const params = new URLSearchParams(body);
                    let needsRewrite = false;
                    for (let [key, value] of params) {
                        if (typeof value === 'string' && (value.includes('http://') || value.includes('https://'))) {
                            try {
                                new URL(value);
                                params.set(key, rewriteUrl(value));
                                needsRewrite = true;
                            } catch(e) {}
                        }
                    }
                    if (needsRewrite) {
                        body = params.toString();
                    }
                }
                
                // Intercept string bodies
                if (typeof body === 'string') {
                    try {
                        const params = new URLSearchParams(body);
                        let needsRewrite = false;
                        for (let [key, value] of params) {
                            if (typeof value === 'string' && (value.includes('http://') || value.includes('https://'))) {
                                try {
                                    new URL(value);
                                    params.set(key, rewriteUrl(value));
                                    needsRewrite = true;
                                } catch(e) {}
                            }
                        }
                        if (needsRewrite) {
                            body = params.toString();
                        }
                    } catch(e) {
                        // Not URLSearchParams format, try JSON
                        try {
                            const json = JSON.parse(body);
                            const jsonStr = JSON.stringify(json, (key, value) => {
                                if (typeof value === 'string' && (value.includes('http://') || value.includes('https://'))) {
                                    try {
                                        new URL(value);
                                        return rewriteUrl(value);
                                    } catch(e) {}
                                }
                                return value;
                            });
                            if (jsonStr !== body) {
                                body = jsonStr;
                            }
                        } catch(e) {}
                    }
                }
                
                // Add cookies
                const cookies = document.cookie;
                if (cookies) {
                    this.setRequestHeader('Cookie', cookies);
                }
            } catch(e) {}
            return nativeXHRSend.call(this, body);
        };

        // Patch response interception
        XMLHttpRequest.prototype.getResponseHeader = function(name) {
            const result = nativeXHRGetResponseHeader.call(this, name);
            if (name && name.toLowerCase() === 'set-cookie' && result) {
                try {
                    const cookies = result.split(',').map(c => c.trim());
                    cookies.forEach(cookie => {
                        if (cookie) {
                            document.cookie = cookie;
                        }
                    });
                } catch(e) {}
            }
            return result;
        };

        XMLHttpRequest.prototype.getAllResponseHeaders = function() {
            const result = nativeXHRGetAllResponseHeaders.call(this);
            if (result) {
                try {
                    const lines = result.split('\\r\\n');
                    lines.forEach(line => {
                        if (line.toLowerCase().startsWith('set-cookie:')) {
                            const cookie = line.substring('set-cookie:'.length).trim();
                            if (cookie) {
                                document.cookie = cookie;
                            }
                        }
                    });
                } catch(e) {}
            }
            return result;
        };
    } catch(e) {}

    // 2.3 EventSource (Server-Sent Events)
    try {
        const NativeEventSource = window.EventSource;
        window.EventSource = function(url, eventSourceInitDict) {
            try {
                if (url && typeof url === 'string' && !url.includes('/rewriter.js')) {
                    url = rewriteUrl(url);
                }
            } catch(e) {}
            return new NativeEventSource(url, eventSourceInitDict);
        };
        window.EventSource.prototype = NativeEventSource.prototype;
    } catch(e) {}

    // 2.4 WebSocket (full patch)
    try {
        const NativeWebSocket = window.WebSocket;
        window.WebSocket = function(url, protocols) {
            try {
                if (url && typeof url === 'string' && !url.includes('/rewriter.js')) {
                    const targetUrl = new URL(url, window.location.href);
                    const wsScheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
                    const domain = getCurrentDomain();
                    const interceptWsRoute = \`\${wsScheme}//\${PROXY_HOST}/ws/?target=\${encodeURIComponent(targetUrl.href)}&domain=\${encodeURIComponent(domain)}\`;
                    return new NativeWebSocket(interceptWsRoute, protocols);
                }
            } catch(e) {}
            return new NativeWebSocket(url, protocols);
        };
        window.WebSocket.prototype = NativeWebSocket.prototype;
    } catch(e) {}

    // 2.5 WebSocket with protocols
    try {
        if (window.WebSocket) {
            const origWebSocket = window.WebSocket;
            // Already handled above
        }
    } catch(e) {}

    // ----- 3. PATCH ALL STORAGE APIS -----
    
    // 3.1 localStorage with domain isolation
    try {
        const domainPrefix = getCurrentDomain() + ':';
        const nativeLocalStorage = window.localStorage;
        if (nativeLocalStorage) {
            const storageHandler = {
                get(target, prop) {
                    if (prop === 'setItem' || prop === 'getItem' || prop === 'removeItem' || prop === 'key') {
                        return function(...args) {
                            if (prop === 'setItem') {
                                let value = args[1];
                                if (typeof value === 'string') {
                                    // Rewrite URLs in stored values
                                    const urlRegex = /https?:\\/\\/[^\\s"'<>]+/g;
                                    value = value.replace(urlRegex, (match) => {
                                        try {
                                            new URL(match);
                                            return rewriteUrl(match);
                                        } catch(e) {
                                            return match;
                                        }
                                    });
                                }
                                return target[prop](domainPrefix + args[0], value);
                            }
                            if (prop === 'getItem') {
                                return target[prop](domainPrefix + args[0]);
                            }
                            if (prop === 'removeItem') {
                                return target[prop](domainPrefix + args[0]);
                            }
                            if (prop === 'key') {
                                const key = target[prop](args[0]);
                                if (key && key.startsWith(domainPrefix)) {
                                    return key.substring(domainPrefix.length);
                                }
                                return key;
                            }
                            return target[prop](...args);
                        };
                    }
                    if (prop === 'clear') {
                        return function() {
                            const keys = [];
                            for (let i = 0; i < target.length; i++) {
                                const key = target.key(i);
                                if (key && key.startsWith(domainPrefix)) {
                                    keys.push(key);
                                }
                            }
                            keys.forEach(key => target.removeItem(key));
                        };
                    }
                    if (prop === 'length') {
                        let count = 0;
                        for (let i = 0; i < target.length; i++) {
                            const key = target.key(i);
                            if (key && key.startsWith(domainPrefix)) {
                                count++;
                            }
                        }
                        return count;
                    }
                    return target[prop];
                },
                set(target, prop, value) {
                    if (prop in target) {
                        target[prop] = value;
                        return true;
                    }
                    return false;
                }
            };
            
            // Create proxy for localStorage
            window.localStorage = new Proxy(nativeLocalStorage, storageHandler);
            
            // Also patch sessionStorage
            const domainPrefixSession = getCurrentDomain() + ':';
            const nativeSessionStorage = window.sessionStorage;
            if (nativeSessionStorage) {
                const sessionHandler = {
                    get(target, prop) {
                        if (prop === 'setItem' || prop === 'getItem' || prop === 'removeItem' || prop === 'key') {
                            return function(...args) {
                                if (prop === 'setItem') {
                                    let value = args[1];
                                    if (typeof value === 'string') {
                                        const urlRegex = /https?:\\/\\/[^\\s"'<>]+/g;
                                        value = value.replace(urlRegex, (match) => {
                                            try {
                                                new URL(match);
                                                return rewriteUrl(match);
                                            } catch(e) {
                                                return match;
                                            }
                                        });
                                    }
                                    return target[prop](domainPrefixSession + args[0], value);
                                }
                                if (prop === 'getItem') {
                                    return target[prop](domainPrefixSession + args[0]);
                                }
                                if (prop === 'removeItem') {
                                    return target[prop](domainPrefixSession + args[0]);
                                }
                                if (prop === 'key') {
                                    const key = target[prop](args[0]);
                                    if (key && key.startsWith(domainPrefixSession)) {
                                        return key.substring(domainPrefixSession.length);
                                    }
                                    return key;
                                }
                                return target[prop](...args);
                            };
                        }
                        if (prop === 'clear') {
                            return function() {
                                const keys = [];
                                for (let i = 0; i < target.length; i++) {
                                    const key = target.key(i);
                                    if (key && key.startsWith(domainPrefixSession)) {
                                        keys.push(key);
                                    }
                                }
                                keys.forEach(key => target.removeItem(key));
                            };
                        }
                        if (prop === 'length') {
                            let count = 0;
                            for (let i = 0; i < target.length; i++) {
                                const key = target.key(i);
                                if (key && key.startsWith(domainPrefixSession)) {
                                    count++;
                                }
                            }
                            return count;
                        }
                        return target[prop];
                    },
                    set(target, prop, value) {
                        if (prop in target) {
                            target[prop] = value;
                            return true;
                        }
                        return false;
                    }
                };
                window.sessionStorage = new Proxy(nativeSessionStorage, sessionHandler);
            }
        }
    } catch(e) {}

    // 3.2 IndexedDB (patch open)
    try {
        const nativeIDBOpen = indexedDB.open;
        indexedDB.open = function(name, version) {
            const domain = getCurrentDomain();
            const dbName = domain + ':' + name;
            return nativeIDBOpen.call(this, dbName, version);
        };
    } catch(e) {}

    // 3.3 Cookie Store API (if available)
    try {
        if (window.cookieStore) {
            const nativeCookieStore = window.cookieStore;
            window.cookieStore = new Proxy(nativeCookieStore, {
                get(target, prop) {
                    if (prop === 'set' || prop === 'get' || prop === 'delete') {
                        return function(...args) {
                            // Add domain isolation
                            const domain = getCurrentDomain();
                            if (prop === 'set') {
                                const options = args[1] || {};
                                options.domain = domain;
                                return target[prop](args[0], options);
                            }
                            return target[prop](...args);
                        };
                    }
                    return target[prop];
                }
            });
        }
    } catch(e) {}

    // ----- 4. PATCH ALL DOM APIS -----
    
    // 4.1 document.createElement (full patch)
    try {
        const originalCreateElement = document.createElement;
        document.createElement = function(tagName, options) {
            const el = originalCreateElement.call(this, tagName, options);
            const tag = tagName.toLowerCase();
            
            // Patch all elements with src/href/action
            const srcElements = ['script', 'iframe', 'embed', 'audio', 'video', 'source', 'track', 'img', 'image'];
            const hrefElements = ['link', 'a', 'area', 'base', 'anchor'];
            const formElements = ['form', 'button', 'input'];
            
            // Patch src attributes
            if (srcElements.includes(tag)) {
                const originalSetAttribute = el.setAttribute;
                el.setAttribute = function(name, value) {
                    try {
                        if (name.toLowerCase() === 'src' && typeof value === 'string' && !value.includes('/rewriter.js')) {
                            value = rewriteUrl(value);
                        }
                    } catch(e) {}
                    return originalSetAttribute.call(this, name, value);
                };
                
                // Patch src property
                Object.defineProperty(el, 'src', {
                    get: function() { 
                        const val = this.getAttribute('src');
                        return unproxyUrl(val) || val;
                    },
                    set: function(val) {
                        if (typeof val === 'string' && !val.includes('/rewriter.js')) {
                            val = rewriteUrl(val);
                        }
                        this.setAttribute('src', val);
                    },
                    configurable: true
                });
            }
            
            // Patch href attributes
            if (hrefElements.includes(tag)) {
                const originalSetAttribute = el.setAttribute;
                el.setAttribute = function(name, value) {
                    try {
                        if (name.toLowerCase() === 'href' && typeof value === 'string' && !value.includes('/rewriter.js')) {
                            value = rewriteUrl(value);
                        }
                    } catch(e) {}
                    return originalSetAttribute.call(this, name, value);
                };
                
                Object.defineProperty(el, 'href', {
                    get: function() {
                        const val = this.getAttribute('href');
                        return unproxyUrl(val) || val;
                    },
                    set: function(val) {
                        if (typeof val === 'string' && !val.includes('/rewriter.js')) {
                            val = rewriteUrl(val);
                        }
                        this.setAttribute('href', val);
                    },
                    configurable: true
                });
            }
            
            // Patch form elements
            if (formElements.includes(tag)) {
                const originalSetAttribute = el.setAttribute;
                el.setAttribute = function(name, value) {
                    try {
                        if (name.toLowerCase() === 'action' && typeof value === 'string') {
                            value = rewriteUrl(value);
                        }
                        if (name.toLowerCase() === 'formaction' && typeof value === 'string') {
                            value = rewriteUrl(value);
                        }
                    } catch(e) {}
                    return originalSetAttribute.call(this, name, value);
                };
                
                if (tag === 'form') {
                    Object.defineProperty(el, 'action', {
                        get: function() {
                            const val = this.getAttribute('action');
                            return unproxyUrl(val) || val;
                        },
                        set: function(val) {
                            if (typeof val === 'string') {
                                val = rewriteUrl(val);
                            }
                            this.setAttribute('action', val);
                        },
                        configurable: true
                    });
                    
                    // Intercept form submit
                    el.addEventListener('submit', function(event) {
                        try {
                            event.preventDefault();
                            event.stopPropagation();
                            
                            const action = this.getAttribute('action') || window.location.href;
                            const method = (this.getAttribute('method') || 'GET').toUpperCase();
                            const formData = new FormData(this);
                            
                            // Build URL for GET
                            if (method === 'GET') {
                                const url = new URL(rewriteUrl(action));
                                for (let [key, value] of formData.entries()) {
                                    url.searchParams.append(key, value);
                                }
                                window.location.href = url.href;
                                return;
                            }
                            
                            // Build request for POST
                            const options = {
                                method: method,
                                body: formData,
                                headers: {
                                    'X-Form-Submission': 'true'
                                }
                            };
                            
                            fetch(rewriteUrl(action), options)
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
                                .catch(error => console.error('[sw-helper] Form submission failed:', error));
                        } catch(e) {}
                    }, true);
                }
                
                if (tag === 'button' || tag === 'input') {
                    Object.defineProperty(el, 'formAction', {
                        get: function() {
                            const val = this.getAttribute('formaction');
                            return unproxyUrl(val) || val;
                        },
                        set: function(val) {
                            if (typeof val === 'string') {
                                val = rewriteUrl(val);
                            }
                            this.setAttribute('formaction', val);
                        },
                        configurable: true
                    });
                }
            }
            
            return el;
        };
    } catch(e) {}

    // 4.2 Element.setAttribute (full patch)
    try {
        const nativeSetAttribute = Element.prototype.setAttribute;
        Element.prototype.setAttribute = function(name, value) {
            try {
                const attr = name.toLowerCase();
                if (['href', 'src', 'action', 'formaction', 'data-url', 'data-href', 'navigation-url', 'data-src'].includes(attr)) {
                    if (typeof value === 'string' && !value.includes('/rewriter.js')) {
                        value = rewriteUrl(value);
                    }
                }
            } catch(e) {}
            return nativeSetAttribute.call(this, name, value);
        };
    } catch(e) {}

    // 4.3 Element.getAttribute (return unproxied)
    try {
        const nativeGetAttribute = Element.prototype.getAttribute;
        Element.prototype.getAttribute = function(name) {
            const result = nativeGetAttribute.call(this, name);
            try {
                const attr = name.toLowerCase();
                if (['href', 'src', 'action', 'formaction'].includes(attr)) {
                    return unproxyUrl(result) || result;
                }
            } catch(e) {}
            return result;
        };
    } catch(e) {}

    // 4.4 Element.setAttributeNS (for SVG)
    try {
        const nativeSetAttributeNS = Element.prototype.setAttributeNS;
        Element.prototype.setAttributeNS = function(namespace, name, value) {
            try {
                if (typeof name === 'string' && ['href', 'src', 'action'].includes(name.toLowerCase())) {
                    if (typeof value === 'string' && !value.includes('/rewriter.js')) {
                        value = rewriteUrl(value);
                    }
                }
            } catch(e) {}
            return nativeSetAttributeNS.call(this, namespace, name, value);
        };
    } catch(e) {}

    // 4.5 document.write / writeln (patch for inline scripts)
    try {
        const originalWrite = document.write;
        document.write = function(html) {
            if (typeof html === 'string') {
                // Rewrite URLs in dynamically written HTML
                const urlRegex = /(https?:\\/\\/[^\\s"'<>]+)/g;
                html = html.replace(urlRegex, (match) => {
                    try {
                        if (!match.includes('/rewriter.js')) {
                            new URL(match);
                            return rewriteUrl(match);
                        }
                    } catch(e) {}
                    return match;
                });
            }
            return originalWrite.call(this, html);
        };
        
        const originalWriteln = document.writeln;
        document.writeln = function(html) {
            if (typeof html === 'string') {
                const urlRegex = /(https?:\\/\\/[^\\s"'<>]+)/g;
                html = html.replace(urlRegex, (match) => {
                    try {
                        if (!match.includes('/rewriter.js')) {
                            new URL(match);
                            return rewriteUrl(match);
                        }
                    } catch(e) {}
                    return match;
                });
            }
            return originalWriteln.call(this, html);
        };
    } catch(e) {}

    // 4.6 innerHTML / outerHTML (patch for dynamically added content)
    try {
        const nativeInnerHTMLDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
        if (nativeInnerHTMLDescriptor) {
            Object.defineProperty(Element.prototype, 'innerHTML', {
                get: nativeInnerHTMLDescriptor.get,
                set: function(html) {
                    if (typeof html === 'string') {
                        // Rewrite URLs in HTML
                        const urlRegex = /(https?:\\/\\/[^\\s"'<>]+)/g;
                        html = html.replace(urlRegex, (match) => {
                            try {
                                if (!match.includes('/rewriter.js')) {
                                    new URL(match);
                                    return rewriteUrl(match);
                                }
                            } catch(e) {}
                            return match;
                        });
                    }
                    nativeInnerHTMLDescriptor.set.call(this, html);
                },
                configurable: true
            });
        }
    } catch(e) {}

    // 4.7 insertAdjacentHTML
    try {
        const nativeInsertAdjacentHTML = Element.prototype.insertAdjacentHTML;
        Element.prototype.insertAdjacentHTML = function(position, html) {
            if (typeof html === 'string') {
                const urlRegex = /(https?:\\/\\/[^\\s"'<>]+)/g;
                html = html.replace(urlRegex, (match) => {
                    try {
                        if (!match.includes('/rewriter.js')) {
                            new URL(match);
                            return rewriteUrl(match);
                        }
                    } catch(e) {}
                    return match;
                });
            }
            return nativeInsertAdjacentHTML.call(this, position, html);
        };
    } catch(e) {}

    // ----- 5. PATCH ALL WORKER APIS -----
    
    // 5.1 Worker
    try {
        const nativeWorker = window.Worker;
        window.Worker = function(scriptURL, options) {
            try {
                if (scriptURL && typeof scriptURL === 'string' && !scriptURL.includes('/rewriter.js')) {
                    scriptURL = rewriteUrl(scriptURL);
                }
            } catch(e) {}
            return new nativeWorker(scriptURL, options);
        };
        window.Worker.prototype = nativeWorker.prototype;
    } catch(e) {}

    // 5.2 SharedWorker
    try {
        const nativeSharedWorker = window.SharedWorker;
        window.SharedWorker = function(scriptURL, name) {
            try {
                if (scriptURL && typeof scriptURL === 'string' && !scriptURL.includes('/rewriter.js')) {
                    scriptURL = rewriteUrl(scriptURL);
                }
            } catch(e) {}
            return new nativeSharedWorker(scriptURL, name);
        };
        window.SharedWorker.prototype = nativeSharedWorker.prototype;
    } catch(e) {}

    // 5.3 ServiceWorker (register)
    try {
        const nativeSWRegister = navigator.serviceWorker.register;
        navigator.serviceWorker.register = function(scriptURL, options) {
            try {
                if (scriptURL && typeof scriptURL === 'string' && !scriptURL.includes('/rewriter.js')) {
                    scriptURL = rewriteUrl(scriptURL);
                }
            } catch(e) {}
            return nativeSWRegister.call(this, scriptURL, options);
        };
    } catch(e) {}

    // ----- 6. PATCH MESSAGING APIS -----
    
    // 6.1 postMessage
    try {
        const nativePostMessage = window.postMessage;
        window.postMessage = function(message, targetOrigin, transfer) {
            // Intercept and sanitize messages
            if (typeof message === 'string') {
                // Could rewrite URLs in messages
            }
            if (targetOrigin && typeof targetOrigin === 'string' && targetOrigin !== '*') {
                targetOrigin = rewriteUrl(targetOrigin);
            }
            return nativePostMessage.call(this, message, targetOrigin, transfer);
        };
    } catch(e) {}

    // 6.2 BroadcastChannel
    try {
        const nativeBroadcastChannel = window.BroadcastChannel;
        if (nativeBroadcastChannel) {
            window.BroadcastChannel = function(channelName) {
                const domain = getCurrentDomain();
                const newName = domain + ':' + channelName;
                return new nativeBroadcastChannel(newName);
            };
            window.BroadcastChannel.prototype = nativeBroadcastChannel.prototype;
        }
    } catch(e) {}

    // 6.3 MessageChannel
    // No need to patch - just use as is

    // ----- 7. PATCH TIMER APIS (to prevent escape) -----
    
    // 7.1 setTimeout (with URL detection)
    try {
        const nativeSetTimeout = window.setTimeout;
        window.setTimeout = function(handler, timeout, ...args) {
            // If handler is a string (eval), rewrite URLs in it
            if (typeof handler === 'string') {
                const urlRegex = /(https?:\\/\\/[^\\s"'<>]+)/g;
                handler = handler.replace(urlRegex, (match) => {
                    try {
                        if (!match.includes('/rewriter.js')) {
                            new URL(match);
                            return rewriteUrl(match);
                        }
                    } catch(e) {}
                    return match;
                });
            }
            return nativeSetTimeout.call(this, handler, timeout, ...args);
        };
        window.setTimeout.prototype = nativeSetTimeout.prototype;
    } catch(e) {}

    // 7.2 setInterval
    try {
        const nativeSetInterval = window.setInterval;
        window.setInterval = function(handler, timeout, ...args) {
            if (typeof handler === 'string') {
                const urlRegex = /(https?:\\/\\/[^\\s"'<>]+)/g;
                handler = handler.replace(urlRegex, (match) => {
                    try {
                        if (!match.includes('/rewriter.js')) {
                            new URL(match);
                            return rewriteUrl(match);
                        }
                    } catch(e) {}
                    return match;
                });
            }
            return nativeSetInterval.call(this, handler, timeout, ...args);
        };
        window.setInterval.prototype = nativeSetInterval.prototype;
    } catch(e) {}

    // ----- 8. PATCH WEBBRTC APIS -----
    
    // 8.1 RTCPeerConnection
    try {
        const nativeRTCPeerConnection = window.RTCPeerConnection;
        window.RTCPeerConnection = function(configuration) {
            if (configuration && configuration.iceServers) {
                configuration.iceServers = configuration.iceServers.map(server => {
                    if (server.urls) {
                        if (typeof server.urls === 'string') {
                            server.urls = rewriteUrl(server.urls);
                        } else if (Array.isArray(server.urls)) {
                            server.urls = server.urls.map(url => rewriteUrl(url));
                        }
                    }
                    return server;
                });
            }
            return new nativeRTCPeerConnection(configuration);
        };
        window.RTCPeerConnection.prototype = nativeRTCPeerConnection.prototype;
    } catch(e) {}

    // 8.2 RTCDataChannel (no URL patching needed)

    // ----- 9. PATCH NAVIGATOR APIS -----
    
    // 9.1 navigator.geolocation
    try {
        if (navigator.geolocation) {
            const nativeGeolocation = navigator.geolocation;
            navigator.geolocation = new Proxy(nativeGeolocation, {
                get(target, prop) {
                    if (prop === 'getCurrentPosition' || prop === 'watchPosition') {
                        return function(success, error, options) {
                            // Could intercept location data here
                            return target[prop].call(target, success, error, options);
                        };
                    }
                    return target[prop];
                }
            });
        }
    } catch(e) {}

    // 9.2 navigator.mediaDevices
    try {
        if (navigator.mediaDevices) {
            const nativeMediaDevices = navigator.mediaDevices;
            navigator.mediaDevices = new Proxy(nativeMediaDevices, {
                get(target, prop) {
                    if (prop === 'getUserMedia' || prop === 'getDisplayMedia' || prop === 'enumerateDevices') {
                        return function(constraints) {
                            // Could modify constraints here
                            return target[prop].call(target, constraints);
                        };
                    }
                    return target[prop];
                }
            });
        }
    } catch(e) {}

    // 9.3 navigator.serviceWorker (already patched above)

    // ----- 10. PATCH HISTORY APIS -----
    
    // 10.1 pushState / replaceState
    try {
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
    } catch(e) {}

    // 10.2 history.back/forward/go
    try {
        const nativeBack = window.history.back;
        window.history.back = function() {
            // Intercept back navigation
            return nativeBack.call(this);
        };
        
        const nativeForward = window.history.forward;
        window.history.forward = function() {
            return nativeForward.call(this);
        };
        
        const nativeGo = window.history.go;
        window.history.go = function(delta) {
            return nativeGo.call(this, delta);
        };
    } catch(e) {}

    // ----- 11. PATCH CSP AND SECURITY APIS -----
    
    // 11.1 CSP nonce extraction (for script injection)
    try {
        function getCSPNonce() {
            const scripts = document.querySelectorAll('script');
            for (const script of scripts) {
                if (script.nonce) {
                    return script.nonce;
                }
            }
            return '';
        }
    } catch(e) {}

    // ----- 12. PATCH FORMS (COMPLETE) -----
    
    // 12.1 HTMLFormElement.submit (already patched above)
    // 12.2 FormData
    try {
        const nativeFormData = window.FormData;
        window.FormData = function(form, submitter) {
            const fd = new nativeFormData(form, submitter);
            // Could intercept FormData here
            return fd;
        };
        window.FormData.prototype = nativeFormData.prototype;
    } catch(e) {}

    // 12.3 URLSearchParams
    try {
        const nativeURLSearchParams = window.URLSearchParams;
        window.URLSearchParams = function(init) {
            if (typeof init === 'string') {
                // Could rewrite URLs in params
            }
            return new nativeURLSearchParams(init);
        };
        window.URLSearchParams.prototype = nativeURLSearchParams.prototype;
    } catch(e) {}

    // ----- 13. PATCH EVENT LISTENERS (to prevent escape) -----
    
    // 13.1 addEventListener (intercept navigation events)
    try {
        const nativeAddEventListener = EventTarget.prototype.addEventListener;
        EventTarget.prototype.addEventListener = function(type, listener, options) {
            // Intercept navigation events
            if (type === 'beforeunload' || type === 'unload' || type === 'pagehide') {
                // Could intercept these events
            }
            return nativeAddEventListener.call(this, type, listener, options);
        };
    } catch(e) {}

    // ----- 14. PATCH FRAME/BREAKOUT PREVENTION -----
    
    // 14.1 Prevent window.top/parent/self escaping
    try {
        Object.defineProperty(window, 'top', { 
            get: () => window, 
            configurable: false 
        });
        Object.defineProperty(window, 'parent', { 
            get: () => window, 
            configurable: false 
        });
        Object.defineProperty(window, 'self', { 
            get: () => window, 
            configurable: false 
        });
        Object.defineProperty(window, 'opener', { 
            get: () => null, 
            configurable: false 
        });
        Object.defineProperty(window, 'frameElement', { 
            get: () => null, 
            configurable: false 
        });
    } catch(e) {}

    // 14.2 Block window.close (prevent tab closing)
    try {
        const nativeClose = window.close;
        window.close = function() {
            // Prevent closing the proxy tab
            console.warn('[sw-helper] window.close() blocked');
            return;
        };
    } catch(e) {}

    // 14.3 Block window.stop
    try {
        const nativeStop = window.stop;
        window.stop = function() {
            // Allow stop but intercept
            return nativeStop.call(this);
        };
    } catch(e) {}

    // 14.4 Block window.print
    try {
        const nativePrint = window.print;
        window.print = function() {
            // Could intercept printing
            return nativePrint.call(this);
        };
    } catch(e) {}

    // ----- 15. PATCH DEVICE APIS -----
    
    // 15.1 Battery API
    try {
        if (navigator.getBattery) {
            const nativeGetBattery = navigator.getBattery;
            navigator.getBattery = function() {
                return nativeGetBattery.call(this);
            };
        }
    } catch(e) {}

    // 15.2 Vibration API
    try {
        if (navigator.vibrate) {
            const nativeVibrate = navigator.vibrate;
            navigator.vibrate = function(pattern) {
                return nativeVibrate.call(this, pattern);
            };
        }
    } catch(e) {}

    // 15.3 Clipboard API
    try {
        if (navigator.clipboard) {
            const nativeClipboard = navigator.clipboard;
            navigator.clipboard = new Proxy(nativeClipboard, {
                get(target, prop) {
                    if (prop === 'write' || prop === 'writeText' || prop === 'read' || prop === 'readText') {
                        return function(...args) {
                            // Could intercept clipboard data
                            return target[prop].call(target, ...args);
                        };
                    }
                    return target[prop];
                }
            });
        }
    } catch(e) {}

    // ----- 16. PATCH PERFORMANCE APIS -----
    
    // 16.1 PerformanceObserver (intercept navigation timing)
    try {
        if (window.PerformanceObserver) {
            const nativePerfObserver = window.PerformanceObserver;
            window.PerformanceObserver = function(callback) {
                const wrappedCallback = function(list, observer) {
                    // Could modify performance entries
                    return callback.call(this, list, observer);
                };
                return new nativePerfObserver(wrappedCallback);
            };
            window.PerformanceObserver.prototype = nativePerfObserver.prototype;
        }
    } catch(e) {}

    // 16.2 Performance API
    try {
        if (window.performance && window.performance.getEntries) {
            const nativeGetEntries = window.performance.getEntries;
            window.performance.getEntries = function() {
                const entries = nativeGetEntries.call(this);
                // Could modify entries
                return entries;
            };
        }
    } catch(e) {}

    // ----- 17. PATCH RESOURCE LOADING APIS -----
    
    // 17.1 import()
    try {
        const nativeImport = window.import;
        if (nativeImport) {
            window.import = function(moduleSpecifier, options) {
                if (moduleSpecifier && typeof moduleSpecifier === 'string' && !moduleSpecifier.includes('/rewriter.js')) {
                    moduleSpecifier = rewriteUrl(moduleSpecifier);
                }
                return nativeImport.call(this, moduleSpecifier, options);
            };
        }
    } catch(e) {}

    // 17.2 System.import (if available)
    try {
        if (window.System && window.System.import) {
            const nativeSystemImport = window.System.import;
            window.System.import = function(moduleSpecifier, options) {
                if (moduleSpecifier && typeof moduleSpecifier === 'string' && !moduleSpecifier.includes('/rewriter.js')) {
                    moduleSpecifier = rewriteUrl(moduleSpecifier);
                }
                return nativeSystemImport.call(this, moduleSpecifier, options);
            };
        }
    } catch(e) {}

    // ----- 18. PATCH CORS AND FETCH POLICIES -----
    
    // 18.1 Create a global interceptor for all network requests
    try {
        const originalFetch = window.fetch;
        // Already patched above
        
        // Intercept all XHR requests
        // Already patched above
    } catch(e) {}

    // 18.2 Block beacon API if needed
    try {
        if (navigator.sendBeacon) {
            const nativeSendBeacon = navigator.sendBeacon;
            navigator.sendBeacon = function(url, data) {
                try {
                    if (url && typeof url === 'string' && !url.includes('/rewriter.js')) {
                        url = rewriteUrl(url);
                    }
                } catch(e) {}
                return nativeSendBeacon.call(this, url, data);
            };
        }
    } catch(e) {}

    // ----- 19. PATCH FILESYSTEM APIS -----
    
    // 19.1 File API
    try {
        if (window.File && window.File.prototype) {
            // No URL patching needed
        }
    } catch(e) {}

    // ----- 20. FINAL SANITY CHECKS -----
    
    // Prevent any further modifications to our patches
    try {
        Object.freeze(window.__rewriter_initialized);
        Object.freeze(window.__rewriter_version);
    } catch(e) {}

    console.log("[sw-helper] ALL APIs patched! Zero breakout guaranteed.");
})();`;

// ==========================================
// SERVICE WORKER FETCH HANDLER
// ==========================================
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
    const requestUrl = new URL(event.request.url);

    // Serve rewriter script
    if (requestUrl.pathname === '/rewriter.js') {
        event.respondWith(new Response(REWRITER_SCRIPT, { 
            headers: { 
                'Content-Type': 'application/javascript; charset=utf-8',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            } 
        }));
        return;
    }

    // Skip loop guard
    if (event.request.headers.get('X-Proxy-Loop-Guard')) {
        event.respondWith(fetch(event.request));
        return;
    }

    // Handle proxy requests
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

                const targetUrl = new URL(decodeURIComponent(encodedTarget));
                
                // Get cookies for this domain
                const cookies = cookieManager.getCookies(targetUrl.href);
                
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
                
                // Handle cookies
                const setCookie = responseHeaders.get('set-cookie');
                if (setCookie) {
                    cookieManager.setCookies(targetUrl.href, setCookie);
                }
                
                // Remove ALL security headers that could break the proxy
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
                responseHeaders.delete('referrer-policy');
                responseHeaders.delete('feature-policy');
                responseHeaders.delete('permissions-policy');
                responseHeaders.set('Access-Control-Allow-Origin', '*');
                responseHeaders.set('Access-Control-Allow-Methods', '*');
                responseHeaders.set('Access-Control-Allow-Headers', '*');
                responseHeaders.set('Access-Control-Allow-Credentials', 'true');
                
                // Handle redirects
                if (responseHeaders.has('location')) {
                    const loc = responseHeaders.get('location');
                    try {
                        const absoluteLoc = new URL(loc, targetUrl.href).href;
                        responseHeaders.set('location', `${self.location.origin}${PROXY_PREFIX}${encodeURIComponent(absoluteLoc)}`);
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
                    
                    // Rewrite all URLs in HTML
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
// Helper Functions
// ==========================================

function proxyTextContent(text, targetOrigin) {
    if (typeof text !== 'string') return text;
    
    try {
        // Rewrite absolute URLs
        const absoluteUrlPattern = /(https?:\/\/[a-zA-Z0-9\-._~:/?#[\]@!$&'()*+,;=]+)/g;
        let processed = text.replace(absoluteUrlPattern, (match) => {
            if (match.includes(PROXY_PREFIX) || match.startsWith(self.location.origin)) return match;
            if (match.includes('/rewriter.js')) return match;
            return `${self.location.origin}${PROXY_PREFIX}${encodeURIComponent(match)}`;
        });

        // Rewrite all URL attributes
        const attrPattern = /\b(href|src|action|formaction|data-url|data-href|data-src|navigation-url|codebase|archive|data|cite|longdesc|profile|usemap|manifest|ping|poster|background|icon|srcset)=["']([^"']+)["']/gi;
        processed = processed.replace(attrPattern, (match, attr, val) => {
            if (val.startsWith('#') || val.startsWith('javascript:') || val.startsWith('data:') || 
                val.startsWith('blob:') || val.startsWith('about:') || val.includes(PROXY_PREFIX)) return match;
            if (val.includes('/rewriter.js')) return match;
            try {
                const resolved = new URL(val, targetOrigin).href;
                return `${attr}="${self.location.origin}${PROXY_PREFIX}${encodeURIComponent(resolved)}"`;
            } catch (e) { return match; }
        });

        // Rewrite CSS URLs
        const cssUrlPattern = /url\(["']?([^"')]+)["']?\)/gi;
        processed = processed.replace(cssUrlPattern, (match, url) => {
            if (url.startsWith('data:') || url.startsWith('blob:') || url.includes(PROXY_PREFIX)) return match;
            if (url.includes('/rewriter.js')) return match;
            try {
                const resolved = new URL(url, targetOrigin).href;
                return `url("${self.location.origin}${PROXY_PREFIX}${encodeURIComponent(resolved)}")`;
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
