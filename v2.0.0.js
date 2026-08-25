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
            libcurl.onload = function() {
                libcurlReady = true;
            };
        }
        return true;
    }
    return false;
}

checkLibcurlReady();

if (!libcurlReady) {
    var checkInterval = setInterval(function() {
        libcurlLoadAttempts++;
        if (checkLibcurlReady() || libcurlLoadAttempts >= MAX_LIBCURL_ATTEMPTS) {
            clearInterval(checkInterval);
        }
    }, 500);
}

var XORCoder = function() {
    this.keys = XOR_KEYS;
};

XORCoder.prototype.encode = function(str) {
    if (!str) return str;
    try {
        var bytes = new TextEncoder().encode(str);
        var encoded = new Uint8Array(bytes.length);
        for (var i = 0; i < bytes.length; i++) {
            encoded[i] = bytes[i] ^ this.keys[i % this.keys.length];
        }
        return btoa(String.fromCharCode.apply(null, encoded));
    } catch (e) {
        return str;
    }
};

XORCoder.prototype.decode = function(encoded) {
    if (!encoded) return encoded;
    try {
        var binary = atob(encoded);
        var bytes = new Uint8Array(binary.length);
        for (var i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i) ^ this.keys[i % this.keys.length];
        }
        return new TextDecoder().decode(bytes);
    } catch (e) {
        return encoded;
    }
};

XORCoder.prototype.safeDecode = function(encoded) {
    if (!encoded) return encoded;
    try {
        var decoded = this.decode(encoded);
        if (decoded && (decoded.startsWith('http://') || decoded.startsWith('https://') ||
                        decoded.startsWith('ws://') || decoded.startsWith('wss://') ||
                        decoded.startsWith('//') || decoded.indexOf('.') !== -1)) {
            return decoded;
        }
        try {
            var uriDecoded = decodeURIComponent(encoded);
            if (uriDecoded && (uriDecoded.startsWith('http://') || uriDecoded.startsWith('https://') ||
                              uriDecoded.startsWith('ws://') || uriDecoded.startsWith('wss://') ||
                              uriDecoded.startsWith('//') || uriDecoded.indexOf('.') !== -1)) {
                return uriDecoded;
            }
        } catch(e) {}
        return encoded;
    } catch(e) {
        return encoded;
    }
};

var xorCoder = new XORCoder();

var CookieJar = function() {
    this.cookieStore = new Map();
    this.cookieMetadata = new Map();
};

CookieJar.prototype.getDomainKey = function(url) {
    try {
        var urlObj = new URL(url);
        var hostname = urlObj.hostname;
        if (hostname.match(/^\d+\.\d+\.\d+\.\d+$/)) {
            return hostname;
        }
        var parts = hostname.split('.');
        if (parts.length > 2) {
            var publicSuffixes = ['com', 'org', 'net', 'gov', 'edu', 'co', 'uk', 'au', 'ca', 'de', 'fr', 'jp', 'cn', 'ru', 'br', 'in', 'it', 'nl', 'es', 'se', 'no', 'fi', 'dk', 'pl', 'cz', 'at', 'ch', 'be', 'ie', 'nz', 'za', 'mx', 'ar', 'cl', 'pe', 've', 'my', 'ph', 'sg', 'th', 'vn', 'id', 'tr', 'gr', 'pt', 'il', 'sa', 'ae', 'eg', 'ng', 'ke', 'gh', 'za', 'ma', 'dz', 'tn', 'jo', 'lb', 'kw', 'bh', 'qa', 'om', 'ye', 'sy', 'iq', 'ly', 'sd', 'so', 'dj', 'er', 'et', 'tz', 'ug', 'zm', 'zw', 'mw', 'mz', 'ao', 'cm', 'ci', 'sn', 'ml', 'bf', 'ne', 'td', 'cf', 'cg', 'ga', 'gq', 'st', 'cv', 'sc', 'mu', 'km', 'mg', 're', 'yt', 'tf', 'wf', 'pf', 'nc', 'vu', 'sb', 'ki', 'tv', 'nr', 'pw', 'fm', 'mh', 'to', 'ws', 'fj', 'pg', 'tl', 'bn', 'kh', 'la', 'mm', 'bt', 'np', 'mv', 'lk', 'bd', 'pk', 'af', 'tj', 'tm', 'kg', 'uz', 'az', 'ge', 'am', 'md', 'ua', 'by', 'lt', 'lv', 'ee', 'si', 'hr', 'ba', 'rs', 'me', 'mk', 'al', 'bg', 'ro', 'hu', 'sk'];
            var lastPart = parts[parts.length - 1];
            if (publicSuffixes.indexOf(lastPart) !== -1) {
                return parts.slice(-2).join('.');
            }
            return parts.slice(-2).join('.');
        }
        return hostname;
    } catch (e) {
        return 'default';
    }
};

CookieJar.prototype.parseCookieString = function(cookieStr) {
    var cookies = [];
    if (!cookieStr) return cookies;
    
    var cookieParts = cookieStr.split(';');
    var mainCookie = null;
    var attributes = {};
    
    cookieParts.forEach(function(part, index) {
        var trimmed = part.trim();
        if (!trimmed) return;
        
        var parts = trimmed.split('=');
        var name = parts[0].trim();
        var value = parts.slice(1).join('=');
        
        if (index === 0) {
            mainCookie = { name: name, value: value };
        } else {
            var attrName = name.toLowerCase();
            if (attrName === 'expires') {
                attributes.expires = new Date(value);
            } else if (attrName === 'max-age') {
                var maxAge = parseInt(value);
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
        var cookie = mainCookie;
        for (var key in attributes) {
            cookie[key] = attributes[key];
        }
        cookies.push(cookie);
    }
    
    return cookies;
};

CookieJar.prototype.setCookies = function(url, cookieString) {
    var domain = this.getDomainKey(url);
    if (!domain) return;
    
    if (!this.cookieStore.has(domain)) {
        this.cookieStore.set(domain, new Map());
        this.cookieMetadata.set(domain, new Map());
    }
    
    var domainCookies = this.cookieStore.get(domain);
    var domainMetadata = this.cookieMetadata.get(domain);
    var parsedCookies = this.parseCookieString(cookieString);
    
    parsedCookies.forEach(function(cookie) {
        if (!cookie.name) return;
        
        if (cookie.expires && cookie.expires < new Date()) {
            domainCookies.delete(cookie.name);
            domainMetadata.delete(cookie.name);
            return;
        }
        
        domainCookies.set(cookie.name, cookie.value);
        
        var metadata = {
            expires: cookie.expires || null,
            domain: cookie.domain || domain,
            path: cookie.path || '/',
            secure: cookie.secure || false,
            httpOnly: cookie.httpOnly || false,
            sameSite: cookie.sameSite || 'Lax'
        };
        domainMetadata.set(cookie.name, metadata);
    });
};

CookieJar.prototype.getCookies = function(url, cookieNames) {
    var domain = this.getDomainKey(url);
    if (!domain || !this.cookieStore.has(domain)) return '';
    
    var domainCookies = this.cookieStore.get(domain);
    var domainMetadata = this.cookieMetadata.get(domain);
    var cookiePairs = [];
    
    var toRemove = [];
    for (var [name, metadata] of domainMetadata) {
        if (metadata.expires && metadata.expires < new Date()) {
            toRemove.push(name);
        }
    }
    toRemove.forEach(function(name) {
        domainCookies.delete(name);
        domainMetadata.delete(name);
    });
    
    if (cookieNames) {
        var names = Array.isArray(cookieNames) ? cookieNames : [cookieNames];
        names.forEach(function(name) {
            if (domainCookies.has(name)) {
                cookiePairs.push(name + '=' + domainCookies.get(name));
            }
        });
    } else {
        var urlPath = new URL(url).pathname || '/';
        for (var [name, value] of domainCookies) {
            var metadata = domainMetadata.get(name);
            if (metadata) {
                if (metadata.path && urlPath.indexOf(metadata.path) !== 0) {
                    continue;
                }
                if (metadata.secure && new URL(url).protocol !== 'https:') {
                    continue;
                }
            }
            cookiePairs.push(name + '=' + value);
        }
    }
    
    return cookiePairs.join('; ');
};

var cookieJar = new CookieJar();

var REWRITER_SCRIPT = `(function() {
    'use strict';
    
    if (window.__rewriter_initialized) return;
    window.__rewriter_initialized = true;

    var PROXY_PREFIX = '/go/';
    var PROXY_HOST = window.location.host;
    var PROXY_ORIGIN = window.location.origin;

    var XOR_KEYS = [0x5A, 0x3C, 0xF1];

    function xorEncode(str) {
        if (!str) return str;
        try {
            var bytes = new TextEncoder().encode(str);
            var encoded = new Uint8Array(bytes.length);
            for (var i = 0; i < bytes.length; i++) {
                encoded[i] = bytes[i] ^ XOR_KEYS[i % XOR_KEYS.length];
            }
            return btoa(String.fromCharCode.apply(null, encoded));
        } catch (e) {
            return str;
        }
    }

    function xorDecode(encoded) {
        if (!encoded) return encoded;
        try {
            var binary = atob(encoded);
            var bytes = new Uint8Array(binary.length);
            for (var i = 0; i < binary.length; i++) {
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
            var decoded = xorDecode(encoded);
            if (decoded && (decoded.startsWith('http://') || decoded.startsWith('https://') || 
                           decoded.startsWith('ws://') || decoded.startsWith('wss://') ||
                           decoded.startsWith('//') || decoded.indexOf('.') !== -1)) {
                return decoded;
            }
            try {
                var uriDecoded = decodeURIComponent(encoded);
                if (uriDecoded && (uriDecoded.startsWith('http://') || uriDecoded.startsWith('https://') ||
                                  uriDecoded.startsWith('ws://') || uriDecoded.startsWith('wss://') ||
                                  uriDecoded.startsWith('//') || uriDecoded.indexOf('.') !== -1)) {
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
            var currentRemoteHref = getCurrentRemoteHref();
            var url = new URL(urlStr, currentRemoteHref);

            if (url.origin === window.location.origin && 
                url.pathname.substr(0, PROXY_PREFIX.length) === PROXY_PREFIX) {
                return urlStr;
            }

            if (url.protocol !== "http:" && url.protocol !== "https:" && 
                url.protocol !== "ws:" && url.protocol !== "wss:") {
                return urlStr;
            }

            if (url.hostname === window.location.hostname) {
                var currentRemoteUrl = new URL(currentRemoteHref);
                url.host = currentRemoteUrl.host;
                url.protocol = currentRemoteUrl.protocol;
            }

            var encoded = xorEncode(url.href);
            return PROXY_PREFIX + encoded;
        } catch (e) {
            return urlStr;
        }
    }

    function unfixUrl(urlStr) {
        if (!urlStr || typeof urlStr !== 'string') return urlStr;
        if (urlStr.indexOf(PROXY_PREFIX) !== -1) {
            try {
                var parts = urlStr.split(PROXY_PREFIX);
                var encoded = parts[parts.length - 1];
                var decoded = safeXorDecode(encoded);
                if (decoded && decoded !== encoded) {
                    return decoded;
                }
            } catch (e) {}
        }
        return urlStr;
    }

    function patchXMLHttpRequest() {
        if (!window.XMLHttpRequest) return;
        var _XMLHttpRequest = window.XMLHttpRequest;

        window.XMLHttpRequest = function(opts) {
            var xhr = new _XMLHttpRequest(opts);
            var _open = xhr.open;
            xhr.open = function() {
                var args = Array.prototype.slice.call(arguments);
                args[1] = fixUrl(args[1]);
                return _open.apply(xhr, args);
            };
            return xhr;
        };
        window.XMLHttpRequest.prototype = _XMLHttpRequest.prototype;
    }

    function patchFetch() {
        if (!window.fetch) return;
        var _fetch = window.fetch;

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
        var _createElement = window.document.createElement;

        window.document.createElement = function(tagName, options) {
            var element = _createElement.call(window.document, tagName, options);
            var tag = tagName.toLowerCase();
            
            var srcTags = ['img', 'script', 'iframe', 'audio', 'video', 'embed', 'source', 'track'];
            if (srcTags.indexOf(tag) !== -1) {
                var originalSetAttribute = element.setAttribute;
                element.setAttribute = function(name, value) {
                    if (name.toLowerCase() === 'src' && typeof value === 'string') {
                        value = fixUrl(value);
                    }
                    return originalSetAttribute.call(this, name, value);
                };
                var originalGetAttribute = element.getAttribute;
                element.getAttribute = function(name) {
                    var val = originalGetAttribute.call(this, name);
                    if (name.toLowerCase() === 'src' && val) {
                        return unfixUrl(val) || val;
                    }
                    return val;
                };
                var srcDescriptor = Object.getOwnPropertyDescriptor(element, 'src');
                if (srcDescriptor) {
                    var srcGetter = srcDescriptor.get;
                    var srcSetter = srcDescriptor.set;
                    Object.defineProperty(element, 'src', {
                        get: function() {
                            var val = srcGetter.call(this);
                            return unfixUrl(val) || val;
                        },
                        set: function(value) {
                            srcSetter.call(this, fixUrl(value));
                        },
                        configurable: true
                    });
                }
            }
            
            var hrefTags = ['a', 'link', 'area', 'base'];
            if (hrefTags.indexOf(tag) !== -1) {
                var originalSetAttribute = element.setAttribute;
                element.setAttribute = function(name, value) {
                    if (name.toLowerCase() === 'href' && typeof value === 'string') {
                        value = fixUrl(value);
                    }
                    return originalSetAttribute.call(this, name, value);
                };
                var originalGetAttribute = element.getAttribute;
                element.getAttribute = function(name) {
                    var val = originalGetAttribute.call(this, name);
                    if (name.toLowerCase() === 'href' && val) {
                        return unfixUrl(val) || val;
                    }
                    return val;
                };
                var hrefDescriptor = Object.getOwnPropertyDescriptor(element, 'href');
                if (hrefDescriptor) {
                    var hrefGetter = hrefDescriptor.get;
                    var hrefSetter = hrefDescriptor.set;
                    Object.defineProperty(element, 'href', {
                        get: function() {
                            var val = hrefGetter.call(this);
                            return unfixUrl(val) || val;
                        },
                        set: function(value) {
                            hrefSetter.call(this, fixUrl(value));
                        },
                        configurable: true
                    });
                }
            }
            
            if (tag === 'form') {
                var originalSetAttribute = element.setAttribute;
                element.setAttribute = function(name, value) {
                    if (name.toLowerCase() === 'action' && typeof value === 'string') {
                        value = fixUrl(value);
                    }
                    return originalSetAttribute.call(this, name, value);
                };
                var originalGetAttribute = element.getAttribute;
                element.getAttribute = function(name) {
                    var val = originalGetAttribute.call(this, name);
                    if (name.toLowerCase() === 'action' && val) {
                        return unfixUrl(val) || val;
                    }
                    return val;
                };
                var actionDescriptor = Object.getOwnPropertyDescriptor(element, 'action');
                if (actionDescriptor) {
                    var actionGetter = actionDescriptor.get;
                    var actionSetter = actionDescriptor.set;
                    Object.defineProperty(element, 'action', {
                        get: function() {
                            var val = actionGetter.call(this);
                            return unfixUrl(val) || val;
                        },
                        set: function(value) {
                            actionSetter.call(this, fixUrl(value));
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
        var _WebSocket = window.WebSocket;

        window.WebSocket = function(url, protocols) {
            var fixedUrl = url;
            if (typeof url === 'string' && url.indexOf(PROXY_PREFIX) === -1) {
                fixedUrl = fixUrl(url);
            }
            return new _WebSocket(fixedUrl, protocols);
        };
        window.WebSocket.prototype = _WebSocket.prototype;
        
        for (var key in _WebSocket) {
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

        var _pushState = window.history.pushState;
        window.history.pushState = function(state, title, url) {
            if (url) {
                url = fixUrl(url);
            }
            return _pushState.call(window.history, state, title, url);
        };

        if (!window.history.replaceState) return;
        var _replaceState = window.history.replaceState;
        window.history.replaceState = function(state, title, url) {
            if (url) {
                url = fixUrl(url);
            }
            return _replaceState.call(window.history, state, title, url);
        };
    }

    function patchLocation() {
        var location = window.location;
        var locationProxy = {
            get href() {
                return location.href;
            },
            set href(value) {
                location.href = fixUrl(value);
            },
            get protocol() { return location.protocol; },
            set protocol(value) { location.protocol = value; },
            get host() { return location.host; },
            set host(value) { location.host = value; },
            get hostname() { return location.hostname; },
            set hostname(value) { location.hostname = value; },
            get port() { return location.port; },
            set port(value) { location.port = value; },
            get pathname() { return location.pathname; },
            set pathname(value) { location.pathname = value; },
            get search() { return location.search; },
            set search(value) { location.search = value; },
            get hash() { return location.hash; },
            set hash(value) { location.hash = value; },
            get origin() { return location.origin; },
            get ancestorOrigins() { return location.ancestorOrigins; },
            reload: function() { return location.reload(); },
            replace: function(url) { return location.replace(fixUrl(url)); },
            assign: function(url) { return location.assign(fixUrl(url)); },
            toString: function() { return location.href; }
        };

        try {
            window.location = locationProxy;
        } catch(e) {}

        try {
            document.location = locationProxy;
        } catch(e) {}
    }

    function patchWindowOpen() {
        var _open = window.open;
        window.open = function(url, target, features) {
            if (url && typeof url === 'string') {
                url = fixUrl(url);
            }
            return _open.call(this, url, target, features);
        };
    }

    function patchDocumentCookie() {
        var cookieDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
        if (cookieDescriptor) {
            var cookieGetter = cookieDescriptor.get;
            var cookieSetter = cookieDescriptor.set;
            Object.defineProperty(document, 'cookie', {
                get: function() {
                    return cookieGetter.call(this) || '';
                },
                set: function(value) {
                    cookieSetter.call(this, value);
                },
                configurable: true
            });
        }
    }

    function handleFormSubmission(form, event) {
        try {
            if (!form) return false;
            
            var action = form.getAttribute('action') || window.location.href;
            var method = (form.getAttribute('method') || 'GET').toUpperCase();
            var enctype = form.getAttribute('enctype') || 'application/x-www-form-urlencoded';
            var formData = new FormData(form);
            
            action = fixUrl(action);
            form.setAttribute('action', action);
            
            if (method === 'GET') {
                var url = new URL(action);
                for (var entry of formData.entries()) {
                    var key = entry[0];
                    var value = entry[1];
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
                .then(function(response) {
                    if (response.redirected) {
                        window.location.href = response.url;
                        return;
                    }
                    return response.text().then(function(html) {
                        var contentType = response.headers.get('content-type') || '';
                        if (contentType.indexOf('text/html') !== -1) {
                            document.open();
                            document.write(html);
                            document.close();
                            if (window.history && window.history.pushState) {
                                window.history.pushState({}, '', url.href);
                            }
                        }
                    });
                })
                .catch(function() {
                    window.location.href = url.href;
                });
                
                return true;
            }
            
            if (['POST', 'PUT', 'DELETE', 'PATCH'].indexOf(method) !== -1) {
                if (event) {
                    event.preventDefault();
                    event.stopPropagation();
                }
                
                var options = {
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
                    var params = new URLSearchParams();
                    for (var entry of formData.entries()) {
                        var key = entry[0];
                        var value = entry[1];
                        if (typeof value === 'string') {
                            params.append(key, value);
                        }
                    }
                    options.body = params.toString();
                } else if (enctype === 'application/json') {
                    options.headers['Content-Type'] = 'application/json';
                    var json = {};
                    for (var entry of formData.entries()) {
                        json[entry[0]] = entry[1];
                    }
                    options.body = JSON.stringify(json);
                } else {
                    options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
                    var params = new URLSearchParams();
                    for (var entry of formData.entries()) {
                        var key = entry[0];
                        var value = entry[1];
                        if (typeof value === 'string') {
                            params.append(key, value);
                        }
                    }
                    options.body = params.toString();
                }
                
                fetch(action, options)
                    .then(function(response) {
                        if (response.redirected) {
                            window.location.href = response.url;
                            return;
                        }
                        return response.text().then(function(html) {
                            var contentType = response.headers.get('content-type') || '';
                            if (contentType.indexOf('text/html') !== -1) {
                                document.open();
                                document.write(html);
                                document.close();
                            }
                        });
                    })
                    .catch(function() {});
                
                return true;
            }
            
            return false;
        } catch(e) {
            return false;
        }
    }

    function patchForms() {
        document.addEventListener('submit', function(event) {
            var form = event.target;
            if (form && form.tagName && form.tagName.toLowerCase() === 'form') {
                if (form.dataset.intercepted) return;
                form.dataset.intercepted = 'true';
                handleFormSubmission(form, event);
            }
        }, true);

        var _submit = HTMLFormElement.prototype.submit;
        HTMLFormElement.prototype.submit = function() {
            if (this.dataset && this.dataset.intercepted === 'true') {
                return _submit.call(this);
            }
            if (this.dataset) {
                this.dataset.intercepted = 'true';
            }
            var handled = handleFormSubmission(this);
            if (!handled) {
                if (this.dataset) {
                    delete this.dataset.intercepted;
                }
                return _submit.call(this);
            }
        };
    }

    function patchSetAttribute() {
        var _setAttribute = Element.prototype.setAttribute;
        Element.prototype.setAttribute = function(name, value) {
            var attr = name.toLowerCase();
            if (['href', 'src', 'action', 'formaction', 'data'].indexOf(attr) !== -1) {
                if (typeof value === 'string' && value.indexOf('/rewriter.js') === -1) {
                    value = fixUrl(value);
                }
            }
            return _setAttribute.call(this, name, value);
        };
    }

    function preventBreakout() {
        try {
            window.top = window;
            window.parent = window;
            window.self = window;
            window.opener = null;
            window.frameElement = null;
        } catch(e) {}
    }

    function initialize() {
        try { patchXMLHttpRequest(); } catch(e) {}
        try { patchFetch(); } catch(e) {}
        try { patchCreateElement(); } catch(e) {}
        try { patchWebSockets(); } catch(e) {}
        try { patchHistory(); } catch(e) {}
        try { patchLocation(); } catch(e) {}
        try { patchWindowOpen(); } catch(e) {}
        try { patchDocumentCookie(); } catch(e) {}
        try { patchForms(); } catch(e) {}
        try { patchSetAttribute(); } catch(e) {}
        try { preventBreakout(); } catch(e) {}
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }
})();`;

self.addEventListener('install', function() { self.skipWaiting(); });
self.addEventListener('activate', function(e) { e.waitUntil(self.clients.claim()); });

self.addEventListener('fetch', function(event) {
    var requestUrl = new URL(event.request.url);

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

    if (requestUrl.pathname.indexOf(PROXY_PREFIX) === 0) {
        var encodedTarget = requestUrl.pathname.substring(PROXY_PREFIX.length);
        if (!encodedTarget) {
            event.respondWith(new Response('No target specified', { status: 400 }));
            return;
        }

        var handleRequest = function() {
            return new Promise(function(resolve, reject) {
                var checkReady = function() {
                    if (libcurlReady) {
                        resolve();
                    } else {
                        setTimeout(checkReady, 50);
                    }
                };
                checkReady();
            }).then(function() {
                var targetUrl;
                try {
                    var decoded = xorCoder.safeDecode(encodedTarget);
                    if (decoded && (decoded.startsWith('http://') || decoded.startsWith('https://'))) {
                        targetUrl = new URL(decoded);
                    } else {
                        targetUrl = new URL(decodeURIComponent(encodedTarget));
                    }
                } catch(e) {
                    targetUrl = new URL(decodeURIComponent(encodedTarget));
                }

                var cookies = cookieJar.getCookies(targetUrl.href);

                var modifiedHeaders = new Headers(event.request.headers);
                modifiedHeaders.delete('accept-encoding');
                modifiedHeaders.set('X-Proxy-Loop-Guard', 'true');

                if (cookies) {
                    modifiedHeaders.set('Cookie', cookies);
                }

                var fetchMode = event.request.mode;
                if (fetchMode === 'same-origin' || fetchMode === 'navigate') fetchMode = 'cors';

                var fetchOptions = {
                    method: event.request.method,
                    headers: modifiedHeaders,
                    redirect: 'follow',
                    mode: fetchMode,
                    credentials: 'omit'
                };

                if (['GET', 'HEAD'].indexOf(event.request.method) === -1) {
                    fetchOptions.body = event.request.body;
                    if (event.request.body) fetchOptions.duplex = 'half';
                }

                return libcurl.fetch(targetUrl.href, fetchOptions).then(function(response) {
                    var contentType = response.headers.get('content-type') || '';
                    var responseHeaders = new Headers(response.headers);

                    var setCookie = responseHeaders.get('set-cookie');
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
                        var loc = responseHeaders.get('location');
                        try {
                            var absoluteLoc = new URL(loc, targetUrl.href).href;
                            var encoded = xorCoder.encode(absoluteLoc);
                            responseHeaders.set('location', self.location.origin + PROXY_PREFIX + encoded);
                        } catch (e) {}
                    }

                    if (contentType.indexOf('text/html') !== -1) {
                        return response.text().then(function(html) {
                            var rewriterUrl = self.location.origin + '/rewriter.js';
                            var injectorScript = '<script src="' + rewriterUrl + '"></script>';

                            if (html.match(/<head>/i)) {
                                html = html.replace(/<head>/i, '<head>' + injectorScript);
                            } else if (html.match(/<html>/i)) {
                                html = html.replace(/<html>/i, '<html>' + injectorScript);
                            } else {
                                html = injectorScript + html;
                            }

                            html = proxyTextContent(html, targetUrl.origin);
                            return new Response(html, {
                                status: response.status,
                                statusText: response.statusText,
                                headers: responseHeaders
                            });
                        });
                    }

                    if (contentType.indexOf('application/javascript') !== -1 || contentType.indexOf('text/css') !== -1) {
                        return response.text().then(function(text) {
                            text = proxyTextContent(text, targetUrl.origin);
                            return new Response(text, {
                                status: response.status,
                                statusText: response.statusText,
                                headers: responseHeaders
                            });
                        });
                    }

                    return new Response(response.body, {
                        status: response.status,
                        statusText: response.statusText,
                        headers: responseHeaders
                    });
                });
            }).catch(function(err) {
                return new Response(generateErrorPage(err.message, 502), {
                    status: 502,
                    headers: { 'Content-Type': 'text/html' }
                });
            });
        };

        event.respondWith(handleRequest());
        return;
    }

    event.respondWith(fetch(event.request));
});

function proxyTextContent(text, targetOrigin) {
    if (typeof text !== 'string') return text;

    try {
        var absoluteUrlPattern = /(https?:\/\/[a-zA-Z0-9\-._~:/?#[\]@!$&'()*+,;=]+)/g;
        var processed = text.replace(absoluteUrlPattern, function(match) {
            if (match.indexOf(PROXY_PREFIX) !== -1 || match.indexOf(self.location.origin) === 0) return match;
            if (match.indexOf('/rewriter.js') !== -1) return match;
            var encoded = xorCoder.encode(match);
            return self.location.origin + PROXY_PREFIX + encoded;
        });

        var attrPattern = /\b(href|src|action|formaction|data-url|data-href|data-src|navigation-url|codebase|archive|data|cite|longdesc|profile|usemap|manifest|ping|poster|background|icon|srcset|data|download|ping|integrity|referrerpolicy|sandbox|allow|allowfullscreen|allowpaymentrequest|loading|decoding|crossorigin|rel|type|media|sizes|as|fetchpriority|importance|blocking|nonce)=["']([^"']+)["']/gi;
        processed = processed.replace(attrPattern, function(match, attr, val) {
            if (val.indexOf('#') === 0 || val.indexOf('javascript:') === 0 || val.indexOf('data:') === 0 ||
                val.indexOf('blob:') === 0 || val.indexOf('about:') === 0 || val.indexOf(PROXY_PREFIX) !== -1) return match;
            if (val.indexOf('/rewriter.js') !== -1) return match;
            try {
                var resolved = new URL(val, targetOrigin).href;
                var encoded = xorCoder.encode(resolved);
                return attr + '="' + self.location.origin + PROXY_PREFIX + encoded + '"';
            } catch (e) {
                try {
                    var resolved = new URL(val, targetOrigin + '/').href;
                    var encoded = xorCoder.encode(resolved);
                    return attr + '="' + self.location.origin + PROXY_PREFIX + encoded + '"';
                } catch(e2) {
                    return match;
                }
            }
        });

        var cssUrlPattern = /url\(["']?([^"')]+)["']?\)/gi;
        processed = processed.replace(cssUrlPattern, function(match, url) {
            if (url.indexOf('data:') === 0 || url.indexOf('blob:') === 0 || url.indexOf(PROXY_PREFIX) !== -1) return match;
            if (url.indexOf('/rewriter.js') !== -1) return match;
            try {
                var resolved = new URL(url, targetOrigin).href;
                var encoded = xorCoder.encode(resolved);
                return 'url("' + self.location.origin + PROXY_PREFIX + encoded + '")';
            } catch (e) {
                try {
                    var resolved = new URL(url, targetOrigin + '/').href;
                    var encoded = xorCoder.encode(resolved);
                    return 'url("' + self.location.origin + PROXY_PREFIX + encoded + '")';
                } catch(e2) {
                    return match;
                }
            }
        });

        var srcsetPattern = /srcset=["']([^"']+)["']/gi;
        processed = processed.replace(srcsetPattern, function(match, srcset) {
            var parts = srcset.split(',').map(function(part) {
                var trimmed = part.trim();
                var urlParts = trimmed.split(/\s+/);
                var url = urlParts[0];
                var size = urlParts.slice(1).join(' ');
                try {
                    var resolved = new URL(url, targetOrigin).href;
                    var encoded = xorCoder.encode(resolved);
                    var newUrl = self.location.origin + PROXY_PREFIX + encoded;
                    return size ? newUrl + ' ' + size : newUrl;
                } catch(e) {
                    return trimmed;
                }
            });
            return 'srcset="' + parts.join(', ') + '"';
        });

        return processed;
    } catch(e) {
        return text;
    }
}

function generateErrorPage(errorMessage, status) {
    return '<!DOCTYPE html>\n<html>\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0">\n<title>Proxy Error</title>\n<style>\nbody { background: #111; color: #eee; font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; }\n.card { background: #1a1a1a; padding: 40px; border-radius: 12px; border: 1px solid #333; max-width: 500px; width: 100%; text-align: center; }\nh1 { color: #ff4a4a; font-size: 24px; margin-top: 0; }\np { color: #aaa; font-size: 15px; line-height: 1.6; margin-bottom: 25px; }\n.badge { background: #2a1b1b; color: #ff6b6b; padding: 6px 12px; border-radius: 4px; font-family: monospace; font-size: 13px; display: inline-block; margin-bottom: 20px; border: 1px solid #4a2222; }\nbutton { background: #0070f3; color: white; border: none; padding: 12px 24px; border-radius: 6px; font-weight: 600; cursor: pointer; font-size: 14px; transition: background 0.2s; }\nbutton:hover { background: #0051cb; }\n</style>\n</head>\n<body>\n<div class="card">\n<div class="badge">Status ' + (status || 502) + '</div>\n<h1>Failed to Load Page</h1>\n<p>' + (errorMessage || 'An error occurred while trying to load the page.') + '</p>\n<button onclick="window.location.reload()">Retry</button>\n</div>\n</body>\n</html>';
}
