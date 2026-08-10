// ==UserScript==
// @name         Bitrix24 task comments to Obsidian Daily Notes
// @namespace    bitrix24-obsidian-exporter
// @version      1.0.0
// @description  Appends successfully submitted Bitrix24 task comments to the current Obsidian daily note.
// @include      /^https:\/\/[^/]+\.bitrix24\.(?:com(?:\.br)?|ru|by|kz|ua|eu|de|fr|it|pl|es|in|tr|cn)\//
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
    'use strict';

    const DAILY_NOTE_DIRECTORY = '03-Daily';
    const TASK_COMMENT_ACTIONS = new Set([
        'tasks.task.comment.add',
        'task.commentitem.add',
        'tasks.task.chat.message.send',
    ]);

    const nativeFetch = window.fetch?.bind(window);
    const nativeXhrOpen = XMLHttpRequest.prototype.open;
    const nativeXhrSend = XMLHttpRequest.prototype.send;
    const xhrRequests = new WeakMap();

    function pad(number) {
        return String(number).padStart(2, '0');
    }

    function dailyNotePath(date) {
        return `${DAILY_NOTE_DIRECTORY}/${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.md`;
    }

    function formatEntry(comment, date) {
        const value = comment.replace(/\s*\r?\n\s*/g, ' ').trim();
        return `\n- ${pad(date.getHours())}:${pad(date.getMinutes())} ${value}`;
    }

    function openObsidian(comment) {
        const date = new Date();
        const parameters = new URLSearchParams({
            file: dailyNotePath(date),
            content: formatEntry(comment, date),
            append: 'true',
        });

        window.location.assign(`obsidian://new?${parameters.toString()}`);
    }

    function parseStringBody(body) {
        const trimmed = body.trim();
        if (!trimmed) {
            return null;
        }

        try {
            return JSON.parse(trimmed);
        } catch {
            return new URLSearchParams(trimmed);
        }
    }

    async function parseBody(body) {
        if (body == null) {
            return null;
        }
        if (typeof body === 'string') {
            return parseStringBody(body);
        }
        if (body instanceof URLSearchParams || body instanceof FormData) {
            return body;
        }
        if (body instanceof Blob) {
            return parseStringBody(await body.text());
        }
        if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
            const bytes = body instanceof ArrayBuffer
                ? new Uint8Array(body)
                : new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
            return parseStringBody(new TextDecoder().decode(bytes));
        }
        if (typeof body === 'object') {
            return body;
        }
        return null;
    }

    function entriesOf(value) {
        if (value instanceof URLSearchParams || value instanceof FormData) {
            return Array.from(value.entries());
        }
        return value && typeof value === 'object' ? Object.entries(value) : [];
    }

    function findValue(payload, keyPattern) {
        const queue = [payload];
        const visited = new Set();

        while (queue.length > 0) {
            const current = queue.shift();
            if (!current || typeof current !== 'object' || visited.has(current)) {
                continue;
            }
            visited.add(current);

            for (const [key, value] of entriesOf(current)) {
                if (keyPattern.test(key) && typeof value === 'string' && value.trim()) {
                    return value;
                }
                if (value && typeof value === 'object') {
                    queue.push(value);
                }
            }
        }

        return null;
    }

    function actionFrom(url, payload) {
        let parsedUrl;
        try {
            parsedUrl = new URL(url, window.location.href);
        } catch {
            return null;
        }

        const queryAction = parsedUrl.searchParams.get('action');
        if (queryAction) {
            return queryAction.toLowerCase().replace(/\.json$/i, '');
        }

        const bodyAction = findValue(payload, /(?:^|\[)action\]?$/i);
        if (bodyAction) {
            return bodyAction.toLowerCase().replace(/\.json$/i, '');
        }

        const pathMatch = parsedUrl.pathname.match(/(?:^|\/)(tasks\.task\.comment\.add|task\.commentitem\.add|tasks\.task\.chat\.message\.send)(?:\.json)?(?:$|\/)/i);
        return pathMatch?.[1].toLowerCase() ?? null;
    }

    function commentFrom(payload, action) {
        const postMessage = findValue(payload, /(?:^|\[)post_message\]?$/i);
        if (postMessage) {
            return postMessage;
        }

        if (action === 'tasks.task.chat.message.send') {
            return findValue(payload, /(?:^|\[)(?:message|text)\]?$/i);
        }

        return null;
    }

    async function taskComment(url, method, body) {
        if (String(method || 'GET').toUpperCase() !== 'POST') {
            return null;
        }

        const payload = await parseBody(body);
        const action = actionFrom(url, payload);
        if (!TASK_COMMENT_ACTIONS.has(action)) {
            return null;
        }

        return commentFrom(payload, action);
    }

    function apiResponseSucceeded(payload) {
        if (!payload || typeof payload !== 'object') {
            return true;
        }

        return String(payload.status ?? '').toLowerCase() !== 'error'
            && !payload.error
            && !(Array.isArray(payload.errors) && payload.errors.length > 0);
    }

    async function fetchResponseSucceeded(response) {
        if (!response.ok) {
            return false;
        }

        try {
            return apiResponseSucceeded(await response.clone().json());
        } catch {
            return true;
        }
    }

    async function fetchBody(input, init) {
        if (init?.body != null) {
            return init.body;
        }
        if (typeof Request !== 'undefined' && input instanceof Request) {
            try {
                return await input.clone().text();
            } catch {
                return null;
            }
        }
        return null;
    }

    if (nativeFetch) {
        window.fetch = function interceptedFetch(input, init) {
            const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
            const method = init?.method ?? input?.method ?? 'GET';
            const commentPromise = fetchBody(input, init).then((body) => taskComment(url, method, body));
            const responsePromise = nativeFetch(input, init);

            void Promise.all([commentPromise, responsePromise])
                .then(async ([comment, response]) => {
                    if (comment && await fetchResponseSucceeded(response)) {
                        openObsidian(comment);
                    }
                })
                .catch(() => {});

            return responsePromise;
        };
    }

    XMLHttpRequest.prototype.open = function interceptedOpen(method, url, ...rest) {
        xhrRequests.set(this, { method, url: String(url), body: null });
        return nativeXhrOpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function interceptedSend(body) {
        const request = xhrRequests.get(this);
        if (request) {
            request.body = body;
            this.addEventListener('loadend', async () => {
                if (this.status < 200 || this.status >= 300) {
                    return;
                }

                const comment = await taskComment(request.url, request.method, request.body);
                if (!comment) {
                    return;
                }

                let payload = null;
                try {
                    payload = this.responseType === 'json' ? this.response : JSON.parse(this.responseText);
                } catch {
                    // A successful non-JSON response is accepted.
                }

                if (apiResponseSucceeded(payload)) {
                    openObsidian(comment);
                }
            }, { once: true });
        }

        return nativeXhrSend.call(this, body);
    };
})();
