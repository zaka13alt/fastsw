// ==========================================
// Enhanced Service Worker with Safe Rewriter
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
// SAFE REWRITER SCRIPT - No Recursion
// ==========================================
const REWRITER_SCRIPT = `(function() {
    // Check if already initialized
    if (window.__rewriter_initialized) return;
    window.__rewriter_initialized = true;

    const PROXY_PREFIX = '/go/';
    const PROXY_HOST = window.location.host;
    const PROXY_ORIGIN = window.location.origin;

    // Cache for rewritten URLs to prevent recursion
    const urlCache = new Map();
    const MAX_CACHE_SIZE = 1000;

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
        
        // Check cache first
        if (urlCache.has(url)) {
            return urlCache.get(url);
        }
        
        const trimmed = url.trim();
        if (trimmed.startsWith('data:') || trimmed.startsWith('blob:') || trimmed.startsWith('javascript:')) return url;
        if (trimmed.startsWith(PROXY_PREFIX) || trimmed.startsWith(PROXY_ORIGIN + PROXY_PREFIX)) return url;
        if (trimmed.includes('/rewriter.js')) return url;
        
        try {
            const baseContext = window.location.href;
            const resolved = new URL(trimmed, baseContext).href;
            const result = PROXY_PREFIX + encodeURIComponent(resolved);
            
            // Cache the result
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
                return decodeURIComponent(parts[parts.length - 1]);
            } catch (e) {}
        }
        return url;
    }

    // --- Safe Cookie handling ---
    try {
        const cookieDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
        if (cookieDescriptor) {
            Object.defineProperty(document, 'cookie', {
                get: function() {
                    return cookieDescriptor.get.call(this) || '';
                },
                set: function(value) {
                    return cookieDescriptor.set.call(this, value);
                }
            });
        }
    } catch(e) {}

    // --- Safe fetch API ---
    const nativeFetch = window.fetch;
    window.fetch = function(input, init) {
        try {
            let url = typeof input === 'string' ? input : input.url;
            if (url && typeof url === 'string' && !url.includes('/rewriter.js')) {
                const rewritten = rewriteUrl(url);
                if (typeof input === 'string') {
                    return nativeFetch.call(this, rewritten, init);
                } else if (input instanceof Request) {
                    const newRequest = new Request(rewritten, input);
                    return nativeFetch.call(this, newRequest, init);
                }
            }
            return nativeFetch.call(this, input, init);
        } catch(e) {
            return nativeFetch.call(this, input, init);
        }
    };

    // --- Safe XHR ---
    try {
        const nativeXHROpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function(method, url, ...args) {
            try {
                if (url && typeof url === 'string' && !url.includes('/rewriter.js')) {
                    url = rewriteUrl(url);
                }
            } catch(e) {}
            return nativeXHROpen.call(this, method, url, ...args);
        };
    } catch(e) {}

    // --- Safe WebSocket ---
    try {
        const NativeWebSocket = window.WebSocket;
        window.WebSocket = function(url, protocols) {
            try {
                if (url && typeof url === 'string' && !url.includes('/rewriter.js')) {
                    const targetUrl = new URL(url, window.location.href);
                    const wsScheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
                    const interceptWsRoute = \`\${wsScheme}//\${PROXY_HOST}/ws/?target=\${encodeURIComponent(targetUrl.href)}\`;
                    return new NativeWebSocket(interceptWsRoute, protocols);
                }
            } catch(e) {}
            return new NativeWebSocket(url, protocols);
        };
        window.WebSocket.prototype = NativeWebSocket.prototype;
    } catch(e) {}

    // --- Safe Element attribute patching ---
    try {
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
    } catch(e) {}

    // --- Safe createElement ---
    try {
        const originalCreateElement = document.createElement;
        document.createElement = function(tagName, options) {
            const el = originalCreateElement.call(this, tagName, options);
            const tag = tagName.toLowerCase();
            
            if (tag === 'script' || tag === 'iframe' || tag === 'img') {
                const originalSetAttribute = el.setAttribute;
                el.setAttribute = function(name, value) {
                    try {
                        if (name.toLowerCase() === 'src' && typeof value === 'string' && !value.includes('/rewriter.js')) {
                            value = rewriteUrl(value);
                        }
                    } catch(e) {}
                    return originalSetAttribute.call(this, name, value);
                };
            }
            
            if (tag === 'link' || tag === 'a') {
                const originalSetAttribute = el.setAttribute;
                el.setAttribute = function(name, value) {
                    try {
                        if (name.toLowerCase() === 'href' && typeof value === 'string' && !value.includes('/rewriter.js')) {
                            value = rewriteUrl(value);
                        }
                    } catch(e) {}
                    return originalSetAttribute.call(this, name, value);
                };
            }
            
            if (tag === 'form') {
                const originalSetAttribute = el.setAttribute;
                el.setAttribute = function(name, value) {
                    try {
                        if (name.toLowerCase() === 'action' && typeof value === 'string') {
                            value = rewriteUrl(value);
                        }
                    } catch(e) {}
                    return originalSetAttribute.call(this, name, value);
                };
            }
            
            return el;
        };
    } catch(e) {}

    // --- Safe form handling ---
    function handleFormSubmission(form, event) {
        try {
            if (!form) return false;
            
            const action = form.getAttribute('action') || window.location.href;
            const method = (form.getAttribute('method') || 'GET').toUpperCase();
            
            const rewrittenAction = rewriteUrl(action);
            form.setAttribute('action', rewrittenAction);
            
            if (event) {
                event.preventDefault();
                event.stopPropagation();
            }
            
            if (method === 'GET') {
                const formData = new FormData(form);
                const url = new URL(rewrittenAction);
                for (let [key, value] of formData.entries()) {
                    url.searchParams.append(key, value);
                }
                window.location.href = url.href;
                return true;
            }
            
            return false;
        } catch(e) {
            return false;
        }
    }

    // --- Safe submit interception ---
    try {
        document.addEventListener('submit', function(event) {
            const form = event.target;
            if (form && form.tagName && form.tagName.toLowerCase() === 'form') {
                if (form.dataset.intercepted) return;
                form.dataset.intercepted = 'true';
                handleFormSubmission(form, event);
            }
        }, true);
    } catch(e) {}

    // --- Safe HTMLFormElement.submit override ---
    try {
        const originalFormSubmit = HTMLFormElement.prototype.submit;
        HTMLFormElement.prototype.submit = function() {
            if (this.dataset && this.dataset.intercepted) {
                return originalFormSubmit.call(this);
            }
            if (this.dataset) this.dataset.intercepted = 'true';
            const handled = handleFormSubmission(this);
            if (!handled) {
                return originalFormSubmit.call(this);
            }
        };
    } catch(e) {}

    // --- Safe History API ---
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

    // --- Safe window.open ---
    try {
        const nativeOpen = window.open;
        window.open = function(url, target, features) {
            if (url && typeof url === 'string' && !url.includes('/rewriter.js')) {
                url = rewriteUrl(url);
            }
            return nativeOpen.call(this, url, target, features);
        };
    } catch(e) {}

    // --- Safe Location mock with no recursion ---
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
                if (prop === 'toString') return () => window.location.href;
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

        const originalGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
        Object.getOwnPropertyDescriptor = function(obj, prop) {
            if ((obj === window || obj === document) && prop === 'location') {
                return { get: () => locationMock, configurable: true, enumerable: true };
            }
            return originalGetOwnPropertyDescriptor.apply(this, arguments);
        };

        Object.defineProperty(window, 'location', { get: () => locationMock, set: (val) => { 
            if (typeof val === 'string' && !val.includes('/rewriter.js')) {
                val = rewriteUrl(val);
            }
            window.location.href = val; 
        } });
    } catch(e) {}

    console.log("[sw-helper] Rewriter initialized safely!");
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
                
                // Remove security headers that cause issues
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
                    
                    // Inject rewriter script - use absolute URL
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

        // Rewrite attributes
        const attrPattern = /\b(href|src|action)=["']([^"']+)["']/gi;
        processed = processed.replace(attrPattern, (match, attr, val) => {
            if (val.startsWith('#') || val.startsWith('javascript:') || val.startsWith('data:') || val.includes(PROXY_PREFIX)) return match;
            if (val.includes('/rewriter.js')) return match;
            try {
                const resolved = new URL(val, targetOrigin).href;
                return `${attr}="${self.location.origin}${PROXY_PREFIX}${encodeURIComponent(resolved)}"`;
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
