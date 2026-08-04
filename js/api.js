// ==========================================================
// Camada de comunicação com o Google Apps Script (API)
// ==========================================================

const Api = (() => {
  const isConfigured = () =>
    typeof API_URL === "string" &&
    API_URL.startsWith("http") &&
    !API_URL.includes("COLE_AQUI");

  async function getAll() {
    if (!isConfigured()) throw new Error("API_URL não configurada");
    const res = await fetch(`${API_URL}?action=all`, { method: "GET" });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "Erro ao buscar dados");
    return json;
  }

  async function post(body) {
    if (!isConfigured()) throw new Error("API_URL não configurada");
    const res = await fetch(API_URL, {
      method: "POST",
      // text/plain evita o preflight CORS que o Apps Script não trata bem
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body)
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "Erro na operação");
    return json;
  }

  const add = (sheet, data) => post({ action: "add", sheet, data });
  const remove = (sheet, id) => post({ action: "delete", sheet, id });
  const update = (sheet, id, data) => post({ action: "update", sheet, id, data });
  const setConfig = (chave, valor) => post({ action: "setConfig", chave, valor });

  return { isConfigured, getAll, add, remove, update, setConfig };
})();
