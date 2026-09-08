// ==========================================================
// Camada de comunicação com a API (AWS: API Gateway + Lambda)
// ==========================================================

const Api = (() => {
  const isConfigured = () =>
    typeof API_URL === "string" &&
    API_URL.startsWith("http") &&
    !API_URL.includes("COLE_AQUI") &&
    typeof API_KEY === "string" &&
    !API_KEY.includes("COLE_AQUI");

  function headers(extra = {}) {
    return { "x-api-key": API_KEY, ...extra };
  }

  async function getAll() {
    if (!isConfigured()) throw new Error("API_URL/API_KEY não configurados");
    const res = await fetch(API_URL, { method: "GET", headers: headers() });
    const json = await res.json();
    if (!res.ok || !json.ok) throw new Error(json.error || "Erro ao buscar dados");
    return json;
  }

  async function post(body) {
    if (!isConfigured()) throw new Error("API_URL/API_KEY não configurados");
    const res = await fetch(API_URL, {
      method: "POST",
      headers: headers({ "Content-Type": "application/json" }),
      body: JSON.stringify(body)
    });
    const json = await res.json();
    if (!res.ok || !json.ok) throw new Error(json.error || "Erro na operação");
    return json;
  }

  const add = (sheet, data) => post({ action: "add", sheet, data });
  const remove = (sheet, id) => post({ action: "delete", sheet, id });
  const update = (sheet, id, data) => post({ action: "update", sheet, id, data });
  const setConfig = (chave, valor) => post({ action: "setConfig", chave, valor });
  // Botão "Atualizar" da aba Despesas: pede pro backend ir buscar
  // transações novas na Pluggy (Open Finance) e lançar como despesa/receita.
  const syncPluggy = () => post({ action: "syncPluggy" });

  return { isConfigured, getAll, add, remove, update, setConfig, syncPluggy };
})();
