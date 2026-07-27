// ==========================================
// Enhanced Browser API Patcher & Form Handler
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
// ENHANCED REWRITER - Comprehensive API Patching
// ==========================================
const REWRITER_SOURCE = `(function() {
    const PROXY_PREFIX = '/go/';
    const PROXY_HOST = window.location.host;
    const PROXY_ORIGIN = window.location.origin;

    // Configuration for API detection
    const API_PATTERNS = [
        '/api/', '/v1/', '/v2/', '/v3/', '/v4/', '/v5/',
        '/graphql', '/rest/', '/rpc/', '/service/', '/auth/',
        '/oauth/', '/token', '/login', '/signin', '/register',
        '/upload', '/post', '/put', '/delete', '/patch'
    ];

    const simulatedTarget = new URL(unproxyUrl(window.location.href));

    function isApiRequest(url) {
        if (!url || typeof url !== 'string') return false;
        const urlLower = url.toLowerCase();
        return API_PATTERNS.some(pattern => urlLower.includes(pattern));
    }

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

    // --- PATCH WebAssembly ---
    const nativeInstantiateStreaming = WebAssembly.instantiateStreaming;
    WebAssembly.instantiateStreaming = function(source, importObject) {
        if (source instanceof Response) return nativeInstantiateStreaming.call(WebAssembly, source, importObject);
        if (typeof source === 'string') source = rewriteUrl(source);
        else if (source instanceof Request) source = new Request(rewriteUrl(source.url), source);
        return nativeInstantiateStreaming.call(WebAssembly, source, importObject);
    };

    // --- PATCH fetch API ---
    const nativeFetch = window.fetch;
    window.fetch = async function(input, init) {
        if (typeof input === 'string') {
            input = rewriteUrl(input);
        } else if (input instanceof Request) {
            const url = input.url;
            input = new Request(rewriteUrl(url), input);
        }
        return nativeFetch.call(this, input, init);
    };

    // --- PATCH XMLHttpRequest ---
    const nativeXHROpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url, ...args) {
        const rewrittenUrl = rewriteUrl(url);
        // Store original URL for reference
        this._originalUrl = url;
        this._rewrittenUrl = rewrittenUrl;
        return nativeXHROpen.call(this, method, rewrittenUrl, ...args);
    };

    // --- PATCH XMLHttpRequest send (for form data) ---
    const nativeXHRSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function(body) {
        // If we're sending FormData and it's going to an API endpoint
        if (body instanceof FormData && this._rewrittenUrl) {
            // Check if we need to modify the form data
            const url = unproxyUrl(this._rewrittenUrl);
            if (isApiRequest(url)) {
                // We can intercept and modify form data here if needed
                console.log('[sw-helper] Intercepted API form submission:', url);
            }
        }
        return nativeXHRSend.call(this, body);
    };

    // --- PATCH WebSocket ---
    const NativeWebSocket = window.WebSocket;
    window.WebSocket = function(url, protocols) {
        try {
            const baseContext = simulatedTarget ? simulatedTarget.href : window.location.href;
            const targetUrl = new URL(url, baseContext);
            
            const wsScheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const interceptWsRoute = \`\${wsScheme}//\${PROXY_HOST}/ws/?target=\${encodeURIComponent(targetUrl.href)}\`;
            
            return new NativeWebSocket(interceptWsRoute, protocols);
        } catch(e) {
            return new NativeWebSocket(url, protocols);
        }
    };
    window.WebSocket.prototype = NativeWebSocket.prototype;

    // --- PATCH History API ---
    const nativePushState = window.history.pushState;
    window.history.pushState = function(state, title, url) {
        if (url) url = rewriteUrl(url.toString());
        return nativePushState.call(this, state, title, url);
    };

    const nativeReplaceState = window.history.replaceState;
    window.history.replaceState = function(state, title, url) {
        if (url) url = rewriteUrl(url.toString());
        return nativeReplaceState.call(this, state, title, url);
    };

    // --- PATCH EventSource (Server-Sent Events) ---
    const NativeEventSource = window.EventSource;
    window.EventSource = function(url, eventSourceInitDict) {
        const rewrittenUrl = rewriteUrl(url);
        return new NativeEventSource(rewrittenUrl, eventSourceInitDict);
    };
    window.EventSource.prototype = NativeEventSource.prototype;

    // --- PATCH WebRTC (RTCPeerConnection) ---
    const NativeRTCPeerConnection = window.RTCPeerConnection;
    window.RTCPeerConnection = function(configuration) {
        // Intercept ICE servers and proxy them if needed
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
        return new NativeRTCPeerConnection(configuration);
    };
    window.RTCPeerConnection.prototype = NativeRTCPeerConnection.prototype;

    // --- PATCH Navigator APIs ---
    const navigatorProperties = ['geolocation', 'mediaDevices', 'serviceWorker', 'share', 'clipboard'];
    navigatorProperties.forEach(prop => {
        if (navigator[prop]) {
            const original = navigator[prop];
            navigator[prop] = new Proxy(original, {
                get(target, prop) {
                    // Intercept methods that might have URLs
                    if (prop === 'getUserMedia' || prop === 'getDisplayMedia') {
                        return function(constraints) {
                            // Could modify constraints here if needed
                            return target[prop].call(target, constraints);
                        };
                    }
                    return target[prop];
                }
            });
        }
    });

    // --- PATCH document.cookie (for tracking) ---
    const cookieDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
    if (cookieDescriptor) {
        Object.defineProperty(document, 'cookie', {
            get: function() {
                return cookieDescriptor.get.call(this);
            },
            set: function(value) {
                // Could modify cookies here to ensure they work with proxy
                cookieDescriptor.set.call(this, value);
            }
        });
    }

    // --- PATCH localStorage and sessionStorage ---
    ['localStorage', 'sessionStorage'].forEach(storageType => {
        const storage = window[storageType];
        if (storage) {
            const originalSetItem = storage.setItem;
            storage.setItem = function(key, value) {
                // Check if value contains URLs that need rewriting
                if (typeof value === 'string' && (value.includes('http://') || value.includes('https://'))) {
                    try {
                        // Only rewrite if it's a valid URL
                        new URL(value);
                        value = rewriteUrl(value);
                    } catch(e) {}
                }
                return originalSetItem.call(this, key, value);
            };
        }
    });

    // --- PATCH window.postMessage ---
    const nativePostMessage = window.postMessage;
    window.postMessage = function(message, targetOrigin, transfer) {
        // Could intercept and modify messages here
        return nativePostMessage.call(this, message, targetOrigin, transfer);
    };

    // --- Enhanced Form Handling ---
    const originalCreateElement = document.createElement;
    document.createElement = function(tagName, options) {
        const el = originalCreateElement.call(this, tagName, options);
        const tag = tagName.toLowerCase();
        
        // Patch all elements with src/href/action attributes
        if (['script', 'iframe', 'embed', 'audio', 'video', 'source', 'track'].includes(tag)) {
            const originalSetAttribute = el.setAttribute;
            el.setAttribute = function(name, value) {
                if (name.toLowerCase() === 'src') value = rewriteUrl(value);
                return originalSetAttribute.call(this, name, value);
            };
            Object.defineProperty(el, 'src', { 
                get: () => unproxyUrl(el.getAttribute('src')), 
                set: (val) => el.setAttribute('src', val) 
            });
        }
        
        if (['link', 'a', 'area', 'base'].includes(tag)) {
            const attr = 'href';
            const originalSetAttribute = el.setAttribute;
            el.setAttribute = function(name, value) {
                if (name.toLowerCase() === attr) value = rewriteUrl(value);
                return originalSetAttribute.call(this, name, value);
            };
            Object.defineProperty(el, attr, { 
                get: () => unproxyUrl(el.getAttribute(attr)), 
                set: (val) => el.setAttribute(attr, val) 
            });
        }
        
        // Enhanced form handling
        if (['form', 'button', 'input'].includes(tag)) {
            if (tag === 'form') {
                // Patch form action
                const originalSetAttribute = el.setAttribute;
                el.setAttribute = function(name, value) {
                    if (name.toLowerCase() === 'action') value = rewriteUrl(value);
                    return originalSetAttribute.call(this, name, value);
                };
                Object.defineProperty(el, 'action', { 
                    get: () => unproxyUrl(el.getAttribute('action')), 
                    set: (val) => el.setAttribute('action', val) 
                });
                
                // Patch form method (to ensure POST/GET are handled correctly)
                Object.defineProperty(el, 'method', {
                    get: function() { return this.getAttribute('method') || 'GET'; },
                    set: function(val) { this.setAttribute('method', val.toUpperCase()); }
                });
                
                // Patch form enctype
                Object.defineProperty(el, 'enctype', {
                    get: function() { return this.getAttribute('enctype') || 'application/x-www-form-urlencoded'; },
                    set: function(val) { this.setAttribute('enctype', val); }
                });
            }
            
            if (tag === 'input' || tag === 'button') {
                // Patch input/button form attributes
                const originalSetAttribute = el.setAttribute;
                el.setAttribute = function(name, value) {
                    if (name.toLowerCase() === 'formaction') value = rewriteUrl(value);
                    return originalSetAttribute.call(this, name, value);
                };
                Object.defineProperty(el, 'formAction', { 
                    get: () => unproxyUrl(el.getAttribute('formaction')), 
                    set: (val) => el.setAttribute('formaction', val) 
                });
            }
        }
        return el;
    };

    // --- Patch element prototypes for src/href/action ---
    const elementPrototypes = [
        HTMLImageElement, HTMLScriptElement, HTMLIFrameElement, 
        HTMLAudioElement, HTMLVideoElement, HTMLEmbedElement, 
        HTMLSourceElement, HTMLTrackElement
    ];
    elementPrototypes.forEach(proto => {
        if (!proto) return;
        const desc = Object.getOwnPropertyDescriptor(proto.prototype, 'src');
        if (!desc) return;
        Object.defineProperty(proto.prototype, 'src', { 
            get: function() { return unproxyUrl(desc.get.call(this)); }, 
            set: function(val) { desc.set.call(this, rewriteUrl(val)); } 
        });
    });

    const linkPrototypes = [HTMLAnchorElement, HTMLLinkElement, HTMLAreaElement];
    linkPrototypes.forEach(proto => {
        if (!proto) return;
        const desc = Object.getOwnPropertyDescriptor(proto.prototype, 'href');
        if (!desc) return;
        Object.defineProperty(proto.prototype, 'href', { 
            get: function() { return unproxyUrl(desc.get.call(this)); }, 
            set: function(val) { desc.set.call(this, rewriteUrl(val)); } 
        });
    });

    // --- Comprehensive Form Submission Interception ---
    function interceptFormSubmission(form, event) {
        if (!form) return false;
        
        // Get the form's target URL
        let actionUrl = form.getAttribute('action') || window.location.href;
        const method = (form.getAttribute('method') || 'GET').toUpperCase();
        const enctype = form.getAttribute('enctype') || 'application/x-www-form-urlencoded';
        
        // Check if this is an API request
        const isApi = isApiRequest(actionUrl);
        
        // Rewrite the action URL
        const rewrittenAction = rewriteUrl(actionUrl);
        form.setAttribute('action', rewrittenAction);
        
        // For GET forms, we need to handle query parameters
        if (method === 'GET') {
            try {
                const formData = new FormData(form);
                const urlObj = new URL(rewrittenAction, simulatedTarget.href);
                
                // Convert FormData to URL params for GET
                for (let [key, val] of formData.entries()) {
                    if (typeof val === 'string') urlObj.searchParams.append(key, val);
                }
                
                // Update the form action with query string
                form.setAttribute('action', urlObj.href);
                
                // Prevent default to avoid double submission
                if (event) {
                    event.preventDefault();
                }
                
                // Navigate using fetch to intercept the response
                fetch(urlObj.href, {
                    method: 'GET',
                    headers: {
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                    }
                }).then(response => {
                    if (response.ok) {
                        return response.text();
                    }
                    throw new Error('Network response was not ok');
                }).then(html => {
                    // Replace current page with the response
                    document.open();
                    document.write(html);
                    document.close();
                }).catch(error => {
                    console.error('[sw-helper] Form submission failed:', error);
                });
                
                return true;
            } catch(e) {
                console.error('[sw-helper] Error processing GET form:', e);
            }
        }
        
        // For POST/PUT/DELETE forms, we need to handle form data
        if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
            // If the form uses multipart/form-data, we need to handle it specially
            if (enctype === 'multipart/form-data') {
                // The browser will handle this naturally with the rewritten action
                return false;
            }
            
            // For URL-encoded forms, we can intercept and modify
            if (enctype === 'application/x-www-form-urlencoded') {
                const formData = new FormData(form);
                const params = new URLSearchParams();
                for (let [key, val] of formData.entries()) {
                    if (typeof val === 'string') params.append(key, val);
                }
                
                // Prevent default submission
                if (event) {
                    event.preventDefault();
                }
                
                // Send the data via fetch
                fetch(rewrittenAction, {
                    method: method,
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                    },
                    body: params.toString()
                }).then(response => {
                    if (response.ok) {
                        // Handle the response
                        return response.text();
                    }
                    throw new Error('Network response was not ok');
                }).then(data => {
                    // Navigate or update page based on response
                    if (data) {
                        document.open();
                        document.write(data);
                        document.close();
                    }
                }).catch(error => {
                    console.error('[sw-helper] Form submission failed:', error);
                });
                
                return true;
            }
        }
        
        return false;
    }

    // --- Intercept form submit events ---
    document.addEventListener('submit', function(event) {
        const form = event.target;
        if (form && form.tagName && form.tagName.toLowerCase() === 'form') {
            // Intercept and handle the form submission
            const intercepted = interceptFormSubmission(form, event);
            if (intercepted) {
                // Form was handled by our interceptor
                return;
            }
            
            // Otherwise, just rewrite the action
            const action = form.getAttribute('action');
            if (action && !action.startsWith(PROXY_PREFIX)) {
                form.setAttribute('action', rewriteUrl(action));
            }
        }
    }, true);

    // --- Override HTMLFormElement.prototype.submit ---
    const originalFormSubmit = HTMLFormElement.prototype.submit;
    HTMLFormElement.prototype.submit = function() {
        // Try to intercept first
        const intercepted = interceptFormSubmission(this);
        if (intercepted) {
            // Form was handled, prevent native submission
            return;
        }
        
        // Fallback to original submit behavior
        const action = this.getAttribute('action');
        if (action && !action.startsWith(PROXY_PREFIX)) {
            this.setAttribute('action', rewriteUrl(action));
        }
        
        // Check if we need to rewrite any input values
        const inputs = this.querySelectorAll('input, select, textarea');
        inputs.forEach(input => {
            if (input.value && typeof input.value === 'string') {
                // Check if value contains URLs
                if (input.value.includes('http://') || input.value.includes('https://')) {
                    try {
                        const url = new URL(input.value);
                        // Only rewrite if it's a valid URL
                        input.value = rewriteUrl(input.value);
                    } catch(e) {}
                }
            }
        });
        
        return originalFormSubmit.call(this);
    };

    // --- Intercept fetch API for API requests ---
    const originalFetch = window.fetch;
    window.fetch = function(input, init) {
        // Check if this is an API request
        let url = typeof input === 'string' ? input : input.url;
        if (isApiRequest(url)) {
            // Modify headers for API requests
            init = init || {};
            init.headers = new Headers(init.headers || {});
            
            // Add custom headers to identify proxied API requests
            init.headers.set('X-Proxied-API', 'true');
            
            // For JSON APIs, ensure proper content type
            if (init.headers.get('Content-Type') === 'application/json') {
                // We could intercept and modify the body here
                if (init.body) {
                    try {
                        const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
                        // Could modify body here if needed
                        init.body = JSON.stringify(body);
                    } catch(e) {}
                }
            }
        }
        
        // Rewrite the URL
        const rewrittenInput = typeof input === 'string' ? rewriteUrl(input) : 
                              (input instanceof Request ? new Request(rewriteUrl(input.url), input) : input);
        
        return originalFetch.call(this, rewrittenInput, init);
    };

    // --- Patch XMLHttpRequest for API requests ---
    const originalXHROpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url, ...args) {
        this._method = method;
        this._originalUrl = url;
        
        // Check if API request
        if (isApiRequest(url)) {
            this._isApiRequest = true;
        }
        
        const rewrittenUrl = rewriteUrl(url);
        return originalXHROpen.call(this, method, rewrittenUrl, ...args);
    };

    // --- Patch XMLHttpRequest.setRequestHeader for API ---
    const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
    XMLHttpRequest.prototype.setRequestHeader = function(header, value) {
        if (this._isApiRequest) {
            // Could modify headers here
            if (header.toLowerCase() === 'content-type') {
                // Handle content-type for API requests
            }
        }
        return originalSetRequestHeader.call(this, header, value);
    };

    // --- Location mocking (existing) ---
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
        
        Object.defineProperty(window, 'top', { get: () => window, configurable: true });
        Object.defineProperty(window, 'parent', { get: () => window, configurable: true });
        Object.defineProperty(window, 'self', { get: () => window, configurable: true });
    } catch(e) {}

    // --- Additional attribute patching ---
    const nativeSetAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function(name, value) {
        const attr = name.toLowerCase();
        if (attr === 'href' || attr === 'src' || attr === 'action' || attr === 'formaction' || attr === 'navigation-url') {
            value = rewriteUrl(value);
        }
        return nativeSetAttribute.call(this, name, value);
    };

    // --- MutationObserver for dynamic content ---
    const pathObserver = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.type === 'attributes' && ['href', 'src', 'action', 'formaction'].includes(mutation.attributeName)) {
                const targetEl = mutation.target;
                const currentVal = targetEl.getAttribute(mutation.attributeName);
                if (currentVal && !currentVal.startsWith(PROXY_PREFIX) && !currentVal.startsWith(PROXY_ORIGIN + PROXY_PREFIX)) {
                    targetEl.setAttribute(mutation.attributeName, rewriteUrl(currentVal));
                }
            }
            // Check for dynamically added forms
            if (mutation.type === 'childList') {
                mutation.addedNodes.forEach(node => {
                    if (node.tagName && node.tagName.toLowerCase() === 'form') {
                        const action = node.getAttribute('action');
                        if (action && !action.startsWith(PROXY_PREFIX)) {
                            node.setAttribute('action', rewriteUrl(action));
                        }
                    }
                });
            }
        });
    });

    if (document.documentElement) {
        pathObserver.observe(document.documentElement, { 
            attributes: true, 
            subtree: true, 
            attributeFilter: ['href', 'src', 'action', 'formaction', 'navigation-url'] 
        });
    } else {
        window.addEventListener('DOMContentLoaded', () => {
            pathObserver.observe(document.documentElement, { 
                attributes: true, 
                subtree: true, 
                attributeFilter: ['href', 'src', 'action', 'formaction', 'navigation-url'] 
            });
        });
    }

    // --- Patch window.open ---
    const nativeOpen = window.open;
    window.open = function(url, target, features) {
        if (url) url = rewriteUrl(url.toString());
        return nativeOpen.call(this, url, target, features);
    };

    // --- Patch document.write and document.writeln for inline scripts ---
    const originalWrite = document.write;
    document.write = function(html) {
        if (typeof html === 'string') {
            // Could rewrite URLs in dynamically written HTML
            // This is complex and might break things, so we're cautious
        }
        return originalWrite.call(this, html);
    };

    console.log("[sw-helper] All APIs patched successfully!");
})();`;

// ... (rest of your code remains the same)
