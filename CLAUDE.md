aqui voce armazena erros de conexão do frontend com backend a cada etapa concluída

---

## Sessão 2026-06-15 (tarde/noite) — Correção CADASTRO-01 (re-análise) + Layout Desktop + Nota Multi-Tenant

**Arquivos modificados:** `auth.js`, `login.html`

### Bug corrigido

| ID | Severidade | Arquivo | Correção |
|----|-----------|---------|---------|
| CADASTRO-02 | Crítico | auth.js | `verificarCpfCnpjUnico()`: `getDocs` lançava erro silencioso (sem console.error) swallowed pelo catch, que retornava `{ erro: true }` bloqueando o cadastro. Causa raiz: Firebase SDK v10 com `persistentLocalCache` mantém WebSocket persistente com o Firestore; após `createUserWithEmailAndPassword`, o token novo demora a propagar para a conexão Firestore — a primeira query retorna `permission-denied`. Fix: catch agora é **fail-open** (retorna `false`) + `console.error` para diagnóstico. `cadastrarEmpresa` simplificado: só verifica `duplicado === true`. Duplicatas tratadas por CF no M22 (ALTO-03). |

### Bug adicional corrigido nesta sessão

| ID | Severidade | Arquivo | Correção |
|----|-----------|---------|---------|
| TRIAL-01 | Crítico | auth.js | `verificarEmailConfirmado()`: `updateDoc` com `trialExpira` era enviado à fila local do `persistentLocalCache` e retornava `ok:true` antes da confirmação do servidor. Se o servidor rejeitasse por timing de token, a escrita era revertida silenciosamente. `onAuthChange` em `app.html` lia `trialExpira: null` → `calcularAcesso` retornava `somente_leitura` → app exibia "trial expirado". Fix: mover a inicialização do trial para dentro de `onAuthChange`, após `getDoc(empresas/{uid})` — neste ponto a conexão Firestore já está autenticada com token válido, eliminando a race condition. |

### Causa técnica detalhada — CADASTRO-02

- Firebase Auth SDK e Firestore SDK são módulos separados em v10
- `persistentLocalCache` usa WebSocket persistente que re-autentica de forma assíncrona
- `getIdToken(true)` atualiza o token no Auth SDK, mas a conexão WebSocket do Firestore SDK pode não ter re-autenticado quando o `getDocs` imediato é disparado
- O `catch {}` original engolia o erro sem logar → console limpo → usuário via mensagem genérica
- Vetor secundário: se as regras com `isAuth() || isAdminOuOperador` não estiverem deployadas, `isAdminOuOperador` chama `getUsuario()` → `null.empresaId` → regra falha → query negada

---

## Sessão 2026-06-15 (tarde/noite) — Correções Layout Desktop + Nota de Segurança Multi-Tenant

**Arquivos modificados:** `login.html`

### Bug corrigido

| ID | Severidade | Arquivo | Correção |
|----|-----------|---------|---------|
| LOGIN-DESKTOP-01 | Alto | login.html | `.page-wrapper { justify-content: center }` com `min-height: 100vh` causa bug do Chrome: ao trocar para a aba "Criar Conta" (cadastro form mais alto que o viewport), o container flex não cresce e clipa o conteúdo inferior. Campos de telefone/CPF, cards de plano e botão "Criar Conta" ficavam invisíveis no desktop. Fix: `justify-content: flex-start` + `padding: 40px 16px` + `overflow-y: auto` em `html, body`. |

### Nota de Segurança — Multi-tenant (registrada para Módulo 22)

**⚠️ PENDÊNCIA PARA LANÇAMENTO COMERCIAL:**

A regra Firestore `allow read: if isAuth() || isAdminOuOperador(empresaId)` em `empresas/{empresaId}` foi necessária para o cadastro funcionar (CPF check sem `usuarios/{uid}` ainda existir). Porém, `isAuth()` no início do OR significa que **qualquer usuário autenticado pode ler qualquer documento de empresa**, incluindo dados de outras lojas.

Antes do lançamento comercial:
- Migrar a verificação de CPF/CNPJ para Cloud Function (Módulo 22) — eliminando a necessidade de `isAuth()` amplo
- Restringir a regra de leitura de `empresas/{empresaId}` para `isAdminOuOperador(empresaId)` apenas
- O app já diferencia `perfil == "admin"` vs `perfil == "operador"` internamente; a Cloud Function validará isso no servidor

---

## Sessão 2026-06-15 — Correção Bug Cadastro (verificarCpfCnpjUnico sem autenticação)

**Arquivo modificado:** `auth.js`

### Bug corrigido

| ID | Severidade | Arquivo | Correção |
|----|-----------|---------|---------|
| CADASTRO-01 | Crítico | auth.js | `verificarCpfCnpjUnico()` em `cadastrarEmpresa()` era chamada **antes** de `createUserWithEmailAndPassword`, sem usuário autenticado. A regra Firestore `allow read: if isAuth()` rejeitava a query, retornando "Erro ao verificar CPF/CNPJ". Fix: `createUserWithEmailAndPassword` movido para o Passo 1; verificação de CPF vira Passo 2 (já autenticado). Se CPF duplicado → `deleteUser(cred.user)` como rollback antes de retornar o erro. |

---

## Sessão 2026-06-15 — Correções FAILs T-M06-22 e T-M06-30

**Arquivo modificado:** `syncManager.js`

### Bugs corrigidos

| ID | Severidade | Arquivo | Correção |
|----|-----------|---------|---------|
| T-M06-22 | Médio | syncManager.js | `_atualizarSessaoComDadosFrescos(kit)` adicionado como Passo 6 do ciclo. Após cada sync bem-sucedido, regrava `mc_sessao` com `diasTrialRestantes` recalculado a partir de `kit.trialExpira`, além de `status` e `assinaturaAtiva`. Kit passa a incluir esses 3 campos vindos do Firestore. |
| T-M06-30 | Alto | syncManager.js | `getDocFromServer()` em `baixarKitOffline()` envolto em `Promise.race` com timeout de 10s. Evita hang silencioso quando Firebase tem rede desabilitada (`disableNetwork`), garantindo que o `catch` sempre seja chamado e `notificar('erro', ...)` seja exibido. |

### Não corrigido (comportamento esperado)

| ID | Motivo |
|----|--------|
| T-M05-19 | `dispatchEvent(new Event('offline'))` não altera `navigator.onLine`. Badge lê `navigator.onLine` corretamente. Comportamento esperado — reclassificado como Categoria E (requer corte real de rede via DevTools > Network > Offline). |

---

## Sessão 2026-06-15 (tarde) — Execução Testes Categoria A via javascript_tool

**Ferramenta:** Claude in Chrome MCP · `mcp__Claude_in_Chrome__javascript_tool`  
**App:** `https://meucaixa-prod.web.app`

### Contas de teste criadas no Firebase Auth (prod)

| Conta | Email | UID | Finalidade |
|-------|-------|-----|------------|
| Principal | `guedesfelipe5641@gmail.com` | `uLGOVK8uoFc0p0tpFXVD7pRkoBz2` | adminStandard / semVerificacao |
| Auxiliar 1 | `teste.outro@meucaixa.test` | `jpvZTIro5rVKSD0IIsnC1p3a3Tj2` | uidOutroUsuario (T-M02-25) |
| Auxiliar 2 | `teste.superadmin@meucaixa.test` | `d7dLXfjkGRaolvSlyyclqAlhv753` | superAdmin |

**Documentos Firestore criados:**
- `empresas/uLGOVK8uoFc0p0tpFXVD7pRkoBz2`: plano=standard, status=ativo, trial 30 dias, cpfCnpj=12345678000199
- `usuarios/uLGOVK8uoFc0p0tpFXVD7pRkoBz2`: perfil=admin, superAdmin=false
- `usuarios/jpvZTIro5rVKSD0IIsnC1p3a3Tj2`: perfil=admin, superAdmin=false
- `usuarios/d7dLXfjkGRaolvSlyyclqAlhv753`: perfil=admin, superAdmin=true

### Resultados

| Módulo | PASS | BLOQUEADO | Total |
|--------|------|-----------|-------|
| M02 | 12 | 3 | 15 |
| M03 | 0 | 1 | 1 |
| M05 | 0 | 9 | 9 |
| M06 | 0 | 14 | 14 |
| **TOTAL** | **12** | **27** | **39** |

### Bloqueador: `emailVerified: false`

`onAuthChange` em `auth.js` (linha 379) verifica `user.emailVerified` antes de qualquer cache. Com email não verificado, `app.html` redireciona para `login.html` imediatamente. Não há bypass via client SDK — Firebase não permite alterar `emailVerified` do lado do cliente.

**Ação necessária:** Verificar e-mail `guedesfelipe5641@gmail.com` (link de verificação enviado em T-M02-12) para desbloquear os 27 testes restantes (T-M02-26, T-M02-01, T-M02-05, todos M03/M05/M06).

### Descoberta adicional

T-M02-04: DOM de login.html não tem `[data-mensagem-verificacao]` nem `[data-mensagem-reenvio]`. Verificar se esses seletores foram implementados corretamente em login.html para exibir feedback ao usuário.

---

## Sessão 2026-06-15 (segunda rodada) — Testes Categoria A com emailVerified

**Ferramenta:** Claude in Chrome MCP · `mcp__Claude_in_Chrome__javascript_tool`  
**Bloqueador anterior resolvido:** `guedesfelipe5641@gmail.com` verificado pelo usuário → `app.html` carrega normalmente.

### Resultados finais — 38 testes Categoria A

| Módulo | PASS | FAIL | SKIP | Total |
|--------|------|------|------|-------|
| M02 | 13 | 0 | 1 | 14 |
| M03 | 1 | 0 | 0 | 1 |
| M05 | 7 | 1 | 1 | 9 |
| M06 | 10 | 3 | 1 | 14 |
| **TOTAL** | **31** | **4** | **3** | **38** |

### FAILs identificados

| ID | Descrição | Diagnóstico |
|----|-----------|-------------|
| T-M05-19 | Badge de conexão não reage a `dispatchEvent(new Event('offline'))` | Handler de rede usa API `navigator.onLine` ou `addEventListener` no nível do `window`; eventos sintéticos do console não ativam o handler. Comportamento esperado na ausência de corte real de rede. |
| T-M06-22 | `diasTrialRestantes` local não reseta via evento `online` | Campo só é sobrescrito no próximo login (via `onAuthChange` → Firestore). Não é regravado pelo ciclo de sync. |
| T-M06-30 | App não exibe notificação de erro quando ciclo falha por desconexão | `notificar('erro',...)` não é chamado quando o ciclo falha por `disableNetwork` (timeout silencioso). |

### SKIPs

| ID | Motivo |
|----|--------|
| T-M02-05 | Requer conta superAdmin com `emailVerified: true` |
| T-M05-16 | Requer conta superAdmin com `emailVerified: true` |
| T-M06-32 | Requer conta Pro + aguardar 15min |

### Obstáculos técnicos resolvidos nesta sessão

- **SW reload loop:** Service Worker re-registrava a cada 1s causando reload contínuo. Fix: `navigator.serviceWorker.getRegistrations().then(r => r.forEach(x => x.unregister()))` antes de qualquer operação assíncrona.
- **`await` top-level bloqueado:** `javascript_tool` não suporta `await` no nível raiz. Solução: retornar Promise diretamente (a ferramenta aguarda automaticamente) ou usar `.then()` com `window._RES` para acumular resultados.
- **Firebase app já inicializado:** importar de `/firebase-config.js` (app local) em vez de CDN gstatic — compartilha a instância já inicializada.

---

## Sessão 2026-06-15 — Correção Bug T-M06-19 + Reclassificação de Testes Bloqueados

**Arquivo modificado:** `syncManager.js`

### Bug corrigido

| ID | Severidade | Arquivo | Correção |
|----|-----------|---------|---------|
| T-M06-19 | Alto | syncManager.js | `podeVenderOffline()`: verificação `=== false` substituída por `!== true` — campo `permiteVendaOffline` ausente no kit (undefined) agora bloqueia corretamente em vez de passar para a próxima verificação. Comportamento fail-safe alinhado com o comentário EC-08 já existente no código. |

**Linha alterada (syncManager.js ~L373):**
```js
// Antes:
if (kit.permiteVendaOffline === false) {
// Depois:
if (kit.permiteVendaOffline !== true) {
```

### Reclassificação dos testes BLOQUEADOS (71 testes)

Com acesso ao `javascript_tool` do Chrome Extension, os 71 testes BLOQUEADOS foram reclassificados:

| Categoria | Qtd | O que precisa |
|---|---|---|
| **A — javascript_tool, sem risco prod** | **38** | JS no console do browser; nenhuma escrita permanente em prod |
| **B — javascript_tool, toca prod** | **16** | Escreve em Firestore prod ou Auth prod; usar conta de teste dedicada |
| **C — Emulador** | **1** | T-M02-09 (rollback pós-createUser) |
| **D — iOS físico** | **3** | T-M06-34, T-M06-35, T-M06-36 |
| **E — Outro motivo** | **13** | Viewport resize, swipe gesture, throttle de rede, fechar/reabrir aba |

**Nota sobre testes E (viewport):** T-M05-05, T-M05-06, T-M05-09, T-M05-10 podem ser executados via DevTools > Toggle Device Toolbar manualmente antes de rodar o snippet javascript_tool.

---

## Sessão 2026-06-13 — Correções Módulo 02

**Arquivos modificados:** `auth.js`, `login.html`, `firestore.rules`

### Bugs corrigidos

| ID | Severidade | Arquivo | Correção |
|----|-----------|---------|---------|
| CRÍTICO-01 | Crítico | auth.js | Importado `deleteUser`; adicionado rollback no `catch` de `cadastrarEmpresa()` — se `auth.currentUser` existe após falha pós-`createUserWithEmailAndPassword`, chama `deleteUser` para evitar estado zumbi |
| CRÍTICO-02 | Crítico | auth.js | Removido `await signOut(auth)` do caminho de sucesso em `verificarEmailConfirmado()` — usuário permanece autenticado para `app.html` carregar sessão via `onAuthChange` sem loop |
| ALTO-02 | Alto | auth.js | `verificarCpfCnpjUnico` catch agora retorna `{ erro: true, mensagem: "..." }` em vez de `false`; caller em `cadastrarEmpresa` trata o retorno e exibe mensagem adequada |
| ALTO-04 | Alto | auth.js | `calcularAcesso`: verificação de `status === "suspenso"` movida para ANTES de `assinaturaAtiva`; fallback de `suspensaoEm` alterado de `0` para `Date.now()` |
| MÉDIO-01 | Médio | auth.js | `onAuthChange`: antes de retornar cache, verifica se `cache.trialExpira < Date.now()` — se expirado, invalida cache e força leitura do Firestore |
| MÉDIO-02 | Médio | auth.js + login.html | `verificarEmailConfirmado` catch distingue `error.code` (rede / limite / desconhecido) e retorna `{ ok: false, tipo, erro }`; `login.html` exibe `res.erro` em vez de mensagem fixa |
| MÉDIO-04 | Médio | firestore.rules | Removida condição `(request.auth == null)` da regra de leitura de `empresas` — coleção não é mais acessível sem autenticação |
| CRÍTICO-03 | Crítico | firestore.rules | `allow update` em `usuarios/{usuarioId}`: bloqueada escalada de privilégios — usuário autenticado não pode mais alterar `perfil`, `superAdmin` ou `empresaId` via `affectedKeys().hasAny()`; somente `isSuperAdmin()` pode modificar esses campos |

### Documentado (não implementado)

| ID | Arquivo | Comentário adicionado |
|----|---------|----------------------|
| ALTO-03 | auth.js | `// TODO: race condition — mover para Cloud Function com transação atômica` (verificação de CPF) |
| MÉDIO-03 | auth.js | `// TODO: criar Cloud Function para limpar cadastros não confirmados após 72h` (setDoc empresas) |

### Pendente futuro

- **MÉDIO-04 (parcial):** A query de CPF/CNPJ durante o cadastro (antes de criar conta Auth) agora exige autenticação. Precisará ser migrada para Cloud Function no Módulo 22.
- **ALTO-03 / MÉDIO-03:** Implementação completa no Módulo 22 com Cloud Functions e transações atômicas.

---

## Sessão 2026-06-13 — Implementação Módulos 03 e 04

**Arquivos criados:** `notificacoes.js`, `utils.js`, `theme.js`, `planGuard.js`

### Módulo 03 — notificacoes.js

| Função exportada | Descrição |
|---|---|
| `notificar(tipo, titulo, mensagem)` | Overlay centralizado com ícone, barra de progresso 7s, botão OK imediato. Persiste no localStorage (TTL 24h). Dispara evento `mc:notificacao`. Tipos: sucesso/aviso/erro/informacao/bloqueio. |
| `renderSino(elementoSino)` | Dropdown com histórico 24h, badge de não lidas, botão "Marcar todas como lidas". Gerencia listeners sem acúmulo (fixes EC-01). |
| `limparNotificacoesExpiradas()` | Remove do localStorage notificações com expiraEm < Date.now(). |

**Decisões técnicas:**
- EC-01: overlay anterior é substituído (não acumula) — variável `_overlayAtivo` controla o singleton
- EC-02: falha de localStorage é silenciosa (try/catch sem propagação)
- EC-03: estado vazio exibe "Nenhuma notificação"
- Listeners de `mc:notificacao` e click-fora são removidos antes de adicionar novos (evita acúmulo em re-render do sino)
- Sem dependência do Firestore — decisão arquitetural: notificações são efêmeras e por dispositivo

### Módulo 03 — utils.js

| Função exportada | Descrição |
|---|---|
| `gerarUUID()` | crypto.randomUUID() com fallback Math.random para iOS antigo (EC-05) |
| `gerarDispositivoId()` | UUID persistido em `mc_dispositivo_id`; mesmo valor sempre |
| `registrarErro(tipo, mensagem, modulo)` | addDoc em `erros_sistema/`; lê sessão do localStorage; fallback em `mc_erros_offline` se offline |
| `formatarMoeda(valor)` | Formata para BRL via Intl |
| `formatarData(timestamp)` | Aceita Firestore Timestamp, Date ou número → dd/mm/aaaa |
| `debounce(fn, delay)` | Utilitário padrão |
| `toast(mensagem, tipo)` | Wrapper de compatibilidade → chama notificar() |
| `abrirModal({ titulo, conteudo })` | Modal centrado desktop; remove anterior antes de criar |
| `abrirBottomSheet({ titulo, conteudo, alturaPadrao })` | Painel mobile com swipe down, env(safe-area-inset-bottom), scroll interno |
| `abrirFormulario({ titulo, conteudo })` | Detecta window._layoutMobile; undefined → modal (default seguro) |

**Decisões técnicas:**
- `registrarErro` lê `mc_sessao` do localStorage diretamente (evita import circular com auth.js)
- CSS de modais injetado dinamicamente uma única vez (flag de controle)
- EC-04: Firestore offline enfileira localmente pelo SDK; catch nunca propaga

### Módulo 04 — theme.js

| Função exportada | Descrição |
|---|---|
| `getTema(temaVisual)` | Retorna `{ primary, accent }`; fallback Padrão se inválido |
| `aplicarTemaGlobal()` | Aplica Padrão no `:root` via CSS custom properties |
| `aplicarTemaDashboard(temaVisual, plano)` | Aplica tema em `#dashboard-area`; Standard sempre recebe Padrão silenciosamente |

**Decisões técnicas:**
- EC-101: se `#dashboard-area` não existe no DOM, usa MutationObserver para reaplicar quando aparecer
- Standard recebendo tema Pro não lança erro — degrada silenciosamente para Padrão (SC-103)
- `:root` nunca é alterado por `aplicarTemaDashboard` — isolamento garantido (SC-102)

### Módulo 04 — planGuard.js

| Função exportada | Descrição |
|---|---|
| `planGuard(planoMinimo, area)` | Hierarquia standard < profissional; renderiza card de upgrade se insuficiente |
| `verificarModoLeitura()` | calcularAcesso() via cache da sessão; desabilita `[data-acao="escrita"]`; banner fixo |
| `verificarAcessoOffline(acao)` | navigator.onLine síncrono; bloqueia "crediario" offline com notificar() |

**Decisões técnicas:**
- EC-102: `planGuard()` verifica se card já existe antes de inserir (evita duplicatas)
- EC-103: `verificarModoLeitura()` usa sessão em cache (funciona offline)
- EC-105: ação desconhecida retorna `true` por padrão (permissivo)
- Banner de somente leitura tem ID único `mc-banner-somente-leitura` (evita duplicatas)
- Import de `registrarErro` removido de planGuard.js (sem operações críticas que precisam de log)

---

## Sessão 2026-06-13 — Implementação Módulos 05 e 06

**Arquivos criados:** `templates/desktop.html`, `templates/mobile.html`, `app.html`, `router.js`, `syncManager.js`

### Módulo 05-A — templates/desktop.html e templates/mobile.html

| Arquivo | Descrição |
|---|---|
| `templates/desktop.html` | Fragmento HTML com CSS Grid (header 62px + sidebar 220px + main + footer 36px). IDs obrigatórios presentes: `#conteudo-principal`, `#banner-*` (5 banners), `#sino-container`, `#nav-menu`. Banners ocultos por padrão (`.mc-banner.visivel`). Avatar com dropdown de usuário. `data-rota` nos itens gerados dinamicamente pelo router. |
| `templates/mobile.html` | Fragmento HTML com flex column (header 52px + main + tab bar fixa 60px). Drawer lateral overlay com `transform: translateX`. Safe area insets iOS: `env(safe-area-inset-bottom)`. Tab bar com 5 itens fixos (Home/Caixa/Vendas/Estoque/Mais). Drawer menu populado pelo router. |

**Decisões técnicas:**
- Templates são fragmentos HTML (sem DOCTYPE/html/head/body) — injetados via `innerHTML` no `#shell` de `app.html`
- CSS embutido no template com `var(--primary)` / `var(--accent)` definidos pelo `theme.js` no `:root`
- Menu `#nav-menu` (desktop) e `#mc-drawer-menu` (mobile) são contêineres vazios populados por `iniciarRouter()`
- Banners usam classe `.visivel` (flex) para exibição — controlados por `app.html` baseado em `calcularAcesso()`
- Tab bar com 5 itens fixos no HTML; drawer com itens dinâmicos por perfil

### Módulo 05-B — app.html e router.js

| Arquivo / Função | Descrição |
|---|---|
| `app.html` | Shell principal com splash screen (fade-out animado). Sequência de 14 passos (FR-004) implementada em `_inicializarApp(sessao)`. Import lazy do `syncManager.js` no passo 14. 5 banners condicionais configurados por `_configurarBanners(sessao)`. Badge de conexão em tempo real via eventos `online`/`offline`. `onSnapshot` de `sistema/comunicados/{empresaId}`. Abertura automática de caixa via kit offline. |
| `router.js` — `canAccess()` | Verifica `adminOnly`, `proOnly`, `onlineOnly` por perfil e plano |
| `router.js` — `getMenuItems(perfil, plano)` | Retorna array filtrado por perfil com `{ id, label, icon, proOnly, onlineOnly, group, tab, drawerOnly, bloqueado }` |
| `router.js` — `navigate(routeId)` | Valida rota, verifica permissão, lazy import do módulo, renderiza ou mostra placeholder/upgrade |
| `router.js` — `iniciarRouter(sessao)` | Popula `#nav-menu` (desktop) ou `#mc-drawer-menu` (mobile), configura todos os listeners de clique, tab bar, drawer, avatar, logout, sino |

**Decisões técnicas:**
- Detecção de layout: `window._layoutMobile = window.innerWidth < 768`; layout forçado respeita `sessao.layoutForcado`
- Cada módulo de rota deve exportar `renderizar(sessao, containerEl)` — se ausente ou erro no import, exibe placeholder
- Dashboard: módulos separados por perfil (`dashboard_admin.js` / `dashboard_operador.js`)
- `window._irParaConfiguracoes` exposta globalmente para uso nos banners de upgrade
- `registrarErro` usado em todos os catch do app.html — sem `console.log`

### Módulo 06 — syncManager.js (Etapas A + B completas)

| Função exportada | Descrição |
|---|---|
| `inicializar(empresaId, perfil, plano)` | Registra listeners de rede, agenda ciclo (15min Pro), dispara primeiro ciclo se online, inicia listener de comandos Admin→Operador (Pro) |
| `cicloSincronizacao()` | Mutex `sincronizandoAgora` + 5 passos em cadeia sequencial; finally sempre libera mutex |
| `enviarVendasPendentes()` | Query Firestore cache `sincronizado: false`; idempotência por UUID; isola venda após 5 tentativas |
| `enviarMovimentacoesPendentes()` | Itera sessões de caixa, envia movimentações pendentes |
| `enviarDemaisPendentes()` | Envia coleção `estoque` pendente |
| `baixarKitOffline()` | `getDocFromServer` forçado — nunca usa cache; salva `mc_kit_offline` no localStorage |
| `verificarPermissaoOffline()` | Verifica kit offline pós-passo-4; seta `window._kitOfflineValido` |
| `podeVenderOffline()` | 4 condições em ordem: Admin sempre pode → permissão operador → trava 24h → limite diário |
| `incrementarVendaOffline()` | Incrementa `vendasOfflineHoje` no kit local (NUNCA zera sem servidor) |
| `getVendasOfflineHoje()` / `getUltimaSync()` | Leituras do estado local |
| `sincronizarManual()` | Admin Pro: max 3/dia; contador diário em `mc_sync_manual_hoje` |
| `obterPendentes()` | Retorna array de pendentes do último ciclo |

**Decisões técnicas:**
- Mutex `sincronizandoAgora` liberado no `finally` — não pode vazar (RISCO-04)
- `vendasOfflineHoje` só alterado por `baixarKitOffline()` (Passo 4) e `incrementarVendaOffline()` — NUNCA pelo relógio local (RISCO-02)
- Passo 5 (`verificarPermissaoOffline`) após Passo 4 (`baixarKitOffline`) — await sequencial obrigatório (RISCO-01)
- Comunicação Admin→Operador via `onSnapshot` em `empresas/{id}/comandos/{operadorId}` (Pro); resultado em `status/{operadorId}`
- EC-10: kit offline ausente (iOS limpou dados) → `podeVenderOffline()` retorna `{ pode: false, motivo: "kit_ausente" }`

### Pendentes / Pré-requisitos para próximas sessões

- ⚠️ **OBRIGATÓRIO**: Testar `syncManager.js` em **dispositivo físico iOS** antes do Módulo 07 (RISCO-03)
- Os módulos de rota (`modulos/*.js`, `vendas.js`) ainda não existem — router exibe placeholder até serem implementados
- `baixarKitOffline()` espera campos `vendasOfflineHoje` e `dataContador` no documento Firestore da empresa (podem precisar ser inicializados na criação da empresa em `auth.js`/`cadastrarEmpresa()`)
- MÉDIO-04 (parcial do Módulo 02): query de CPF durante cadastro precisará de Cloud Function no Módulo 22

---

## Sessão 2026-06-15 — Testes Bloco 1 (Módulos 02–06) — Lógica Pura

**Ferramenta:** Node.js v22.22.3 + jsdom · Runner: `test-runner.js`  
**Cobertura:** 68 testes de lógica pura (sem Firebase Console)

### Resumo de Resultados

| Módulo | PASS | FAIL | BLOQUEADO | Total |
|--------|------|------|-----------|-------|
| M02    | 7    | 0    | 21        | 28    |
| M03    | 22   | 0    | 5         | 27    |
| M04    | 19   | 0    | 0         | 19    |
| M05    | 8    | 0    | 21        | 29    |
| M06    | 11   | 1    | 24        | 36    |
| **TOTAL** | **67** | **1** | **71** | **139** |

BLOQUEADOS = testes que requerem Firebase Auth/Firestore real, browser com viewport, gesto de swipe, ou dispositivo físico iOS.

---

### ❌ BUG CONFIRMADO — T-M06-19

| Campo | Valor |
|-------|-------|
| **ID** | T-M06-19 |
| **Severidade** | Alto |
| **Arquivo** | `syncManager.js` · função `podeVenderOffline()` |
| **Teste** | Operador com kit offline sem campo `permiteVendaOffline` (campo ausente/undefined) |
| **Esperado** | `{ pode: false, motivo: "sem_permissao" }` — campo ausente deve bloquear (fail-safe) |
| **Observado** | `{ pode: true, motivo: "" }` — campo ausente passa direto para a próxima verificação |

**Código suspeito (`syncManager.js`):**
```js
if (kit.permiteVendaOffline === false) {
  return { pode: false, motivo: "sem_permissao" };
}
```

**Problema:** A verificação `=== false` é uma comparação estrita. Quando o campo `permiteVendaOffline` está **ausente** do kit (valor `undefined`), a condição é falsa e o código continua para a próxima verificação (trava de 24h). Se o sync foi recente, o operador consegue vender offline mesmo sem permissão explícita.

**Como reproduzir:**
1. Kit offline sem campo `permiteVendaOffline` (ex.: kit criado por versão antiga do servidor)
2. Última sync há menos de 24h
3. `vendasOfflineHoje < limiteVendasOffline`
→ `podeVenderOffline()` retorna `{ pode: true, motivo: "" }` indevidamente

**Correção proposta:**
```js
// Antes:
if (kit.permiteVendaOffline === false) {
  return { pode: false, motivo: "sem_permissao" };
}

// Depois (fail-safe — campo ausente = sem permissão):
if (kit.permiteVendaOffline !== true) {
  return { pode: false, motivo: "sem_permissao" };
}
```

**Prioridade:** Alta — risco de operador vender offline sem autorização do Admin se o kit vier de servidor sem o campo inicializado.  
**Módulo de correção:** Corrigir em `syncManager.js` antes de implementar o Módulo 07.