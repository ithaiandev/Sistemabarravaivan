'use strict';
/* =============================================================
   Barraca do Ivan — Gestão Pro (versão 2)
   Página estática + Supabase (login e banco com RLS por usuário).
   ============================================================= */

// ---------------- Utilidades ----------------
const $ = id => document.getElementById(id);
const n = v => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const round2 = v => Math.round(n(v) * 100) / 100;
const money = v => n(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const num = v => n(v).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const pct = v => Number.isFinite(v) ? v.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%' : '—';
const safe = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = x => String(x).padStart(2, '0');
const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => isoDate(new Date());
const parseDate = s => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (iso, k) => { const d = parseDate(iso); d.setDate(d.getDate() + k); return isoDate(d); };
const addMonths = (ym, k) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + k, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const daysInMonth = ym => { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate(); };
const fmtDate = s => /^\d{4}-\d{2}-\d{2}/.test(s || '') ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '—';
const fmtTime = s => { const d = new Date(s); return isNaN(d) ? '' : d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); };
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const MESES_CURTO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const DIAS_CURTO = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const fmtMonth = ym => { const [y, m] = ym.split('-'); return `${MESES[+m - 1]} de ${y}`; };
const fmtMonthShort = ym => { const [y, m] = ym.split('-'); return `${MESES_CURTO[+m - 1]}/${y.slice(2)}`; };
const sum = (arr, f) => arr.reduce((a, x) => a + n(f(x)), 0);
const byName = (a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR');
const inMonth = (d, ym) => typeof d === 'string' && d.startsWith(ym);
const inRange = (d, a, b) => typeof d === 'string' && d >= a && d <= b;
const LOW_STOCK = 5;
const MAX_ROWS = 300;
const CATEGORIAS_PRODUTO = ['Pratos', 'Porções', 'Bebidas', 'Sobremesas', 'Outros'];
const CATEGORIAS_SAIDA = [['Compras', 'Compras (mercadoria e insumos)'], 'Gelo', 'Gás', 'Energia', 'Água', 'Aluguel', 'Embalagens', 'Transporte', 'Taxas e maquininha', 'Manutenção', 'Salários', 'Impostos', 'Outros'];
const CATEGORIAS_ENTRADA = [['Vendas', 'Vendas fora do sistema'], 'Aporte do dono', 'Outros'];

// Preferências locais do navegador (só conveniência; o sistema funciona sem elas).
const store = {
  get(k, fallback) { try { const v = localStorage.getItem('barraca:' + k); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(k, v) { try { localStorage.setItem('barraca:' + k, JSON.stringify(v)); } catch { /* sem armazenamento */ } },
};

// ---------------- Estado ----------------
// optional: a tela continua funcionando se a tabela ainda não foi criada no banco.
// dateField: tabelas que crescem todo dia; só os últimos WINDOW_MONTHS meses são carregados.
const SOURCES = {
  produtos: { table: 'produtos', order: 'created_at' },
  vendas: { table: 'vendas', order: 'created_at', dateField: 'data' },
  movimentos: { table: 'movimentos', order: 'data', dateField: 'data' },
  funcionarios: { table: 'funcionarios', order: 'created_at', optional: true },
  pagamentos: { table: 'pagamentos_funcionarios', order: 'data', optional: true, dateField: 'data' },
  impostos: { table: 'impostos', order: 'vencimento', optional: true },
  pratos: { table: 'pratos_contagem', order: 'nome', asc: true, optional: true },
  contagens: { table: 'contagens_pratos', order: 'data', optional: true, dateField: 'data' },
};
const WINDOW_MONTHS = 12;
const validYm = v => /^\d{4}-(0[1-9]|1[0-2])$/.test(v || '') ? v : null;
// Primeiro dia carregado: 12 meses antes do mês selecionado (ou do mês atual, o que for mais antigo).
function windowFor() {
  const cur = today().slice(0, 7), sel = validYm($('periodo').value) || cur;
  return addMonths(sel < cur ? sel : cur, -WINDOW_MONTHS) + '-01';
}
const SETUP_FILES = { funcionarios: 'database-original.sql', pagamentos: 'folha-pagamentos.sql', impostos: 'impostos-upgrade.sql', pratos: 'contagem-pratos.sql', contagens: 'contagem-pratos.sql' };
const emptyData = () => Object.fromEntries(Object.keys(SOURCES).map(k => [k, []]));

let db = null, sessionId = 0, entered = false, loading = false, reloadQueued = false, lastLoad = 0, working = false;
let loaded = false, windowStart = null; // loaded: já chegou ao menos uma carga completa nesta sessão
let data = emptyData();
let lastToday = today();
const missing = new Set();
let pendentes = store.get('contagemPendente', {}); // { prato_id: quantidade ainda não salva }

// ---------------- Avisos e erros ----------------
function toast(msg, type = 'ok') {
  const el = document.createElement('div');
  el.className = 'toast toast-' + type;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.textContent = msg;
  $('toasts').append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, type === 'error' ? 7000 : 3200);
}
function friendly(e) {
  const m = e?.message || String(e);
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Sem conexão com a internet ou com o servidor. Tente novamente.';
  if (/Invalid login credentials/i.test(m)) return 'E-mail ou senha incorretos.';
  if (/Email not confirmed/i.test(m)) return 'E-mail ainda não confirmado.';
  if (/rate limit|too many/i.test(m)) return 'Muitas tentativas. Aguarde alguns minutos.';
  if (/JWT|token.*expired|Não autenticado/i.test(m)) return 'Sua sessão expirou. Entre novamente.';
  if (e?.code === '23505') return 'Já existe um registro igual.';
  if (e?.code === '23503') return 'Este registro está ligado a outros dados e não pode ser removido.';
  if (e?.code === '23514') return 'Algum valor está fora do permitido.';
  return m;
}
const fail = e => { console.error(e); toast(friendly(e), 'error'); };
const isMissingTable = e => e?.code === 'PGRST205' || e?.code === '42P01' || /schema cache|does not exist/i.test(e?.message || '');
const setSync = t => { $('syncInfo').textContent = t; };

// ---------------- Diálogo reutilizável ----------------
function fieldHtml(f) {
  const name = safe(f.name), label = safe(f.label);
  if (f.options) {
    const opts = f.options.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${safe(v)}"${String(v) === String(f.value) ? ' selected' : ''}>${safe(l)}</option>`; }).join('');
    return `<label>${label}<select name="${name}">${opts}</select></label>`;
  }
  const attrs = ['min', 'max', 'step', 'maxlength', 'placeholder', 'inputmode', 'list'].filter(a => f[a] !== undefined).map(a => `${a}="${safe(f[a])}"`).join(' ');
  return `<label>${label}<input name="${name}" type="${safe(f.type || 'text')}" value="${safe(f.value ?? '')}" ${f.required === false ? '' : 'required'} ${attrs}></label>`;
}
function ask({ title, message = '', fields = [], ok = 'Confirmar', danger = false, cancel = 'Cancelar' }) {
  return new Promise(resolve => {
    const dlg = $('dlg'), form = $('dlgForm'), okBtn = $('dlgOk');
    $('dlgTitle').textContent = title;
    $('dlgMsg').textContent = message;
    $('dlgMsg').hidden = !message;
    $('dlgFields').innerHTML = fields.map(fieldHtml).join('');
    okBtn.textContent = ok;
    okBtn.className = 'btn ' + (danger ? 'btn-danger' : 'btn-primary');
    $('dlgCancel').textContent = cancel;
    let done = false;
    const finish = v => {
      if (done) return;
      done = true;
      form.onsubmit = null; $('dlgCancel').onclick = null; dlg.oncancel = null; dlg.onclose = null;
      if (dlg.open) dlg.close();
      resolve(v);
    };
    form.onsubmit = e => { e.preventDefault(); if (!form.reportValidity()) return; finish(Object.fromEntries(new FormData(form))); };
    $('dlgCancel').onclick = () => finish(null);
    dlg.oncancel = e => { e.preventDefault(); finish(null); };
    // O evento "close" de um diálogo anterior pode chegar atrasado; só vale se estiver fechado mesmo.
    dlg.onclose = () => { if (!dlg.open) finish(null); };
    dlg.showModal();
    (form.querySelector('#dlgFields input, #dlgFields select') || okBtn).focus();
  });
}
const confirmar = (title, message, ok = 'Confirmar', danger = false) => ask({ title, message, ok, danger }).then(Boolean);

// ---------------- Validação ----------------
function amount(v, { min = 0, max = 1e9, label = 'Valor' } = {}) {
  const s = String(v ?? '').trim().replace(',', '.');
  const x = Number(s);
  if (s === '' || !Number.isFinite(x) || x < min || x > max) throw Error(`${label} inválido.`);
  return x;
}
function text(v, { max = 160, label = 'o texto' } = {}) {
  const s = String(v ?? '').trim().replace(/\s+/g, ' ');
  if (!s) throw Error(`Informe ${label}.`);
  if (s.length > max) throw Error(`Texto muito longo (máximo ${max} caracteres).`);
  return s;
}
function dateVal(v, { future = true, label = 'Data' } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v || '') || isoDate(parseDate(v)) !== v) throw Error(`${label} inválida.`);
  if (!future && v > today()) throw Error(`${label} não pode ser no futuro.`);
  return v;
}

// ---------------- Banco de dados ----------------
async function fetchAll(key, since = null) {
  const s = SOURCES[key], out = [];
  for (let from = 0; ; from += 1000) {
    let q = db.from(s.table).select('*');
    if (since && s.dateField) q = q.gte(s.dateField, since);
    // Desempate por id: sem isso a paginação pode pular ou repetir linhas.
    const { data: rows, error } = await q.order(s.order, { ascending: !!s.asc }).order('id', { ascending: true }).range(from, from + 999);
    if (error) {
      if (s.optional && isMissingTable(error)) { missing.add(key); return []; }
      throw error;
    }
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  missing.delete(key);
  return out;
}
// Cópia local dos dados: as gravações já atualizam a tela com a linha que o banco devolveu,
// sem esperar uma nova carga completa.
const TABLE_KEY = Object.fromEntries(Object.entries(SOURCES).map(([k, s]) => [s.table, k]));
// Enquanto uma busca está em andamento, as alterações locais ficam anotadas e são reaplicadas
// sobre a resposta; sem isso, uma resposta atrasada apagaria o que acabou de ser gravado.
const activeLogs = new Set();
function upsertLocal(key, rows) { applyUpsert(key, rows); for (const l of activeLogs) l.push(['up', key, rows]); }
function removeLocal(key, id) { applyRemove(key, id); for (const l of activeLogs) l.push(['rm', key, id]); }
const applyRemove = (key, id) => { data[key] = data[key].filter(x => x.id !== id); };
async function fetchKeys(keys, since, sid, onApply) {
  const log = [];
  activeLogs.add(log);
  try {
    const res = await Promise.all(keys.map(k => fetchAll(k, since)));
    if (sid !== sessionId) return false;
    onApply?.();
    keys.forEach((k, i) => { data[k] = res[i]; });
    for (const [t, k, x] of log) if (keys.includes(k)) { if (t === 'up') applyUpsert(k, x); else applyRemove(k, x); }
    return true;
  } finally { activeLogs.delete(log); }
}
function applyUpsert(key, rows) {
  const s = SOURCES[key];
  for (const r of [].concat(rows || [])) {
    if (!r?.id) continue;
    const i = data[key].findIndex(x => x.id === r.id);
    const foraDaJanela = s.dateField && windowStart && String(r[s.dateField]) < windowStart;
    if (foraDaJanela) { if (i >= 0) data[key].splice(i, 1); continue; }
    if (i >= 0) data[key][i] = { ...data[key][i], ...r }; else data[key].push(r);
  }
}

async function insert(table, row) {
  const { data: rows, error } = await db.from(table).insert(row).select();
  if (error) throw error;
  upsertLocal(TABLE_KEY[table], rows);
  return rows;
}
async function update(table, id, patch) {
  const { data: rows, error } = await db.from(table).update(patch).eq('id', id).select();
  if (error) throw error;
  if (!rows?.length) throw Error('Registro não encontrado ou sem permissão.');
  upsertLocal(TABLE_KEY[table], rows);
}
async function remove(table, id) {
  const { data: rows, error } = await db.from(table).delete().eq('id', id).select('id');
  if (error) throw error;
  if (!rows?.length) throw Error('Registro não encontrado ou sem permissão.');
  removeLocal(TABLE_KEY[table], id);
}
// Recarrega só as tabelas afetadas (usado depois das funções do banco, como registrar venda).
async function refresh(keys) {
  const sid = sessionId, since = windowStart || windowFor();
  try {
    if (await fetchKeys(keys, since, sid)) render();
  } catch (e) { if (sid === sessionId) fail(e); }
}
async function rpc(name, args) { const { data: r, error } = await db.rpc(name, args); if (error) throw error; return r; }

async function load() {
  if (!db || !entered) return;
  if (loading) { reloadQueued = true; return; }
  loading = true;
  const sid = sessionId;
  setSync('Atualizando…');
  $('refreshBtn').disabled = true;
  try {
    const keys = Object.keys(SOURCES), since = windowFor();
    if (!await fetchKeys(keys, since, sid, () => { windowStart = since; })) return;
    lastLoad = Date.now();
    loaded = true;
    render();
    setSync('Atualizado às ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
  } catch (e) {
    if (sid === sessionId) { fail(e); setSync('Falha ao atualizar'); }
  } finally {
    loading = false;
    $('refreshBtn').disabled = false;
    if (reloadQueued) { reloadQueued = false; void load(); }
  }
}

// Lançado quando o usuário desiste numa confirmação: interrompe sem mostrar erro.
const CANCEL = Symbol('cancelado');

// Executa uma gravação bloqueando cliques duplos e mostra o resultado na hora.
// refreshKeys: tabelas alteradas pelo banco que precisam ser buscadas de novo.
async function run(btn, fn, okMsg, refreshKeys = []) {
  if (working) { toast('Aguarde a operação anterior terminar.', 'warn'); return false; }
  working = true;
  if (btn) btn.disabled = true;
  try {
    await fn();
    render();
    if (okMsg) toast(okMsg);
    if (refreshKeys.length) await refresh(refreshKeys);
    return true;
  } catch (e) { if (e !== CANCEL) fail(e); return false; }
  finally { working = false; if (btn) btn.disabled = false; }
}
function resetForm(form, keep = []) {
  const kept = Object.fromEntries(keep.map(k => [k, form.elements[k]?.value]));
  form.reset();
  form.querySelectorAll('[data-default="today"]').forEach(el => { el.value = today(); });
  form.querySelectorAll('[data-default="month"]').forEach(el => { el.value = today().slice(0, 7); });
  for (const [k, v] of Object.entries(kept)) if (form.elements[k] && v !== undefined) form.elements[k].value = v;
}
function bindForm(id, handler, okMsg, keep = [], refreshKeys = []) {
  const form = $(id);
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    const vals = Object.fromEntries(new FormData(form));
    let msg = okMsg;
    const ok = await run(form.querySelector('[type="submit"]'), async () => { const r = await handler(vals, form); if (r === false) throw CANCEL; if (typeof r === 'string') msg = r; }, null, refreshKeys);
    if (ok) { resetForm(form, keep); toast(msg); form.dispatchEvent(new Event('change')); }
  });
}

// ---------------- Cálculos ----------------
function calc(vendas, movs, pags) {
  const fat = sum(vendas, v => v.total), cmv = sum(vendas, v => v.custo_total);
  const saidas = movs.filter(m => m.tipo === 'saida');
  const despesas = sum(saidas, m => m.valor);
  const compras = sum(saidas.filter(m => m.categoria === 'Compras'), m => m.valor);
  const entradas = sum(movs.filter(m => m.tipo === 'entrada'), m => m.valor);
  const folha = sum(pags, p => p.valor);
  const bruto = fat - cmv;
  const operacionais = despesas - compras;
  const resultado = bruto + entradas - operacionais - folha;
  const caixa = fat + entradas - despesas - folha;
  return { fat, cmv, bruto, despesas, compras, operacionais, entradas, folha, resultado, caixa, itens: sum(vendas, v => v.quantidade), qtdVendas: vendas.length, margem: fat ? resultado / fat * 100 : NaN };
}
const filterBy = (pred) => [data.vendas.filter(v => pred(v.data)), data.movimentos.filter(m => pred(m.data)), data.pagamentos.filter(p => pred(p.data))];
function weekRange(ref = today()) {
  const d = parseDate(ref), dow = (d.getDay() + 6) % 7;
  const mon = addDays(ref, -dow);
  return [mon, addDays(mon, 6)];
}
const sortVendas = arr => [...arr].sort((a, b) => String(b.data).localeCompare(String(a.data)) || String(b.created_at).localeCompare(String(a.created_at)));
function groupSum(arr, keyFn, valFn) {
  const m = new Map();
  for (const x of arr) { const k = keyFn(x); m.set(k, (m.get(k) || 0) + n(valFn(x))); }
  return m;
}
const produtoById = id => data.produtos.find(p => p.id === id);
const pratoById = id => data.pratos.find(p => p.id === id);

// ---------------- Componentes de HTML ----------------
function table(head, rows, { empty = 'Nenhum registro.', foot = '', more = '' } = {}) {
  const th = head.map(h => { const [l, c] = Array.isArray(h) ? h : [h, '']; return `<th class="${c}">${safe(l)}</th>`; }).join('');
  const body = rows.length ? rows.join('') : `<tr><td colspan="${head.length}" class="empty">${safe(empty)}</td></tr>`;
  return `<table><thead><tr>${th}</tr></thead><tbody>${body}</tbody>${foot ? `<tfoot>${foot}</tfoot>` : ''}</table>${more ? `<div class="more">${safe(more)}</div>` : ''}`;
}
const toneOf = v => v < -0.004 ? 'neg' : v > 0.004 ? 'pos' : '';
const kpi = (label, value, { tone = '', hint = '' } = {}) =>
  `<div class="kpi ${tone}"><span class="kpi-label">${safe(label)}</span><strong class="kpi-value">${safe(value)}</strong>${hint ? `<span class="kpi-hint">${safe(hint)}</span>` : ''}</div>`;
const badge = (t, cls = '') => `<span class="badge ${cls}">${safe(t)}</span>`;
const act = (action, id, label, danger = false) => `<button type="button" class="link-btn${danger ? ' danger' : ''}" data-action="${safe(action)}" data-id="${safe(id)}">${safe(label)}</button>`;
const signed = v => `<span class="${toneOf(v)}-t">${money(v)}</span>`;

function barChart(items, { fmt = money, height = 180, dense = false } = {}) {
  const max = Math.max(0, ...items.map(i => i.value));
  if (!max) return '<p class="empty-box">Sem dados no período.</p>';
  return `<div class="vchart${dense ? ' dense' : ''}" style="--h:${height}px">${items.map(i =>
    `<div class="vcol${i.hl ? ' hl' : ''}" title="${safe(i.title || `${i.label}: ${fmt(i.value)}`)}"><div class="vbar" style="height:${(Math.max(0, i.value) / max * 100).toFixed(1)}%"></div><span class="vlabel">${safe(i.label)}</span></div>`).join('')}</div>`;
}
function hBars(items, { fmt = money, empty = 'Sem dados no período.' } = {}) {
  const max = Math.max(0, ...items.map(i => i.value));
  if (!items.length || !max) return `<p class="empty-box">${safe(empty)}</p>`;
  return `<ul class="hbars">${items.map(i => `<li><div class="hb-top"><span class="hb-name">${safe(i.label)}</span><span class="hb-val">${safe(fmt(i.value))}${i.sub ? ` <small>${safe(i.sub)}</small>` : ''}</span></div><div class="hb-track"><div class="hb-fill" style="width:${(Math.max(0, i.value) / max * 100).toFixed(1)}%"></div></div></li>`).join('')}</ul>`;
}
function setOptions(select, options, placeholder) {
  const prev = select.value;
  select.innerHTML = (placeholder !== undefined ? `<option value="">${safe(placeholder)}</option>` : '') + options;
  if ([...select.options].some(o => o.value === prev)) select.value = prev;
}
const optionList = list => list.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${safe(v)}">${safe(l)}</option>`; }).join('');

// ---------------- Navegação ----------------
const PAGES = {
  dashboard: ['Visão geral', 'Resumo de hoje, da semana e do mês'],
  vendas: ['Anotar vendas', 'Vendas com preço, para acompanhar faturamento e lucro'],
  contagem: ['Contagem de pratos', 'Quantos pratos saem por dia, sem valores'],
  produtos: ['Cardápio e custos', 'Preço, custo, margem e estoque de cada produto'],
  movimentos: ['Despesas e entradas', 'Gastos do dia a dia e entradas fora das vendas'],
  funcionarios: ['Funcionários', 'Equipe e pagamentos'],
  impostos: ['Impostos a pagar', 'Obrigações e vencimentos'],
  relatorios: ['Relatórios', 'Evolução, categorias e exportações'],
};
function go(name, scroll = true) {
  if (!PAGES[name]) name = 'dashboard';
  for (const k of Object.keys(PAGES)) $('page-' + k).classList.toggle('hidden', k !== name);
  document.querySelectorAll('#nav [data-tab]').forEach(b => { if (b.dataset.tab === name) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  $('pageTitle').textContent = PAGES[name][0];
  $('pageSub').textContent = PAGES[name][1];
  document.title = PAGES[name][0] + ' | Barraca do Ivan';
  store.set('tab', name);
  if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
  if (scroll) window.scrollTo({ top: 0 });
}

// ---------------- Renderização ----------------
function render() {
  const ym = validYm($('periodo').value) || today().slice(0, 7);
  const ctx = { ym, hoje: today() };
  // Cada seção é isolada: um erro em uma não apaga as outras.
  for (const fn of [renderDashboard, renderVendas, renderContagem, renderProdutos, renderMovimentos, renderFuncionarios, renderImpostos, renderRelatorios]) {
    try { fn(ctx); } catch (e) { console.error(fn.name, e); }
  }
}

function vendaRow(v, withAction = true) {
  return `<tr><td>${fmtDate(v.data)}</td><td>${safe(v.produto_nome)}</td><td class="num">${num(v.quantidade)}</td><td class="num">${money(v.preco_unitario)}</td><td class="num">${money(v.total)}</td><td class="num">${signed(n(v.total) - n(v.custo_total))}</td><td>${safe(v.pagamento)}</td>${withAction ? `<td class="actions">${act('cancelSale', v.id, 'Cancelar', true)}</td>` : ''}</tr>`;
}
const VENDA_HEAD = ['Data', 'Produto', ['Qtd.', 'num'], ['Unitário', 'num'], ['Total', 'num'], ['Lucro bruto', 'num'], 'Pagamento'];

function renderDashboard({ ym, hoje }) {
  // Alertas
  const alerts = [];
  const pend = data.impostos.filter(i => !i.pago);
  const vencidos = pend.filter(i => i.vencimento < hoje);
  const proximos = pend.filter(i => inRange(i.vencimento, hoje, addDays(hoje, 7)));
  if (vencidos.length) alerts.push(['danger', `${vencidos.length} imposto(s) vencido(s) sem pagamento: ${money(sum(vencidos, i => i.valor))}.`, 'impostos']);
  if (proximos.length) alerts.push(['warn', `${proximos.length} imposto(s) vencem nos próximos 7 dias: ${money(sum(proximos, i => i.valor))}.`, 'impostos']);
  const baixo = data.produtos.filter(p => p.ativo !== false && p.controla_estoque !== false && n(p.estoque) <= LOW_STOCK);
  if (baixo.length) alerts.push(['warn', `Estoque baixo: ${baixo.slice(0, 5).map(p => `${p.nome} (${num(p.estoque)})`).join(', ')}${baixo.length > 5 ? ` e mais ${baixo.length - 5}` : ''}.`, 'produtos']);
  const semCusto = data.produtos.filter(p => p.ativo !== false && n(p.custo) === 0 && n(p.preco) > 0);
  if (semCusto.length) alerts.push(['info', `${semCusto.length} produto(s) com custo R$ 0,00: o lucro desses itens aparece maior do que é. Cadastre o custo ou acompanhe o Saldo de caixa.`, 'produtos']);
  for (const k of new Set([...missing].map(k => SETUP_FILES[k]))) alerts.push(['info', `Parte do sistema está desativada: execute o arquivo ${k} no SQL Editor do Supabase.`, null]);
  $('alertas').innerHTML = alerts.map(([cls, msg, page]) => `<div class="alert ${cls}"><span>${safe(msg)}</span>${page ? `<button type="button" class="link-btn" data-goto="${page}">Ver</button>` : ''}</div>`).join('');

  // Hoje
  const h = calc(...filterBy(d => d === hoje));
  const pratosHoje = sum(data.contagens.filter(c => c.data === hoje), c => c.quantidade);
  $('hojeLabel').textContent = `${DIAS[parseDate(hoje).getDay()]}, ${fmtDate(hoje)}`;
  $('kpiHoje').innerHTML = [
    kpi('Faturamento', money(h.fat), { hint: `${h.qtdVendas} venda(s)` }),
    kpi('Itens vendidos', num(h.itens), { hint: missing.has('contagens') ? '' : `${num(pratosHoje)} prato(s) na contagem` }),
    kpi('Lucro bruto', money(h.bruto), { tone: toneOf(h.bruto) }),
    kpi('Despesas + pagamentos', money(h.despesas + h.folha), { hint: h.folha ? `inclui ${money(h.folha)} de funcionários` : '' }),
    kpi('Resultado estimado', money(h.resultado), { tone: toneOf(h.resultado) }),
  ].join('');

  // Semana
  const [ini, fim] = weekRange(hoje);
  const s = calc(...filterBy(d => inRange(d, ini, fim)));
  $('kpiSemana').innerHTML = [
    kpi('Faturamento', money(s.fat), { hint: `${fmtDate(ini).slice(0, 5)} a ${fmtDate(fim).slice(0, 5)}` }),
    kpi('Itens vendidos', num(s.itens)),
    kpi('Despesas + salários', money(s.despesas + s.folha)),
    kpi('Resultado estimado', money(s.resultado), { tone: toneOf(s.resultado) }),
  ].join('');

  // Mês
  const m = calc(...filterBy(d => inMonth(d, ym)));
  $('mesLabel').textContent = fmtMonth(ym);
  $('kpiMes').innerHTML = [
    kpi('Faturamento de vendas', money(m.fat), { tone: 'main', hint: `${m.qtdVendas} venda(s) · ${num(m.itens)} itens` }),
    kpi('Custo dos produtos vendidos', money(m.cmv)),
    kpi('Lucro bruto', money(m.bruto), { tone: toneOf(m.bruto) }),
    kpi('Despesas operacionais', money(m.operacionais), { hint: m.compras ? `fora ${money(m.compras)} em compras` : '' }),
    kpi('Pagamentos a funcionários', money(m.folha)),
    kpi('Entradas manuais', money(m.entradas)),
    kpi('Resultado estimado', money(m.resultado), { tone: toneOf(m.resultado), hint: `margem ${pct(m.margem)}` }),
    kpi('Saldo de caixa', money(m.caixa), { tone: toneOf(m.caixa), hint: 'tudo que entrou − tudo que saiu' }),
  ].join('');

  // Gráfico diário
  const vm = data.vendas.filter(v => inMonth(v.data, ym));
  const porDia = groupSum(vm, v => v.data, v => v.total);
  const dias = Array.from({ length: daysInMonth(ym) }, (_, i) => `${ym}-${pad(i + 1)}`);
  $('chartDias').innerHTML = barChart(dias.map(d => ({ label: String(+d.slice(8)), value: porDia.get(d) || 0, hl: d === hoje, title: `${DIAS_CURTO[parseDate(d).getDay()]} ${fmtDate(d)}: ${money(porDia.get(d) || 0)}` })), { dense: true });
  const melhor = [...porDia.entries()].sort((a, b) => b[1] - a[1])[0];
  if (melhor) $('chartDias').innerHTML += `<p class="chart-note">Melhor dia: <b>${DIAS[parseDate(melhor[0]).getDay()]}, ${fmtDate(melhor[0])}</b> com ${money(melhor[1])}. Média por dia com venda: <b>${money(m.fat / porDia.size)}</b>.</p>`;

  const porPag = groupSum(vm, v => v.pagamento, v => v.total);
  $('chartPagamentos').innerHTML = hBars([...porPag.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k, value: v, sub: pct(m.fat ? v / m.fat * 100 : NaN) })));

  $('ultimasVendas').innerHTML = table([...VENDA_HEAD, ['', 'actions']], sortVendas(data.vendas).slice(0, 8).map(v => vendaRow(v)), { empty: 'Nenhuma venda registrada ainda.' });
}

function renderVendas({ ym }) {
  // Seletor de produtos agrupado por categoria
  const disponiveis = data.produtos.filter(p => p.ativo !== false && (p.controla_estoque === false || n(p.estoque) > 0)).sort(byName);
  const cats = [...new Set(disponiveis.map(p => p.categoria))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  setOptions($('produtoVenda'), cats.map(c => `<optgroup label="${safe(c)}">${disponiveis.filter(p => p.categoria === c).map(p =>
    `<option value="${safe(p.id)}">${safe(p.nome)} — ${money(p.preco)}${p.controla_estoque === false ? '' : ` (estoque ${num(p.estoque)})`}</option>`).join('')}</optgroup>`).join(''),
    disponiveis.length ? 'Selecione o produto…' : 'Cadastre produtos no Cardápio primeiro');
  updateVendaPreview();

  // Relatório de um dia
  const allCats = [...new Set(data.produtos.map(p => p.categoria))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  setOptions($('filtroCategoria'), optionList(allCats), 'Todas');
  const dia = $('filtroDia').value || today(), cat = $('filtroCategoria').value;
  const vDia = data.vendas.filter(v => v.data === dia && (!cat || produtoById(v.produto_id)?.categoria === cat));
  const cd = calc(vDia, [], []);
  $('kpiDia').innerHTML = [kpi('Faturamento', money(cd.fat)), kpi('Itens vendidos', num(cd.itens)), kpi('Lucro bruto', money(cd.bruto), { tone: toneOf(cd.bruto) }), kpi('Ticket médio', cd.qtdVendas ? money(cd.fat / cd.qtdVendas) : '—', { hint: `${cd.qtdVendas} venda(s)` })].join('');
  const agr = new Map();
  for (const v of vDia) {
    const a = agr.get(v.produto_id) || { nome: v.produto_nome, qtd: 0, total: 0, custo: 0 };
    a.qtd += n(v.quantidade); a.total += n(v.total); a.custo += n(v.custo_total);
    agr.set(v.produto_id, a);
  }
  const linhas = [...agr.values()].sort((a, b) => b.total - a.total);
  $('relatorioDia').innerHTML = table(['Produto', ['Quantidade', 'num'], ['Faturamento', 'num'], ['Lucro bruto', 'num']],
    linhas.map(x => `<tr><td>${safe(x.nome)}</td><td class="num">${num(x.qtd)}</td><td class="num">${money(x.total)}</td><td class="num">${signed(x.total - x.custo)}</td></tr>`),
    { empty: `Nenhuma venda em ${fmtDate(dia)}.`, foot: linhas.length ? `<tr><td>Total</td><td class="num">${num(cd.itens)}</td><td class="num">${money(cd.fat)}</td><td class="num">${money(cd.bruto)}</td></tr>` : '' });

  // Histórico do mês
  const busca = $('buscaVenda').value.trim().toLocaleLowerCase('pt-BR'), pag = $('filtroPagamento').value;
  const hist = sortVendas(data.vendas.filter(v => inMonth(v.data, ym) && (!pag || v.pagamento === pag) && (!busca || String(v.produto_nome).toLocaleLowerCase('pt-BR').includes(busca))));
  $('listaVendas').innerHTML = table([...VENDA_HEAD, ['', 'actions']], hist.slice(0, MAX_ROWS).map(v => vendaRow(v)),
    { empty: `Nenhuma venda em ${fmtMonth(ym)}.`, more: hist.length > MAX_ROWS ? `Mostrando ${MAX_ROWS} de ${hist.length} vendas. Use a busca ou exporte o CSV para ver todas.` : '' });
}
function updateVendaPreview() {
  const f = $('formVenda'), p = produtoById(f.elements.produto.value), q = n(f.elements.quantidade.value);
  $('previewVenda').innerHTML = p && q > 0 ? `Total: <b>${money(round2(q * n(p.preco)))}</b> · lucro bruto ${money(round2(q * (n(p.preco) - n(p.custo))))}` : '';
}

function renderContagem({ ym }) {
  const off = missing.has('pratos') || missing.has('contagens');
  $('contagemSetup').classList.toggle('hidden', !off);
  $('contagemBody').classList.toggle('hidden', off);
  if (off) return;

  const dia = $('contagemData').value || today();
  const ativos = data.pratos.filter(p => p.ativo !== false).sort((a, b) => String(a.categoria).localeCompare(String(b.categoria), 'pt-BR') || byName(a, b));
  // Descarta quantidades pendentes de pratos removidos ou desativados
  // (só depois que os dados chegaram; antes disso a lista de pratos ainda está vazia).
  if (loaded) {
    for (const id of Object.keys(pendentes)) if (!ativos.some(p => p.id === id)) delete pendentes[id];
    store.set('contagemPendente', pendentes);
  }

  const doDia = data.contagens.filter(c => c.data === dia);
  const reg = groupSum(doDia, c => c.prato_id, c => c.quantidade);
  const nomeDe = c => pratoById(c.prato_id)?.nome || c.prato_nome;

  // Não redesenha o contador enquanto alguém digita uma quantidade nele.
  const digitando = $('contadorGrid').contains(document.activeElement) && document.activeElement.tagName === 'INPUT';
  if (digitando) { /* mantém como está */ }
  else if (!ativos.length) {
    $('contadorGrid').innerHTML = '<p class="empty-box">Cadastre seus pratos no fim desta página para começar a contar.</p>';
  } else {
    const cats = [...new Set(ativos.map(p => p.categoria))];
    $('contadorGrid').innerHTML = cats.map(c => `<h4 class="counter-cat">${safe(c)}</h4><div class="counter-grid">${ativos.filter(p => p.categoria === c).map(p => {
      const q = pendentes[p.id] || 0;
      return `<div class="counter${q ? ' has-pending' : ''}" data-id="${safe(p.id)}"><div class="counter-info"><strong>${safe(p.nome)}</strong><small>Já salvo no dia: <b>${num(reg.get(p.id) || 0)}</b></small></div><div class="stepper"><button type="button" data-step="-1" aria-label="Diminuir ${safe(p.nome)}">−</button><input type="number" min="0" max="10000" step="1" inputmode="numeric" value="${q}" aria-label="Quantidade de ${safe(p.nome)}"><button type="button" data-step="1" aria-label="Aumentar ${safe(p.nome)}">+</button></div></div>`;
    }).join('')}</div>`).join('');
  }
  updatePendingBar();

  // Registrado no dia
  const totalDia = sum(doDia, c => c.quantidade);
  const topDia = [...groupSum(doDia, nomeDe, c => c.quantidade).entries()].sort((a, b) => b[1] - a[1])[0];
  $('kpiContagemDia').innerHTML = [kpi('Pratos no dia', num(totalDia), { hint: `${DIAS[parseDate(dia).getDay()]}, ${fmtDate(dia)}` }), kpi('Pratos diferentes', num(reg.size)), kpi('Mais pedido', topDia ? topDia[0] : '—', { hint: topDia ? `${num(topDia[1])} unidade(s)` : '' })].join('');
  $('listaContagemDia').innerHTML = table(['Hora', 'Prato', ['Qtd.', 'num'], ['', 'actions']],
    [...doDia].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).map(c => `<tr><td>${fmtTime(c.created_at)}</td><td>${safe(nomeDe(c))}</td><td class="num">${num(c.quantidade)}</td><td class="actions">${act('delContagem', c.id, 'Excluir', true)}</td></tr>`),
    { empty: 'Nada salvo neste dia.' });

  // Últimos 7 dias (terminando no dia escolhido)
  const dias7 = Array.from({ length: 7 }, (_, i) => addDays(dia, i - 6));
  const c7 = data.contagens.filter(c => inRange(c.data, dias7[0], dia));
  const porPrato = new Map();
  for (const c of c7) {
    const nome = nomeDe(c);
    const row = porPrato.get(nome) || { total: 0, dias: {} };
    row.total += n(c.quantidade); row.dias[c.data] = (row.dias[c.data] || 0) + n(c.quantidade);
    porPrato.set(nome, row);
  }
  const tot7 = groupSum(c7, c => c.data, c => c.quantidade);
  $('contagem7dias').innerHTML = table(['Prato', ...dias7.map(d => [`${DIAS_CURTO[parseDate(d).getDay()]} ${d.slice(8)}`, 'num']), ['Total', 'num']],
    [...porPrato.entries()].sort((a, b) => b[1].total - a[1].total).map(([nome, r]) => `<tr><td>${safe(nome)}</td>${dias7.map(d => `<td class="num">${r.dias[d] ? num(r.dias[d]) : '<span class="muted">·</span>'}</td>`).join('')}<td class="num"><b>${num(r.total)}</b></td></tr>`),
    { empty: 'Sem contagens nesses 7 dias.', foot: porPrato.size ? `<tr><td>Total</td>${dias7.map(d => `<td class="num">${num(tot7.get(d) || 0)}</td>`).join('')}<td class="num">${num(sum(c7, c => c.quantidade))}</td></tr>` : '' });

  // Ranking do mês
  const cm = data.contagens.filter(c => inMonth(c.data, ym));
  const totalMes = sum(cm, c => c.quantidade);
  const diasComRegistro = new Set(cm.map(c => c.data)).size;
  $('rankingPratos').innerHTML = hBars([...groupSum(cm, nomeDe, c => c.quantidade).entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k, value: v, sub: `${pct(v / totalMes * 100)} · ${num(Math.round(v / diasComRegistro * 10) / 10)}/dia` })),
    { fmt: num, empty: `Sem contagens em ${fmtMonth(ym)}.` }) + (totalMes ? `<p class="chart-note"><b>${num(totalMes)}</b> pratos em ${diasComRegistro} dia(s) com registro · média de <b>${num(Math.round(totalMes / diasComRegistro))}</b> por dia.</p>` : '');

  // Média por dia da semana (só conta dias que tiveram registro)
  const porData = groupSum(cm, c => c.data, c => c.quantidade);
  const semana = [1, 2, 3, 4, 5, 6, 0].map(w => {
    const ds = [...porData.entries()].filter(([d]) => parseDate(d).getDay() === w);
    const media = ds.length ? sum(ds, x => x[1]) / ds.length : 0;
    return { label: DIAS_CURTO[w], value: Math.round(media * 10) / 10, dias: ds.length, w };
  });
  const best = [...semana].sort((a, b) => b.value - a.value)[0];
  $('chartSemanaPratos').innerHTML = barChart(semana.map(s => ({ ...s, hl: best.value > 0 && s === best, title: `${DIAS[s.w]}: média de ${num(s.value)} pratos (${s.dias} dia(s))` })), { fmt: num, height: 160 })
    + (best.value ? `<p class="chart-note">Dia mais forte do mês: <b>${DIAS[best.w]}</b>, com média de ${num(best.value)} pratos.</p>` : '');

  // Lista de pratos
  const totMesPrato = groupSum(cm, c => c.prato_id, c => c.quantidade);
  const usados = new Set(data.contagens.map(c => c.prato_id));
  $('listaPratos').innerHTML = table(['Prato', 'Categoria', ['No mês', 'num'], 'Situação', ['', 'actions']],
    [...data.pratos].sort(byName).map(p => `<tr><td>${safe(p.nome)}</td><td>${safe(p.categoria)}</td><td class="num">${num(totMesPrato.get(p.id) || 0)}</td><td>${p.ativo === false ? badge('Inativo') : badge('Ativo', 'ok')}</td><td class="actions">${act('editPrato', p.id, 'Editar')}${act('togglePrato', p.id, p.ativo === false ? 'Reativar' : 'Desativar')}${usados.has(p.id) ? '' : act('delPrato', p.id, 'Excluir', true)}</td></tr>`),
    { empty: 'Nenhum prato cadastrado.' });
}
function updatePendingBar() {
  const total = Object.values(pendentes).reduce((a, b) => a + n(b), 0);
  const tipos = Object.keys(pendentes).length;
  const dia = $('contagemData').value || today();
  $('contagemPendente').textContent = total ? `${num(total)} prato(s) de ${tipos} tipo(s) para salvar em ${fmtDate(dia)}` : 'Nada para salvar.';
  $('salvarContagem').disabled = !total;
  $('zerarContagem').disabled = !total;
  document.querySelector('.counter-bar').classList.toggle('active', !!total);
}
function setPendente(id, value, card) {
  const v = Math.max(0, Math.min(10000, Math.floor(n(value))));
  if (v) pendentes[id] = v; else delete pendentes[id];
  store.set('contagemPendente', pendentes);
  if (card) {
    card.classList.toggle('has-pending', v > 0);
    const input = card.querySelector('input');
    if (input && String(input.value) !== String(v)) input.value = v;
  }
  updatePendingBar();
}

function renderProdutos() {
  const busca = $('buscaProduto').value.trim().toLocaleLowerCase('pt-BR');
  const lista = [...data.produtos].filter(p => !busca || String(p.nome).toLocaleLowerCase('pt-BR').includes(busca))
    .sort((a, b) => (a.ativo === false) - (b.ativo === false) || String(a.categoria).localeCompare(String(b.categoria), 'pt-BR') || byName(a, b));
  $('listaProdutos').innerHTML = table(['Produto', 'Categoria', ['Custo', 'num'], ['Preço', 'num'], ['Lucro/un.', 'num'], ['Margem', 'num'], ['Estoque', 'num'], ['', 'actions']],
    lista.map(p => {
      const lucro = n(p.preco) - n(p.custo), margem = n(p.preco) ? lucro / n(p.preco) * 100 : NaN;
      const mBadge = !Number.isFinite(margem) ? '—' : badge(pct(margem), margem < 0 ? 'danger' : margem < 30 ? 'warn' : 'ok');
      const est = p.controla_estoque === false ? '<span class="muted">não controla</span>' : n(p.estoque) <= LOW_STOCK ? badge(num(p.estoque), n(p.estoque) <= 0 ? 'danger' : 'warn') : num(p.estoque);
      return `<tr><td>${safe(p.nome)} ${p.ativo === false ? badge('Inativo') : ''}${n(p.custo) === 0 && n(p.preco) > 0 ? ' ' + badge('sem custo', 'info') : ''}</td><td>${safe(p.categoria)}</td><td class="num">${money(p.custo)}</td><td class="num">${money(p.preco)}</td><td class="num">${signed(lucro)}</td><td class="num">${mBadge}</td><td class="num">${est}</td><td class="actions">${act('editProduct', p.id, 'Editar')}${p.controla_estoque === false ? '' : act('stock', p.id, '+ Estoque')}${act('toggleProduct', p.id, p.ativo === false ? 'Reativar' : 'Desativar', p.ativo !== false)}</td></tr>`;
    }), { empty: busca ? 'Nenhum produto encontrado.' : 'Nenhum produto cadastrado.' });
}
function updateProdutoForm() {
  const f = $('formProduto');
  $('produtoEstoqueWrap').classList.toggle('hidden', f.elements.controla_estoque.value !== 'sim');
  const c = n(f.elements.custo.value), p = n(f.elements.preco.value);
  $('previewProduto').innerHTML = p > 0 ? `Lucro por unidade: <b>${money(p - c)}</b> · margem ${pct((p - c) / p * 100)}` : '';
}

function renderMovimentos({ ym }) {
  const ms = data.movimentos.filter(m => inMonth(m.data, ym));
  const c = calc([], ms, []);
  $('kpiMov').innerHTML = [kpi('Saídas no mês', money(c.despesas), { hint: `${ms.filter(m => m.tipo === 'saida').length} lançamento(s)` }), kpi('Compras de mercadoria', money(c.compras)), kpi('Outras despesas', money(c.operacionais)), kpi('Entradas manuais', money(c.entradas))].join('');
  const tipo = $('filtroMovTipo').value;
  const lista = ms.filter(m => !tipo || m.tipo === tipo).sort((a, b) => b.data.localeCompare(a.data) || String(b.created_at).localeCompare(String(a.created_at)));
  const vinculados = new Set(data.impostos.map(i => i.movimento_id).filter(Boolean));
  $('listaMov').innerHTML = table(['Data', 'Descrição', 'Categoria', 'Tipo', ['Valor', 'num'], ['', 'actions']],
    lista.slice(0, MAX_ROWS).map(m => `<tr><td>${fmtDate(m.data)}</td><td>${safe(m.descricao)}</td><td>${safe(m.categoria)}</td><td>${m.tipo === 'entrada' ? badge('Entrada', 'ok') : badge('Saída', 'danger')}</td><td class="num">${money(m.valor)}</td><td class="actions">${vinculados.has(m.id) ? '<span class="muted small">imposto pago</span>' : act('delMov', m.id, 'Excluir', true)}</td></tr>`),
    { empty: `Nenhum lançamento em ${fmtMonth(ym)}.`, more: lista.length > MAX_ROWS ? `Mostrando ${MAX_ROWS} de ${lista.length}.` : '' });
}
function updateMovCategorias() {
  const entrada = $('movTipo').value === 'entrada';
  setOptions($('movCategoria'), optionList(entrada ? CATEGORIAS_ENTRADA : CATEGORIAS_SAIDA));
}

function renderFuncionarios({ ym, hoje }) {
  const off = missing.has('funcionarios') || missing.has('pagamentos');
  const pm = data.pagamentos.filter(p => inMonth(p.data, ym));
  $('kpiFunc').innerHTML = [kpi('Pago hoje', money(sum(data.pagamentos.filter(p => p.data === hoje), p => p.valor))), kpi('Pago no mês', money(sum(pm, p => p.valor)), { hint: `${pm.length} pagamento(s)` }), kpi('Salários mensais cadastrados', money(sum(data.funcionarios, f => f.salario)), { hint: `${data.funcionarios.length} pessoa(s)` }), kpi('Diárias somadas', money(sum(data.funcionarios, f => f.valor_diario)), { hint: 'custo de um dia com todos' })].join('');
  setOptions($('funcPagamento'), [...data.funcionarios].sort(byName).map(f => `<option value="${safe(f.id)}">${safe(f.nome)} — ${safe(f.cargo)}</option>`).join(''), off ? 'Execute folha-pagamentos.sql' : 'Selecione…');
  const pagosMes = groupSum(pm, p => p.funcionario_id, p => p.valor);
  const comPag = new Set(data.pagamentos.map(p => p.funcionario_id));
  $('listaFunc').innerHTML = table(['Nome', 'Cargo', ['Diária', 'num'], ['Mensal', 'num'], 'Admissão', ['Pago no mês', 'num'], ['', 'actions']],
    [...data.funcionarios].sort(byName).map(f => `<tr><td>${safe(f.nome)}</td><td>${safe(f.cargo)}</td><td class="num">${money(f.valor_diario)}</td><td class="num">${money(f.salario)}</td><td>${fmtDate(f.admissao)}</td><td class="num">${money(pagosMes.get(f.id) || 0)}</td><td class="actions">${act('payFunc', f.id, 'Pagar')}${act('editFunc', f.id, 'Editar')}${comPag.has(f.id) ? '' : act('delFunc', f.id, 'Excluir', true)}</td></tr>`),
    { empty: 'Nenhum funcionário cadastrado.' });
  const TIPOS = { diaria: 'Diária', mensal: 'Mensal', extra: 'Extra' };
  $('listaPagamentos').innerHTML = table(['Data', 'Funcionário', 'Tipo', ['Valor', 'num'], 'Observação', ['', 'actions']],
    [...pm].sort((a, b) => b.data.localeCompare(a.data)).map(p => `<tr><td>${fmtDate(p.data)}</td><td>${safe(p.funcionario_nome)}</td><td>${safe(TIPOS[p.tipo] || p.tipo)}</td><td class="num">${money(p.valor)}</td><td>${safe(p.observacao)}</td><td class="actions">${act('delPagamento', p.id, 'Excluir', true)}</td></tr>`),
    { empty: `Nenhum pagamento em ${fmtMonth(ym)}.`, foot: pm.length ? `<tr><td colspan="3">Total</td><td class="num">${money(sum(pm, p => p.valor))}</td><td colspan="2"></td></tr>` : '' });
}
function preencherPagamento() {
  const f = data.funcionarios.find(x => x.id === $('funcPagamento').value), tipo = $('tipoPagamento').value;
  if (f && tipo !== 'extra') $('valorPagamento').value = n(tipo === 'diaria' ? f.valor_diario : f.salario) || '';
}

function renderImpostos({ ym, hoje }) {
  const pend = data.impostos.filter(i => !i.pago);
  const pagos = data.impostos.filter(i => i.pago && inMonth(i.data_pagamento, ym));
  $('kpiImp').innerHTML = [kpi('Pendentes', money(sum(pend, i => i.valor)), { hint: `${pend.length} obrigação(ões)` }), kpi('Vencidos sem pagamento', money(sum(pend.filter(i => i.vencimento < hoje), i => i.valor)), { tone: pend.some(i => i.vencimento < hoje) ? 'neg' : '' }), kpi('Vencem em 7 dias', money(sum(pend.filter(i => inRange(i.vencimento, hoje, addDays(hoje, 7))), i => i.valor))), kpi('Pagos no mês', money(sum(pagos, i => i.valor)))].join('');
  const lista = [...data.impostos].sort((a, b) => (a.pago - b.pago) || (a.pago ? String(b.data_pagamento).localeCompare(String(a.data_pagamento)) : a.vencimento.localeCompare(b.vencimento)));
  $('listaImpostos').innerHTML = table(['Descrição', 'Competência', 'Vencimento', ['Valor', 'num'], 'Situação', ['', 'actions']],
    lista.map(i => {
      const st = i.pago ? badge('Pago em ' + fmtDate(i.data_pagamento), 'ok') : i.vencimento < hoje ? badge('Vencido', 'danger') : i.vencimento <= addDays(hoje, 7) ? badge('Vence em breve', 'warn') : badge('Pendente');
      const [y, m] = String(i.competencia).split('-');
      return `<tr><td>${safe(i.descricao)}</td><td>${safe(m && y ? `${m}/${y}` : i.competencia)}</td><td>${fmtDate(i.vencimento)}</td><td class="num">${money(i.valor)}</td><td>${st}</td><td class="actions">${i.pago ? '' : act('payTax', i.id, 'Marcar pago') + act('delTax', i.id, 'Excluir', true)}</td></tr>`;
    }), { empty: missing.has('impostos') ? 'Execute impostos-upgrade.sql para ativar esta aba.' : 'Nenhuma obrigação anotada.' });
}

function renderRelatorios({ ym }) {
  const meses = Array.from({ length: 6 }, (_, i) => addMonths(ym, i - 5));
  const res = meses.map(mm => ({ mm, ...calc(...filterBy(d => inMonth(d, mm))) }));
  $('chartEvolucao').innerHTML = barChart(res.map(r => ({ label: fmtMonthShort(r.mm), value: r.fat, hl: r.mm === ym, title: `${fmtMonth(r.mm)}: faturamento ${money(r.fat)}, resultado ${money(r.resultado)}` })), { height: 150 });
  $('tabelaEvolucao').innerHTML = table(['Mês', ['Faturamento', 'num'], ['Lucro bruto', 'num'], ['Despesas + folha', 'num'], ['Resultado', 'num'], ['Margem', 'num'], ['Saldo de caixa', 'num']],
    res.map((r, i) => {
      const ant = res[i - 1], varia = ant && ant.fat ? (r.fat - ant.fat) / ant.fat * 100 : NaN;
      return `<tr><td>${safe(fmtMonth(r.mm))}</td><td class="num">${money(r.fat)}${Number.isFinite(varia) ? ` <small class="${toneOf(varia)}-t">${varia > 0 ? '+' : ''}${pct(varia)}</small>` : ''}</td><td class="num">${money(r.bruto)}</td><td class="num">${money(r.operacionais + r.folha)}</td><td class="num">${signed(r.resultado)}</td><td class="num">${pct(r.margem)}</td><td class="num">${signed(r.caixa)}</td></tr>`;
    }).reverse());

  const ms = data.movimentos.filter(m => inMonth(m.data, ym) && m.tipo === 'saida');
  const cat = groupSum(ms, m => m.categoria, m => m.valor);
  const folha = sum(data.pagamentos.filter(p => inMonth(p.data, ym)), p => p.valor);
  if (folha) cat.set('Pagamentos de funcionários', (cat.get('Pagamentos de funcionários') || 0) + folha);
  const totCat = [...cat.values()].reduce((a, b) => a + b, 0);
  $('categorias').innerHTML = hBars([...cat.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k, value: v, sub: pct(v / totCat * 100) })));

  const vs = data.vendas.filter(v => inMonth(v.data, ym));
  const fat = sum(vs, v => v.total);
  const fc = groupSum(vs, v => produtoById(v.produto_id)?.categoria || 'Outros', v => v.total);
  $('fatCategorias').innerHTML = hBars([...fc.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k, value: v, sub: pct(v / fat * 100) })));

  const tops = new Map();
  for (const v of vs) {
    const t = tops.get(v.produto_id) || { nome: v.produto_nome, qtd: 0, total: 0, lucro: 0 };
    t.qtd += n(v.quantidade); t.total += n(v.total); t.lucro += n(v.total) - n(v.custo_total);
    tops.set(v.produto_id, t);
  }
  $('maisVendidos').innerHTML = table(['#', 'Produto', ['Quantidade', 'num'], ['Faturamento', 'num'], ['% do total', 'num'], ['Lucro bruto', 'num']],
    [...tops.values()].sort((a, b) => b.total - a.total).map((x, i) => `<tr><td>${i + 1}</td><td>${safe(x.nome)}</td><td class="num">${num(x.qtd)}</td><td class="num">${money(x.total)}</td><td class="num">${pct(fat ? x.total / fat * 100 : NaN)}</td><td class="num">${signed(x.lucro)}</td></tr>`),
    { empty: `Nenhuma venda em ${fmtMonth(ym)}.` });
}

// ---------------- Exportação CSV ----------------
function csv(rows, cols, name) {
  const cell = (v, type) => {
    let s;
    if (type === 'num') s = Number.isFinite(Number(v)) && v !== null && v !== '' ? String(Number(v)).replace('.', ',') : '';
    else if (type === 'date') s = v ? fmtDate(v) : '';
    else {
      s = String(v ?? '');
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // impede fórmulas maliciosas no Excel
    }
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const content = '﻿' + [cols.map(c => cell(c[1])).join(';'), ...rows.map(r => cols.map(([k, , t]) => cell(r[k], t)).join(';'))].join('\r\n');
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}
const simNao = v => v === false ? 'Não' : 'Sim';
const CSV = {
  vendas: { date: 'data', cols: [['data', 'Data', 'date'], ['produto_nome', 'Produto'], ['quantidade', 'Quantidade', 'num'], ['preco_unitario', 'Preço unitário', 'num'], ['custo_unitario', 'Custo unitário', 'num'], ['total', 'Total', 'num'], ['custo_total', 'Custo total', 'num'], ['pagamento', 'Pagamento']] },
  movimentos: { date: 'data', cols: [['data', 'Data', 'date'], ['tipo', 'Tipo'], ['categoria', 'Categoria'], ['descricao', 'Descrição'], ['valor', 'Valor', 'num']] },
  pagamentos: { date: 'data', cols: [['data', 'Data', 'date'], ['funcionario_nome', 'Funcionário'], ['tipo', 'Tipo'], ['valor', 'Valor', 'num'], ['observacao', 'Observação']] },
  impostos: { date: 'vencimento', map: r => ({ ...r, pago: r.pago ? 'Sim' : 'Não' }), cols: [['descricao', 'Descrição'], ['competencia', 'Competência'], ['vencimento', 'Vencimento', 'date'], ['valor', 'Valor', 'num'], ['pago', 'Pago'], ['data_pagamento', 'Data do pagamento', 'date']] },
  contagens: { date: 'data', map: c => ({ ...c, prato: pratoById(c.prato_id)?.nome || c.prato_nome }), cols: [['data', 'Data', 'date'], ['prato', 'Prato'], ['quantidade', 'Quantidade', 'num']] },
  produtos: { date: null, map: r => ({ ...r, ativo: simNao(r.ativo) }), cols: [['nome', 'Produto'], ['categoria', 'Categoria'], ['custo', 'Custo', 'num'], ['preco', 'Preço', 'num'], ['estoque', 'Estoque', 'num'], ['ativo', 'Ativo']] },
};
async function exportCsv(kind, btn) {
  const cfg = CSV[kind], ym = validYm($('periodo').value) || today().slice(0, 7);
  const soMes = $('csvSoMes').checked && cfg.date;
  let rows = data[kind];
  // A tela guarda só os últimos meses; para exportar tudo, busca o histórico completo no banco.
  if (!soMes && SOURCES[kind].dateField) {
    btn.disabled = true;
    try { rows = await fetchAll(kind); } catch (e) { fail(e); return; } finally { btn.disabled = false; }
  }
  const list = (soMes ? rows.filter(r => inMonth(r[cfg.date], ym)) : rows).map(cfg.map || (r => r));
  if (!list.length) { toast('Nada para exportar nesse filtro.', 'warn'); return; }
  csv(list, cfg.cols, `${kind}${soMes ? '-' + ym : ''}.csv`);
}

// ---------------- Ações das tabelas ----------------
const ACTIONS = {
  async cancelSale(id) {
    const v = data.vendas.find(x => x.id === id);
    if (!v) throw Error('Venda não encontrada. Atualize a página.');
    const devolve = v.estoque_baixado ?? produtoById(v.produto_id)?.controla_estoque !== false;
    if (!await confirmar('Cancelar venda', `${num(v.quantidade)} × ${v.produto_nome} (${money(v.total)}) de ${fmtDate(v.data)}.${devolve ? '\nA quantidade volta para o estoque.' : ''}`, 'Cancelar venda', true)) return;
    return [async () => { await rpc('cancelar_venda', { p_venda: id }); removeLocal('vendas', id); }, 'Venda cancelada.', ['produtos']];
  },
  async editProduct(id) {
    const p = produtoById(id);
    if (!p) throw Error('Produto não encontrado.');
    const cats = CATEGORIAS_PRODUTO.includes(p.categoria) ? CATEGORIAS_PRODUTO : [p.categoria, ...CATEGORIAS_PRODUTO];
    const r = await ask({ title: 'Editar produto', message: 'O estoque não muda aqui: use “+ Estoque” na lista.', ok: 'Salvar alterações', fields: [
      { name: 'nome', label: 'Nome', value: p.nome, maxlength: 160 },
      { name: 'categoria', label: 'Categoria', value: p.categoria, options: cats },
      { name: 'custo', label: 'Custo unitário (R$)', type: 'number', min: 0, step: 0.01, value: p.custo, inputmode: 'decimal' },
      { name: 'preco', label: 'Preço de venda (R$)', type: 'number', min: 0, step: 0.01, value: p.preco, inputmode: 'decimal' },
      { name: 'controla_estoque', label: 'Controlar estoque?', value: p.controla_estoque === false ? 'nao' : 'sim', options: [['nao', 'Não'], ['sim', 'Sim']] },
    ] });
    if (!r) return;
    const patch = { nome: text(r.nome, { label: 'o nome' }), categoria: text(r.categoria, { max: 60, label: 'a categoria' }), custo: amount(r.custo, { label: 'Custo' }), preco: amount(r.preco, { label: 'Preço' }), controla_estoque: r.controla_estoque === 'sim' };
    const passaAControlar = patch.controla_estoque && p.controla_estoque === false;
    return [() => update('produtos', id, patch), passaAControlar && n(p.estoque) <= 0 ? 'Produto atualizado. Use “+ Estoque” para lançar as unidades; sem estoque ele não aparece em Anotar vendas.' : 'Produto atualizado.'];
  },
  async stock(id) {
    const p = produtoById(id);
    if (!p) throw Error('Produto não encontrado.');
    const r = await ask({ title: 'Adicionar ao estoque', message: `${p.nome}: estoque atual ${num(p.estoque)}.`, ok: 'Adicionar', fields: [{ name: 'q', label: 'Quantas unidades entraram?', type: 'number', min: 0.001, step: 0.001, max: 100000, inputmode: 'decimal' }] });
    if (!r) return;
    const q = amount(r.q, { min: 0.001, max: 100000, label: 'Quantidade' });
    return [async () => { await rpc('adicionar_estoque', { p_produto: id, p_quantidade: q }); upsertLocal('produtos', [{ id, estoque: n(p.estoque) + q }]); }, `Estoque de ${p.nome}: +${num(q)}.`, ['produtos']];
  },
  async toggleProduct(id) {
    const p = produtoById(id);
    if (!p) throw Error('Produto não encontrado.');
    const ativo = p.ativo === false;
    if (!await confirmar(ativo ? 'Reativar produto' : 'Desativar produto', `${p.nome}\nO histórico de vendas é preservado.`, ativo ? 'Reativar' : 'Desativar', !ativo)) return;
    return [() => update('produtos', id, { ativo }), ativo ? 'Produto reativado.' : 'Produto desativado.'];
  },
  async delMov(id) {
    const m = data.movimentos.find(x => x.id === id);
    if (!m) throw Error('Lançamento não encontrado.');
    if (data.impostos.some(t => t.movimento_id === id)) throw Error('Esta despesa é de um imposto pago e não pode ser excluída sozinha.');
    if (!await confirmar('Excluir lançamento', `${m.descricao} — ${money(m.valor)} em ${fmtDate(m.data)}`, 'Excluir', true)) return;
    return [() => remove('movimentos', id), 'Lançamento excluído.'];
  },
  async payFunc(id) {
    $('funcPagamento').value = id;
    preencherPagamento();
    $('formPagamento').scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('valorPagamento').focus();
  },
  async editFunc(id) {
    const f = data.funcionarios.find(x => x.id === id);
    if (!f) throw Error('Funcionário não encontrado.');
    const r = await ask({ title: 'Editar funcionário', message: 'Pagamentos já registrados não mudam.', ok: 'Salvar', fields: [
      { name: 'nome', label: 'Nome', value: f.nome, maxlength: 160 },
      { name: 'cargo', label: 'Cargo', value: f.cargo, maxlength: 100 },
      { name: 'valor_diario', label: 'Valor diário (R$)', type: 'number', min: 0, step: 0.01, value: n(f.valor_diario) },
      { name: 'salario', label: 'Salário mensal (R$)', type: 'number', min: 0, step: 0.01, value: n(f.salario) },
      { name: 'admissao', label: 'Admissão', type: 'date', value: f.admissao },
    ] });
    if (!r) return;
    const patch = { nome: text(r.nome, { label: 'o nome' }), cargo: text(r.cargo, { max: 100, label: 'o cargo' }), valor_diario: amount(r.valor_diario), salario: amount(r.salario), admissao: dateVal(r.admissao, { label: 'Admissão' }) };
    return [() => update('funcionarios', id, patch), 'Funcionário atualizado.'];
  },
  async delFunc(id) {
    const f = data.funcionarios.find(x => x.id === id);
    if (!f) throw Error('Funcionário não encontrado.');
    if (data.pagamentos.some(p => p.funcionario_id === id)) throw Error('Este funcionário tem pagamentos registrados; o histórico precisa ser preservado.');
    if (!await confirmar('Excluir funcionário', f.nome, 'Excluir', true)) return;
    return [() => remove('funcionarios', id), 'Funcionário excluído.'];
  },
  async delPagamento(id) {
    const p = data.pagamentos.find(x => x.id === id);
    if (!p) throw Error('Pagamento não encontrado.');
    if (!await confirmar('Excluir pagamento', `${p.funcionario_nome} — ${money(p.valor)} em ${fmtDate(p.data)}`, 'Excluir', true)) return;
    return [() => remove('pagamentos_funcionarios', id), 'Pagamento excluído.'];
  },
  async payTax(id) {
    const t = data.impostos.find(x => x.id === id);
    if (!t || t.pago) throw Error('Este imposto não está pendente.');
    const r = await ask({ title: 'Marcar imposto como pago', message: `${t.descricao} — ${money(t.valor)}\nO valor entra automaticamente nas saídas (categoria Impostos).`, ok: 'Confirmar pagamento', fields: [{ name: 'data', label: 'Data do pagamento', type: 'date', value: today(), max: today() }] });
    if (!r) return;
    const d = dateVal(r.data, { future: false, label: 'Data do pagamento' });
    return [async () => { await rpc('pagar_imposto', { p_imposto: id, p_data: d }); upsertLocal('impostos', [{ id, pago: true, data_pagamento: d }]); }, 'Pagamento do imposto registrado.', ['impostos', 'movimentos']];
  },
  async delTax(id) {
    const t = data.impostos.find(x => x.id === id);
    if (!t || t.pago) throw Error('Só é possível excluir obrigações pendentes.');
    if (!await confirmar('Excluir obrigação', `${t.descricao} — ${money(t.valor)}`, 'Excluir', true)) return;
    return [() => remove('impostos', id), 'Obrigação excluída.'];
  },
  async editPrato(id) {
    const p = pratoById(id);
    if (!p) throw Error('Prato não encontrado.');
    const r = await ask({ title: 'Editar prato', message: 'O novo nome também aparece nas contagens antigas.', ok: 'Salvar', fields: [
      { name: 'nome', label: 'Nome do prato', value: p.nome, maxlength: 120 },
      { name: 'categoria', label: 'Categoria', value: p.categoria, maxlength: 60, list: 'categoriasPratos' },
    ] });
    if (!r) return;
    const nome = text(r.nome, { max: 120, label: 'o nome' });
    if (data.pratos.some(x => x.id !== id && x.nome.toLocaleLowerCase('pt-BR') === nome.toLocaleLowerCase('pt-BR'))) throw Error('Já existe um prato com esse nome.');
    return [() => update('pratos_contagem', id, { nome, categoria: text(r.categoria, { max: 60, label: 'a categoria' }) }), 'Prato atualizado.'];
  },
  async togglePrato(id) {
    const p = pratoById(id);
    if (!p) throw Error('Prato não encontrado.');
    const ativo = p.ativo === false;
    return [() => update('pratos_contagem', id, { ativo }), ativo ? 'Prato reativado.' : 'Prato desativado (as contagens antigas continuam).'];
  },
  async delPrato(id) {
    const p = pratoById(id);
    if (!p) throw Error('Prato não encontrado.');
    if (data.contagens.some(c => c.prato_id === id)) throw Error('Este prato já tem contagens. Desative em vez de excluir.');
    if (!await confirmar('Excluir prato', p.nome, 'Excluir', true)) return;
    return [() => remove('pratos_contagem', id), 'Prato excluído.'];
  },
  async delContagem(id) {
    const c = data.contagens.find(x => x.id === id);
    if (!c) throw Error('Registro não encontrado.');
    if (!await confirmar('Excluir contagem', `${num(c.quantidade)} × ${pratoById(c.prato_id)?.nome || c.prato_nome} em ${fmtDate(c.data)}`, 'Excluir', true)) return;
    return [() => remove('contagens_pratos', id), 'Contagem excluída.'];
  },
};
async function handleAction(name, id, btn) {
  if (!ACTIONS[name]) return;
  if (working) { toast('Aguarde a operação anterior terminar.', 'warn'); return; }
  try {
    const job = await ACTIONS[name](id);
    if (job) await run(btn, job[0], job[1], job[2] || []);
  } catch (e) { fail(e); }
}

// ---------------- Contagem: salvar ----------------
async function salvarContagem() {
  let dia;
  try { dia = dateVal($('contagemData').value, { future: false, label: 'Dia da contagem' }); } catch (e) { fail(e); return; }
  const rows = Object.entries(pendentes).map(([id, q]) => ({ p: pratoById(id), q: Math.floor(n(q)) }))
    .filter(x => x.p && x.p.ativo !== false && x.q > 0)
    .map(x => ({ prato_id: x.p.id, prato_nome: x.p.nome, quantidade: x.q, data: dia }));
  if (!rows.length) { toast('Nada para salvar.', 'warn'); return; }
  const total = rows.reduce((a, r) => a + r.quantidade, 0);
  const ok = await run($('salvarContagem'), async () => {
    await insert('contagens_pratos', rows);
    // Desconta só o que foi salvo: toques feitos durante o envio continuam pendentes.
    for (const r of rows) {
      const resto = Math.floor(n(pendentes[r.prato_id])) - r.quantidade;
      if (resto > 0) pendentes[r.prato_id] = resto; else delete pendentes[r.prato_id];
    }
    store.set('contagemPendente', pendentes);
  }, `Contagem salva: ${num(total)} prato(s) em ${fmtDate(dia)}.`);
  if (!ok) updatePendingBar();
}

// ---------------- Tempo real entre aparelhos ----------------
// Recebe do Supabase cada inclusão, alteração e exclusão feita em outro aparelho ou aba.
let channel = null, live = false, renderTimer = null;
function setLive(v) {
  live = v;
  const el = $('liveInfo');
  el.classList.toggle('on', v);
  el.textContent = v ? 'Ao vivo' : 'Sem tempo real';
  el.title = v ? 'Alterações feitas em outros aparelhos aparecem na hora.' : 'O sistema confere novidades a cada minuto. Para atualizar na hora entre aparelhos, execute tempo-real.sql no Supabase.';
}
function scheduleRender() { clearTimeout(renderTimer); renderTimer = setTimeout(() => { if (entered) render(); }, 150); }
function applyChange(key, p) {
  if (p.eventType === 'DELETE') { if (p.old?.id) removeLocal(key, p.old.id); }
  else if (p.new) upsertLocal(key, [p.new]);
  scheduleRender();
}
function startRealtime() {
  stopRealtime();
  if (typeof db.channel !== 'function') return;
  const sid = sessionId;
  let ch = db.channel('barraca-' + sid);
  for (const [key, s] of Object.entries(SOURCES)) {
    ch = ch.on('postgres_changes', { event: '*', schema: 'public', table: s.table }, p => { if (sid === sessionId) applyChange(key, p); });
  }
  let jaConectou = false;
  channel = ch.subscribe(status => {
    if (sid !== sessionId) return;
    if (status === 'SUBSCRIBED') {
      // Ao reconectar, busca o que pode ter mudado enquanto a conexão estava caída.
      if (jaConectou) void load();
      jaConectou = true;
      // A conexão abre mesmo sem o tempo-real.sql, mas aí nenhum aviso chega: confere no banco.
      rpc('tempo_real_ativo', {}).then(ok => { if (sid === sessionId) setLive(ok === true); }, () => { if (sid === sessionId) setLive(false); });
    } else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) setLive(false);
  });
}
function stopRealtime() {
  if (channel) { try { db.removeChannel(channel); } catch { /* já fechado */ } channel = null; }
  setLive(false);
}

// ---------------- Login e sessão ----------------
function showAuth(msg = '') {
  $('boot').classList.add('hidden');
  $('app').classList.add('hidden');
  $('auth').classList.remove('hidden');
  $('loginmsg').textContent = msg;
}
function enter(session) {
  entered = true;
  sessionId++;
  $('userEmail').textContent = session?.user?.email || '';
  $('boot').classList.add('hidden');
  $('auth').classList.add('hidden');
  $('app').classList.remove('hidden');
  $('password').value = '';
  go(location.hash.slice(1) || store.get('tab', 'dashboard'), false);
  void load();
  startRealtime();
}
// A contagem pendente fica guardada mesmo se a sessão expirar; só o botão Sair a apaga.
function leave() {
  stopRealtime();
  entered = false;
  loaded = false;
  windowStart = null;
  sessionId++;
  data = emptyData();
  missing.clear();
  render(); // limpa as telas para não deixar dados visíveis
  setSync('');
  showAuth();
}
function onAuth(event, session) {
  if (session && !entered) enter(session);
  else if (!session && entered) leave();
  else if (!session) showAuth($('loginmsg').textContent);
}

async function init() {
  bindUI();
  if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) { showAuth('Supabase não configurado (verifique config.js).'); return; }
  if (!window.supabase?.createClient) { showAuth('Não foi possível carregar a biblioteca do Supabase. Verifique a internet e recarregue a página.'); return; }
  db = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
  // O callback não deve chamar o Supabase diretamente; o setTimeout evita travamentos.
  db.auth.onAuthStateChange((event, session) => setTimeout(() => onAuth(event, session), 0));
}

function bindUI() {
  // Login
  $('loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    if (!db) { $('loginmsg').textContent = 'Conexão com o Supabase indisponível.'; return; }
    if (!e.currentTarget.reportValidity()) return;
    const btn = $('loginBtn');
    btn.disabled = true;
    $('loginmsg').textContent = '';
    btn.textContent = 'Entrando…';
    try {
      const { error } = await db.auth.signInWithPassword({ email: $('email').value.trim(), password: $('password').value });
      if (error) throw error;
    } catch (err) { $('loginmsg').textContent = friendly(err); }
    finally { btn.disabled = false; btn.textContent = 'Entrar'; }
  });
  $('logoutBtn').addEventListener('click', async () => {
    const qtd = Object.values(pendentes).reduce((a, b) => a + n(b), 0);
    if (qtd && !await confirmar('Sair sem salvar a contagem?', `Há ${num(qtd)} prato(s) contados que ainda não foram salvos. Se sair agora, eles serão descartados.`, 'Sair e descartar', true)) return;
    pendentes = {};
    store.set('contagemPendente', pendentes);
    const { error } = await db.auth.signOut();
    if (error) { await db.auth.signOut({ scope: 'local' }); leave(); }
  });

  // Navegação
  document.addEventListener('click', e => {
    const tabBtn = e.target.closest('[data-tab]');
    if (tabBtn) { go(tabBtn.dataset.tab); return; }
    const gotoBtn = e.target.closest('[data-goto]');
    if (gotoBtn) { go(gotoBtn.dataset.goto); return; }
    const actBtn = e.target.closest('button[data-action]');
    if (actBtn) { void handleAction(actBtn.dataset.action, actBtn.dataset.id, actBtn); return; }
    const csvBtn = e.target.closest('[data-csv]');
    if (csvBtn) void exportCsv(csvBtn.dataset.csv, csvBtn);
  });
  window.addEventListener('hashchange', () => { if (entered) go(location.hash.slice(1)); });

  // Datas padrão e filtros
  $('periodo').value = today().slice(0, 7);
  $('periodo').addEventListener('change', () => {
    // Alguns navegadores mostram um campo de texto livre; mês inválido volta para o atual.
    if (!validYm($('periodo').value)) { if ($('periodo').value) toast('Mês inválido. Use o formato AAAA-MM, por exemplo 2026-10.', 'warn'); $('periodo').value = today().slice(0, 7); }
    if (entered && windowStart && windowFor() < windowStart) void load(); // mês antigo: busca mais histórico
    else render();
  });
  document.querySelectorAll('[data-default="today"]').forEach(el => { el.value = today(); });
  document.querySelectorAll('[data-default="month"]').forEach(el => { el.value = today().slice(0, 7); });
  $('refreshBtn').addEventListener('click', () => load());
  // Filtros redesenham só a própria tela.
  const only = fn => () => { try { fn({ ym: validYm($('periodo').value) || today().slice(0, 7), hoje: today() }); } catch (e) { console.error(e); } };
  for (const id of ['filtroDia', 'filtroCategoria', 'filtroPagamento']) $(id).addEventListener('change', only(renderVendas));
  $('buscaVenda').addEventListener('input', only(renderVendas));
  $('buscaProduto').addEventListener('input', only(renderProdutos));
  $('filtroMovTipo').addEventListener('change', only(renderMovimentos));
  $('contagemData').addEventListener('change', only(renderContagem));
  // Outra aba do navegador alterou a contagem pendente: sincroniza para não salvar em dobro.
  window.addEventListener('storage', e => { if (e.key === 'barraca:contagemPendente') { pendentes = store.get('contagemPendente', {}) || {}; if (entered) only(renderContagem)(); } });

  // Vendas
  $('formVenda').addEventListener('input', updateVendaPreview);
  $('formVenda').addEventListener('change', updateVendaPreview);
  bindForm('formVenda', async f => {
    const prod = produtoById(f.produto);
    if (!prod || prod.ativo === false) throw Error('Selecione um produto ativo.');
    const qtd = amount(f.quantidade, { min: 0.001, max: 100000, label: 'Quantidade' });
    const semEstoque = prod.controla_estoque === false;
    if (!semEstoque && qtd > n(prod.estoque)) throw Error(`Estoque insuficiente: há ${num(prod.estoque)} unidade(s).`);
    const dia = dateVal(f.data, { future: false });
    const vendaId = await rpc(semEstoque ? 'registrar_venda_sem_estoque' : 'registrar_venda', { p_produto: prod.id, p_quantidade: qtd, p_pagamento: f.pagamento, p_data: dia });
    // Mostra a venda já; a busca seguinte troca pela versão exata do banco.
    upsertLocal('vendas', [{ id: vendaId || 'tmp-' + Date.now(), data: dia, produto_id: prod.id, produto_nome: prod.nome, quantidade: qtd, preco_unitario: n(prod.preco), custo_unitario: n(prod.custo), total: round2(qtd * n(prod.preco)), custo_total: round2(qtd * n(prod.custo)), pagamento: f.pagamento, estoque_baixado: !semEstoque, created_at: new Date().toISOString() }]);
    if (!semEstoque) upsertLocal('produtos', [{ id: prod.id, estoque: n(prod.estoque) - qtd }]);
    return `Venda registrada: ${num(qtd)} × ${prod.nome} (${money(round2(qtd * n(prod.preco)))}).`;
  }, 'Venda registrada.', ['pagamento', 'data'], ['vendas', 'produtos']);

  // Contagem de pratos
  $('contadorGrid').addEventListener('click', e => {
    const b = e.target.closest('[data-step]');
    if (!b) return;
    const card = b.closest('.counter'), input = card.querySelector('input');
    setPendente(card.dataset.id, n(input.value) + Number(b.dataset.step), card);
    card.classList.remove('bump'); void card.offsetWidth; card.classList.add('bump');
  });
  $('contadorGrid').addEventListener('input', e => {
    if (e.target.matches('.stepper input')) { const card = e.target.closest('.counter'); setPendente(card.dataset.id, e.target.value, null); card.classList.toggle('has-pending', n(e.target.value) > 0); }
  });
  $('contadorGrid').addEventListener('change', e => { if (e.target.matches('.stepper input')) setPendente(e.target.closest('.counter').dataset.id, e.target.value, e.target.closest('.counter')); });
  $('salvarContagem').addEventListener('click', salvarContagem);
  $('zerarContagem').addEventListener('click', async () => { if (await confirmar('Zerar contagem', 'Descartar as quantidades que ainda não foram salvas?', 'Zerar', true)) { pendentes = {}; store.set('contagemPendente', pendentes); render(); } });
  bindForm('formPrato', async f => {
    const nome = text(f.nome, { max: 120, label: 'o nome do prato' });
    if (data.pratos.some(p => p.nome.toLocaleLowerCase('pt-BR') === nome.toLocaleLowerCase('pt-BR'))) throw Error('Já existe um prato com esse nome.');
    await insert('pratos_contagem', { nome, categoria: text(f.categoria, { max: 60, label: 'a categoria' }) });
    return `Prato “${nome}” adicionado.`;
  }, 'Prato adicionado.', ['categoria']);

  // Cardápio
  $('formProduto').addEventListener('input', updateProdutoForm);
  $('formProduto').addEventListener('change', updateProdutoForm);
  bindForm('formProduto', async f => {
    const controla = f.controla_estoque === 'sim';
    const row = { nome: text(f.nome, { label: 'o nome do produto' }), categoria: text(f.categoria, { max: 60, label: 'a categoria' }), custo: amount(f.custo, { label: 'Custo' }), preco: amount(f.preco, { label: 'Preço' }), estoque: controla ? amount(f.estoque || 0, { max: 1e7, label: 'Estoque' }) : 0, controla_estoque: controla };
    if (row.preco > 0 && row.preco < row.custo && !await confirmar('Preço abaixo do custo', `O preço (${money(row.preco)}) é menor que o custo (${money(row.custo)}). Cadastrar mesmo assim?`)) return false;
    if (data.produtos.some(p => p.ativo !== false && p.nome.toLocaleLowerCase('pt-BR') === row.nome.toLocaleLowerCase('pt-BR')) && !await confirmar('Produto repetido', `Já existe um produto ativo chamado “${row.nome}”. Cadastrar outro?`)) return false;
    await insert('produtos', row);
    return `Produto “${row.nome}” cadastrado.`;
  }, 'Produto cadastrado.', ['categoria', 'controla_estoque']);

  // Despesas e entradas
  updateMovCategorias();
  $('movTipo').addEventListener('change', updateMovCategorias);
  bindForm('formMov', async f => {
    if (['Salários', 'Impostos'].includes(f.categoria) && f.tipo === 'saida' && !await confirmar('Atenção: possível duplicidade', `Pagamentos de funcionários e impostos têm abas próprias que já lançam a despesa. Lançar “${f.categoria}” aqui mesmo assim?`, 'Lançar mesmo assim')) return false;
    if (f.tipo === 'entrada' && f.categoria === 'Vendas' && !await confirmar('Atenção: possível duplicidade', 'Se esta venda também foi registrada em “Anotar vendas”, o faturamento será contado duas vezes. Continuar?', 'Continuar')) return false;
    await insert('movimentos', { descricao: text(f.descricao, { label: 'a descrição' }), tipo: f.tipo === 'entrada' ? 'entrada' : 'saida', categoria: text(f.categoria, { max: 60, label: 'a categoria' }), valor: amount(f.valor, { min: 0.01, label: 'Valor' }), data: dateVal(f.data) });
  }, 'Lançamento salvo.', ['tipo', 'data']);
  $('formMov').addEventListener('change', e => { if (e.target === $('formMov')) updateMovCategorias(); });

  // Funcionários
  $('funcPagamento').addEventListener('change', preencherPagamento);
  $('tipoPagamento').addEventListener('change', preencherPagamento);
  bindForm('formFunc', f => insert('funcionarios', { nome: text(f.nome, { label: 'o nome' }), cargo: text(f.cargo, { max: 100, label: 'o cargo' }), salario: amount(f.salario, { label: 'Salário' }), valor_diario: amount(f.valor_diario, { label: 'Valor diário' }), admissao: dateVal(f.admissao, { label: 'Admissão' }) }), 'Funcionário cadastrado.');
  bindForm('formPagamento', async f => {
    const func = data.funcionarios.find(x => x.id === f.funcionario_id);
    if (!func) throw Error('Selecione um funcionário.');
    const valor = amount(f.valor, { min: 0.01, label: 'Valor' });
    await insert('pagamentos_funcionarios', { funcionario_id: func.id, funcionario_nome: func.nome, tipo: ['diaria', 'mensal', 'extra'].includes(f.tipo) ? f.tipo : 'extra', valor, data: dateVal(f.data), observacao: String(f.observacao || '').trim().slice(0, 160) });
    return `Pagamento de ${money(valor)} para ${func.nome} registrado.`;
  }, 'Pagamento registrado.', ['tipo', 'data']);

  // Impostos
  bindForm('formImposto', f => {
    if (!/^\d{4}-\d{2}$/.test(f.competencia)) throw Error('Competência inválida.');
    return insert('impostos', { descricao: text(f.descricao, { label: 'a descrição' }), competencia: f.competencia, vencimento: dateVal(f.vencimento, { label: 'Vencimento' }), valor: amount(f.valor, { min: 0.01, label: 'Valor' }) });
  }, 'Obrigação anotada.');

  // Atualiza ao voltar para a aba e acompanha a virada do dia.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !entered) return;
    rolloverDay();
    if (Date.now() - lastLoad > 60000) void load();
  });
  setInterval(rolloverDay, 60000);
  // Sem tempo real ativo, confere novidades a cada minuto enquanto a tela estiver aberta.
  // Com tempo real, confere a cada 5 minutos por segurança (avisos podem se perder numa queda rápida).
  setInterval(() => { if (entered && !working && document.visibilityState === 'visible' && Date.now() - lastLoad > (live ? 300000 : 55000)) void load(); }, 15000);
  window.addEventListener('offline', () => toast('Você está sem internet. As gravações vão falhar até a conexão voltar.', 'warn'));
  window.addEventListener('online', () => { toast('Conexão restabelecida.'); if (entered) void load(); });
  window.addEventListener('beforeunload', e => { if (Object.keys(pendentes).length && entered) { e.preventDefault(); e.returnValue = ''; } });
}
// Depois da meia-noite, os campos que estavam com "hoje" passam para o novo dia.
function rolloverDay() {
  const t = today();
  if (t === lastToday) return;
  document.querySelectorAll('[data-default="today"]').forEach(el => { if (el.value === lastToday) el.value = t; });
  if ($('periodo').value === lastToday.slice(0, 7)) $('periodo').value = t.slice(0, 7);
  lastToday = t;
  if (entered) render();
}

init();
