const $ = (id) => document.getElementById(id);

// Estado visual da aba ativa; a fonte persistida é o storage.session do worker.
let tabId = null;
let state = { capturing: false, requests: [] };
let selected = null;
let generation = 0;

// Desconsidera respostas que chegaram depois de o usuário trocar de aba.
async function send(action) {
  if (tabId === null) {
    return;
  }

  const target = tabId;
  const result = await chrome.runtime.sendMessage({ action, tabId: target });

  if (target !== tabId) {
    return;
  }

  if (result.error) {
    throw new Error(result.error);
  }

  state = result.state;
  render();
}

function showError(error) {
  $('notice').textContent = error.message;
}

// A geração impede que consultas assíncronas antigas restaurem uma aba anterior.
async function activeTab() {
  const version = ++generation;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (version !== generation) {
    return;
  }

  tabId = tab?.id ?? null;
  selected = null;
  $('details').hidden = true;
  const supported = /^https?:\/\//.test(tab?.url || '');
  $('site').textContent = supported
    ? new URL(tab.url).hostname
    : 'Abra uma página HTTP ou HTTPS';
  $('toggle').disabled = !supported;
  $('clear').disabled = !supported;
  $('notice').textContent = '';
  state = { capturing: false, requests: [] };
  render();
  if (supported) {
    await send('read');
  }
}

// Os filtros afetam somente a exibição; o histórico original é preservado.
function render() {
  document.body.classList.toggle('live', state.capturing);
  $('toggle').textContent = state.capturing ? 'Pausar captura' : 'Iniciar captura';
  $('capture-status').textContent = state.capturing
    ? '● Capturando nesta aba — execute uma ação no sistema'
    : 'Captura pausada';

  const search = $('search').value.toLowerCase();
  const items = state.requests.filter((r) => {
    const status = $('status').value;

    // O Chrome classifica tanto Fetch quanto XHR como "xmlhttprequest".
    return (
      ($('type').value === 'all' || r.type === 'xmlhttprequest') &&
      (!$('method').value || r.method === $('method').value) &&
      r.url.toLowerCase().includes(search) &&
      (!status ||
        (status === 'error'
          ? !!r.error
          : String(r.status || '').startsWith(status)))
    );
  });

  $('count').textContent = `${items.length} exibidas · ${state.requests.length}/500 capturadas`;
  const list = $('requests');
  list.replaceChildren();

  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = state.requests.length
      ? 'Nenhuma chamada corresponde aos filtros.'
      : 'Inicie a captura e interaja com a página. Se necessário, recarregue a página para capturar as chamadas iniciais.';
    list.append(empty);
  }

  // Conteúdo vindo da rede é inserido como texto, sem interpretar HTML da página.
  for (const r of [...items].reverse()) {
    const button = document.createElement('button');
    button.className = 'request';

    const meta = document.createElement('span');
    meta.className = 'meta';

    const method = document.createElement('span');
    method.className = 'method';
    method.textContent = r.method;

    const duration = document.createElement('span');
    duration.textContent =
      r.duration === undefined
        ? r.finished
          ? 'Interrompida'
          : 'Em andamento'
        : `${r.duration} ms`;

    const status = document.createElement('span');
    status.className = `status${r.error || r.status >= 400 ? ' bad' : ''}`;
    status.textContent = r.error ? 'Falha' : (r.status ?? '…');
    meta.append(method, duration, status);

    const url = new URL(r.url);
    const path = document.createElement('span');
    path.className = 'path';
    path.textContent = url.pathname + url.search;

    const host = document.createElement('span');
    host.className = 'host';
    host.textContent = url.host;

    button.append(meta, path, host);
    button.addEventListener('click', () => {
      selected = r;
      details();
    });
    list.append(button);
  }

  if (selected) {
    // O horário distingue etapas de redirecionamento que têm o mesmo requestId.
    selected =
      state.requests.find(
        (r) => r.id === selected.id && r.started === selected.started,
      ) || null;
    details();
  }
}

// Reconstitui os detalhes quando uma chamada selecionada recebe novos eventos.
function details() {
  $('details').hidden = !selected;

  if (!selected) {
    return;
  }

  const r = selected;
  const formatHeaders = (items) =>
    items?.map((h) => `${h.name}: ${h.value}`).join('\n') || '(não disponíveis)';

  $('detail-content').textContent =
    `${r.method} ${r.url}\n\n` +
    `Status: ${r.status ?? '—'}\n` +
    `Tipo: ${r.type}\n` +
    `Horário: ${new Date(r.started).toLocaleTimeString('pt-BR')}\n` +
    `Duração: ${r.duration === undefined ? '—' : r.duration + ' ms'}\n` +
    `Cache: ${r.fromCache ? 'Sim' : 'Não / desconhecido'}` +
    (r.error ? '\nFalha: ' + r.error : '') +
    (r.redirectUrl ? '\nRedirecionamento: ' + r.redirectUrl : '') +
    `\n\nCABEÇALHOS DA REQUISIÇÃO\n${formatHeaders(r.requestHeaders)}` +
    `\n\nCABEÇALHOS DA RESPOSTA\n${formatHeaders(r.responseHeaders)}` +
    '\n\nCredenciais em cabeçalhos conhecidos são ocultadas. O corpo da resposta não é capturado.';
}

// Controles do painel: comandos alteram o worker; filtros alteram apenas a tela.
$('toggle').addEventListener('click', () => send('toggle').catch(showError));
$('clear').addEventListener('click', () => {
  selected = null;
  $('details').hidden = true;
  send('clear').catch(showError);
});

for (const id of ['search', 'type', 'method', 'status']) {
  $(id).addEventListener('input', render);
}

$('close').addEventListener('click', () => {
  selected = null;
  details();
});

$('copy').addEventListener('click', async () => {
  if (!selected) {
    return;
  }

  try {
    await navigator.clipboard.writeText(selected.url);
    $('notice').textContent = 'URL copiada.';
  } catch (error) {
    showError(error);
  }
});

// Acompanha a navegação e recebe atualizações sem consultar a rede periodicamente.
chrome.tabs.onActivated.addListener(() => activeTab().catch(showError));
chrome.tabs.onUpdated.addListener((id, change) => {
  if (id === tabId && change.url) {
    activeTab().catch(showError);
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes[`tab:${tabId}`]) {
    state = changes[`tab:${tabId}`].newValue || {
      capturing: false,
      requests: [],
    };
    render();
  }
});

activeTab().catch(showError);
