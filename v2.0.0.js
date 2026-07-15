// ==========================================
// 
// ==========================================
const PROXY_PREFIX = '/go/';
const WISP_SERVER_URL = 'wss://wisp.mercurywork.shop/wisp/'; // 

// 
const cndPart1 = 'https://cdn.';
const cndPart2 = 'jsdelivr.net/';
const cndPart3 = 'npm/libcurl.js';
const cndPart4 = '@latest/';
const cndPart5 = 'libcurl_full.js';

// 
const libcurlUrl = cndPart1 + cndPart2 + cndPart3 + cndPart4 + cndPart5;

try {
    importScripts(libcurlUrl);
} catch (e) {
    console.error("[sw-helper] Failed to load libcurl.js dependency.", e);
}

// 
let libcurlReady = false;

if (typeof libcurl !== 'undefined') {
    // 
    if (typeof libcurl.set_websocket === 'function') {
        libcurl.set_websocket(WISP_SERVER_URL);
    }
    
    // 
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

const REWRITER_SOURCE = `(function() {
    const PROXY_PREFIX = '/go/';
    const PROXY_HOST = window.location.host;
    const PROXY_ORIGIN = window.location.origin;

    const simulatedTarget = new URL(unproxyUrl(window.location.href));

    function rewriteUrl(url) {
        if (!url || typeof url !== 'string') return url;
        const trimmed = url.trim();
        if (trimmed.startsWith('data:') || trimmed.startsWith('blob:') || trimmed.startsWith('javascript:')) return url;
        if (trimmed.startsWith(PROXY_PREFIX) || trimmed.startsWith(PROXY_ORIGIN + PROXY_PREFIX)) return url;
        try {
            const baseContext = simulatedTarget ? simulatedTarget.href : window.location.href;
            const resolved = new URL(trimmed, baseContext).href;
            return PROXY_PREFIX + encodeURIComponent(resolved);
        } catch (e) {
            if (simulatedTarget) {
                try {
                    const manualResolved = new URL(trimmed, simulatedTarget.origin).href;
                    return PROXY_PREFIX + encodeURIComponent(manualResolved);
                } catch(err) {}
            }
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

    const nativeInstantiateStreaming = WebAssembly.instantiateStreaming;
    WebAssembly.instantiateStreaming = function(source, importObject) {
        if (source instanceof Response) return nativeInstantiateStreaming.call(WebAssembly, source, importObject);
        if (typeof source === 'string') source = rewriteUrl(source);
        else if (source instanceof Request) source = new Request(rewriteUrl(source.url), source);
        return nativeInstantiateStreaming.call(WebAssembly, source, importObject);
    };

    const nativeFetch = window.fetch;
    window.fetch = async function(input, init) {
        if (typeof input === 'string') input = rewriteUrl(input);
        else if (input instanceof Request) input = new Request(rewriteUrl(url), input);
        return nativeFetch.call(this, input, init);
    };

    const nativeXHROpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url, ...args) {
        return nativeXHROpen.call(this, method, rewriteUrl(url), ...args);
    };

    // --- INTERCEPT WEBSOCKET NETWORKING (CHROME SCHEME FIX) ---
    const NativeWebSocket = window.WebSocket;
    window.WebSocket = function(url, protocols) {
        try {
            const baseContext = simulatedTarget ? simulatedTarget.href : window.location.href;
            const targetUrl = new URL(url, baseContext);
            
            // Explicitly force the target browser protocol using a clean wss/ws structure 
            const wsScheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            
            // Build a valid WebSocket endpoint structure that points right back to your server's proxy route
            const interceptWsRoute = \`\${wsScheme}//\${PROXY_HOST}/ws/?target=\${encodeURIComponent(targetUrl.href)}\`;
            
            return new NativeWebSocket(interceptWsRoute, protocols);
        } catch(e) {
            return new NativeWebSocket(url, protocols);
        }
    };
    window.WebSocket.prototype = NativeWebSocket.prototype;

    const nativePushState = window.history.pushState;
    window.history.pushState = function(state, title, url) {
        if (url) url = rewriteUrl(url.toString());
        return nativePushState.call(this, state, title, url);
    };
`;

// ==========================================
// 
// ==========================================
const REWRITER_SOURCE_PART_TWO = `
    const locationMock = new Proxy({}, {
        get(target, prop) {
            if (prop === 'reload') return () => window.location.reload();
            if (prop === 'replace') return (url) => window.location.replace(rewriteUrl(url));
            if (prop === 'assign') return (url) => window.location.assign(rewriteUrl(url));
            if (prop === 'toString') return () => simulatedTarget.href;
            return simulatedTarget[prop];
        },
        set(target, prop, value) {
            if (typeof prop === 'string' && prop in simulatedTarget) {
                simulatedTarget[prop] = value;
                window.location.href = rewriteUrl(simulatedTarget.href);
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
        
       
        // Overrides global hierarchy objects so internal scripts cannot see they are sandboxed inside an iframe
        Object.defineProperty(window, 'top', { get: () => window, configurable: true });
        Object.defineProperty(window, 'parent', { get: () => window, configurable: true });
        Object.defineProperty(window, 'self', { get: () => window, configurable: true });
    } catch(e) {}

    const originalCreateElement = document.createElement;
    document.createElement = function(tagName, options) {
        const el = originalCreateElement.call(this, tagName, options);
        const tag = tagName.toLowerCase();
        if (['script', 'iframe', 'embed', 'audio', 'video'].includes(tag)) {
            const originalSetAttribute = el.setAttribute;
            el.setAttribute = function(name, value) {
                if (name.toLowerCase() === 'src') value = rewriteUrl(value);
                return originalSetAttribute.call(this, name, value);
            };
            Object.defineProperty(el, 'src', { get: () => unproxyUrl(el.getAttribute('src')), set: (val) => el.setAttribute('src', val) });
        }
        if (['link', 'a', 'form'].includes(tag)) {
            const attr = tag === 'form' ? 'action' : 'href';
            const originalSetAttribute = el.setAttribute;
            el.setAttribute = function(name, value) {
                if (name.toLowerCase() === attr) value = rewriteUrl(value);
                return originalSetAttribute.call(this, name, value);
            };
            Object.defineProperty(el, attr, { get: () => unproxyUrl(el.getAttribute(attr)), set: (val) => el.setAttribute(attr, val) });
        }
        return el;
    };

    const elementPrototypes = [HTMLImageElement, HTMLScriptElement, HTMLIFrameElement, HTMLAudioElement, HTMLVideoElement, HTMLEmbedElement];
    elementPrototypes.forEach(proto => {
        if (!proto) return;
        const desc = Object.getOwnPropertyDescriptor(proto.prototype, 'src');
        if (!desc) return;
        Object.defineProperty(proto.prototype, 'src', { get: function() { return unproxyUrl(desc.get.call(this)); }, set: function(val) { desc.set.call(this, rewriteUrl(val)); } });
    });

    const linkPrototypes = [HTMLAnchorElement, HTMLLinkElement];
    linkPrototypes.forEach(proto => {
        if (!proto) return;
        const desc = Object.getOwnPropertyDescriptor(proto.prototype, 'href');
        if (!desc) return;
        Object.defineProperty(proto.prototype, 'href', { get: function() { return unproxyUrl(desc.get.call(this)); }, set: function(val) { desc.set.call(this, rewriteUrl(val)); } });
    });

    if (typeof HTMLFormElement !== 'undefined') {
        const desc = Object.getOwnPropertyDescriptor(HTMLFormElement.prototype, 'action');
        if (desc) {
            Object.defineProperty(HTMLFormElement.prototype, 'action', { 
                get: function() { return unproxyUrl(desc.get.call(this)); }, 
                set: function(val) { desc.set.call(this, rewriteUrl(val)); } 
            });
        }
        
        // Advanced submission handler rewriting actions before they post data to external domains
        const handleFormSubmission = function(form) {
            let actionUrl = form.getAttribute('action') || window.location.href;
            if (!actionUrl.startsWith(PROXY_PREFIX)) {
                // If the form method is GET, append data values directly onto the URL string parameters
                if (form.method && form.method.toLowerCase() === 'get') {
                    try {
                        const formData = new FormData(form);
                        const urlObj = new URL(actionUrl, simulatedTarget.href);
                        for (let [key, val] of formData.entries()) {
                            if (typeof val === 'string') urlObj.searchParams.append(key, val);
                        }
                        actionUrl = urlObj.href;
                    } catch(e) {}
                }
                form.setAttribute('action', rewriteUrl(actionUrl));
            }
        };

        const originalSubmit = HTMLFormElement.prototype.submit;
        HTMLFormElement.prototype.submit = function() {
            handleFormSubmission(this);
            return originalSubmit.call(this);
        };

        window.addEventListener('submit', (e) => {
            if (e.target && e.target.tagName.toLowerCase() === 'form') {
                handleFormSubmission(e.target);
            }
        }, true);
    }
`;
// ==========================================
// 
// ==========================================
const REWRITER_SOURCE_PART_THREE = `
    const nativeSetAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function(name, value) {
        const attr = name.toLowerCase();
        if (attr === 'href' || attr === 'src' || attr === 'action' || attr === 'navigation-url') value = rewriteUrl(value);
        return nativeSetAttribute.call(this, name, value);
    };

    const pathObserver = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.type === 'attributes' && (mutation.attributeName === 'href' || mutation.attributeName === 'src')) {
                const targetEl = mutation.target;
                const currentVal = targetEl.getAttribute(mutation.attributeName);
                if (currentVal && !currentVal.startsWith(PROXY_PREFIX) && !currentVal.startsWith(PROXY_ORIGIN + PROXY_PREFIX)) {
                    targetEl.setAttribute(mutation.attributeName, rewriteUrl(currentVal));
                }
            }
        });
    });

    if (document.documentElement) {
        pathObserver.observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ['href', 'src', 'navigation-url'] });
    } else {
        window.addEventListener('DOMContentLoaded', () => {
            pathObserver.observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ['href', 'src', 'navigation-url'] });
        });
    }

    const nativeOpen = window.open;
    window.open = function(url, target, features) {
        if (url) url = rewriteUrl(url.toString());
        return nativeOpen.call(this, url, target, features);
    };

    console.log("[sw-helper] rewrote one asset!");
})();`;

const COMPLETE_REWRITER_CODE = REWRITER_SOURCE + REWRITER_SOURCE_PART_TWO + REWRITER_SOURCE_PART_THREE;

function generateErrorPage(errorMessage, status) {
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Redirecting...</title>
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
            <div class="badge">status ${status || 502}</div>
            <h1>failed.</h1>
            <p>Try • checking your Internet connection, • Checking if the target website exists or is misspelled,  • and checking if the proxy server is online</p>
            <p style="color: #666; font-size: 12px; font-family: monospace;">Details: ${errorMessage || 'No supplementary context returned'}</p>
            <button onclick="window.location.reload()">Retry Connection</button>
        </div>
    </body>
    </html>`;
}
// ==========================================
//
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

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
    const requestUrl = new URL(event.request.url);

    if (requestUrl.pathname === '/rewriter.js') {
        event.respondWith(new Response(COMPLETE_REWRITER_CODE, { headers: { 'Content-Type': 'application/javascript; charset=utf-8' } }));
        return;
    }

    if (event.request.headers.get('X-Proxy-Loop-Guard')) return;

    if (requestUrl.pathname.startsWith(PROXY_PREFIX)) {
        const encodedTarget = requestUrl.pathname.substring(PROXY_PREFIX.length);
        if (!encodedTarget) return;

        // 
        const handleLibcurlFetch = async () => {
            // 
            while (!libcurlReady) {
                await new Promise(resolve => setTimeout(resolve, 50));
            }

            const targetUrl = new URL(decodeURIComponent(encodedTarget));
            const modifiedHeaders = new Headers(event.request.headers);
            modifiedHeaders.delete('accept-encoding');
            modifiedHeaders.set('X-Proxy-Loop-Guard', 'true');

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
                responseHeaders.delete('content-security-policy');
                responseHeaders.delete('x-frame-options');
                responseHeaders.delete('cross-origin-opener-policy');
                responseHeaders.set('Access-Control-Allow-Origin', '*');

                if (responseHeaders.has('location')) {
                    const loc = responseHeaders.get('location');
                    try {
                        const absoluteLoc = new URL(loc, targetUrl.href).href;
                        responseHeaders.set('location', `${self.location.origin}${PROXY_PREFIX}${encodeURIComponent(absoluteLoc)}`);
                    } catch (e) {}
                }

                if (contentType.includes('text/html') || contentType.includes('application/javascript') || contentType.includes('text/css') || contentType.includes('application/x-javascript')) {
                    let rawText = await response.text();
                    let parsedText = proxyTextContent(rawText, targetUrl.origin);
                    if (contentType.includes('text/html')) {
                        const injectorScript = `<script src="/rewriter.js"></script>`;
                        if (parsedText.match(/<head>/i)) parsedText = parsedText.replace(/<head>/i, `<head>${injectorScript}`);
                        else if (parsedText.match(/<html>/i)) parsedText = parsedText.replace(/<html>/i, `<html>${injectorScript}`);
                        else parsedText = injectorScript + parsedText;
                    }
                    return new Response(parsedText, { status: response.status, statusText: response.statusText, headers: responseHeaders });
                }
                return new Response(response.body, { status: response.status, statusText: response.statusText, headers: responseHeaders });
            } catch (err) {
                return new Response(generateErrorPage(err.message, 502), { status: 502, headers: { 'Content-Type': 'text/html' } });
            }
        };

        event.respondWith(handleLibcurlFetch());
        return;
    }
// ==========================================
// 
// ==========================================
    if (requestUrl.origin !== self.location.origin) {
        const fallbackProxyUrl = `${self.location.origin}${PROXY_PREFIX}${encodeURIComponent(event.request.url)}`;
        let fallbackMode = event.request.mode;
        if (fallbackMode === 'navigate' || fallbackMode === 'same-origin') fallbackMode = 'cors';

        const fallbackOptions = { method: event.request.method, headers: event.request.headers, redirect: 'follow', mode: fallbackMode };
        if (!['GET', 'HEAD'].includes(event.request.method)) {
            fallbackOptions.body = event.request.body;
            if (event.request.body) fallbackOptions.duplex = 'half';
        }
        event.respondWith(
            fetch(fallbackProxyUrl, fallbackOptions).catch((err) => {
                return new Response(generateErrorPage(err.message, 502), { status: 502, headers: { 'Content-Type': 'text/html' } });
            })
        );
        return;
    }

    if (requestUrl.origin === self.location.origin && !requestUrl.pathname.startsWith(PROXY_PREFIX) && !['/index.html', '/sw.js', '/favicon.ico'].includes(requestUrl.pathname)) {
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
                if (!fallbackContextUrl && clients && clients.length > 0) fallbackContextUrl = clients.url;

                if (fallbackContextUrl) {
                    try {
                        const clientUrlObj = new URL(fallbackContextUrl);
                        let targetOrigin = "";
                        if (clientUrlObj.pathname.startsWith(PROXY_PREFIX)) {
                            const currentProxyTargetEncoded = clientUrlObj.pathname.substring(PROXY_PREFIX.length);
                            targetOrigin = new URL(decodeURIComponent(currentProxyTargetEncoded)).origin;
                        } else {
                            if (assetPath.includes('search_query=') || assetPath.startsWith('/watch')) targetOrigin = 'https://youtube.com';
                            else if (assetPath.startsWith('/api/') || assetPath.startsWith('/assets/')) targetOrigin = 'https://discord.com';
                            else targetOrigin = 'https://google.com';
                        }
                        
                        const correctedUrl = `${self.location.origin}${PROXY_PREFIX}${encodeURIComponent(targetOrigin + assetPath)}`;
                        if (event.request.mode === 'navigate') return Response.redirect(correctedUrl, 302);

                        const dynamicOptions = { method: event.request.method, headers: event.request.headers, mode: dynamicMode };
                        if (!['GET', 'HEAD'].includes(event.request.method)) {
                            dynamicOptions.body = event.request.body;
                            if (event.request.body) dynamicOptions.duplex = 'half';
                        }
                        return fetch(correctedUrl, dynamicOptions);
                    } catch (e) {}
                }
                return fetch(event.request);
            }).catch((err) => {
                return new Response(generateErrorPage(err.message, 502), { status: 502, headers: { 'Content-Type': 'text/html' } });
            })
        );
        return;
    }
});
