// ==========================================
// fastsw v2, powerful proxy with rewritting and service workers
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
// ULTIMATE CLIENT-SIDE REWRITER
// Based on reference implementation
// ==========================================
const REWRITER = `(function() {
    'use strict';
    
    const PROXY_PREFIX = '/go/';
    const PROXY_ORIGIN = window.location.origin;
    
    // Only run on proxied pages
    if (!window.location.pathname.startsWith(PROXY_PREFIX)) return;
    
    // Get target URL
    let targetUrl;
    try {
        const idx = window.location.href.indexOf(PROXY_PREFIX);
        if (idx !== -1) {
            targetUrl = decodeURIComponent(window.location.href.slice(idx + PROXY_PREFIX.length));
        }
    } catch(e) { return; }
    
    // --- URL rewriting with proper context ---
    function rewriteUrl(url) {
        if (!url || typeof url !== 'string') return url;
        const trimmed = url.trim();
        if (!trimmed) return url;
        
        // Skip protocols
        if (trimmed.startsWith('data:') || trimmed.startsWith('blob:') || 
            trimmed.startsWith('javascript:') || trimmed.startsWith('#') || 
            trimmed.startsWith('mailto:') || trimmed.startsWith('tel:') ||
            trimmed.startsWith(PROXY_PREFIX) || trimmed.startsWith(PROXY_ORIGIN + PROXY_PREFIX)) {
            return url;
        }
        
        try {
            const resolved = new URL(trimmed, targetUrl).href;
            if (resolved.startsWith(PROXY_ORIGIN) && !resolved.startsWith(PROXY_ORIGIN + PROXY_PREFIX)) {
                return url;
            }
            return PROXY_PREFIX + encodeURIComponent(resolved);
        } catch(e) {
            return url;
        }
    }
    
    // --- Cache for performance ---
    const cache = new Map();
    const CACHE_LIMIT = 300;
    
    function cachedRewrite(url) {
        if (cache.has(url)) return cache.get(url);
        const result = rewriteUrl(url);
        if (cache.size < CACHE_LIMIT) cache.set(url, result);
        return result;
    }
    
    // --- Attribute list from reference ---
    const URL_ATTRS = new Set([
        'href', 'src', 'action', 'data', 'poster', 'srcset',
        'longdesc', 'codebase', 'cite', 'profile', 'archive',
        'code', 'declare', 'standby', 'background', 'manifest',
        'icon', 'preload'
    ]);
    
    // ==========================================
    // FETCH - with proper binding
    // ==========================================
    const originalFetch = window.fetch;
    window.fetch = function(input, init) {
        if (typeof input === 'string') {
            input = cachedRewrite(input);
        } else if (input && input.url) {
            const newUrl = cachedRewrite(input.url);
            if (newUrl !== input.url) {
                input = new Request(newUrl, {
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
                    duplex: input.duplex || 'half'
                });
            }
        }
        if (init && init.body && !init.duplex) {
            init.duplex = 'half';
        }
        return originalFetch.call(this, input, init);
    };
    
    // ==========================================
    // XMLHttpRequest - proper binding
    // ==========================================
    const originalXHROpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url, ...args) {
        if (typeof url === 'string') {
            url = cachedRewrite(url);
        }
        return originalXHROpen.call(this, method, url, ...args);
    };
    
    // ==========================================
    // LOCATION - careful proxy
    // ==========================================
    const locationHandler = {
        get(target, prop) {
            if (prop === 'href') return targetUrl;
            if (prop === 'assign' || prop === 'replace') {
                return function(url) {
                    target[prop](cachedRewrite(url));
                };
            }
            if (prop === 'toString' || prop === Symbol.toPrimitive) {
                return () => targetUrl;
            }
            const value = target[prop];
            return typeof value === 'function' ? value.bind(target) : value;
        },
        set(target, prop, value) {
            if (prop === 'href') {
                target.href = cachedRewrite(value);
                return true;
            }
            target[prop] = value;
            return true;
        }
    };
    
    try {
        const locationProxy = new Proxy(window.location, locationHandler);
        Object.defineProperty(window, 'location', {
            get: () => locationProxy,
            configurable: true
        });
        Object.defineProperty(document, 'location', {
            get: () => locationProxy,
            configurable: true
        });
    } catch(e) {}
    
    // ==========================================
    // HISTORY - proper binding
    // ==========================================
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;
    
    history.pushState = function(state, title, url) {
        if (url) url = cachedRewrite(url.toString());
        return originalPushState.call(this, state, title, url);
    };
    
    history.replaceState = function(state, title, url) {
        if (url) url = cachedRewrite(url.toString());
        return originalReplaceState.call(this, state, title, url);
    };
    
    // ==========================================
    // WINDOW.OPEN
    // ==========================================
    const originalOpen = window.open;
    window.open = function(url, name, features) {
        if (url) url = cachedRewrite(url.toString());
        return originalOpen.call(this, url, name, features);
    };
    
    // ==========================================
    // SEND BEACON
    // ==========================================
    if (navigator.sendBeacon) {
        const originalSendBeacon = navigator.sendBeacon.bind(navigator);
        navigator.sendBeacon = function(url, data) {
            return originalSendBeacon(cachedRewrite(url), data);
        };
    }
    
    // ==========================================
    // ELEMENT ATTRIBUTES - careful patching
    // ==========================================
    const originalSetAttribute = Element.prototype.setAttribute;
    
    Element.prototype.setAttribute = function(name, value) {
        const n = name.toLowerCase();
        if (URL_ATTRS.has(n) && typeof value === 'string' && value) {
            if (!value.startsWith(PROXY_PREFIX) && !value.startsWith(PROXY_ORIGIN + PROXY_PREFIX) &&
                !value.startsWith('data:') && !value.startsWith('blob:') && !value.startsWith('#')) {
                try {
                    new URL(value, targetUrl);
                    value = cachedRewrite(value);
                } catch(e) {}
            }
        }
        return originalSetAttribute.call(this, name, value);
    };
    
    // ==========================================
    // SRC SET for images
    // ==========================================
    const imgSrcset = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'srcset');
    if (imgSrcset && imgSrcset.set) {
        Object.defineProperty(HTMLImageElement.prototype, 'srcset', {
            get: imgSrcset.get,
            set: function(value) {
                if (typeof value === 'string') {
                    value = value.split(',').map(part => {
                        const trimmed = part.trim();
                        const spaceIdx = trimmed.search(/\\s/);
                        if (spaceIdx === -1) return rewriteUrl(trimmed);
                        const urlPart = trimmed.slice(0, spaceIdx);
                        const rest = trimmed.slice(spaceIdx);
                        return rewriteUrl(urlPart) + rest;
                    }).join(', ');
                }
                imgSrcset.set.call(this, value);
            },
            configurable: true
        });
    }
    
    // ==========================================
    // MUTATION OBSERVER - lightweight
    // ==========================================
    let observerTimeout = null;
    let observerActive = false;
    
    const observer = new MutationObserver((mutations) => {
        if (observerTimeout) clearTimeout(observerTimeout);
        observerTimeout = setTimeout(() => {
            observerTimeout = null;
            if (observerActive) return;
            observerActive = true;
            
            try {
                for (const mutation of mutations) {
                    if (mutation.type === 'attributes') {
                        const el = mutation.target;
                        const attr = mutation.attributeName;
                        if (URL_ATTRS.has(attr)) {
                            const val = el.getAttribute(attr);
                            if (val && typeof val === 'string' && 
                                !val.startsWith(PROXY_PREFIX) && 
                                !val.startsWith('data:')) {
                                try {
                                    el.setAttribute(attr, cachedRewrite(val));
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
                                            el.setAttribute(attr, cachedRewrite(val));
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
            attributeFilter: [...URL_ATTRS]
        });
    }
    
    // ==========================================
    // CLEANUP
    // ==========================================
    setInterval(() => {
        if (cache.size > CACHE_LIMIT) {
            const keys = Array.from(cache.keys());
            for (let i = 0; i < keys.length / 2; i++) {
                cache.delete(keys[i]);
            }
        }
    }, 60000);
    
    console.log('[fastsw] Ultimate rewriter active');
})();`;

// ==========================================
// SERVICE WORKER HELPERS
// ==========================================

function generateErrorPage(message) {
    return `<!DOCTYPE html>
<html>
<head>
    <title>Error</title>
    <style>
        body{background:#111;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;padding:20px}
        .card{background:#1a1a1a;padding:40px;border-radius:8px;max-width:500px;width:100%;text-align:center}
        h1{color:#ff4444;margin-top:0}
        p{color:#aaa;line-height:1.6}
        button{background:#0070f3;color:#fff;border:none;padding:10px 20px;border-radius:4px;cursor:pointer;font-size:16px}
        button:hover{background:#0051cb}
    </style>
</head>
<body>
    <div class="card">
        <h1>⚠️ Error</h1>
        <p>${message || 'Failed to load page'}</p>
        <button onclick="location.reload()">Retry</button>
    </div>
</body>
</html>`;
}

// ==========================================
// ULTIMATE TEXT REWRITING
// ==========================================

function ultimateRewrite(text, targetOrigin) {
    if (typeof text !== 'string') return text;
    if (!text.includes('http') && !text.includes('src=') && !text.includes('href=')) {
        return text;
    }
    
    // Rewrite all URL attributes
    const attrRegex = /\b(href|src|action|data|poster|srcset|longdesc|codebase|cite|profile|archive|code|declare|standby|background|manifest|icon|preload)=(["'])([^"']+)\2/gi;
    let result = text.replace(attrRegex, (match, attr, quote, value) => {
        if (value.startsWith('#') || value.startsWith('javascript:') || 
            value.startsWith('data:') || value.includes(PROXY_PREFIX)) return match;
        try {
            const resolved = new URL(value, targetOrigin).href;
            return `${attr}=${quote}${self.location.origin}${PROXY_PREFIX}${encodeURIComponent(resolved)}${quote}`;
        } catch(e) { return match; }
    });
    
    // Rewrite absolute URLs
    const urlRegex = /https?:\/\/[a-zA-Z0-9\-._~:/?#[\]@!$&()*+,;=%]+/g;
    result = result.replace(urlRegex, (match) => {
        if (match.includes(PROXY_PREFIX) || match.startsWith(self.location.origin)) return match;
        if (match.startsWith('data:') || match.startsWith('blob:')) return match;
        return `${self.location.origin}${PROXY_PREFIX}${encodeURIComponent(match)}`;
    });
    
    // Rewrite CSS URLs
    const cssRegex = /url\(([^)]+)\)/gi;
    result = result.replace(cssRegex, (match, url) => {
        const trimmed = url.trim().replace(/['"]/g, '');
        if (!trimmed || trimmed.startsWith('data:') || trimmed.includes(PROXY_PREFIX)) return match;
        try {
            const resolved = new URL(trimmed, targetOrigin).href;
            return `url(${self.location.origin}${PROXY_PREFIX}${encodeURIComponent(resolved)})`;
        } catch(e) { return match; }
    });
    
    return result;
}

// ==========================================
// SERVICE WORKER LIFECYCLE
// ==========================================
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// ==========================================
// OPTIMIZED FETCH HANDLER
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
            
            // Build request with proper headers
            const headers = new Headers(event.request.headers);
            headers.delete('accept-encoding');
            headers.delete('if-none-match');
            headers.delete('if-match');
            headers.delete('if-modified-since');
            headers.delete('if-unmodified-since');
            headers.set('X-Proxy-Loop-Guard', 'true');
            headers.set('Origin', targetUrl.origin);
            headers.set('Referer', targetUrl.origin + '/');
            
            const options = {
                method: event.request.method,
                headers: headers,
                redirect: 'follow',
                mode: 'cors',
                credentials: 'include'
            };
            
            // Handle body for non-GET requests
            if (!['GET', 'HEAD'].includes(event.request.method)) {
                try {
                    const body = await event.request.text();
                    if (body) {
                        options.body = body;
                        options.duplex = 'half';
                    }
                } catch(e) {
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
                const isJson = ct.includes('application/json');
                
                const respHeaders = new Headers(response.headers);
                
                // Remove problematic headers
                const blockHeaders = [
                    'content-security-policy', 
                    'content-security-policy-report-only',
                    'x-frame-options', 
                    'cross-origin-opener-policy',
                    'cross-origin-embedder-policy', 
                    'cross-origin-resource-policy',
                    'strict-transport-security', 
                    'x-content-type-options',
                    'integrity', 
                    'content-encoding',
                    'content-length'
                ];
                for (const h of blockHeaders) respHeaders.delete(h);
                
                // Add CORS headers
                respHeaders.set('Access-Control-Allow-Origin', '*');
                respHeaders.set('Access-Control-Allow-Credentials', 'true');
                respHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD');
                respHeaders.set('Access-Control-Allow-Headers', '*');
                respHeaders.set('Access-Control-Expose-Headers', '*');
                
                // Handle redirects
                if (respHeaders.has('location')) {
                    try {
                        const abs = new URL(respHeaders.get('location'), targetUrl.href).href;
                        respHeaders.set('location', `${self.location.origin}${PROXY_PREFIX}${encodeURIComponent(abs)}`);
                    } catch(e) {}
                }
                
                // Rewrite content
                if (isHtml || isCss || isJson) {
                    let text = await response.text();
                    
                    if (isJson) {
                        try {
                            const json = JSON.parse(text);
                            // Rewrite URLs in JSON
                            function rewriteJson(obj) {
                                if (!obj || typeof obj !== 'object') return;
                                for (const key in obj) {
                                    if (typeof obj[key] === 'string' && 
                                        (key === 'url' || key === 'href' || key === 'src' || key === 'action')) {
                                        try {
                                            const resolved = new URL(obj[key], targetUrl.origin).href;
                                            obj[key] = `${self.location.origin}${PROXY_PREFIX}${encodeURIComponent(resolved)}`;
                                        } catch(e) {}
                                    } else if (typeof obj[key] === 'object') {
                                        rewriteJson(obj[key]);
                                    }
                                }
                            }
                            rewriteJson(json);
                            text = JSON.stringify(json);
                        } catch(e) {
                            text = ultimateRewrite(text, targetUrl.origin);
                        }
                    } else {
                        text = ultimateRewrite(text, targetUrl.origin);
                    }
                    
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
                        // Remove meta refresh tags
                        text = text.replace(/<meta[^>]*http-equiv=["']refresh["'][^>]*>/gi, '');
                    }
                    
                    return new Response(text, { 
                        status: response.status, 
                        headers: respHeaders 
                    });
                }
                
                // Binary content
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
            credentials: 'include'
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
    
    // --- Static assets from proxied pages ---
    const skipPaths = new Set(['/index.html', '/rewriter.js', '/favicon.ico', '/robots.txt']);
    if (!pathname.startsWith(PROXY_PREFIX) && !skipPaths.has(pathname)) {
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
                        
                        let targetPath = pathname + reqUrl.search;
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
                            credentials: 'include'
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
