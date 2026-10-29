const LIMIT = 500;

// Eventos de rede e comandos do painel compartilham a mesma fila para evitar
// que operações concorrentes sobrescrevam o histórico no storage.session.
let queue = Promise.resolve();

function serial(task) {
  const result = queue.then(task);
  queue = result.catch(console.error);
  return result;
}

const key = (tabId) => `tab:${tabId}`;

// O armazenamento de sessão preserva o estado quando o Chrome suspende o worker.
async function read(tabId) {
  return (
    (await chrome.storage.session.get(key(tabId)))[key(tabId)] || {
      capturing: false,
      requests: [],
    }
  );
}

async function save(tabId, state) {
  await chrome.storage.session.set({ [key(tabId)]: state });
}

// Oculta credenciais em cabeçalhos conhecidos e limita o tamanho dos valores.
// URLs e cabeçalhos personalizados ainda podem conter dados sensíveis.
function headers(items = []) {
  return items.map(({ name, value }) => ({
    name,
    value: /authorization|cookie|token|api[-_]?key|secret/i.test(name)
      ? '[oculto]'
      : (value || '').slice(0, 4096),
  }));
}

// Cada chamada é montada progressivamente a partir dos eventos de webRequest.
function record(details, phase) {
  if (details.tabId < 0) {
    return;
  }

  serial(async () => {
    const state = await read(details.tabId);

    if (!state.capturing) {
      return;
    }

    // Redirecionamentos reutilizam o requestId; somente a etapa aberta é atualizada.
    let entry = state.requests.findLast(
      (item) => item.id === details.requestId && !item.finished,
    );

    if (phase === 'start') {
      entry = {
        id: details.requestId,
        url: details.url,
        method: details.method,
        type: details.type,
        started: details.timeStamp,
        status: null,
      };
      state.requests.push(entry);
      state.requests = state.requests.slice(-LIMIT);
    }

    // Ignora eventos de chamadas iniciadas antes da captura ou removidas da lista.
    if (!entry) {
      return;
    }

    if (details.requestHeaders) {
      entry.requestHeaders = headers(details.requestHeaders);
    }

    if (details.responseHeaders) {
      entry.responseHeaders = headers(details.responseHeaders);
    }

    if (details.statusCode !== undefined) {
      entry.status = details.statusCode;
    }

    if (['done', 'error', 'redirect'].includes(phase)) {
      entry.finished = true;
      entry.duration = Math.max(0, Math.round(details.timeStamp - entry.started));
      entry.error = details.error;
      entry.redirectUrl = details.redirectUrl;
      entry.fromCache = details.fromCache;
    }

    await save(details.tabId, state);
  });
}

// Listeners são registrados no escopo principal para receber eventos após
// uma nova inicialização do service worker. A captura é apenas de observação.
const filter = { urls: ['http://*/*', 'https://*/*'] };
chrome.webRequest.onBeforeRequest.addListener((d) => record(d, 'start'), filter);
chrome.webRequest.onSendHeaders.addListener(
  (d) => record(d, 'headers'),
  filter,
  ['requestHeaders'],
);
chrome.webRequest.onHeadersReceived.addListener(
  (d) => record(d, 'headers'),
  filter,
  ['responseHeaders'],
);
chrome.webRequest.onBeforeRedirect.addListener((d) => record(d, 'redirect'), filter);
chrome.webRequest.onCompleted.addListener((d) => record(d, 'done'), filter);
chrome.webRequest.onErrorOccurred.addListener((d) => record(d, 'error'), filter);
chrome.tabs.onRemoved.addListener((tabId) =>
  serial(() => chrome.storage.session.remove(key(tabId))),
);

// O painel só envia comandos para a própria extensão e informa a aba de destino.
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (
    sender.id !== chrome.runtime.id ||
    !Number.isInteger(message.tabId) ||
    !['read', 'toggle', 'clear'].includes(message.action)
  ) {
    return;
  }

  serial(async () => {
    const state = await read(message.tabId);

    if (message.action === 'toggle') {
      state.capturing = !state.capturing;

      // Finaliza entradas pendentes para não aceitar conclusões antigas ao retomar.
      if (!state.capturing) {
        for (const entry of state.requests) {
          if (!entry.finished) {
            entry.finished = true;
            entry.error = 'Captura interrompida';
          }
        }
      }
    }

    if (message.action === 'clear') {
      state.requests = [];
    }

    if (message.action !== 'read') {
      await save(message.tabId, state);
    }

    respond({ state });
  }).catch((error) => respond({ error: error.message }));

  // Mantém o canal de resposta aberto enquanto a operação assíncrona termina.
  return true;
});

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(console.error);
