
// ==========================================
// ULTIMATE BROWSER API PATCHER - Fixed Form Submission
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
// COMPLETE REWRITER - Fixed Form Handling
// ==========================================
const REWRITER_SCRIPT = `(function() {
    'use strict';
    
    if (window.__rewriter_initialized) return;
    window.__rewriter_initialized = true;
    window.__rewriter_version = '3.1.0';

    const PROXY_PREFIX = '/go/';
    const PROXY_HOST = window.location.host;
    const PROXY_ORIGIN = window.location.origin;

    const urlCache = new Map();
    const MAX_CACHE_SIZE = 2000;

    // ----- CORE FUNCTIONS -----
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
            '/webhooks', '/callback', '/hook', '/event',
            '/search', '/query', '/lookup', '/find'
        ];
        return apiPatterns.some(pattern => urlLower.includes(pattern));
    }

    // ----- FIXED FORM SUBMISSION HANDLING -----
    function handleFormSubmission(form, event) {
        try {
            if (!form) return false;
            
            // Get form data
            const action = form.getAttribute('action') || window.location.href;
            const method = (form.getAttribute('method') || 'GET').toUpperCase();
            const enctype = form.getAttribute('enctype') || 'application/x-www-form-urlencoded';
            
            // Get form data
            const formData = new FormData(form);
            
            // Create a proper URL for GET requests
            if (method === 'GET') {
                const url = new URL(rewriteUrl(action));
                // Append form data to URL
                for (let [key, value] of formData.entries()) {
                    if (typeof value === 'string') {
                        url.searchParams.append(key, value);
                    }
                }
                
                // Navigate to the URL
                if (event) {
                    event.preventDefault();
                    event.stopPropagation();
                }
                
                // Use fetch to handle the navigation properly
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
                            // Replace the page content
                            document.open();
                            document.write(html);
                            document.close();
                            
                            // Update URL in address bar
                            const newUrl = url.href;
                            if (window.history && window.history.pushState) {
                                window.history.pushState({}, '', newUrl);
                            }
                        }
                    });
                })
                .catch(error => {
                    console.error('[sw-helper] Form submission failed:', error);
                    // Fallback to direct navigation
                    window.location.href = url.href;
                });
                
                return true;
            }
            
            // Handle POST requests
            if (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') {
                if (event) {
                    event.preventDefault();
                    event.stopPropagation();
                }
                
                const options = {
                    method: method,
                    headers: {
                        'X-Form-Submission': 'true',
                        'X-Original-Action': action,
                        'User-Agent': navigator.userAgent
                    },
                    credentials: 'include'
                };
                
                // Handle different content types
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
                    // Default to URL encoded
                    options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
                    const params = new URLSearchParams();
                    for (let [key, value] of formData.entries()) {
                        if (typeof value === 'string') {
                            params.append(key, value);
                        }
                    }
                    options.body = params.toString();
                }
                
                // Send the request
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
                            } else if (contentType.includes('application/json')) {
                                // Handle JSON response
                                try {
                                    const json = JSON.parse(html);
                                    console.log('[sw-helper] JSON response:', json);
                                } catch(e) {}
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
    try {
        // Intercept submit events
        document.addEventListener('submit', function(event) {
            const form = event.target;
            if (form && form.tagName && form.tagName.toLowerCase() === 'form') {
                // Check if form has been intercepted before
                if (form.dataset.intercepted) {
                    // Allow the form to submit normally if it's already been intercepted
                    return;
                }
                form.dataset.intercepted = 'true';
                
                // Handle the submission
                const handled = handleFormSubmission(form, event);
                if (!handled) {
                    // If not handled, remove the flag and let it submit normally
                    delete form.dataset.intercepted;
                }
            }
        }, true);

        // Override HTMLFormElement.prototype.submit
        const originalFormSubmit = HTMLFormElement.prototype.submit;
        HTMLFormElement.prototype.submit = function() {
            // Check if this form has been intercepted
            if (this.dataset && this.dataset.intercepted === 'true') {
                // Allow native submit
                return originalFormSubmit.call(this);
            }
            
            // Mark as intercepted
            if (this.dataset) {
                this.dataset.intercepted = 'true';
            }
            
            // Try to handle the submission
            const handled = handleFormSubmission(this);
            if (!handled) {
                // Fall back to native submit
                if (this.dataset) {
                    delete this.dataset.intercepted;
                }
                return originalFormSubmit.call(this);
            }
            
            // Return undefined to prevent native submit
            return undefined;
        };

        // Also intercept form submissions via button clicks
        document.addEventListener('click', function(event) {
            const target = event.target;
            if (target && target.tagName && 
                (target.tagName.toLowerCase() === 'button' || target.tagName.toLowerCase() === 'input') &&
                target.type === 'submit') {
                
                const form = target.closest('form');
                if (form && !form.dataset.intercepted) {
                    // Let the submit event handle it
                }
            }
        }, true);

    } catch(e) {
        console.error('[sw-helper] Form interception error:', e);
    }

    // ----- PATCH FETCH FOR API REQUESTS -----
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
                
                // Check if this is a form submission
                if (init && init.body && init.body instanceof FormData) {
                    // Intercept form data
                    const formData = init.body;
                    let needsRewrite = false;
                    const entries = Array.from(formData.entries());
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
                        init.body = newFormData;
                    }
                }
            } catch(e) {}
            return nativeFetch.call(this, input, init);
        };
        window.fetch.prototype = nativeFetch.prototype;
    } catch(e) {}

    // ----- PATCH XMLHTTPREQUEST -----
    try {
        const nativeXHROpen = XMLHttpRequest.prototype.open;
        const nativeXHRSend = XMLHttpRequest.prototype.send;
        const nativeXHRSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

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
                
                // Add cookies
                const cookies = document.cookie;
                if (cookies) {
                    this.setRequestHeader('Cookie', cookies);
                }
            } catch(e) {}
            return nativeXHRSend.call(this, body);
        };
    } catch(e) {}

    // ----- PATCH LOCATION (to handle navigation) -----
    try {
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
    } catch(e) {}

    // ----- PATCH CREATE ELEMENT (for forms) -----
    try {
        const originalCreateElement = document.createElement;
        document.createElement = function(tagName, options) {
            const el = originalCreateElement.call(this, tagName, options);
            const tag = tagName.toLowerCase();
            
            if (tag === 'form') {
                // Patch form action
                const originalSetAttribute = el.setAttribute;
                el.setAttribute = function(name, value) {
                    try {
                        if (name.toLowerCase() === 'action' && typeof value === 'string') {
                            value = rewriteUrl(value);
                        }
                    } catch(e) {}
                    return originalSetAttribute.call(this, name, value);
                };
                
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
                
                // Add submit listener to new forms
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
    } catch(e) {}

    // ----- MUTATION OBSERVER FOR DYNAMIC FORMS -----
    try {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach(node => {
                        if (node.nodeType === 1) {
                            // Check for newly added forms
                            if (node.tagName && node.tagName.toLowerCase() === 'form') {
                                if (!node.dataset || !node.dataset.intercepted) {
                                    const action = node.getAttribute('action');
                                    if (action && !action.startsWith(PROXY_PREFIX)) {
                                        node.setAttribute('action', rewriteUrl(action));
                                    }
                                    
                                    node.addEventListener('submit', function(event) {
                                        if (this.dataset && this.dataset.intercepted === 'true') {
                                            return;
                                        }
                                        event.preventDefault();
                                        event.stopPropagation();
                                        handleFormSubmission(this, event);
                                    }, true);
                                }
                            }
                            
                            // Check for forms inside added nodes
                            if (node.querySelectorAll) {
                                const forms = node.querySelectorAll('form');
                                forms.forEach(form => {
                                    if (!form.dataset || !form.dataset.intercepted) {
                                        const action = form.getAttribute('action');
                                        if (action && !action.startsWith(PROXY_PREFIX)) {
                                            form.setAttribute('action', rewriteUrl(action));
                                        }
                                        
                                        form.addEventListener('submit', function(event) {
                                            if (this.dataset && this.dataset.intercepted === 'true') {
                                                return;
                                            }
                                            event.preventDefault();
                                            event.stopPropagation();
                                            handleFormSubmission(this, event);
                                        }, true);
                                    }
                                });
                            }
                        }
                    });
                }
            });
        });

        if (document.documentElement) {
            observer.observe(document.documentElement, {
                childList: true,
                subtree: true
            });
        }
    } catch(e) {}

    // ----- PATCH HISTORY -----
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

    // ----- PATCH WINDOW.OPEN -----
    try {
        const nativeOpen = window.open;
        window.open = function(url, target, features) {
            if (url && typeof url === 'string' && !url.includes('/rewriter.js')) {
                url = rewriteUrl(url);
            }
            return nativeOpen.call(this, url, target, features);
        };
    } catch(e) {}

    // ----- PREVENT FRAME BREAKOUT -----
    try {
        Object.defineProperty(window, 'top', { get: () => window, configurable: false });
        Object.defineProperty(window, 'parent', { get: () => window, configurable: false });
        Object.defineProperty(window, 'self', { get: () => window, configurable: false });
        Object.defineProperty(window, 'opener', { get: () => null, configurable: false });
        Object.defineProperty(window, 'frameElement', { get: () => null, configurable: false });
    } catch(e) {}

    console.log("[sw-helper] ALL APIs patched with fixed form handling!");
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
                'Cache-Control': 'no-cache, no-store, must-revalidate'
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
