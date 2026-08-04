// ==========================================
// fastsw service worker - v2.0.0
// ==========================================
const PROXY_PREFIX = '/go/';
const WISP_SERVER_URL = 'wss://wisp.mercurywork.shop/wisp/';

// Split CDN URL to avoid self-proxying
const libcurlUrl = 'https://cdn.' + 'jsdelivr.net/' + 'npm/libcurl.js' + '@latest/' + 'libcurl_full.js';

try {
    importScripts(libcurlUrl);
} catch (e) {
    console.error("[sw] Failed to load libcurl.js.", e);
}

let libcurlReady = false;
if (typeof libcurl !== 'undefined') {
    if (typeof libcurl.set_websocket === 'function') libcurl.set_websocket(WISP_SERVER_URL);
    if (libcurl.ready) {
        libcurlReady = true;
    } else {
        libcurl.onload = () => { libcurlReady = true; };
    }
}

// ==========================================
// CLIENT-SIDE REWRITER (injected into every proxied page)
// ==========================================
const REWRITER = `(function() {
    'use strict';
    const PROXY_PREFIX  = '/go/';
    const PROXY_HOST    = window.location.host;
    const PROXY_ORIGIN  = window.location.origin;
    const WISP_URL      = 'wss://wisp.mercurywork.shop/wisp/';

    // --- derive the real target URL from the proxied URL ---
    function unproxyUrl(url) {
        if (!url || typeof url !== 'string') return url;
        const idx = url.indexOf(PROXY_PREFIX);
        if (idx !== -1) {
            try { return decodeURIComponent(url.slice(idx + PROXY_PREFIX.length)); } catch (e) {}
        }
        return url;
    }

    let simulatedTarget;
    try { simulatedTarget = new URL(unproxyUrl(window.location.href)); } catch(e) { simulatedTarget = null; }

    function rewriteUrl(url) {
        if (!url || typeof url !== 'string') return url;
        const t = url.trim();
        if (!t || t.startsWith('data:') || t.startsWith('blob:') || t.startsWith('javascript:') || t.startsWith('#') || t.startsWith('mailto:') || t.startsWith('tel:')) return url;
        if (t.startsWith(PROXY_PREFIX) || t.startsWith(PROXY_ORIGIN + PROXY_PREFIX)) return url;
        try {
            const base = simulatedTarget ? simulatedTarget.href : window.location.href;
            const resolved = new URL(t, base).href;
            if (resolved.startsWith(PROXY_ORIGIN) && !resolved.startsWith(PROXY_ORIGIN + PROXY_PREFIX)) return url;
            return PROXY_PREFIX + encodeURIComponent(resolved);
        } catch (e) {
            return url;
        }
    }

    // rewrite a srcset attribute value (e.g. "img.png 1x, img2x.png 2x")
    function rewriteSrcset(srcset) {
        if (!srcset || typeof srcset !== 'string') return srcset;
        return srcset.split(',').map(part => {
            const trimmed = part.trim();
            const spaceIdx = trimmed.search(/\s/);
            if (spaceIdx === -1) return rewriteUrl(trimmed);
            const urlPart = trimmed.slice(0, spaceIdx);
            const rest = trimmed.slice(spaceIdx);
            return rewriteUrl(urlPart) + rest;
        }).join(', ');
    }

    // rewrite URLs inside CSS text (background-image: url(...), etc.)
    function rewriteCssText(css) {
        if (!css) return css;
        return css.replace(/url\(\s*(['"]?)([^)'"]+)\\1\s*\)/gi, (match, quote, urlVal) => {
            const rewritten = rewriteUrl(urlVal.trim());
            return \`url(\${quote}\${rewritten}\${quote})\`;
        });
    }

    // ==========================================
    // NETWORK APIs
    // ==========================================

    // --- fetch (fix: was using undefined 'url' var, now uses input.url) ---
    const _fetch = window.fetch;
    window.fetch = async function(input, init) {
        if (typeof input === 'string') input = rewriteUrl(input);
        else if (input instanceof Request) input = new Request(rewriteUrl(input.url), input);
        return _fetch.call(this, input, init);
    };

    // --- XMLHttpRequest ---
    const _xhrOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url, ...args) {
        return _xhrOpen.call(this, method, rewriteUrl(url), ...args);
    };

    // --- navigator.sendBeacon ---
    if (navigator.sendBeacon) {
        const _sendBeacon = navigator.sendBeacon.bind(navigator);
        navigator.sendBeacon = function(url, data) {
            return _sendBeacon(rewriteUrl(url), data);
        };
    }

    // --- EventSource (Server-Sent Events) ---
    const _EventSource = window.EventSource;
    window.EventSource = function(url, config) {
        return new _EventSource(rewriteUrl(url), config);
    };
    window.EventSource.prototype = _EventSource.prototype;
    Object.defineProperty(window.EventSource, 'CONNECTING', { value: _EventSource.CONNECTING });
    Object.defineProperty(window.EventSource, 'OPEN',       { value: _EventSource.OPEN });
    Object.defineProperty(window.EventSource, 'CLOSED',     { value: _EventSource.CLOSED });

    // --- WebSocket: use libcurl.CurlWebSocket (tunnels through Wisp) ---
    // libcurl.js is injected into the page before this script runs.
    // CurlWebSocket wraps the libcurl API in a native-compatible interface.
    const _NativeWS = window.WebSocket;

    function _resolveWsUrl(url) {
        const base = simulatedTarget ? simulatedTarget.href : window.location.href;
        try { return new URL(url, base).href; } catch(e) { return String(url); }
    }

    function _installCurlWS() {
        if (typeof libcurl === 'undefined' || !libcurl.CurlWebSocket) return false;
        try { libcurl.set_websocket(WISP_URL); } catch(e) {}

        // Native-compatible WebSocket wrapper around libcurl.CurlWebSocket
        class CurlWSWrapper extends EventTarget {
            constructor(url, protocols) {
                super();
                this.readyState    = 0; // CONNECTING
                this.binaryType    = 'blob';
                this.bufferedAmount = 0;
                this.extensions    = '';
                this.protocol      = '';
                this.url           = _resolveWsUrl(url);
                this.onopen    = null;
                this.onmessage = null;
                this.onclose   = null;
                this.onerror   = null;

                const prots = protocols == null ? []
                    : Array.isArray(protocols) ? protocols : [protocols];

                this._cws = new libcurl.CurlWebSocket(this.url, prots, {verbose: 0});

                this._cws.addEventListener('open', () => {
                    this.readyState = 1; // OPEN
                    const e = new Event('open');
                    this.dispatchEvent(e);
                    if (typeof this.onopen === 'function') this.onopen(e);
                });

                this._cws.addEventListener('message', (e) => {
                    const me = new MessageEvent('message', { data: e.data });
                    this.dispatchEvent(me);
                    if (typeof this.onmessage === 'function') this.onmessage(me);
                });

                this._cws.addEventListener('close', () => {
                    this.readyState = 3; // CLOSED
                    const ce = new CloseEvent('close', { code: 1000, reason: '', wasClean: true });
                    this.dispatchEvent(ce);
                    if (typeof this.onclose === 'function') this.onclose(ce);
                });

                this._cws.addEventListener('error', () => {
                    const ee = new Event('error');
                    this.dispatchEvent(ee);
                    if (typeof this.onerror === 'function') this.onerror(ee);
                    // fire a close event too so callers don't hang
                    if (this.readyState < 2) {
                        this.readyState = 3;
                        const ce = new CloseEvent('close', { code: 1006, reason: 'Connection error', wasClean: false });
                        this.dispatchEvent(ce);
                        if (typeof this.onclose === 'function') this.onclose(ce);
                    }
                });
            }

            send(data) {
                if (this.readyState !== 1)
                    throw new DOMException('WebSocket is not open', 'InvalidStateError');
                this._cws.send(data);
            }

            close(code, reason) {
                if (this.readyState >= 2) return;
                this.readyState = 2; // CLOSING
                try { this._cws.close(); } catch(e) {}
            }
        }

        CurlWSWrapper.CONNECTING = 0; CurlWSWrapper.OPEN = 1;
        CurlWSWrapper.CLOSING   = 2; CurlWSWrapper.CLOSED = 3;
        CurlWSWrapper.prototype.CONNECTING = 0; CurlWSWrapper.prototype.OPEN = 1;
        CurlWSWrapper.prototype.CLOSING   = 2; CurlWSWrapper.prototype.CLOSED = 3;
        window.WebSocket = CurlWSWrapper;
        return true;
    }

    // Try to install immediately; if libcurl WASM isn't done yet, hook its onload
    if (!_installCurlWS() && typeof libcurl !== 'undefined') {
        const _prevOnload = libcurl.onload;
        libcurl.onload = function() {
            if (typeof _prevOnload === 'function') _prevOnload();
            _installCurlWS();
        };
    }

    // --- Worker / SharedWorker (rewrite the script URL) ---
    const _Worker = window.Worker;
    window.Worker = function(url, options) {
        return new _Worker(rewriteUrl(url), options);
    };
    window.Worker.prototype = _Worker.prototype;

    if (window.SharedWorker) {
        const _SharedWorker = window.SharedWorker;
        window.SharedWorker = function(url, options) {
            return new _SharedWorker(rewriteUrl(url), options);
        };
        window.SharedWorker.prototype = _SharedWorker.prototype;
    }

    // --- WebAssembly streaming ---
    if (typeof WebAssembly !== 'undefined') {
        const _wasmIS = WebAssembly.instantiateStreaming;
        WebAssembly.instantiateStreaming = function(source, importObject) {
            if (source instanceof Response) return _wasmIS.call(WebAssembly, source, importObject);
            if (typeof source === 'string') source = rewriteUrl(source);
            else if (source instanceof Request) source = new Request(rewriteUrl(source.url), source);
            return _wasmIS.call(WebAssembly, source, importObject);
        };
        const _wasmCS = WebAssembly.compileStreaming;
        if (_wasmCS) {
            WebAssembly.compileStreaming = function(source) {
                if (source instanceof Response) return _wasmCS.call(WebAssembly, source);
                if (typeof source === 'string') source = rewriteUrl(source);
                else if (source instanceof Request) source = new Request(rewriteUrl(source.url), source);
                return _wasmCS.call(WebAssembly, source);
            };
        }
    }

    // ==========================================
    // NAVIGATION / HISTORY / LOCATION
    // ==========================================

    // --- location mock ---
    const locationMock = new Proxy({}, {
        get(target, prop) {
            if (!simulatedTarget) return window.location[prop];
            if (prop === 'reload')    return () => window.location.reload();
            if (prop === 'replace')   return (url) => window.location.replace(rewriteUrl(url));
            if (prop === 'assign')    return (url) => window.location.assign(rewriteUrl(url));
            if (prop === 'toString')  return () => simulatedTarget.href;
            if (prop === Symbol.toPrimitive) return () => simulatedTarget.href;
            if (prop === 'href') return simulatedTarget.href;
            if (prop in simulatedTarget) return simulatedTarget[prop];
            return undefined;
        },
        set(target, prop, value) {
            if (prop === 'href') {
                window.location.href = rewriteUrl(value);
                return true;
            }
            if (simulatedTarget && typeof prop === 'string' && prop in simulatedTarget) {
                try {
                    simulatedTarget[prop] = value;
                    window.location.href = rewriteUrl(simulatedTarget.href);
                } catch(e) {}
                return true;
            }
            return false;
        }
    });

    const _getOwnPropDesc = Object.getOwnPropertyDescriptor;
    Object.getOwnPropertyDescriptor = function(obj, prop) {
        if ((obj === window || obj === document) && prop === 'location') {
            return { get: () => locationMock, configurable: true, enumerable: true };
        }
        return _getOwnPropDesc.apply(this, arguments);
    };

    try {
        Object.defineProperty(window,   'location', { get: () => locationMock, configurable: false });
        Object.defineProperty(document, 'location', { get: () => locationMock, configurable: false });
    } catch(e) {}

    // --- history push/replaceState ---
    const _pushState = window.history.pushState;
    window.history.pushState = function(state, title, url) {
        if (url) url = rewriteUrl(url.toString());
        return _pushState.call(this, state, title, url);
    };
    const _replaceState = window.history.replaceState;
    window.history.replaceState = function(state, title, url) {
        if (url) url = rewriteUrl(url.toString());
        return _replaceState.call(this, state, title, url);
    };

    // --- window.navigation (Navigation API, newer browsers) ---
    if (window.navigation) {
        const _navNavigate = window.navigation.navigate.bind(window.navigation);
        window.navigation.navigate = function(url, options) {
            return _navNavigate(rewriteUrl(url), options);
        };
    }

    // --- window.open ---
    const _open = window.open;
    window.open = function(url, target, features) {
        if (url) url = rewriteUrl(url.toString());
        return _open.call(this, url, target, features);
    };

    // ==========================================
    // SANDBOX ESCAPE PREVENTION
    // ==========================================
    try {
        Object.defineProperty(window, 'top',         { get: () => window,    configurable: true });
        Object.defineProperty(window, 'parent',      { get: () => window,    configurable: true });
        Object.defineProperty(window, 'self',        { get: () => window,    configurable: true });
        Object.defineProperty(window, 'frameElement',{ get: () => null,      configurable: true });
        Object.defineProperty(window, 'frames',      { get: () => window,    configurable: true });
    } catch(e) {}

    // hide that we are in an iframe
    try {
        Object.defineProperty(window, 'length', { get: () => 0, configurable: true });
    } catch(e) {}

    // ==========================================
    // DOCUMENT IDENTITY MOCKING
    // ==========================================
    if (simulatedTarget) {
        const _domain  = _getOwnPropDesc(Document.prototype, 'domain')  || _getOwnPropDesc(document, 'domain');
        const _docURL  = _getOwnPropDesc(Document.prototype, 'URL')      || _getOwnPropDesc(document, 'URL');
        const _docURI  = _getOwnPropDesc(Document.prototype, 'documentURI') || _getOwnPropDesc(document, 'documentURI');
        const _baseURI = _getOwnPropDesc(Node.prototype,     'baseURI')  || _getOwnPropDesc(document, 'baseURI');
        const _referrer= _getOwnPropDesc(Document.prototype, 'referrer') || _getOwnPropDesc(document, 'referrer');

        try {
            Object.defineProperty(document, 'URL',         { get: () => simulatedTarget.href, configurable: true });
            Object.defineProperty(document, 'documentURI', { get: () => simulatedTarget.href, configurable: true });
            Object.defineProperty(document, 'baseURI',     { get: () => simulatedTarget.href, configurable: true });
            Object.defineProperty(document, 'domain',      {
                get: () => simulatedTarget.hostname,
                set: () => {},
                configurable: true
            });
            Object.defineProperty(document, 'referrer',    { get: () => simulatedTarget.origin + '/', configurable: true });
        } catch(e) {}
    }

    // --- document.write / writeln (rewrite URLs in injected markup) ---
    const _docWrite = document.write.bind(document);
    document.write = function(html) {
        return _docWrite(typeof html === 'string' ? rewriteHtmlUrls(html) : html);
    };
    const _docWriteln = document.writeln.bind(document);
    document.writeln = function(html) {
        return _docWriteln(typeof html === 'string' ? rewriteHtmlUrls(html) : html);
    };

    function rewriteHtmlUrls(html) {
        return html
            .replace(/(href|src|action|data|poster|srcset)=(['"])([^'"]+)\\2/gi, (m, attr, q, val) => {
                const rewritten = attr.toLowerCase() === 'srcset' ? rewriteSrcset(val) : rewriteUrl(val);
                return \`\${attr}=\${q}\${rewritten}\${q}\`;
            })
            .replace(/url\(\s*(['"]?)([^)'"]+)\\1\s*\)/gi, (m, q, val) => \`url(\${q}\${rewriteUrl(val.trim())}\${q})\`);
    }

    // ==========================================
    // ELEMENT CREATION & ATTRIBUTE OVERRIDES
    // ==========================================

    // --- Patch prototypes for all URL-bearing elements ---
    // These capture native descriptors (before any override) so there is no double-rewrite.
    // Property setters (.src = val) go through here; explicit setAttribute('src', val) goes
    // through the global Element.prototype.setAttribute override below. Both paths are
    // independent and idempotent — rewriteUrl/rewriteSrcset skip already-proxied values.
    const protoPatches = [
        [HTMLAnchorElement,    'href'],
        [HTMLAreaElement,      'href'],
        [HTMLLinkElement,      'href'],
        [HTMLBaseElement,      'href'],
        [HTMLImageElement,     'src'],
        [HTMLScriptElement,    'src'],
        [HTMLIFrameElement,    'src'],
        [HTMLAudioElement,     'src'],
        [HTMLVideoElement,     'src'],
        [HTMLVideoElement,     'poster'],
        [HTMLEmbedElement,     'src'],
        [HTMLSourceElement,    'src'],
        [HTMLSourceElement,    'srcset'],
        [HTMLTrackElement,     'src'],
        [HTMLObjectElement,    'data'],
        [HTMLFormElement,      'action'],
        [HTMLInputElement,     'src'],
    ];

    for (const [Ctor, prop] of protoPatches) {
        if (!Ctor) continue;
        try {
            const desc = Object.getOwnPropertyDescriptor(Ctor.prototype, prop);
            if (!desc || !desc.get) continue;
            Object.defineProperty(Ctor.prototype, prop, {
                get: function() { return unproxyUrl(desc.get.call(this)); },
                set: function(val) { desc.set.call(this, prop === 'srcset' ? rewriteSrcset(val) : rewriteUrl(val)); },
                configurable: true
            });
        } catch(e) {}
    }

    // --- HTMLImageElement srcset ---
    try {
        const imgSrcsetDesc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'srcset');
        if (imgSrcsetDesc && imgSrcsetDesc.get) {
            Object.defineProperty(HTMLImageElement.prototype, 'srcset', {
                get: function() { return imgSrcsetDesc.get.call(this); },
                set: function(val) { imgSrcsetDesc.set.call(this, rewriteSrcset(val)); },
                configurable: true
            });
        }
    } catch(e) {}

    // --- HTMLFormElement submit ---
    function rewriteFormAction(form) {
        let action = form.getAttribute('action') || (simulatedTarget ? simulatedTarget.href : window.location.href);
        if (!action.startsWith(PROXY_PREFIX)) form.setAttribute('action', rewriteUrl(action));
    }
    const _formSubmit = HTMLFormElement.prototype.submit;
    HTMLFormElement.prototype.submit = function() { rewriteFormAction(this); return _formSubmit.call(this); };
    window.addEventListener('submit', (e) => { if (e.target && e.target.tagName === 'FORM') rewriteFormAction(e.target); }, true);

    // ==========================================
    // GLOBAL setAttribute / insertAdjacentHTML / innerHTML
    // ==========================================
    const _setAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function(name, value) {
        const n = name.toLowerCase();
        if (n === 'href' || n === 'src' || n === 'action' || n === 'data' || n === 'poster') value = rewriteUrl(value);
        else if (n === 'srcset') value = rewriteSrcset(value);
        else if (n === 'style') value = rewriteCssText(value);
        // meta http-equiv refresh with URL
        else if (n === 'content' && this.tagName === 'META') {
            value = value.replace(/(;\s*url=)(.+)/i, (m, prefix, url) => prefix + rewriteUrl(url.trim()));
        }
        return _setAttribute.call(this, name, value);
    };

    // --- insertAdjacentHTML ---
    const _insertAdjacentHTML = Element.prototype.insertAdjacentHTML;
    Element.prototype.insertAdjacentHTML = function(position, html) {
        return _insertAdjacentHTML.call(this, position, rewriteHtmlUrls(html));
    };

    // --- innerHTML / outerHTML setters ---
    try {
        const _innerHTMLDesc = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
        if (_innerHTMLDesc && _innerHTMLDesc.set) {
            Object.defineProperty(Element.prototype, 'innerHTML', {
                get: _innerHTMLDesc.get,
                set: function(val) { return _innerHTMLDesc.set.call(this, typeof val === 'string' ? rewriteHtmlUrls(val) : val); },
                configurable: true
            });
        }
        const _outerHTMLDesc = Object.getOwnPropertyDescriptor(Element.prototype, 'outerHTML');
        if (_outerHTMLDesc && _outerHTMLDesc.set) {
            Object.defineProperty(Element.prototype, 'outerHTML', {
                get: _outerHTMLDesc.get,
                set: function(val) { return _outerHTMLDesc.set.call(this, typeof val === 'string' ? rewriteHtmlUrls(val) : val); },
                configurable: true
            });
        }
    } catch(e) {}

    // ==========================================
    // CSS STYLE REWRITING
    // ==========================================
    const CSS_URL_PROPS = [
        'backgroundImage', 'background', 'borderImage', 'borderImageSource',
        'listStyleImage', 'maskImage', 'mask', 'cursor', 'content',
        'webkitMaskImage', 'webkitMask',
    ];

    try {
        const _setProperty = CSSStyleDeclaration.prototype.setProperty;
        CSSStyleDeclaration.prototype.setProperty = function(prop, value, priority) {
            if (typeof value === 'string' && value.includes('url(')) value = rewriteCssText(value);
            return _setProperty.call(this, prop, value, priority);
        };

        for (const prop of CSS_URL_PROPS) {
            try {
                const desc = Object.getOwnPropertyDescriptor(CSSStyleDeclaration.prototype, prop);
                if (!desc || !desc.set) continue;
                Object.defineProperty(CSSStyleDeclaration.prototype, prop, {
                    get: desc.get,
                    set: function(val) { desc.set.call(this, typeof val === 'string' ? rewriteCssText(val) : val); },
                    configurable: true
                });
            } catch(e) {}
        }

        // cssText setter
        const _cssTextDesc = Object.getOwnPropertyDescriptor(CSSStyleDeclaration.prototype, 'cssText');
        if (_cssTextDesc && _cssTextDesc.set) {
            Object.defineProperty(CSSStyleDeclaration.prototype, 'cssText', {
                get: _cssTextDesc.get,
                set: function(val) { _cssTextDesc.set.call(this, typeof val === 'string' ? rewriteCssText(val) : val); },
                configurable: true
            });
        }
    } catch(e) {}

    // ==========================================
    // PERFORMANCE API (hide proxy URLs from entries)
    // ==========================================
    try {
        const _getEntries = Performance.prototype.getEntries;
        const _getEntriesByType = Performance.prototype.getEntriesByType;
        const _getEntriesByName = Performance.prototype.getEntriesByName;
        const unproxyEntry = (entry) => {
            try {
                // Capture the current string value BEFORE redefining the property.
                // If we read entry.name inside the new getter it calls itself → stack overflow.
                const origName = entry.name;
                Object.defineProperty(entry, 'name', { get: () => unproxyUrl(origName), configurable: true });
                const origType = entry.initiatorType;
                Object.defineProperty(entry, 'initiatorType', { value: origType, configurable: true });
            } catch(e) {}
            return entry;
        };
        if (_getEntries) {
            Performance.prototype.getEntries = function(...a) {
                return _getEntries.apply(this, a).map(unproxyEntry);
            };
        }
        if (_getEntriesByType) {
            Performance.prototype.getEntriesByType = function(...a) {
                return _getEntriesByType.apply(this, a).map(unproxyEntry);
            };
        }
        if (_getEntriesByName) {
            Performance.prototype.getEntriesByName = function(...a) {
                return _getEntriesByName.apply(this, a).map(unproxyEntry);
            };
        }
    } catch(e) {}

    // ==========================================
    // MUTATION OBSERVER (catch dynamic DOM mutations)
    // ==========================================
    const URL_ATTR_SET = new Set(['href', 'src', 'action', 'data', 'poster', 'srcset', 'navigation-url']);

    function rewriteNode(node) {
        if (node.nodeType !== 1) return;
        for (const attr of URL_ATTR_SET) {
            const val = node.getAttribute && node.getAttribute(attr);
            if (val && !val.startsWith(PROXY_PREFIX) && !val.startsWith(PROXY_ORIGIN + PROXY_PREFIX)) {
                try { node.setAttribute(attr, attr === 'srcset' ? rewriteSrcset(val) : rewriteUrl(val)); } catch(e) {}
            }
        }
        // handle inline style
        const style = node.getAttribute && node.getAttribute('style');
        if (style && style.includes('url(')) {
            try { node.setAttribute('style', rewriteCssText(style)); } catch(e) {}
        }
        // recurse into children
        if (node.children) for (const child of node.children) rewriteNode(child);
    }

    const domObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.type === 'attributes') {
                const attr = mutation.attributeName;
                const el   = mutation.target;
                if (URL_ATTR_SET.has(attr)) {
                    const val = el.getAttribute(attr);
                    if (val && !val.startsWith(PROXY_PREFIX) && !val.startsWith(PROXY_ORIGIN + PROXY_PREFIX)) {
                        try { el.setAttribute(attr, attr === 'srcset' ? rewriteSrcset(val) : rewriteUrl(val)); } catch(e) {}
                    }
                } else if (attr === 'style') {
                    const val = el.getAttribute('style');
                    if (val && val.includes('url(')) try { el.setAttribute('style', rewriteCssText(val)); } catch(e) {}
                }
            } else if (mutation.type === 'childList') {
                for (const node of mutation.addedNodes) rewriteNode(node);
            }
        }
    });

    const observerConfig = {
        attributes: true,
        subtree: true,
        childList: true,
        attributeFilter: [...URL_ATTR_SET, 'style'],
    };

    function startObserver() {
        if (document.documentElement) domObserver.observe(document.documentElement, observerConfig);
    }
    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', startObserver, { once: true });
    } else {
        startObserver();
    }

    // ==========================================
    // SVG element href overrides
    // ==========================================
    try {
        if (window.SVGImageElement) {
            const svgDesc = Object.getOwnPropertyDescriptor(SVGImageElement.prototype, 'href');
            if (svgDesc && svgDesc.get) {
                // SVG href is an SVGAnimatedString; intercept via setAttribute instead
                const _svgSetAttr = SVGElement.prototype.setAttribute;
                SVGElement.prototype.setAttribute = function(name, value) {
                    if (name === 'href' || name === 'xlink:href') value = rewriteUrl(value);
                    return _svgSetAttr.call(this, name, value);
                };
            }
        }
    } catch(e) {}

    // ==========================================
    // WINDOW NAME (some sites set/read window.name for communication)
    // ==========================================
    try {
        let _winName = window.name;
        Object.defineProperty(window, 'name', {
            get: () => _winName,
            set: (v) => { _winName = v; },
            configurable: true
        });
    } catch(e) {}

    // ==========================================
    // TRUSTED TYPES (prevent policy blocking our rewrites)
    // ==========================================
    if (window.trustedTypes && window.trustedTypes.createPolicy) {
        try {
            window.trustedTypes.createPolicy('default', {
                createHTML:        (s) => s,
                createScript:      (s) => s,
                createScriptURL:   (s) => s,
            });
        } catch(e) {}
    }

    console.log('[fastsw] rewriter active on', simulatedTarget ? simulatedTarget.href : window.location.href);
})();`;

// ==========================================
// SERVICE WORKER HELPERS
// ==========================================

function generateErrorPage(errorMessage, status) {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Error</title>
    <style>body{background:#111;color:#eee;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px;box-sizing:border-box}.card{background:#1a1a1a;padding:40px;border-radius:12px;border:1px solid #333;max-width:500px;width:100%;text-align:center}h1{color:#ff4a4a}p{color:#aaa;line-height:1.6}.badge{background:#2a1b1b;color:#ff6b6b;padding:6px 12px;border-radius:4px;font-family:monospace;font-size:13px;display:inline-block;margin-bottom:20px;border:1px solid #4a2222}button{background:#0070f3;color:#fff;border:none;padding:12px 24px;border-radius:6px;font-weight:600;cursor:pointer}button:hover{background:#0051cb}</style></head>
    <body><div class="card"><div class="badge">status ${status || 502}</div><h1>failed.</h1><p>Check your internet connection, verify the target site exists, and confirm the proxy server is online.</p><p style="color:#666;font-size:12px;font-family:monospace">${errorMessage || 'No details available'}</p><button onclick="window.location.reload()">Retry</button></div></body></html>`;
}

function proxyTextContent(text, targetOrigin, isJs) {
    if (typeof text !== 'string') return text;

    // JavaScript: skip ALL text-level URL rewriting.
    // The client-side rewriter intercepts fetch/XHR/WebSocket/etc. at runtime.
    // Rewriting URLs inside JS source corrupts syntax — e.g. the URL regex can consume
    // a closing quote character from a JS string literal, causing "missing ) after argument list".
    if (isJs) return text;

    // Rewrite absolute URLs in HTML/CSS.
    // Note: ' is intentionally excluded from the character class to avoid consuming
    // string delimiters when a URL appears inside a quoted context.
    let out = text.replace(/(https?:\/\/[a-zA-Z0-9\-._~:/?#[\]@!$&()*+,;=%]+)/g, (match) => {
        if (match.includes(PROXY_PREFIX) || match.startsWith(self.location.origin)) return match;
        return `${self.location.origin}${PROXY_PREFIX}${encodeURIComponent(match)}`;
    });

    // Rewrite relative href/src/action/data/poster attributes (HTML)
    const attrPattern = /\b(href|src|action|data|poster|srcset)=(["'])([^"']+)\2/gi;
    out = out.replace(attrPattern, (match, attr, q, val) => {
        if (val.startsWith('#') || val.startsWith('javascript:') || val.startsWith('data:') || val.includes(PROXY_PREFIX)) return match;
        try {
            const resolved = new URL(val, targetOrigin).href;
            return `${attr}=${q}${self.location.origin}${PROXY_PREFIX}${encodeURIComponent(resolved)}${q}`;
        } catch(e) { return match; }
    });

    // Rewrite relative url(...) references in CSS (e.g. Google Fonts: url(font.woff2))
    out = out.replace(/\burl\(\s*(["']?)(?!data:|blob:|#)([^)'"]+?)\1\s*\)/gi, (match, q, val) => {
        val = val.trim();
        if (!val || val.includes(PROXY_PREFIX)) return match;
        try {
            const resolved = new URL(val, targetOrigin).href;
            return `url(${q}${self.location.origin}${PROXY_PREFIX}${encodeURIComponent(resolved)}${q})`;
        } catch(e) { return match; }
    });

    return out;
}

// ==========================================
// SERVICE WORKER LIFECYCLE
// ==========================================
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// ==========================================
// FETCH HANDLER
// ==========================================
self.addEventListener('fetch', (event) => {
    const reqUrl = new URL(event.request.url);

    // serve the rewriter script
    if (reqUrl.pathname === '/rewriter.js') {
        event.respondWith(new Response(REWRITER, {
            headers: { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' }
        }));
        return;
    }

    // serve libcurl.js to page context so CurlWebSocket is available in the rewriter
    if (reqUrl.pathname === '/libcurl.js') {
        event.respondWith(
            fetch(libcurlUrl)
                .then(r => {
                    const headers = new Headers(r.headers);
                    headers.set('Cache-Control', 'public, max-age=3600');
                    headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
                    return new Response(r.body, { status: r.status, headers });
                })
                .catch(() => new Response('', { status: 503 }))
        );
        return;
    }

    // prevent proxy loops
    if (event.request.headers.get('X-Proxy-Loop-Guard')) return;

    // --- proxied request ---
    if (reqUrl.pathname.startsWith(PROXY_PREFIX)) {
        const encodedTarget = reqUrl.pathname.substring(PROXY_PREFIX.length);
        if (!encodedTarget) return;

        event.respondWith((async () => {
            while (!libcurlReady) await new Promise(r => setTimeout(r, 50));

            let targetUrl;
            try { targetUrl = new URL(decodeURIComponent(encodedTarget)); }
            catch(e) { return new Response(generateErrorPage('Invalid target URL: ' + e.message, 400), { status: 400, headers: { 'Content-Type': 'text/html' } }); }

            const modHeaders = new Headers(event.request.headers);
            modHeaders.delete('accept-encoding');
            modHeaders.set('X-Proxy-Loop-Guard', 'true');
            // spoof origin/referer to look like it came from the target site
            modHeaders.set('Origin',  targetUrl.origin);
            modHeaders.set('Referer', targetUrl.origin + '/');

            let mode = event.request.mode;
            if (mode === 'same-origin' || mode === 'navigate') mode = 'cors';

            const fetchOpts = { method: event.request.method, headers: modHeaders, redirect: 'follow', mode, credentials: 'omit' };
            if (!['GET', 'HEAD'].includes(event.request.method)) {
                fetchOpts.body = event.request.body;
                if (event.request.body) fetchOpts.duplex = 'half';
            }

            try {
                const response = await libcurl.fetch(targetUrl.href, fetchOpts);
                const ct = response.headers.get('content-type') || '';

                const respHeaders = new Headers(response.headers);
                // strip headers that would block the proxy
                for (const h of [
                    'content-security-policy', 'content-security-policy-report-only',
                    'x-frame-options', 'cross-origin-opener-policy',
                    'cross-origin-embedder-policy', 'cross-origin-resource-policy',
                    'strict-transport-security', 'x-content-type-options',
                ]) respHeaders.delete(h);

                respHeaders.set('Access-Control-Allow-Origin', '*');
                respHeaders.set('Access-Control-Allow-Credentials', 'true');

                // rewrite redirect Location header
                if (respHeaders.has('location')) {
                    try {
                        const abs = new URL(respHeaders.get('location'), targetUrl.href).href;
                        respHeaders.set('location', `${self.location.origin}${PROXY_PREFIX}${encodeURIComponent(abs)}`);
                    } catch(e) {}
                }

                const isHtml = ct.includes('text/html');
                const isJs   = ct.includes('application/javascript') || ct.includes('text/javascript') || ct.includes('application/x-javascript');
                const isCss  = ct.includes('text/css');

                if (isHtml || isJs || isCss) {
                    let text = await response.text();
                    // pass isJs so proxyTextContent skips URL rewriting on JS (avoids syntax corruption)
                    text = proxyTextContent(text, targetUrl.origin, isJs);

                    if (isHtml) {
                        // inject libcurl.js first so CurlWebSocket is available to the rewriter
                        const injector = `<script src="/libcurl.js"><\/script><script src="/rewriter.js"><\/script>`;
                        if (/<head[\s>]/i.test(text)) text = text.replace(/<head([^>]*)>/i, `<head$1>${injector}`);
                        else if (/<html[\s>]/i.test(text)) text = text.replace(/<html([^>]*)>/i, `<html$1>${injector}`);
                        else text = injector + text;
                    }

                    return new Response(text, { status: response.status, statusText: response.statusText, headers: respHeaders });
                }

                return new Response(response.body, { status: response.status, statusText: response.statusText, headers: respHeaders });
            } catch(err) {
                return new Response(generateErrorPage(err.message, 502), { status: 502, headers: { 'Content-Type': 'text/html' } });
            }
        })());
        return;
    }

    // --- external request not through PROXY_PREFIX: auto-route it ---
    if (reqUrl.origin !== self.location.origin) {
        const proxied = `${self.location.origin}${PROXY_PREFIX}${encodeURIComponent(event.request.url)}`;
        let mode = event.request.mode;
        if (mode === 'navigate' || mode === 'same-origin') mode = 'cors';
        const opts = { method: event.request.method, headers: event.request.headers, redirect: 'follow', mode };
        if (!['GET', 'HEAD'].includes(event.request.method)) {
            opts.body = event.request.body;
            if (event.request.body) opts.duplex = 'half';
        }
        event.respondWith(fetch(proxied, opts).catch(err =>
            new Response(generateErrorPage(err.message, 502), { status: 502, headers: { 'Content-Type': 'text/html' } })
        ));
        return;
    }

    // --- same-origin request without PROXY_PREFIX: infer target from active client context ---
    if (!reqUrl.pathname.startsWith(PROXY_PREFIX) && !['/index.html', '/v2.0.0.js', '/rewriter.js', '/register-sw.js', '/favicon.ico'].includes(reqUrl.pathname)) {
        const assetPath = reqUrl.pathname + reqUrl.search;

        event.respondWith(
            self.clients.matchAll({ type: 'window' }).then((clients) => {
                let contextUrl = null;
                if (event.clientId) {
                    const c = clients.find(c => c.id === event.clientId);
                    if (c && new URL(c.url).pathname.startsWith(PROXY_PREFIX)) contextUrl = c.url;
                }
                if (!contextUrl) {
                    const c = clients.find(c => new URL(c.url).pathname.startsWith(PROXY_PREFIX));
                    if (c) contextUrl = c.url;
                }

                if (contextUrl) {
                    try {
                        const clientPath = new URL(contextUrl).pathname;
                        const targetOrigin = new URL(decodeURIComponent(clientPath.substring(PROXY_PREFIX.length))).origin;
                        const corrected = `${self.location.origin}${PROXY_PREFIX}${encodeURIComponent(targetOrigin + assetPath)}`;

                        if (event.request.mode === 'navigate') return Response.redirect(corrected, 302);

                        let mode = event.request.mode;
                        if (mode === 'navigate' || mode === 'same-origin') mode = 'cors';
                        const opts = { method: event.request.method, headers: event.request.headers, mode };
                        if (!['GET', 'HEAD'].includes(event.request.method)) {
                            opts.body = event.request.body;
                            if (event.request.body) opts.duplex = 'half';
                        }
                        return fetch(corrected, opts);
                    } catch(e) {}
                }
                return fetch(event.request);
            }).catch(err =>
                new Response(generateErrorPage(err.message, 502), { status: 502, headers: { 'Content-Type': 'text/html' } })
            )
        );
        return;
    }
});
