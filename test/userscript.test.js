const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const script = readFileSync('bitrix24-obsidian-exporter.user.js', 'utf8');
const taskEndpoint = 'https://acme.bitrix24.ru/bitrix/services/main/ajax.php?action=tasks.v2.Task.get';
const sendEndpoint = 'https://acme.bitrix24.ru/bitrix/services/main/ajax.php?action=im.v2.Chat.Message.send';
const messageBody = 'dialogId=chat11784&fields%5Bmessage%5D=exported+message';

function createEnvironment({ payload = { status: 'success', data: { id: 1376900 } }, settings, isTopFrame = true, hasTaskFrame = false } = {}) {
    const openedUris = [];
    const storage = new Map();
    const scriptStorage = new Map();
    const eventListeners = new WeakMap();

    if (settings) {
        scriptStorage.set('bitrix24-obsidian:settings', settings);
    }

    class MockXMLHttpRequest {
        constructor() {
            this.status = 200;
            this.responseType = '';
            this.responseText = '';
            this.response = null;
        }

        open(method, url) {
            this.method = method;
            this.url = url;
        }

        send(body) {
            this.body = body;
            const result = this.url?.includes('tasks.v2.Task.get')
                ? { status: 'success', data: { id: 42, chatId: 11784 } }
                : payload;
            this.responseText = JSON.stringify(result);
            this.response = result;
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

    class MockTaskFrameXMLHttpRequest extends MockXMLHttpRequest {
        open(method, url) {
            return super.open(method, url);
        }

        send(body) {
            return super.send(body);
        }
    }

    let taskFrame = null;
    let taskFrameWindow = null;

    const attributes = new Set();
    const documentElement = {
        append() {},
        hasAttribute(name) {
            return attributes.has(name);
        },
        setAttribute(name) {
            attributes.add(name);
        },
    };
    const document = {
        body: { append() {} },
        documentElement,
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
        querySelector(selector) {
            return selector === '.tasks-full-card[data-task-id="42"] .tasks-full-card-chat' ? {} : null;
        },
        querySelectorAll(selector) {
            return selector === 'iframe' && taskFrame ? [taskFrame] : [];
        },
        addEventListener() {},
    };
    const window = {
        document,
        location: { href: 'https://acme.bitrix24.ru/tasks/task/view/42/', origin: 'https://acme.bitrix24.ru' },
        sessionStorage: {
            getItem(key) {
                return storage.get(key) ?? null;
            },
            setItem(key, value) {
                storage.set(key, value);
            },
        },
        setTimeout() {},
        XMLHttpRequest: MockXMLHttpRequest,
        async fetch(url) {
            const result = String(url).includes('tasks.v2.Task.get')
                ? { status: 'success', data: { id: 42, chatId: 11784 } }
                : payload;
            return new Response(JSON.stringify(result), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            });
        },
    };
    window.top = isTopFrame ? window : { document };
    if (hasTaskFrame) {
        taskFrameWindow = {
            document,
            XMLHttpRequest: MockTaskFrameXMLHttpRequest,
            fetch: window.fetch,
        };
        taskFrame = {
            tagName: 'IFRAME',
            src: 'https://acme.bitrix24.ru/company/personal/user/1/tasks/task/view/42/?IFRAME=Y&IFRAME_TYPE=SIDE_SLIDER',
            contentWindow: taskFrameWindow,
        };
    }


    const context = {
        Request,
        Response,
        URL,
        URLSearchParams,
        WeakMap,
        XMLHttpRequest: MockXMLHttpRequest,
        GM_getValue(key, defaultValue) {
            return scriptStorage.get(key) ?? defaultValue;
        },
        GM_setValue(key, value) {
            scriptStorage.set(key, value);
        },
        GM_registerMenuCommand() {},
        console: { info() {}, warn() {} },
        document,
        window,
    };
    vm.runInNewContext(script, context);

    return {
        MockXMLHttpRequest,
        taskFrameWindow,
        openedUris,
        window,
    };
}

function assertExported(uri) {
    assert.ok(uri?.startsWith('obsidian://new?'), 'Obsidian URI should be opened');
    const query = new URL(uri).searchParams;
    assert.match(query.get('file'), /^03-Daily\/\d{4}-\d{2}-\d{2}\.md$/);
    assert.match(query.get('content'), /#task\/42 exported message/);
}

function send(Xhr, url, body) {
    const xhr = new Xhr();
    xhr.open('POST', url);
    xhr.send(body);
    return xhr;
}

test('does not export from an independently injected nested frame', () => {
    const nested = createEnvironment({ isTopFrame: false });
    send(nested.MockXMLHttpRequest, taskEndpoint);
    send(nested.MockXMLHttpRequest, sendEndpoint, messageBody);
    assert.equal(nested.openedUris.length, 0);
});

test('exports only confirmed messages from the task-linked chat', () => {
    const { MockXMLHttpRequest, openedUris } = createEnvironment();
    send(MockXMLHttpRequest, sendEndpoint, messageBody);
    assert.equal(openedUris.length, 0, 'no export before task/chat association arrives');

    send(MockXMLHttpRequest, taskEndpoint);
    send(MockXMLHttpRequest, sendEndpoint, 'dialogId=chat999&fields%5Bmessage%5D=other+chat');
    assert.equal(openedUris.length, 0, 'other chat must not be exported');
    send(MockXMLHttpRequest, sendEndpoint, messageBody);
    assertExported(openedUris[0]);
    assert.equal(openedUris.length, 1);
});

test('exports a task chat message from a side slider frame', () => {
    const { openedUris, taskFrameWindow } = createEnvironment({ hasTaskFrame: true });
    send(taskFrameWindow.XMLHttpRequest, taskEndpoint);
    send(taskFrameWindow.XMLHttpRequest, sendEndpoint, messageBody);
    assertExported(openedUris[0]);
});

test('exports fetch messages without consuming the response', async () => {
    const { openedUris, window } = createEnvironment();
    await window.fetch(taskEndpoint, { method: 'POST' });
    const response = await window.fetch(sendEndpoint, { method: 'POST', body: messageBody });
    assertExported(openedUris[0]);
    assert.deepEqual(await response.json(), { status: 'success', data: { id: 1376900 } });
});

test('uses saved export settings and custom task tags', () => {
    const { MockXMLHttpRequest, openedUris } = createEnvironment({
        settings: {
            dailyNoteDirectory: 'Journal/Daily',
            includeTaskTag: false,
            includeCompanyTag: false,
        },
    });
    send(MockXMLHttpRequest, taskEndpoint);
    send(MockXMLHttpRequest, sendEndpoint, messageBody);
    const query = new URL(openedUris[0]).searchParams;
    assert.match(query.get('file'), /^Journal\/Daily\/\d{4}-\d{2}-\d{2}\.md$/);
    assert.doesNotMatch(query.get('content'), /#task\/42/);
    assert.match(query.get('content'), /exported message/);

    const custom = createEnvironment({ settings: { taskTagName: 'project/task' } });
    send(custom.MockXMLHttpRequest, taskEndpoint);
    send(custom.MockXMLHttpRequest, sendEndpoint, messageBody);
    assert.match(new URL(custom.openedUris[0]).searchParams.get('content'), /#project\/task\/42 exported message/);
});

test('does not export rejected, empty, unrelated, or legacy forum submissions', async () => {
    const { MockXMLHttpRequest, openedUris, window } = createEnvironment({ payload: { status: 'error' } });
    send(MockXMLHttpRequest, taskEndpoint);
    send(MockXMLHttpRequest, sendEndpoint, messageBody);
    await window.fetch(sendEndpoint, { method: 'POST', body: messageBody });
    assert.equal(openedUris.length, 0);

    const valid = createEnvironment();
    send(valid.MockXMLHttpRequest, taskEndpoint);
    send(valid.MockXMLHttpRequest, sendEndpoint, 'dialogId=chat11784&fields%5Bmessage%5D=+');
    send(valid.MockXMLHttpRequest, 'https://other.example/bitrix/services/main/ajax.php?action=im.v2.Chat.Message.send', messageBody);
    send(valid.MockXMLHttpRequest, 'https://acme.bitrix24.ru/bitrix/services/main/ajax.php?c=bitrix%3Aforum.comments&action=processComment', 'ENTITY_XML_ID=TASK_42&POST_MESSAGE=legacy');
    assert.equal(valid.openedUris.length, 0);
});
