const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const script = readFileSync('bitrix24-obsidian-exporter.user.js', 'utf8');
const endpoint = 'https://acme.bitrix24.ru/bitrix/services/main/ajax.php?c=bitrix%3Aforum.comments&action=processcomment';
const commentBody = 'ENTITY_XML_ID=TASK_42&ENTITY_TYPE=TK&action=ADD&POST_MESSAGE=exported+comment';

function createEnvironment({ payload = { status: 'success' } } = {}) {
    const openedUris = [];
    const storage = new Map();
    const eventListeners = new WeakMap();

    class MockXMLHttpRequest {
        constructor() {
            this.status = 200;
            this.responseType = '';
            this.responseText = JSON.stringify(payload);
        }

        open(method, url) {
            this.method = method;
            this.url = url;
        }

        send(body) {
            this.body = body;
            for (const listener of eventListeners.get(this) ?? []) {
                listener.callback.call(this);
            }
        }

        addEventListener(type, callback, options) {
            if (type !== 'loadend') {
                return;
            }
            const listeners = eventListeners.get(this) ?? [];
            listeners.push({ callback, once: options?.once });
            eventListeners.set(this, listeners);
        }
    }

    const document = {
        body: { append() {} },
        documentElement: { append() {} },
        createElement() {
            return {
                style: {},
                append() {},
                remove() {},
                click() {
                    openedUris.push(this.href);
                },
            };
        },
        getElementById() {
            return null;
        },
        querySelector() {
            return null;
        },
        querySelectorAll() {
            return [];
        },
    };
    const window = {
        document,
        location: { href: 'https://acme.bitrix24.ru/tasks/task/view/42/' },
        sessionStorage: {
            getItem(key) {
                return storage.get(key) ?? null;
            },
            setItem(key, value) {
                storage.set(key, value);
            },
        },
        setTimeout() {},
        async fetch() {
            return new Response(JSON.stringify(payload), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            });
        },
    };
    window.top = window;

    vm.runInNewContext(script, {
        Request,
        Response,
        URL,
        URLSearchParams,
        WeakMap,
        XMLHttpRequest: MockXMLHttpRequest,
        console: { info() {}, warn() {} },
        document,
        window,
    });

    return { MockXMLHttpRequest, openedUris, window };
}

function assertExported(uri) {
    assert.ok(uri?.startsWith('obsidian://new?'), 'Obsidian URI should be opened');
    const query = new URL(uri).searchParams;
    assert.match(query.get('file'), /^03-Daily\/\d{4}-\d{2}-\d{2}\.md$/);
    assert.match(query.get('content'), /#task\/42 exported comment/);
}

test('exports a successful task comment sent through XMLHttpRequest', () => {
    const { MockXMLHttpRequest, openedUris } = createEnvironment();
    const xhr = new MockXMLHttpRequest();

    xhr.open('POST', endpoint);
    xhr.send(commentBody);

    assertExported(openedUris[0]);
    assert.equal(openedUris.length, 1);
});

test('exports a successful task comment sent through fetch without consuming the response', async () => {
    const { openedUris, window } = createEnvironment();

    const response = await window.fetch(endpoint, { method: 'POST', body: commentBody });

    assertExported(openedUris[0]);
    assert.deepEqual(await response.json(), { status: 'success' });
});

test('does not export a Bitrix-rejected comment sent through XMLHttpRequest', () => {
    const { MockXMLHttpRequest, openedUris } = createEnvironment({ payload: { status: 'error' } });
    const xhr = new MockXMLHttpRequest();

    xhr.open('POST', endpoint);
    xhr.send(commentBody);

    assert.equal(openedUris.length, 0);
});

test('does not export a Bitrix-rejected comment sent through fetch', async () => {
    const { openedUris, window } = createEnvironment({ payload: { status: 'error' } });

    await window.fetch(endpoint, { method: 'POST', body: commentBody });

    assert.equal(openedUris.length, 0);
});
