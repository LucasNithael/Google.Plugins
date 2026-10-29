# Radar de APIs

Extensão para Google Chrome (116 ou superior), Manifest V3, sem dependências ou etapa de build.

## Instalação local

1. Abra `chrome://extensions` no Chrome.
2. Ative **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação** e selecione a pasta `radar-de-apis` dentro deste repositório (a que contém `manifest.json`).
4. Fixe **Radar de APIs** no menu de extensões e clique no ícone para abrir o painel lateral.

## Uso

Abra o sistema, clique em **Iniciar captura** e execute uma ação. As chamadas aparecem no painel; selecione uma para consultar cabeçalhos e copiar a URL. Recarregue a página depois de iniciar para incluir as chamadas de carregamento inicial.

A captura é independente por aba e continua com o painel fechado até ser pausada ou a aba ser fechada. O painel acompanha a aba ativa. O filtro padrão Fetch/XHR inclui a categoria `xmlhttprequest` do Chrome (também usada para Fetch); escolha todas as chamadas para consultar outros recursos HTTP. Busca, método e status podem ser combinados.

## Dados e permissões

- `webRequest`: observar chamadas, sem bloqueá-las ou alterá-las.
- Acesso HTTP/HTTPS a todos os sites: observar tanto o sistema quanto APIs em outros domínios. Pode ser restringido nas configurações da extensão; nesse caso algumas chamadas não aparecerão.
- `tabs`: identificar a aba ativa e exibir seu domínio.
- `sidePanel`: exibir o painel lateral.
- `storage`: manter até 500 chamadas por aba em `storage.session`, inclusive quando o service worker é suspenso. Os dados são descartados ao fechar a aba, encerrar o navegador, recarregar ou desativar a extensão. Não há servidor, telemetria ou envio de dados.

Cabeçalhos com nomes associados a autorização, cookies, tokens, chaves de API e segredos são ocultados. Isso não constitui anonimização completa: URLs, parâmetros e cabeçalhos personalizados podem conter dados sensíveis. O corpo enviado e o corpo da resposta não são armazenados.

## Limitações

Não recupera chamadas anteriores ao início da captura. Não substitui integralmente o Network: não captura JSON das respostas, payloads, frames de WebSocket ou o iniciador JavaScript. Algumas requisições internas do Chrome e atendidas por cache/Service Workers podem não ser observáveis. Políticas corporativas ou restrições de acesso da extensão podem limitar a captura. Cabeçalhos são os disponibilizados pela API, e não uma reprodução exata de todos os cabeçalhos transmitidos.

## Validação

Na pasta `radar-de-apis`, execute `node --test tests/background.test.cjs`. Os testes simulam eventos do Chrome para validar isolamento por aba, ciclo de requisições, redirecionamentos, pausa, limpeza, limite e restauração após suspensão do worker.

Teste manual no Chrome: instale, abra um sistema com chamadas Fetch/XHR, inicie, execute uma pesquisa e compare método/URL/status com o Network. Alterne abas, pause, limpe e recarregue a extensão. A validação automatizada não substitui esse teste no navegador.
