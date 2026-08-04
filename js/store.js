// ==========================================================
// Estado da aplicação: busca dados da API e mantém em memória
// (com cache em localStorage para funcionar offline / carregar rápido)
// ==========================================================

const Store = (() => {
  const CACHE_KEY = "meu-financeiro-cache-v1";

  let state = {
    receitas: [],
    despesas: [],
    fixos: [],
    cartao: [],
    poupanca: [],
    quitacao: [],
    config: {}
  };

  function loadCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) state = JSON.parse(raw);
    } catch (e) {
      /* ignore */
    }
  }

  function saveCache() {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(state));
    } catch (e) {
      /* ignore */
    }
  }

  async function refresh() {
    if (!Api.isConfigured()) {
      loadCache();
      return state;
    }
    const data = await Api.getAll();
    state = {
      receitas: data.receitas || [],
      despesas: data.despesas || [],
      fixos: data.fixos || [],
      cartao: data.cartao || [],
      poupanca: data.poupanca || [],
      quitacao: data.quitacao || [],
      config: data.config || {}
    };
    saveCache();
    return state;
  }

  function get() {
    return state;
  }

  async function addItem(sheetKey, data) {
    if (!Api.isConfigured()) throw new Error("Configure a API primeiro (js/config.js)");
    const res = await Api.add(sheetKey, data);
    state[sheetKey].push(res.item);
    saveCache();
    return res.item;
  }

  async function deleteItem(sheetKey, id) {
    if (!Api.isConfigured()) throw new Error("Configure a API primeiro (js/config.js)");
    await Api.remove(sheetKey, id);
    state[sheetKey] = state[sheetKey].filter((i) => String(i.id) !== String(id));
    saveCache();
  }

  async function updateItem(sheetKey, id, data) {
    if (!Api.isConfigured()) throw new Error("Configure a API primeiro (js/config.js)");
    await Api.update(sheetKey, id, data);
    const idx = state[sheetKey].findIndex((i) => String(i.id) === String(id));
    if (idx !== -1) state[sheetKey][idx] = { ...state[sheetKey][idx], ...data, id };
    saveCache();
  }

  async function setConfigValue(chave, valor) {
    if (!Api.isConfigured()) throw new Error("Configure a API primeiro (js/config.js)");
    await Api.setConfig(chave, valor);
    state.config[chave] = valor;
    saveCache();
  }

  return { refresh, get, addItem, deleteItem, updateItem, setConfigValue, loadCache };
})();
