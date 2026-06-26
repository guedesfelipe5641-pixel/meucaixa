import { db, storage } from "../firebase-config.js";
import {
  collection, getDocs, addDoc, updateDoc, doc,
  query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";
import { abrirFormulario, registrarErro } from "../utils.js";
import { notificar } from "../notificacoes.js";

let _produtos         = [];
let _produtosInativos = [];
let _empresaId        = "";
let _somenteLeitura   = false;
let _perfil           = "admin";
let _fotoBase64       = null;

// ── Código sequencial ────────────────────────────────────────────────────────

async function _proximoCodigo() {
  const snap = await getDocs(collection(db, `empresas/${_empresaId}/produtos`));
  let max = 0;
  snap.forEach(d => {
    const n = parseInt((d.data().codigo || "").replace("PRD", ""), 10);
    if (!isNaN(n) && n > max) max = n;
  });
  return "PRD" + String(max + 1).padStart(3, "0");
}

// ── Carregamento ─────────────────────────────────────────────────────────────

async function _carregar() {
  const q = query(
    collection(db, `empresas/${_empresaId}/produtos`),
    orderBy("nome")
  );
  const snap = await getDocs(q);
  _produtos         = [];
  _produtosInativos = [];
  snap.forEach(d => {
    const data = d.data();
    if (data.ativo === false) _produtosInativos.push({ id: d.id, ...data });
    else                      _produtos.push({ id: d.id, ...data });
  });
}

// ── Filtro ───────────────────────────────────────────────────────────────────

function _filtrar(lista, termo) {
  if (!termo) return lista;
  const t = termo.toLowerCase();
  return lista.filter(p =>
    (p.nome          || "").toLowerCase().includes(t) ||
    (p.codigo        || "").toLowerCase().includes(t) ||
    (p.codigoInterno || "").toLowerCase().includes(t) ||
    (p.categoria     || "").toLowerCase().includes(t)
  );
}

// ── Badges ───────────────────────────────────────────────────────────────────

function _badges(p) {
  const badges = [];
  const atual = Number(p.estoqueAtual ?? 0);
  const min   = Number(p.estoqueMinimo ?? 0);

  if (p.controlarEstoque === true && atual <= 0) {
    badges.push(`<span class="tag tag-danger" style="margin-left:6px">Sem estoque</span>`);
  } else if (atual <= min && min > 0 && atual > 0) {
    badges.push(`<span class="tag tag-accent" style="margin-left:6px">Estoque baixo</span>`);
  }

  if (p.ultimaSaidaEm) {
    const dias = (Date.now() - Number(p.ultimaSaidaEm)) / 86400000;
    if (dias > 30) {
      badges.push(`<span class="tag tag-neutral" style="margin-left:6px">Parado</span>`);
    }
  }

  return badges.join("");
}

// ── Renderização ─────────────────────────────────────────────────────────────

function _botoesAcao(p, contexto = "ativo") {
  if (_somenteLeitura || _perfil !== "admin") return "";
  if (contexto === "inativo") {
    return `<button class="btn btn-sm btn-success" data-reativar="${p.id}">Reativar</button>`;
  }
  return `
    <button class="btn btn-sm btn-secondary" data-editar="${p.id}" style="margin-right:6px">Editar</button>
    <button class="btn btn-sm btn-danger" data-desativar="${p.id}">Desativar</button>`;
}

function _renderizarTabela(lista, container, contexto) {
  const temAcoes = !_somenteLeitura && _perfil === "admin";
  const cols = temAcoes ? 6 : 5;
  container.innerHTML = `
    <div class="table-responsive">
      <table class="table" style="margin-top:4px">
        <thead>
          <tr>
            <th>Código</th>
            <th>Nome</th>
            <th>Preço Custo</th>
            <th>Preço Venda</th>
            <th>Estoque</th>
            ${temAcoes ? "<th>Ações</th>" : ""}
          </tr>
        </thead>
        <tbody>
          ${lista.length === 0
            ? `<tr><td colspan="${cols}" style="text-align:center;color:#aaa;padding:32px">Nenhum produto encontrado.</td></tr>`
            : lista.map(p => `
              <tr>
                <td><span class="tag tag-neutral">${p.codigo || ""}</span></td>
                <td>
                  ${p.fotoUrl ? `<img src="${p.fotoUrl}" data-lightbox="${p.fotoUrl}" style="width:32px;height:32px;object-fit:cover;border-radius:6px;vertical-align:middle;margin-right:6px;cursor:zoom-in" loading="lazy">` : ""}${p.nome || ""}${_badges(p)}
                </td>
                <td>R$ ${Number(p.precoCusto || 0).toFixed(2)}</td>
                <td>${p.precoVenda ? `R$ ${Number(p.precoVenda).toFixed(2)}` : "—"}</td>
                <td>${p.controlarEstoque === false ? "—" : Number(p.estoqueAtual ?? 0)}</td>
                ${temAcoes ? `<td>${_botoesAcao(p, contexto)}</td>` : ""}
              </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
}

function _renderizarCards(lista, container, contexto) {
  if (lista.length === 0) {
    container.innerHTML = `<p style="text-align:center;color:#aaa;padding:32px">Nenhum produto encontrado.</p>`;
    return;
  }
  const temAcoes = !_somenteLeitura && _perfil === "admin";
  container.innerHTML = `<div style="display:flex;flex-direction:column;gap:12px;margin-top:4px">` +
    lista.map(p => `
      <div class="card fade-up" style="overflow:hidden">
        <div style="padding:16px 16px 12px;display:flex;gap:12px;align-items:flex-start">
          ${p.fotoUrl ? `<img src="${p.fotoUrl}" data-lightbox="${p.fotoUrl}" style="width:56px;height:56px;object-fit:cover;border-radius:10px;flex-shrink:0;margin-top:2px;cursor:zoom-in" loading="lazy">` : ""}
          <div style="flex:1;min-width:0">
          <div style="font-size:17px;font-weight:700;color:var(--text);line-height:1.3;margin-bottom:6px">${p.nome || ""}</div>
          <div style="display:flex;align-items:center;flex-wrap:wrap;gap:5px;margin-bottom:10px">
            <span class="tag tag-neutral">${p.codigo || ""}</span>${_badges(p)}
          </div>
          <div style="font-size:15px;color:#666;display:flex;flex-direction:column;gap:4px">
            <span>Custo: R$ ${Number(p.precoCusto || 0).toFixed(2)}${p.precoVenda ? `  ·  Venda: R$ ${Number(p.precoVenda).toFixed(2)}` : ""}</span>
            ${p.controlarEstoque !== false ? `<span>Estoque: ${Number(p.estoqueAtual ?? 0)}</span>` : ""}
            ${p.categoria ? `<span>${p.categoria}</span>` : ""}
          </div>
          </div>
        </div>
        ${temAcoes ? `<div style="border-top:1px solid rgba(0,0,0,.05);padding:10px 16px;display:flex;gap:8px">${_botoesAcao(p, contexto)}</div>` : ""}
      </div>`).join("") +
    `</div>`;
}

function _renderizarLista(lista, container, contexto) {
  if (window._layoutMobile) {
    _renderizarCards(lista, container, contexto);
  } else {
    _renderizarTabela(lista, container, contexto);
  }
}

function _renderizarAbas(listContainer, aba) {
  document.querySelectorAll("#prd-tabs .pill-tab").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tab === aba);
  });

  const countAtivos   = document.getElementById("prd-count-ativos");
  const countInativos = document.getElementById("prd-count-inativos");
  if (countAtivos)   countAtivos.textContent   = `(${_produtos.length})`;
  if (countInativos) countInativos.textContent = `(${_produtosInativos.length})`;

  const busca = document.getElementById("prd-busca");
  if (busca) busca.value = "";

  const lista = aba === "inativos" ? _produtosInativos : _produtos;
  _renderizarLista(lista, listContainer, aba === "inativos" ? "inativo" : "ativo");
}

// ── Formulário ───────────────────────────────────────────────────────────────

async function _carregarFornecedores() {
  try {
    const snap = await getDocs(collection(db, `empresas/${_empresaId}/fornecedores`));
    const lista = [];
    snap.forEach(d => {
      const data = d.data();
      if (data.ativo !== false) lista.push({ id: d.id, nomeFantasia: data.nomeFantasia || "" });
    });
    return lista.sort((a, b) => a.nomeFantasia.localeCompare(b.nomeFantasia));
  } catch {
    return [];
  }
}

function _htmlFormulario(p, fornecedores) {
  const v = p || {};
  const opts = fornecedores.map(f =>
    `<option value="${f.id}" ${v.fornecedorId === f.id ? "selected" : ""}>${f.nomeFantasia}</option>`
  ).join("");
  return `
    <form id="form-produto" autocomplete="off">
      <div class="form-grid">
        <div class="form-group">
          <label class="lbl">Nome *</label>
          <input class="input" type="text" id="prd-nome" value="${v.nome || ""}" maxlength="100" placeholder="Nome do produto">
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="lbl">Código Interno</label>
            <input class="input" type="text" id="prd-codigo-interno" value="${v.codigoInterno || ""}" maxlength="30" placeholder="Ex: SKU-001">
          </div>
          <div class="form-group">
            <label class="lbl">Categoria</label>
            <input class="input" type="text" id="prd-categoria" value="${v.categoria || ""}" maxlength="60" placeholder="Ex: Celulares">
          </div>
        </div>
        <div class="form-group">
          <label class="lbl">Fornecedor</label>
          <select class="input select" id="prd-fornecedor">
            <option value="">Sem fornecedor</option>
            ${opts}
          </select>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="lbl">Preço de Custo * (R$)</label>
            <input class="input" type="number" id="prd-custo" value="${v.precoCusto || ""}" min="0" step="0.01" placeholder="0,00">
          </div>
          <div class="form-group">
            <label class="lbl">Preço de Venda (R$)</label>
            <input class="input" type="number" id="prd-venda" value="${v.precoVenda || ""}" min="0" step="0.01" placeholder="0,00">
          </div>
        </div>
        <div id="prd-margem" style="font-size:13px;color:#888;margin-top:-8px;min-height:18px"></div>
        <div class="form-row">
          <div class="form-group">
            <label class="lbl">Estoque Mínimo</label>
            <input class="input" type="number" id="prd-estoque-min" value="${v.estoqueMinimo ?? 0}" min="0" step="1">
          </div>
          ${!p ? `
          <div class="form-group">
            <label class="lbl">Estoque Inicial</label>
            <input class="input" type="number" id="prd-estoque-ini" value="0" min="0" step="1" placeholder="0">
          </div>` : `
          <div class="form-group" style="display:flex;align-items:center;padding-top:22px;gap:8px">
            <input type="checkbox" id="prd-controlar" ${v.controlarEstoque === false ? "" : "checked"} style="width:18px;height:18px;cursor:pointer">
            <label for="prd-controlar" class="lbl" style="margin:0;cursor:pointer">Controlar estoque</label>
          </div>`}
        </div>
        ${!p ? `
        <div class="form-group" style="display:flex;align-items:center;gap:8px">
          <input type="checkbox" id="prd-controlar" checked style="width:18px;height:18px;cursor:pointer">
          <label for="prd-controlar" class="lbl" style="margin:0;cursor:pointer">Controlar estoque</label>
        </div>` : ""}
        <div class="form-group">
          <label class="lbl">Foto do Produto</label>
          <label for="prd-foto" id="prd-upload-label" style="display:flex;align-items:center;gap:10px;padding:12px 14px;border:1.5px dashed rgba(0,0,0,.18);border-radius:10px;cursor:pointer;background:rgba(0,0,0,.02);font-size:13.5px;color:#888;transition:border-color .18s">
            📷 <span id="prd-foto-nome">${p?.fotoUrl ? "Trocar foto" : "Clique para escolher foto (JPG ou PNG)"}</span>
          </label>
          <input type="file" id="prd-foto" accept="image/jpeg,image/png" style="display:none">
          ${p?.fotoUrl ? `
          <div id="prd-preview-foto" style="margin-top:8px;display:flex;align-items:center;gap:10px">
            <img id="prd-img-preview" src="${p.fotoUrl}" alt="Foto" data-lightbox="${p.fotoUrl}" style="width:72px;height:72px;object-fit:cover;border-radius:10px;border:1.5px solid rgba(0,0,0,.1);cursor:zoom-in">
            <span style="font-size:12px;color:#aaa">Toque para ampliar</span>
          </div>` : `
          <div id="prd-preview-foto" style="margin-top:8px;display:none;align-items:center;gap:10px">
            <img id="prd-img-preview" src="" alt="Preview" data-lightbox="" style="width:72px;height:72px;object-fit:cover;border-radius:10px;border:1.5px solid rgba(0,0,0,.1);cursor:zoom-in">
            <span style="font-size:12px;color:#aaa">Toque para ampliar</span>
          </div>`}
        </div>
        <div class="form-group">
          <label class="lbl">Observações</label>
          <textarea class="input" id="prd-obs" maxlength="300" rows="2" style="resize:vertical">${v.obs || ""}</textarea>
        </div>
        <button type="submit" id="prd-salvar" class="btn btn-primary" style="width:100%;justify-content:center;margin-top:4px" disabled>Salvar</button>
      </div>
    </form>`;
}

function _bindMargem() {
  const inputCusto = document.getElementById("prd-custo");
  const inputVenda = document.getElementById("prd-venda");
  const divMargem  = document.getElementById("prd-margem");

  function _atualizar() {
    const custo = parseFloat(inputCusto?.value);
    const venda = parseFloat(inputVenda?.value);
    if (!divMargem) return;
    if (!isNaN(custo) && !isNaN(venda) && custo > 0 && venda > 0) {
      const margem = ((venda - custo) / venda * 100).toFixed(1);
      divMargem.textContent = `Margem: ${margem}%`;
    } else {
      divMargem.textContent = "";
    }
  }

  inputCusto?.addEventListener("input", _atualizar);
  inputVenda?.addEventListener("input", _atualizar);
  _atualizar();
}

function _abrirLightbox(src) {
  if (!src) return;
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.88);display:flex;align-items:center;justify-content:center;cursor:zoom-out";
  const imgEl = document.createElement("img");
  imgEl.src = src;
  imgEl.style.cssText = "max-width:90vw;max-height:90vh;border-radius:12px;box-shadow:0 8px 40px rgba(0,0,0,.5);object-fit:contain";
  overlay.appendChild(imgEl);
  const fechar = () => { overlay.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = e => { if (e.key === "Escape") fechar(); };
  overlay.addEventListener("click", fechar);
  document.addEventListener("keydown", onKey);
  document.body.appendChild(overlay);
}

function _bindFoto() {
  _fotoBase64 = null;
  const input   = document.getElementById("prd-foto");
  const preview = document.getElementById("prd-preview-foto");
  const img     = document.getElementById("prd-img-preview");
  const nomeEl  = document.getElementById("prd-foto-nome");
  const labelEl = document.getElementById("prd-upload-label");
  if (!input) return;

  img?.addEventListener("click", () => {
    const src = _fotoBase64 || (img.src && img.src !== window.location.href ? img.src : null);
    if (src) _abrirLightbox(src);
  });

  input.addEventListener("change", () => {
    const file = input.files[0];
    if (!file) return;
    if (nomeEl) nomeEl.textContent = file.name;
    const reader = new FileReader();
    reader.onload = e => {
      const original = new Image();
      original.onload = () => {
        const MAX = 800;
        let w = original.width;
        let h = original.height;
        if (w > MAX || h > MAX) {
          if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
          else       { w = Math.round(w * MAX / h); h = MAX; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(original, 0, 0, w, h);
        _fotoBase64 = canvas.toDataURL("image/jpeg", 0.80);
        if (img)     { img.src = _fotoBase64; img.dataset.lightbox = _fotoBase64; }
        if (preview) preview.style.display = "flex";
        if (labelEl) labelEl.style.borderColor = "var(--accent)";
        if (nomeEl)  nomeEl.style.color = "var(--text)";
      };
      original.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function _coletarDados() {
  const iniEl = document.getElementById("prd-estoque-ini");
  return {
    nome:             document.getElementById("prd-nome").value.trim(),
    codigoInterno:    document.getElementById("prd-codigo-interno").value.trim(),
    categoria:        document.getElementById("prd-categoria").value.trim(),
    fornecedorId:     document.getElementById("prd-fornecedor").value,
    precoCusto:       parseFloat(document.getElementById("prd-custo").value) || 0,
    precoVenda:       parseFloat(document.getElementById("prd-venda").value) || 0,
    estoqueMinimo:    parseInt(document.getElementById("prd-estoque-min").value, 10) || 0,
    controlarEstoque: document.getElementById("prd-controlar").checked,
    obs:              document.getElementById("prd-obs").value.trim(),
    ...(iniEl !== null ? { estoqueAtual: parseInt(iniEl.value, 10) || 0 } : {}),
  };
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

async function _abrirCriacao(listContainer) {
  const [codigo, fornecedores] = await Promise.all([_proximoCodigo(), _carregarFornecedores()]);
  abrirFormulario({ titulo: `Novo Produto — ${codigo}`, conteudo: _htmlFormulario(null, fornecedores) });

  const form      = document.getElementById("form-produto");
  const btnSalvar = document.getElementById("prd-salvar");
  const validar   = () => {
    const nome  = document.getElementById("prd-nome").value.trim();
    const custo = document.getElementById("prd-custo").value.trim();
    btnSalvar.disabled = !nome || !custo;
  };
  form.addEventListener("input", validar);
  _bindMargem();
  _bindFoto();

  form.addEventListener("submit", async e => {
    e.preventDefault();
    btnSalvar.disabled = true;
    try {
      const dados = _coletarDados();
      const docRef = await addDoc(collection(db, `empresas/${_empresaId}/produtos`), {
        ...dados, codigo, ativo: true, createdAt: serverTimestamp()
      });

      // Registrar entrada inicial no histórico de estoque
      if ((dados.estoqueAtual || 0) > 0 && dados.controlarEstoque !== false) {
        await addDoc(collection(db, `empresas/${_empresaId}/estoque`), {
          produtoId:    docRef.id,
          nomeProduto:  dados.nome,
          tipo:         "entrada",
          quantidade:   dados.estoqueAtual,
          motivo:       "Estoque inicial",
          operadorId:   _uid,
          criadoOffline: false,
          sincronizado:  true,
          createdAt:    serverTimestamp(),
        });
      }

      if (_fotoBase64 && navigator.onLine) {
        try {
          const storageRef = ref(storage, `empresas/${_empresaId}/produtos/${docRef.id}.jpg`);
          const blob = await fetch(_fotoBase64).then(r => r.blob());
          await uploadBytes(storageRef, blob, { contentType: "image/jpeg" });
          const fotoUrl = await getDownloadURL(storageRef);
          await updateDoc(docRef, { fotoUrl });
        } catch (fotoErr) {
          await registrarErro("storage", fotoErr.message, "produtos.js");
        }
      } else if (_fotoBase64) {
        notificar("aviso", "Foto não salva", "Produto criado. Adicione a foto quando estiver online.");
      }

      document.querySelector(".mc-modal-overlay, .mc-bs-overlay")?.remove();
      notificar("sucesso", "Produto salvo", `${dados.nome} adicionado como ${codigo}.`);
      await _carregar();
      _renderizarAbas(listContainer, "ativos");
    } catch (err) {
      await registrarErro("firestore", err.message, "produtos.js");
      notificar("erro", "Erro ao salvar", "Não foi possível salvar o produto.");
      btnSalvar.disabled = false;
    }
  });
}

async function _abrirEdicao(produtoId, listContainer) {
  const p = _produtos.find(x => x.id === produtoId);
  if (!p) return;
  const fornecedores = await _carregarFornecedores();
  abrirFormulario({ titulo: `Editar — ${p.codigo}`, conteudo: _htmlFormulario(p, fornecedores) });

  const form      = document.getElementById("form-produto");
  const btnSalvar = document.getElementById("prd-salvar");
  const validar   = () => {
    const nome  = document.getElementById("prd-nome").value.trim();
    const custo = document.getElementById("prd-custo").value.trim();
    btnSalvar.disabled = !nome || !custo;
  };
  form.addEventListener("input", validar);
  validar();
  _bindMargem();
  _bindFoto();

  form.addEventListener("submit", async e => {
    e.preventDefault();
    btnSalvar.disabled = true;
    try {
      const dados = _coletarDados();
      let extra = {};

      if (_fotoBase64 && navigator.onLine) {
        try {
          const storageRef = ref(storage, `empresas/${_empresaId}/produtos/${produtoId}.jpg`);
          const blob = await fetch(_fotoBase64).then(r => r.blob());
          await uploadBytes(storageRef, blob, { contentType: "image/jpeg" });
          extra.fotoUrl = await getDownloadURL(storageRef);
        } catch (fotoErr) {
          await registrarErro("storage", fotoErr.message, "produtos.js");
        }
      } else if (_fotoBase64) {
        notificar("aviso", "Foto não atualizada", "Salve a foto quando estiver online.");
      }

      await updateDoc(doc(db, `empresas/${_empresaId}/produtos`, produtoId), { ...dados, ...extra });
      document.querySelector(".mc-modal-overlay, .mc-bs-overlay")?.remove();
      notificar("sucesso", "Produto atualizado", `${dados.nome} atualizado.`);
      await _carregar();
      _renderizarAbas(listContainer, "ativos");
    } catch (err) {
      await registrarErro("firestore", err.message, "produtos.js");
      notificar("erro", "Erro ao salvar", "Não foi possível atualizar o produto.");
      btnSalvar.disabled = false;
    }
  });
}

async function _desativar(produtoId, listContainer) {
  const p = _produtos.find(x => x.id === produtoId);
  if (!p) return;
  if (!window.confirm(`Desativar "${p.nome}"? O registro não será apagado.`)) return;
  try {
    await updateDoc(doc(db, `empresas/${_empresaId}/produtos`, produtoId), { ativo: false });
    notificar("sucesso", "Desativado", `${p.nome} foi desativado.`);
    await _carregar();
    _renderizarAbas(listContainer, "ativos");
  } catch (err) {
    await registrarErro("firestore", err.message, "produtos.js");
    notificar("erro", "Erro", "Não foi possível desativar o produto.");
  }
}

async function _reativar(produtoId, listContainer) {
  const p = _produtosInativos.find(x => x.id === produtoId);
  if (!p) return;
  if (!window.confirm(`Reativar "${p.nome}"?`)) return;
  try {
    await updateDoc(doc(db, `empresas/${_empresaId}/produtos`, produtoId), { ativo: true });
    notificar("sucesso", "Reativado", `${p.nome} foi reativado.`);
    await _carregar();
    _renderizarAbas(listContainer, "inativos");
  } catch (err) {
    await registrarErro("firestore", err.message, "produtos.js");
    notificar("erro", "Erro", "Não foi possível reativar o produto.");
  }
}

// ── Entrada do módulo ────────────────────────────────────────────────────────

export async function renderizar(sessao, containerEl) {
  _empresaId      = sessao.empresaId;
  _somenteLeitura = sessao.acesso === "somente_leitura";
  _perfil         = sessao.perfil;

  containerEl.innerHTML = `<p style="color:#aaa;padding:24px">Carregando produtos…</p>`;

  try {
    await _carregar();
  } catch (err) {
    await registrarErro("firestore", err.message, "produtos.js");
    notificar("erro", "Erro ao carregar", "Não foi possível carregar a lista de produtos.");
    containerEl.innerHTML = `<p style="text-align:center;color:#aaa;padding:40px">Erro ao carregar produtos.</p>`;
    return;
  }

  const podeCriar = !_somenteLeitura && _perfil === "admin";

  containerEl.innerHTML = `
    <div class="section-header">
      <h2>Produtos</h2>
      ${podeCriar ? `<button id="prd-novo" class="btn btn-primary">+ Novo Produto</button>` : ""}
    </div>
    <div class="pill-tabs" id="prd-tabs" style="margin-bottom:16px">
      <button class="pill-tab active" data-tab="ativos">Ativos <span id="prd-count-ativos"></span></button>
      <button class="pill-tab" data-tab="inativos">Inativos <span id="prd-count-inativos"></span></button>
    </div>
    <div style="margin-bottom:16px">
      <input type="search" id="prd-busca" class="input" placeholder="Buscar por nome, código ou categoria…" style="max-width:360px">
    </div>
    <div id="prd-lista"></div>`;

  const listContainer = document.getElementById("prd-lista");

  _renderizarAbas(listContainer, "ativos");

  document.getElementById("prd-busca").addEventListener("input", e => {
    const abaAtiva = document.querySelector("#prd-tabs .pill-tab.active")?.dataset.tab || "ativos";
    const lista = abaAtiva === "inativos" ? _produtosInativos : _produtos;
    _renderizarLista(_filtrar(lista, e.target.value), listContainer, abaAtiva === "inativos" ? "inativo" : "ativo");
  });

  document.getElementById("prd-tabs").addEventListener("click", e => {
    const tab = e.target.closest(".pill-tab")?.dataset.tab;
    if (tab) _renderizarAbas(listContainer, tab);
  });

  if (podeCriar) {
    document.getElementById("prd-novo").addEventListener("click", () => _abrirCriacao(listContainer));
  }

  listContainer.addEventListener("click", e => {
    const lbSrc = e.target.closest("[data-lightbox]")?.dataset.lightbox;
    if (lbSrc) { _abrirLightbox(lbSrc); return; }

    const idEditar    = e.target.dataset.editar;
    const idDesativar = e.target.dataset.desativar;
    const idReativar  = e.target.dataset.reativar;
    if (idEditar)    _abrirEdicao(idEditar, listContainer);
    if (idDesativar) _desativar(idDesativar, listContainer);
    if (idReativar)  _reativar(idReativar, listContainer);
  });
}
