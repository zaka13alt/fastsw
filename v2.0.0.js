// ==========================================
// fastsw service worker - v2.0.0 (FIXED)
// ==========================================
const PROXY_PREFIX = '/go/';
const WISP_SERVER_URL = 'wss://wisp.mercurywork.shop/wisp/';

// Split CDN URL to avoid self-proxying
const libcurlUrl = 'https://cdn.' + 'jsdelivr.net/' + 'npm/libcurl.js' + '@latest/' + 'libcurl_full.js';

// Track loaded state
let libcurlReady = false;
let libcurlQueue = [];

try {
    importScripts(libcurlUrl);
} catch (e) {
    console.error("[sw] Failed to load libcurl.js.", e);
}

if (typeof libcurl !== 'undefined') {
    if (typeof libcurl.set_websocket === 'function') libcurl.set_websocket(WISP_SERVER_URL);
    if (libcurl.ready) {
        libcurlReady = true;
        processQueue();
    } else {
        libcurl.onload = () => { 
            libcurlReady = true; 
            processQueue();
        };
    }
}

function processQueue() {
    while (libcurlQueue.length) {
        const resolver = libcurlQueue.shift();
        resolver();
    }
}

function waitForLibcurl() {
    return new Promise((resolve) => {
        if (libcurlReady) {
            resolve();
        } else {
            libcurlQueue.push(resolve);
            setTimeout(resolve, 3000);
        }
    });
}

// ==========================================
// FIXED CLIENT-SIDE REWRITER
// ==========================================
const REWRITER = `(function() {
    'use strict';
    const PROXY_PREFIX = '/go/';
    const PROXY_ORIGIN = window.location.origin;
    
    // Only run if we're on a proxied page
    if (!window.location.pathname.startsWith(PROXY_PREFIX)) {
        return;
    }
    
    // Simple URL rewriting
    function rewriteUrl(url) {
        if (!url || typeof url !== 'string') return url;
        const t = url.trim();
        if (!t || t.startsWith('data:') || t.startsWith('blob:') || t.startsWith('javascript:') || 
            t.startsWith('#') || t.startsWith('mailto:') || t.startsWith('tel:') || 
            t.startsWith(PROXY_PREFIX) || t.startsWith(PROXY_ORIGIN + PROXY_PREFIX)) return url;
        
        try {
            const resolved = new URL(t, window.location.href).href;
            if (resolved.startsWith(PROXY_ORIGIN) && !resolved.startsWith(PROXY_ORIGIN + PROXY_PREFIX)) {
                return url;
            }
            return PROXY_PREFIX + encodeURIComponent(resolved);
        } catch (e) {
            return url;
        }
    }
    
    // Simple cache
    const urlCache = new Map();
    const CACHE_LIMIT = 200;
    
    function cachedRewriteUrl(url) {
        if (urlCache.has(url)) return urlCache.get(url);
        const result = rewriteUrl(url);
        if (urlCache.size < CACHE_LIMIT) urlCache.set(url, result);
        return result;
    }
    
    // ==========================================
    // FETCH - Fixed with proper duplex handling
    // ==========================================
    const originalFetch = window.fetch;
    window.fetch = function(input, init) {
        let modifiedInput = input;
        
        if (typeof input === 'string') {
            modifiedInput = cachedRewriteUrl(input);
        } else if (input && typeof input === 'object' && input.url) {
            const newUrl = cachedRewriteUrl(input.url);
            if (newUrl !== input.url) {
                // Preserve all request properties
                modifiedInput = new Request(newUrl, {
                    method: input.method,
                    headers: input.headers,
                    body: input.body,
                    mode: input.mode,
                    credentials: input.credentials,
                    cache: input.cache,
                    redirect: input.redirect,
                    referrer: input.referrer,
                    referrerPolicy: input.referrerPolicy,
                    integrity: input.integrity,
                    keepalive: input.keepalive,
                    signal: input.signal,
                    // Add duplex for streaming bodies
                    duplex: input.duplex || 'half'
                });
            }
        }
        
        // If we have a body and no duplex, add it
        if (init && init.body && !init.duplex) {
            init.duplex = 'half';
        }
        
        return originalFetch.call(this, modifiedInput, init);
    };
    
    // ==========================================
    // XMLHttpRequest - Properly bound
    // ==========================================
    const XHR = window.XMLHttpRequest;
    const originalXHROpen = XHR.prototype.open;
    XHR.prototype.open = function(method, url, ...args) {
        if (typeof url === 'string') {
            url = cachedRewriteUrl(url);
        }
        return originalXHROpen.call(this, method, url, ...args);
    };
    
    // ==========================================
    // LOCATION - Only intercept specific props
    // ==========================================
    const loc = window.location;
    let actualUrl;
    try {
        const idx = loc.href.indexOf(PROXY_PREFIX);
        if (idx !== -1) {
            actualUrl = decodeURIComponent(loc.href.slice(idx + PROXY_PREFIX.length));
        }
    } catch(e) {}
    
    if (actualUrl) {
        const locationHandler = {
            get(target, prop) {
                if (prop === 'href') {
                    return actualUrl;
                }
                if (prop === 'assign' || prop === 'replace') {
                    return function(url) {
                        target[prop](cachedRewriteUrl(url));
                    };
                }
                if (prop === 'toString' || prop === Symbol.toPrimitive) {
                    return () => actualUrl;
                }
                const value = target[prop];
                return typeof value === 'function' ? value.bind(target) : value;
            },
            set(target, prop, value) {
                if (prop === 'href') {
                    target.href = cachedRewriteUrl(value);
                    return true;
                }
                target[prop] = value;
                return true;
            }
        };
        
        try {
            const locationProxy = new Proxy(loc, locationHandler);
            Object.defineProperty(window, 'location', {
                get: () => locationProxy,
                configurable: true,
                enumerable: true
            });
            Object.defineProperty(document, 'location', {
                get: () => locationProxy,
                configurable: true,
                enumerable: true
            });
        } catch(e) {}
    }
    
    // ==========================================
    // HISTORY - Properly bound
    // ==========================================
    const historyProto = window.history;
    const originalPushState = historyProto.pushState;
    const originalReplaceState = historyProto.replaceState;
    
    historyProto.pushState = function(state, title, url) {
        if (url) {
            url = cachedRewriteUrl(url.toString());
        }
        return originalPushState.call(this, state, title, url);
    };
    
    historyProto.replaceState = function(state, title, url) {
        if (url) {
            url = cachedRewriteUrl(url.toString());
        }
        return originalReplaceState.call(this, state, title, url);
    };
    
    // ==========================================
    // WINDOW.OPEN
    // ==========================================
    const originalOpen = window.open;
    window.open = function(url, name, features) {
        if (url) {
            url = cachedRewriteUrl(url.toString());
        }
        return originalOpen.call(this, url, name, features);
    };
    
    // ==========================================
    // ELEMENT ATTRIBUTES
    // ==========================================
    const URL_ATTRS = ['href', 'src', 'action', 'data', 'poster'];
    const originalSetAttribute = Element.prototype.setAttribute;
    
    Element.prototype.setAttribute = function(name, value) {
        const n = name.toLowerCase();
        if (URL_ATTRS.includes(n) && typeof value === 'string' && value) {
            if (!value.startsWith(PROXY_PREFIX) && !value.startsWith(PROXY_ORIGIN + PROXY_PREFIX) &&
                !value.startsWith('data:') && !value.startsWith('blob:') && !value.startsWith('#')) {
                try {
                    new URL(value, window.location.href);
                    value = cachedRewriteUrl(value);
                } catch(e) {}
            }
        }
        return originalSetAttribute.call(this, name, value);
    };
    
    // ==========================================
    // SRC SET
    // ==========================================
    const imgProto = HTMLImageElement.prototype;
    const originalSrcSet = Object.getOwnPropertyDescriptor(imgProto, 'srcset');
    
    if (originalSrcSet && originalSrcSet.set) {
        Object.defineProperty(imgProto, 'srcset', {
            get: originalSrcSet.get,
            set: function(value) {
                if (typeof value === 'string') {
                    const parts = value.split(',').map(part => {
                        const trimmed = part.trim();
                        const spaceIdx = trimmed.search(/\\s/);
                        if (spaceIdx === -1) {
                            return rewriteUrl(trimmed);
                        }
                        const urlPart = trimmed.slice(0, spaceIdx);
                        const rest = trimmed.slice(spaceIdx);
                        return rewriteUrl(urlPart) + rest;
                    });
                    value = parts.join(', ');
                }
                originalSrcSet.set.call(this, value);
            },
            configurable: true
        });
    }
    
    // ==========================================
    // NAVIGATOR SEND BEACON
    // ==========================================
    if (navigator.sendBeacon) {
        const originalSendBeacon = navigator.sendBeacon.bind(navigator);
        navigator.sendBeacon = function(url, data) {
            return originalSendBeacon(cachedRewriteUrl(url), data);
        };
    }
    
    // ==========================================
    // MUTATION OBSERVER
    // ==========================================
    let observerActive = false;
    let observerTimeout = null;
    
    const observer = new MutationObserver((mutations) => {
        if (observerTimeout) {
            clearTimeout(observerTimeout);
        }
        observerTimeout = setTimeout(() => {
            observerTimeout = null;
            if (observerActive) return;
            observerActive = true;
            
            try {
                for (const mutation of mutations) {
                    if (mutation.type === 'attributes') {
                        const el = mutation.target;
                        const attr = mutation.attributeName;
                        if (URL_ATTRS.includes(attr)) {
                            const val = el.getAttribute(attr);
                            if (val && typeof val === 'string' && 
                                !val.startsWith(PROXY_PREFIX) && 
                                !val.startsWith('data:') && 
                                !val.startsWith('#')) {
                                try {
                                    el.setAttribute(attr, cachedRewriteUrl(val));
                                } catch(e) {}
                            }
                        }
                    } else if (mutation.type === 'childList') {
                        for (const node of mutation.addedNodes) {
                            if (node.nodeType === 1 && node.querySelectorAll) {
                                const elements = node.querySelectorAll('a[href], img[src], link[href], script[src]');
                                for (const el of elements) {
                                    const attr = el.hasAttribute('href') ? 'href' : 'src';
                                    const val = el.getAttribute(attr);
                                    if (val && typeof val === 'string' && 
                                        !val.startsWith(PROXY_PREFIX) && 
                                        !val.startsWith('data:')) {
                                        try {
                                            el.setAttribute(attr, cachedRewriteUrl(val));
                                        } catch(e) {}
                                    }
                                }
                            }
                        }
                    }
                }
            } finally {
                observerActive = false;
            }
        }, 100);
    });
    
    if (document.documentElement) {
        observer.observe(document.documentElement, {
            attributes: true,
            childList: true,
            subtree: true,
            attributeFilter: URL_ATTRS
        });
    }
    
    // ==========================================
    // CLEANUP
    // ==========================================
    setInterval(() => {
        if (urlCache.size > CACHE_LIMIT) {
            const keys = Array.from(urlCache.keys());
            for (let i = 0; i < keys.length / 2; i++) {
                urlCache.delete(keys[i]);
            }
        }
    }, 60000);
    
    console.log('[fastsw] Rewriter active');
})();`;

// ==========================================
// SERVICE WORKER HELPERS
// ==========================================

function generateErrorPage(message) {
    return `<!DOCTYPE html><html><head><title>Error</title><style>
    body{background:#111;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
    .card{background:#1a1a1a;padding:40px;border-radius:8px;max-width:500px;text-align:center}
    h1{color:#ff4444}
    button{background:#0070f3;color:#fff;border:none;padding:10px 20px;border-radius:4px;cursor:pointer}
    </style></head>
    <body><div class="card"><h1>⚠️ Error</h1><p>${message || 'Failed to load page'}</p><button onclick="location.reload()">Retry</button></div></body></html>`;
}

// ==========================================
// FAST PROXY TEXT REWRITING
// ==========================================

function fastProxyText(text, targetOrigin) {
    if (typeof text !== 'string') return text;
    if (!text.includes('http') && !text.includes('src=') && !text.includes('href=')) {
        return text;
    }
    
    // Quick attribute rewriting
    const attrRegex = /\b(href|src|action|data|poster)=(["'])([^"']+)\2/gi;
    let out = text.replace(attrRegex, (match, attr, q, val) => {
        if (val.startsWith('#') || val.startsWith('javascript:') || 
            val.startsWith('data:') || val.includes(PROXY_PREFIX)) return match;
        try {
            const resolved = new URL(val, targetOrigin).href;
            return `${attr}=${q}${self.location.origin}${PROXY_PREFIX}${encodeURIComponent(resolved)}${q}`;
        } catch(e) { return match; }
    });
    
    // Quick URL rewriting
    const urlRegex = /https?:\/\/[a-zA-Z0-9\-._~:/?#[\]@!$&()*+,;=%]+/g;
    out = out.replace(urlRegex, (match) => {
        if (match.includes(PROXY_PREFIX) || match.startsWith(self.location.origin)) return match;
        return `${self.location.origin}${PROXY_PREFIX}${encodeURIComponent(match)}`;
    });
    
    return out;
}

// ==========================================
// SERVICE WORKER LIFECYCLE
// ==========================================
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// ==========================================
// FETCH HANDLER - FIXED
// ==========================================
self.addEventListener('fetch', (event) => {
    const reqUrl = new URL(event.request.url);
    const pathname = reqUrl.pathname;
    
    // Serve rewriter
    if (pathname === '/rewriter.js') {
        event.respondWith(new Response(REWRITER, {
            headers: { 
                'Content-Type': 'application/javascript',
                'Cache-Control': 'public, max-age=3600'
            }
        }));
        return;
    }
    
    // Serve libcurl.js
    if (pathname === '/libcurl.js') {
        event.respondWith(
            fetch(libcurlUrl)
                .then(r => {
                    const headers = new Headers(r.headers);
                    headers.set('Cache-Control', 'public, max-age=3600');
                    headers.delete('Integrity');
                    return new Response(r.body, { status: r.status, headers });
                })
                .catch(() => new Response('', { status: 503 }))
        );
        return;
    }
    
    // Prevent loops
    if (event.request.headers.get('X-Proxy-Loop-Guard')) return;
    
    // --- Proxied request ---
    if (pathname.startsWith(PROXY_PREFIX)) {
        const encoded = pathname.substring(PROXY_PREFIX.length);
        if (!encoded) return;
        
        event.respondWith((async () => {
            await waitForLibcurl();
            
            let targetUrl;
            try {
                const decoded = decodeURIComponent(encoded);
                targetUrl = new URL(decoded);
            } catch(e) {
                return new Response(generateErrorPage('Invalid URL'), { 
                    status: 400, 
                    headers: { 'Content-Type': 'text/html' } 
                });
            }
            
            const headers = new Headers(event.request.headers);
            headers.delete('accept-encoding');
            headers.set('X-Proxy-Loop-Guard', 'true');
            headers.set('Origin', targetUrl.origin);
            headers.set('Referer', targetUrl.origin + '/');
            
            const options = {
                method: event.request.method,
                headers: headers,
                redirect: 'follow',
                mode: 'cors',
                credentials: 'omit'
            };
            
            // Handle body with proper duplex
            if (!['GET', 'HEAD'].includes(event.request.method)) {
                try {
                    const body = await event.request.text();
                    if (body) {
                        options.body = body;
                        // Add duplex for streaming bodies
                        options.duplex = 'half';
                    }
                } catch(e) {
                    // If we can't read the body, try to stream it
                    if (event.request.body) {
                        options.body = event.request.body;
                        options.duplex = 'half';
                    }
                }
            }
            
            try {
                const response = await Promise.race([
                    libcurl.fetch(targetUrl.href, options),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 30000))
                ]);
                
                const ct = response.headers.get('content-type') || '';
                const isHtml = ct.includes('text/html');
                const isCss = ct.includes('text/css');
                const isJs = ct.includes('javascript') || ct.includes('text/javascript');
                
                const respHeaders = new Headers(response.headers);
                const block = ['content-security-policy', 'x-frame-options', 
                    'cross-origin-opener-policy', 'integrity', 'content-encoding'];
                for (const h of block) respHeaders.delete(h);
                
                respHeaders.set('Access-Control-Allow-Origin', '*');
                respHeaders.set('Access-Control-Allow-Credentials', 'true');
                respHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD');
                respHeaders.set('Access-Control-Allow-Headers', '*');
                respHeaders.set('Access-Control-Expose-Headers', '*');
                
                if (respHeaders.has('location')) {
                    try {
                        const abs = new URL(respHeaders.get('location'), targetUrl.href).href;
                        respHeaders.set('location', `${self.location.origin}${PROXY_PREFIX}${encodeURIComponent(abs)}`);
                    } catch(e) {}
                }
                
                // Don't rewrite JS files - client rewriter handles them
                if (isHtml || isCss) {
                    let text = await response.text();
                    text = fastProxyText(text, targetUrl.origin);
                    
                    if (isHtml) {
                        if (!text.includes('/rewriter.js')) {
                            const injector = `<script src="/rewriter.js"><\/script>`;
                            if (text.includes('<head>')) {
                                text = text.replace('<head>', `<head>${injector}`);
                            } else if (text.includes('<html>')) {
                                text = text.replace('<html>', `<html><head>${injector}</head>`);
                            } else {
                                text = injector + text;
                            }
                        }
                    }
                    
                    return new Response(text, { 
                        status: response.status, 
                        headers: respHeaders 
                    });
                }
                
                return new Response(response.body, { 
                    status: response.status, 
                    headers: respHeaders 
                });
                
            } catch(err) {
                console.error('[sw] Proxy error:', err);
                return new Response(generateErrorPage(err.message || 'Proxy error'), { 
                    status: 502, 
                    headers: { 'Content-Type': 'text/html' } 
                });
            }
        })());
        return;
    }
    
    // --- External request auto-routing ---
    if (reqUrl.origin !== self.location.origin) {
        const proxied = `${self.location.origin}${PROXY_PREFIX}${encodeURIComponent(event.request.url)}`;
        const opts = {
            method: event.request.method,
            headers: event.request.headers,
            redirect: 'follow',
            mode: 'cors',
            credentials: 'omit'
        };
        if (!['GET', 'HEAD'].includes(event.request.method) && event.request.body) {
            opts.body = event.request.body;
            opts.duplex = 'half';
        }
        event.respondWith(
            fetch(proxied, opts).catch(err => {
                console.error('[sw] External fetch error:', err);
                return new Response(generateErrorPage('Failed to proxy request'), { 
                    status: 502, 
                    headers: { 'Content-Type': 'text/html' } 
                });
            })
        );
        return;
    }
    
    // --- Handle 404s and static assets from proxied pages ---
    const skip = new Set(['/index.html', '/rewriter.js', '/favicon.ico', '/robots.txt']);
    if (!pathname.startsWith(PROXY_PREFIX) && !skip.has(pathname)) {
        // For paths like /xjs/ or other Google assets, try to find the context
        event.respondWith(
            self.clients.matchAll({ type: 'window' }).then(clients => {
                let contextUrl = null;
                for (const client of clients) {
                    if (client.url.includes(PROXY_PREFIX)) {
                        contextUrl = client.url;
                        break;
                    }
                }
                
                if (contextUrl) {
                    try {
                        const clientPath = new URL(contextUrl).pathname;
                        const targetOrigin = new URL(decodeURIComponent(
                            clientPath.substring(PROXY_PREFIX.length)
                        )).origin;
                        
                        // Build the full target URL
                        let targetPath = pathname + reqUrl.search;
                        // Handle paths that start with /xjs/ etc.
                        const corrected = `${self.location.origin}${PROXY_PREFIX}${encodeURIComponent(
                            targetOrigin + targetPath
                        )}`;
                        
                        if (event.request.mode === 'navigate') {
                            return Response.redirect(corrected, 302);
                        }
                        
                        const opts = {
                            method: event.request.method,
                            headers: event.request.headers,
                            mode: 'cors',
                            credentials: 'omit'
                        };
                        if (!['GET', 'HEAD'].includes(event.request.method) && event.request.body) {
                            opts.body = event.request.body;
                            opts.duplex = 'half';
                        }
                        return fetch(corrected, opts);
                    } catch(e) {
                        console.error('[sw] Asset routing error:', e);
                    }
                }
                
                // If no context, try to serve the asset directly
                return fetch(event.request);
            }).catch(err => {
                console.error('[sw] Client matching error:', err);
                return new Response(generateErrorPage('Failed to load asset'), { 
                    status: 404, 
                    headers: { 'Content-Type': 'text/html' } 
                });
            })
        );
    }
});
