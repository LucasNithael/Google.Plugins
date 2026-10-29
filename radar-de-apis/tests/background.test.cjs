const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(
  require('node:path').join(__dirname, '../background.js'),
  'utf8',
);

// Cada cenário executa o worker isoladamente, com eventos e armazenamento falsos.
// Reutilizar "store" em outro setup simula a suspensão e recriação do worker.
function setup(store = {}) {
  const events = {};
  const event = (name) => ({
    addListener: (fn) => {
      events[name] = fn;
    },
  });

  const chrome = {
    storage: {
      session: {
        // Cópias evitam compartilhar referências com o estado interno do worker.
        get: async (key) => ({ [key]: structuredClone(store[key]) }),
        set: async (values) => Object.assign(store, structuredClone(values)),
        remove: async (key) => {
          delete store[key];
        },
      },
    },
    runtime: { id: 'radar', onMessage: event('message') },
    tabs: { onRemoved: event('removed') },
    sidePanel: { setPanelBehavior: async () => {} },
    webRequest: Object.fromEntries(
      [
        'onBeforeRequest',
        'onSendHeaders',
        'onHeadersReceived',
        'onBeforeRedirect',
        'onCompleted',
        'onErrorOccurred',
      ].map((name) => [name, event(name)]),
    ),
  };

  vm.runInNewContext(source, { chrome, console });

  // A resposta de um comando também aguarda os eventos anteriores na fila.
  const message = (action, tabId = 1) =>
    new Promise((resolve) =>
      events.message({ action, tabId }, { id: 'radar' }, resolve),
    );

  const emit = (name, overrides = {}) =>
    events[name]({
      tabId: 1,
      requestId: 'a',
      url: 'https://api.example.test/users',
      method: 'GET',
      type: 'xmlhttprequest',
      timeStamp: 100,
      ...overrides,
    });

  return { events, store, message, emit };
}

test('captures only enabled tabs, computes duration and masks credential headers', async () => {
  const app = setup();
  app.emit('onBeforeRequest');
  assert.equal((await app.message('read')).state.requests.length, 0);
  await app.message('toggle');
  app.emit('onBeforeRequest');
  app.emit('onBeforeRequest', { tabId: 2 });
  app.emit('onSendHeaders', {
    requestHeaders: [
      { name: 'Authorization', value: 'Bearer secret' },
      { name: 'Accept', value: 'application/json' },
    ],
  });
  app.emit('onHeadersReceived', {
    statusCode: 200,
    responseHeaders: [{ name: 'Set-Cookie', value: 'secret' }],
  });
  app.emit('onCompleted', { statusCode: 200, timeStamp: 250 });
  const { state } = await app.message('read');
  assert.equal(state.requests.length, 1);
  assert.equal(state.requests[0].duration, 150);
  assert.equal(state.requests[0].status, 200);
  assert.equal(state.requests[0].requestHeaders[0].value, '[oculto]');
  assert.equal(state.requests[0].requestHeaders[1].value, 'application/json');
  assert.equal(state.requests[0].responseHeaders[0].value, '[oculto]');
  assert.equal((await app.message('read', 2)).state.requests.length, 0);
});

test('redirect hops with the same request id remain separate', async () => {
  const app = setup();
  await app.message('toggle');
  app.emit('onBeforeRequest');
  app.emit('onBeforeRedirect', {
    statusCode: 302,
    redirectUrl: 'https://api.example.test/login',
    timeStamp: 120,
  });
  app.emit('onBeforeRequest', {
    url: 'https://api.example.test/login',
    timeStamp: 121,
  });
  app.emit('onCompleted', { statusCode: 200, timeStamp: 140 });
  const { state } = await app.message('read');
  assert.equal(state.requests.length, 2);
  assert.equal(state.requests[0].status, 302);
  assert.equal(state.requests[0].duration, 20);
  assert.equal(state.requests[1].status, 200);
  assert.equal(state.requests[1].duration, 19);
});

test('pause closes pending entries, resume ignores old completions, clear removes entries', async () => {
  const app = setup();
  await app.message('toggle');
  app.emit('onBeforeRequest');
  await app.message('toggle');
  app.emit('onBeforeRequest', { requestId: 'paused' });
  await app.message('toggle');
  app.emit('onCompleted', { statusCode: 200 });
  const { state } = await app.message('read');
  assert.equal(state.requests.length, 1);
  assert.equal(state.requests[0].error, 'Captura interrompida');
  assert.equal(state.requests[0].status, null);
  assert.equal((await app.message('clear')).state.requests.length, 0);
});

test('state survives worker recreation, errors are recorded and closing a tab clears data', async () => {
  const app = setup();
  await app.message('toggle');
  app.emit('onBeforeRequest');
  await app.message('read');
  const restarted = setup(app.store);
  restarted.emit('onErrorOccurred', {
    error: 'net::ERR_FAILED',
    timeStamp: 170,
  });
  const { state } = await restarted.message('read');
  assert.equal(state.capturing, true);
  assert.equal(state.requests[0].error, 'net::ERR_FAILED');
  assert.equal(state.requests[0].duration, 70);
  restarted.events.removed(1);
  assert.equal((await restarted.message('read')).state.requests.length, 0);
});

test('keeps the most recent 500 requests', async () => {
  const app = setup();
  await app.message('toggle');
  for (let i = 0; i < 505; i++) {
    app.emit('onBeforeRequest', { requestId: String(i) });
  }
  const { state } = await app.message('read');
  assert.equal(state.requests.length, 500);
  assert.equal(state.requests[0].id, '5');
  assert.equal(state.requests.at(-1).id, '504');
});
