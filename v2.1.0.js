// ==========================================
// Enhanced Service Worker with CSP Handling
// ==========================================
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
    }

    getDomainKey(url) {
        try {
            const urlObj = new URL(url);
            return urlObj.hostname;
        } catch (e) {
            return 'default';
        }
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
// ENHANCED REWRITER - CSP Compliant
// ==========================================
const REWRITER_SOURCE = `(function() {
    const PROXY_PREFIX = '/go/';
    const PROXY_HOST = window.location.host;
    const PROXY_ORIGIN = window.location.origin;

    // Get current proxied domain
    function getCurrentDomain() {
        try {
            const url = unproxyUrl(window.location.href);
            return new URL(url).hostname;
        } catch (e) {
            return 'default';
        }
    }

    function isApiRequest(url) {
        if (!url || typeof url !== 'string') return false;
        const urlLower = url.toLowerCase();
        const apiPatterns = [
            '/api/', '/v1/', '/v2/', '/v3/', '/v4/', '/v5/',
            '/graphql', '/rest/', '/rpc/', '/service/', '/auth/',
            '/oauth/', '/token', '/login', '/signin', '/register',
            '/upload', '/post', '/put', '/delete', '/patch',
            '/ajax', '/json', '/rpc', '/gateway'
        ];
        return apiPatterns.some(pattern => urlLower.includes(pattern));
    }

    function rewriteUrl(url) {
        if (!url || typeof url !== 'string') return url;
        const trimmed = url.trim();
        if (trimmed.startsWith('data:') || trimmed.startsWith('blob:') || trimmed.startsWith('javascript:')) return url;
        if (trimmed.startsWith(PROXY_PREFIX) || trimmed.startsWith(PROXY_ORIGIN + PROXY_PREFIX)) return url;
        try {
            const baseContext = window.location.href;
            const resolved = new URL(trimmed, baseContext).href;
            return PROXY_PREFIX + encodeURIComponent(resolved);
        } catch (e) {
            return url;
        }
    }

    function unproxyUrl(url) {
        if (!url || typeof url !== 'string') return url;
        if (url.includes(PROXY_PREFIX)) {
            try {
                const parts = url.split(PROXY_PREFIX);
                return decodeURIComponent(parts[parts.length - 1]);
            } catch (e) {}
        }
        return url;
    }

    // --- CSP Compliant Script Injection ---
    function injectRewriter() {
        // Check if already injected
        if (window._rewriterInjected) return;
        window._rewriterInjected = true;

        // Try to find any existing nonce in the page
        let nonce = '';
        const scripts = document.querySelectorAll('script');
        for (const script of scripts) {
            if (script.nonce) {
                nonce = script.nonce;
                break;
            }
        }

        // Create a new script element with proper attributes
        const script = document.createElement('script');
        if (nonce) {
            script.setAttribute('nonce', nonce);
        }
        script.setAttribute('data-rewriter', 'true');
        
        // Use inline script with the full rewriter code
        // This avoids CSP issues with external scripts
        script.textContent = \`
            // Rewriter core functions
            const PROXY_PREFIX = '/go/';
            const PROXY_HOST = window.location.host;
            const PROXY_ORIGIN = window.location.origin;

            function rewriteUrl(url) {
                if (!url || typeof url !== 'string') return url;
                const trimmed = url.trim();
                if (trimmed.startsWith('data:') || trimmed.startsWith('blob:') || trimmed.startsWith('javascript:')) return url;
                if (trimmed.startsWith(PROXY_PREFIX) || trimmed.startsWith(PROXY_ORIGIN + PROXY_PREFIX)) return url;
                try {
                    const baseContext = window.location.href;
                    const resolved = new URL(trimmed, baseContext).href;
                    return PROXY_PREFIX + encodeURIComponent(resolved);
                } catch (e) {
                    return url;
                }
            }

            function unproxyUrl(url) {
                if (!url || typeof url !== 'string') return url;
                if (url.includes(PROXY_PREFIX)) {
                    try {
                        const parts = url.split(PROXY_PREFIX);
                        return decodeURIComponent(parts[parts.length - 1]);
                    } catch (e) {}
                }
                return url;
            }

            function getCurrentDomain() {
                try {
                    const url = unproxyUrl(window.location.href);
                    return new URL(url).hostname;
                } catch (e) {
                    return 'default';
                }
            }

            function isApiRequest(url) {
                if (!url || typeof url !== 'string') return false;
                const urlLower = url.toLowerCase();
                const apiPatterns = [
                    '/api/', '/v1/', '/v2/', '/v3/', '/v4/', '/v5/',
                    '/graphql', '/rest/', '/rpc/', '/service/', '/auth/',
                    '/oauth/', '/token', '/login', '/signin', '/register',
                    '/upload', '/post', '/put', '/delete', '/patch',
                    '/ajax', '/json', '/rpc', '/gateway'
                ];
                return apiPatterns.some(pattern => urlLower.includes(pattern));
            }

            // --- Cookie handling ---
            const cookieDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
            if (cookieDescriptor) {
                Object.defineProperty(document, 'cookie', {
                    get: function() {
                        // Get cookies for current domain from service worker
                        const domain = getCurrentDomain();
                        const cookies = cookieDescriptor.get.call(this);
                        // Filter and return only relevant cookies
                        return cookies || '';
                    },
                    set: function(value) {
                        const domain = getCurrentDomain();
                        if (!value.includes('; Domain=') && !value.includes('; domain=')) {
                            value += \`; Domain=\${domain}\`;
                        }
                        return cookieDescriptor.set.call(this, value);
                    }
                });
            }

            // --- Enhanced fetch API ---
            const nativeFetch = window.fetch;
            window.fetch = async function(input, init) {
                let url = typeof input === 'string' ? input : input.url;
                const isApi = isApiRequest(url);
                
                const domain = getCurrentDomain();
                if (init && typeof init === 'object') {
                    init.headers = new Headers(init.headers || {});
                    const cookies = document.cookie;
                    if (cookies) {
                        init.headers.set('Cookie', cookies);
                    }
                    if (isApi) {
                        init.headers.set('X-API-Request', 'true');
                        init.headers.set('X-Proxied-Domain', domain);
                    }
                }
                
                const rewrittenInput = typeof input === 'string' ? rewriteUrl(input) : 
                                      (input instanceof Request ? new Request(rewriteUrl(input.url), input) : input);
                
                const response = await nativeFetch.call(this, rewrittenInput, init);
                
                const setCookie = response.headers.get('set-cookie');
                if (setCookie) {
                    try {
                        const newCookies = setCookie.split(',').map(c => c.trim());
                        newCookies.forEach(cookie => {
                            if (cookie) {
                                document.cookie = cookie;
                            }
                        });
                    } catch(e) {}
                }
                
                return response;
            };

            // --- Enhanced form handling ---
            function handleFormSubmission(form, event) {
                if (!form) return false;
                
                const action = form.getAttribute('action') || window.location.href;
                const method = (form.getAttribute('method') || 'GET').toUpperCase();
                const enctype = form.getAttribute('enctype') || 'application/x-www-form-urlencoded';
                const isApi = isApiRequest(action);
                
                const formData = new FormData(form);
                const domain = getCurrentDomain();
                
                const rewrittenAction = rewriteUrl(action);
                form.setAttribute('action', rewrittenAction);
                
                if (event) {
                    event.preventDefault();
                    event.stopPropagation();
                }
                
                const options = {
                    method: method,
                    headers: {
                        'X-Form-Submission': 'true',
                        'X-Original-Action': action,
                        'X-Proxied-Domain': domain
                    },
                    credentials: 'include'
                };
                
                if (method === 'GET') {
                    const url = new URL(rewrittenAction);
                    for (let [key, value] of formData.entries()) {
                        if (Array.isArray(value)) {
                            value.forEach(v => url.searchParams.append(key + '[]', v));
                        } else {
                            url.searchParams.append(key, value);
                        }
                    }
                    window.location.href = url.href;
                    return true;
                }
                
                if (enctype === 'multipart/form-data') {
                    options.body = formData;
                } else {
                    options.headers['Content-Type'] = enctype;
                    const params = new URLSearchParams();
                    for (let [key, value] of formData.entries()) {
                        if (Array.isArray(value)) {
                            value.forEach(v => params.append(key + '[]', v));
                        } else {
                            params.append(key, value);
                        }
                    }
                    options.body = params.toString();
                }
                
                fetch(rewrittenAction, options)
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

            // --- Intercept form submissions ---
            document.addEventListener('submit', function(event) {
                const form = event.target;
                if (form && form.tagName && form.tagName.toLowerCase() === 'form') {
                    if (form.dataset.intercepted) return;
                    form.dataset.intercepted = 'true';
                    handleFormSubmission(form, event);
                }
            }, true);

            // --- Override HTMLFormElement.prototype.submit ---
            const originalFormSubmit = HTMLFormElement.prototype.submit;
            HTMLFormElement.prototype.submit = function() {
                if (this.dataset && this.dataset.intercepted) {
                    return originalFormSubmit.call(this);
                }
                if (this.dataset) this.dataset.intercepted = 'true';
                handleFormSubmission(this);
            };

            // --- Enhanced XMLHttpRequest ---
            const nativeXHROpen = XMLHttpRequest.prototype.open;
            const nativeXHRSend = XMLHttpRequest.prototype.send;
            
            XMLHttpRequest.prototype.open = function(method, url, ...args) {
                this._method = method;
                this._originalUrl = url;
                this._isApi = isApiRequest(url);
                this._domain = getCurrentDomain();
                
                const rewrittenUrl = rewriteUrl(url);
                return nativeXHROpen.call(this, method, rewrittenUrl, ...args);
            };
            
            XMLHttpRequest.prototype.send = function(body) {
                const cookies = document.cookie;
                if (cookies) {
                    this.setRequestHeader('Cookie', cookies);
                }
                if (this._isApi) {
                    this.setRequestHeader('X-API-Request', 'true');
                    this.setRequestHeader('X-Proxied-Domain', this._domain);
                }
                
                if (body instanceof FormData && this._isApi) {
                    const entries = Array.from(body.entries());
                    if (entries.length > 0) {
                        console.log('[sw-helper] API FormData:', entries);
                    }
                }
                
                if (typeof body === 'string' && this._isApi) {
                    try {
                        const params = new URLSearchParams(body);
                        for (let [key, value] of params) {
                            if (value.includes('http://') || value.includes('https://')) {
                                try {
                                    new URL(value);
                                    params.set(key, rewriteUrl(value));
                                } catch(e) {}
                            }
                        }
                        body = params.toString();
                    } catch(e) {}
                }
                
                const originalOnReadyStateChange = this.onreadystatechange;
                this.onreadystatechange = function(...args) {
                    if (this.readyState === 4) {
                        const setCookie = this.getResponseHeader('set-cookie');
                        if (setCookie) {
                            try {
                                const cookies = setCookie.split(',').map(c => c.trim());
                                cookies.forEach(cookie => {
                                    if (cookie) {
                                        document.cookie = cookie;
                                    }
                                });
                            } catch(e) {}
                        }
                    }
                    if (originalOnReadyStateChange) {
                        originalOnReadyStateChange.apply(this, args);
                    }
                };
                
                return nativeXHRSend.call(this, body);
            };

            // --- Enhanced WebSocket ---
            const NativeWebSocket = window.WebSocket;
            window.WebSocket = function(url, protocols) {
                try {
                    const baseContext = window.location.href;
                    const targetUrl = new URL(url, baseContext);
                    const domain = getCurrentDomain();
                    
                    const wsScheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
                    const interceptWsRoute = \`\${wsScheme}//\${PROXY_HOST}/ws/?target=\${encodeURIComponent(targetUrl.href)}&domain=\${domain}\`;
                    
                    return new NativeWebSocket(interceptWsRoute, protocols);
                } catch(e) {
                    return new NativeWebSocket(url, protocols);
                }
            };
            window.WebSocket.prototype = NativeWebSocket.prototype;

            // --- Enhanced Element attribute patching ---
            const nativeSetAttribute = Element.prototype.setAttribute;
            Element.prototype.setAttribute = function(name, value) {
                const attr = name.toLowerCase();
                if (['href', 'src', 'action', 'formaction', 'data-url', 'navigation-url'].includes(attr)) {
                    if (typeof value === 'string' && !value.startsWith(PROXY_PREFIX)) {
                        if (!value.startsWith('http://') && !value.startsWith('https://') && !value.startsWith('/')) {
                            const base = window.location.href;
                            try {
                                const resolved = new URL(value, base);
                                value = rewriteUrl(resolved.href);
                            } catch(e) {
                                value = rewriteUrl(value);
                            }
                        } else {
                            value = rewriteUrl(value);
                        }
                    }
                }
                return nativeSetAttribute.call(this, name, value);
            };

            // --- Enhanced createElement ---
            const originalCreateElement = document.createElement;
            document.createElement = function(tagName, options) {
                const el = originalCreateElement.call(this, tagName, options);
                const tag = tagName.toLowerCase();
                
                const srcElements = ['script', 'iframe', 'embed', 'audio', 'video', 'source', 'track', 'img'];
                if (srcElements.includes(tag)) {
                    const originalSetAttribute = el.setAttribute;
                    el.setAttribute = function(name, value) {
                        if (name.toLowerCase() === 'src') {
                            value = rewriteUrl(value);
                        }
                        return originalSetAttribute.call(this, name, value);
                    };
                    Object.defineProperty(el, 'src', {
                        get: function() { return unproxyUrl(this.getAttribute('src')); },
                        set: function(val) { this.setAttribute('src', val); }
                    });
                }
                
                const hrefElements = ['link', 'a', 'area', 'base'];
                if (hrefElements.includes(tag)) {
                    const originalSetAttribute = el.setAttribute;
                    el.setAttribute = function(name, value) {
                        if (name.toLowerCase() === 'href') {
                            value = rewriteUrl(value);
                        }
                        return originalSetAttribute.call(this, name, value);
                    };
                    Object.defineProperty(el, 'href', {
                        get: function() { return unproxyUrl(this.getAttribute('href')); },
                        set: function(val) { this.setAttribute('href', val); }
                    });
                }
                
                if (tag === 'form') {
                    const originalSetAttribute = el.setAttribute;
                    el.setAttribute = function(name, value) {
                        if (name.toLowerCase() === 'action') {
                            value = rewriteUrl(value);
                        }
                        return originalSetAttribute.call(this, name, value);
                    };
                    Object.defineProperty(el, 'action', {
                        get: function() { return unproxyUrl(this.getAttribute('action')); },
                        set: function(val) { this.setAttribute('action', val); }
                    });
                    
                    el.addEventListener('submit', function(event) {
                        event.preventDefault();
                        event.stopPropagation();
                        handleFormSubmission(this, event);
                    }, true);
                }
                
                return el;
            };

            // --- MutationObserver for dynamic content ---
            const observer = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    if (mutation.type === 'attributes') {
                        const attr = mutation.attributeName;
                        if (['href', 'src', 'action', 'formaction'].includes(attr)) {
                            const el = mutation.target;
                            const value = el.getAttribute(attr);
                            if (value && !value.startsWith(PROXY_PREFIX)) {
                                try {
                                    el.setAttribute(attr, rewriteUrl(value));
                                } catch(e) {}
                            }
                        }
                    }
                    
                    if (mutation.type === 'childList') {
                        mutation.addedNodes.forEach(node => {
                            if (node.nodeType === 1) {
                                if (node.tagName && node.tagName.toLowerCase() === 'form') {
                                    const action = node.getAttribute('action');
                                    if (action && !action.startsWith(PROXY_PREFIX)) {
                                        node.setAttribute('action', rewriteUrl(action));
                                    }
                                    node.addEventListener('submit', function(event) {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        handleFormSubmission(this, event);
                                    }, true);
                                }
                                
                                ['src', 'href', 'action'].forEach(attr => {
                                    if (node.hasAttribute && node.hasAttribute(attr)) {
                                        const value = node.getAttribute(attr);
                                        if (value && !value.startsWith(PROXY_PREFIX)) {
                                            try {
                                                node.setAttribute(attr, rewriteUrl(value));
                                            } catch(e) {}
                                        }
                                    }
                                });
                            }
                        });
                    }
                });
            });

            if (document.documentElement) {
                observer.observe(document.documentElement, {
                    attributes: true,
                    childList: true,
                    subtree: true,
                    attributeFilter: ['href', 'src', 'action', 'formaction']
                });
            }

            // --- History API ---
            const nativePushState = window.history.pushState;
            window.history.pushState = function(state, title, url) {
                if (url) {
                    state = state || {};
                    state._originalUrl = unproxyUrl(url.toString());
                    state._domain = getCurrentDomain();
                    url = rewriteUrl(url.toString());
                }
                return nativePushState.call(this, state, title, url);
            };

            const nativeReplaceState = window.history.replaceState;
            window.history.replaceState = function(state, title, url) {
                if (url) {
                    state = state || {};
                    state._originalUrl = unproxyUrl(url.toString());
                    state._domain = getCurrentDomain();
                    url = rewriteUrl(url.toString());
                }
                return nativeReplaceState.call(this, state, title, url);
            };

            // --- window.open ---
            const nativeOpen = window.open;
            window.open = function(url, target, features) {
                if (url) {
                    url = rewriteUrl(url.toString());
                    const domain = getCurrentDomain();
                    url += (url.includes('?') ? '&' : '?') + 'domain=' + encodeURIComponent(domain);
                }
                return nativeOpen.call(this, url, target, features);
            };

            // --- Location mock ---
            const locationMock = new Proxy({}, {
                get(target, prop) {
                    if (prop === 'reload') return () => window.location.reload();
                    if (prop === 'replace') return (url) => {
                        url = rewriteUrl(url);
                        window.location.replace(url);
                    };
                    if (prop === 'assign') return (url) => {
                        url = rewriteUrl(url);
                        window.location.assign(url);
                    };
                    if (prop === 'toString') return () => window.location.href;
                    return window.location[prop];
                },
                set(target, prop, value) {
                    if (prop === 'href') {
                        value = rewriteUrl(value);
                        window.location.href = value;
                        return true;
                    }
                    return false;
                }
            });

            const originalGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
            Object.getOwnPropertyDescriptor = function(obj, prop) {
                if ((obj === window || obj === document) && prop === 'location') {
                    return { get: () => locationMock, configurable: true, enumerable: true };
                }
                return originalGetOwnPropertyDescriptor.apply(this, arguments);
            };

            try {
                Object.defineProperty(window, 'location', { get: () => locationMock, set: (val) => { window.location.href = rewriteUrl(val); } });
                Object.defineProperty(document, 'location', { get: () => locationMock, set: (val) => { window.location.href = rewriteUrl(val); } });
            } catch(e) {}

            console.log("[sw-helper] Rewriter initialized successfully!");
        \`;

        // Insert the script into the page
        const firstScript = document.querySelector('script');
        if (firstScript && firstScript.parentNode) {
            firstScript.parentNode.insertBefore(script, firstScript);
        } else {
            document.head.appendChild(script);
        }
    }

    // --- Execute injection ---
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectRewriter);
    } else {
        injectRewriter();
    }

    // Also inject immediately if possible
    setTimeout(injectRewriter, 0);

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
        event.respondWith(new Response(REWRITER_SOURCE, { 
            headers: { 'Content-Type': 'application/javascript; charset=utf-8' } 
        }));
        return;
    }

    // Skip loop guard
    if (event.request.headers.get('X-Proxy-Loop-Guard')) return;

    // Handle proxy requests
    if (requestUrl.pathname.startsWith(PROXY_PREFIX)) {
        const encodedTarget = requestUrl.pathname.substring(PROXY_PREFIX.length);
        if (!encodedTarget) return;

        const handleRequest = async () => {
            while (!libcurlReady) {
                await new Promise(resolve => setTimeout(resolve, 50));
            }

            const targetUrl = new URL(decodeURIComponent(encodedTarget));
            const domain = targetUrl.hostname;
            
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

            try {
                const response = await libcurl.fetch(targetUrl.href, fetchOptions);
                const contentType = response.headers.get('content-type') || '';
                const responseHeaders = new Headers(response.headers);
                
                // Handle cookies from response
                const setCookie = responseHeaders.get('set-cookie');
                if (setCookie) {
                    cookieManager.setCookies(targetUrl.href, setCookie);
                }
                
                // CRITICAL: Remove or modify CSP headers to allow our script injection
                responseHeaders.delete('content-security-policy');
                responseHeaders.delete('content-security-policy-report-only');
                responseHeaders.delete('x-content-security-policy');
                responseHeaders.delete('x-webkit-csp');
                responseHeaders.delete('x-frame-options');
                responseHeaders.delete('cross-origin-opener-policy');
                responseHeaders.delete('cross-origin-embedder-policy');
                responseHeaders.delete('cross-origin-resource-policy');
                responseHeaders.set('Access-Control-Allow-Origin', '*');
                
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
                    
                    // Extract nonce from CSP if present
                    let nonce = '';
                    const cspMatch = html.match(/script-src[^;]*'nonce-([^']+)'/);
                    if (cspMatch) {
                        nonce = cspMatch[1];
                    }
                    
                    // Inject rewriter script with proper nonce
                    const injectorScript = nonce ? 
                        `<script nonce="${nonce}" src="/rewriter.js"></script>` :
                        `<script src="/rewriter.js"></script>`;
                    
                    if (html.match(/<head>/i)) {
                        html = html.replace(/<head>/i, `<head>${injectorScript}`);
                    } else if (html.match(/<html>/i)) {
                        html = html.replace(/<html>/i, `<html>${injectorScript}`);
                    } else {
                        html = injectorScript + html;
                    }
                    
                    // Rewrite URLs in HTML
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
                return new Response(generateErrorPage(err.message, 502), { 
                    status: 502, 
                    headers: { 'Content-Type': 'text/html' } 
                });
            }
        };

        event.respondWith(handleRequest());
        return;
    }

    // Handle fallback proxy for external requests
    if (requestUrl.origin !== self.location.origin) {
        const fallbackProxyUrl = `${self.location.origin}${PROXY_PREFIX}${encodeURIComponent(event.request.url)}`;
        let fallbackMode = event.request.mode;
        if (fallbackMode === 'navigate' || fallbackMode === 'same-origin') fallbackMode = 'cors';

        const fallbackOptions = { 
            method: event.request.method, 
            headers: event.request.headers, 
            redirect: 'follow', 
            mode: fallbackMode 
        };
        if (!['GET', 'HEAD'].includes(event.request.method)) {
            fallbackOptions.body = event.request.body;
            if (event.request.body) fallbackOptions.duplex = 'half';
        }
        event.respondWith(
            fetch(fallbackProxyUrl, fallbackOptions).catch((err) => {
                return new Response(generateErrorPage(err.message, 502), { 
                    status: 502, 
                    headers: { 'Content-Type': 'text/html' } 
                });
            })
        );
        return;
    }

    // Handle internal asset requests
    if (requestUrl.origin === self.location.origin && 
        !requestUrl.pathname.startsWith(PROXY_PREFIX) && 
        !['/index.html', '/sw.js', '/favicon.ico'].includes(requestUrl.pathname)) {
        
        const assetPath = requestUrl.pathname + requestUrl.search;
        let dynamicMode = event.request.mode;
        if (dynamicMode === 'navigate' || dynamicMode === 'same-origin') dynamicMode = 'cors';

        event.respondWith(
            self.clients.matchAll({ type: 'window' }).then((clients) => {
                let fallbackContextUrl = null;
                if (clients && clients.length > 0) {
                    if (event.clientId) {
                        const targetClient = clients.find(c => c.id === event.clientId);
                        if (targetClient && targetClient.url.includes(PROXY_PREFIX)) fallbackContextUrl = targetClient.url;
                    }
                    if (!fallbackContextUrl) {
                        const proxiedClient = clients.find(c => new URL(c.url).pathname.startsWith(PROXY_PREFIX));
                        if (proxiedClient) fallbackContextUrl = proxiedClient.url;
                    }
                }
                if (!fallbackContextUrl && clients && clients.length > 0) fallbackContextUrl = clients[0].url;

                if (fallbackContextUrl) {
                    try {
                        const clientUrlObj = new URL(fallbackContextUrl);
                        let targetOrigin = "";
                        if (clientUrlObj.pathname.startsWith(PROXY_PREFIX)) {
                            const currentProxyTargetEncoded = clientUrlObj.pathname.substring(PROXY_PREFIX.length);
                            targetOrigin = new URL(decodeURIComponent(currentProxyTargetEncoded)).origin;
                        } else {
                            targetOrigin = 'https://default.com';
                        }
                        
                        const correctedUrl = `${self.location.origin}${PROXY_PREFIX}${encodeURIComponent(targetOrigin + assetPath)}`;
                        if (event.request.mode === 'navigate') {
                            return Response.redirect(correctedUrl, 302);
                        }

                        const dynamicOptions = { 
                            method: event.request.method, 
                            headers: event.request.headers, 
                            mode: dynamicMode 
                        };
                        if (!['GET', 'HEAD'].includes(event.request.method)) {
                            dynamicOptions.body = event.request.body;
                            if (event.request.body) dynamicOptions.duplex = 'half';
                        }
                        return fetch(correctedUrl, dynamicOptions);
                    } catch (e) {}
                }
                return fetch(event.request);
            }).catch((err) => {
                return new Response(generateErrorPage(err.message, 502), { 
                    status: 502, 
                    headers: { 'Content-Type': 'text/html' } 
                });
            })
        );
        return;
    }
});

// ==========================================
// Helper Functions
// ==========================================

function proxyTextContent(text, targetOrigin) {
    if (typeof text !== 'string') return text;
    const absoluteUrlPattern = /(https?:\/\/[a-zA-Z0-9\-._~:/?#[\]@!$&'()*+,;=]+)/g;
    let processed = text.replace(absoluteUrlPattern, (match) => {
        if (match.includes(PROXY_PREFIX) || match.startsWith(self.location.origin)) return match;
        return `${self.location.origin}${PROXY_PREFIX}${encodeURIComponent(match)}`;
    });

    const attrPattern = /\b(href|src|action)=["']([^"']+)["']/gi;
    processed = processed.replace(attrPattern, (match, attr, val) => {
        if (val.startsWith('#') || val.startsWith('javascript:') || val.startsWith('data:') || val.includes(PROXY_PREFIX)) return match;
        try {
            const resolved = new URL(val, targetOrigin).href;
            return `${attr}="${self.location.origin}${PROXY_PREFIX}${encodeURIComponent(resolved)}"`;
        } catch (e) { return match; }
    });
    return processed;
}

function generateErrorPage(errorMessage, status) {
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Error</title>
        <style>
            body { background: #111; color: #eee; font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
            .card { background: #1a1a1a; padding: 40px; border-radius: 12px; border: 1px solid #333; max-width: 500px; width: 100%; text-align: center; box-shadow: 0 8px 30px rgba(0,0,0,0.5); }
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
