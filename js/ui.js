// ==========================================================
// Funções utilitárias de UI (toast, formatação, render de tabelas)
// ==========================================================

const UI = (() => {
  function toast(message, isError = false) {
    const el = document.getElementById("toast");
    el.textContent = message;
    el.classList.toggle("error", isError);
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("show"), 3000);
  }

  function formatBRL(value) {
    const n = Number(value) || 0;
    return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  function formatDate(value) {
    if (!value) return "";
    const d = new Date(value);
    if (isNaN(d.getTime())) return String(value);
    // Ajusta fuso: se vier só data (YYYY-MM-DD), evita problema de timezone
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
      const [y, m, day] = value.substring(0, 10).split("-");
      return `${day}/${m}/${y}`;
    }
    return d.toLocaleDateString("pt-BR");
  }

  // `actionsParam` pode ser:
  //  - uma função onDelete(row) — comportamento antigo, mostra só "Excluir"
  //  - um array de ações [{ label, className, onClick(row) }, ...]
  function renderTable(tbodyEl, rows, columns, actionsParam) {
    const actions =
      typeof actionsParam === "function"
        ? [{ label: "Excluir", className: "btn danger", onClick: actionsParam }]
        : actionsParam || [];

    tbodyEl.innerHTML = "";
    if (!rows.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = columns.length + 1;
      td.className = "empty-state";
      td.textContent = "Nenhum registro ainda.";
      tr.appendChild(td);
      tbodyEl.appendChild(tr);
      return;
    }
    rows.forEach((row) => {
      const tr = document.createElement("tr");
      columns.forEach((col) => {
        const td = document.createElement("td");
        td.innerHTML = col.render ? col.render(row) : (row[col.field] ?? "");
        tr.appendChild(td);
      });
      const tdActions = document.createElement("td");
      tdActions.style.whiteSpace = "nowrap";
      actions.forEach((action) => {
        const btn = document.createElement("button");
        btn.className = action.className || "btn secondary";
        btn.textContent = action.label;
        btn.style.marginRight = "4px";
        btn.onclick = () => action.onClick(row);
        tdActions.appendChild(btn);
      });
      tr.appendChild(tdActions);
      tbodyEl.appendChild(tr);
    });
  }

  function sortByDateDesc(rows, field = "data") {
    return [...rows].sort((a, b) => new Date(b[field]) - new Date(a[field]));
  }

  // Cor fixa por tipo de pagamento, usada em toda a interface (tabelas,
  // pílulas de resumo, dashboard) para reconhecer de relance se um gasto é
  // dinheiro de verdade, cartão, VA ou CAJU — sem precisar ler o texto.
  const FONTE_CORES = {
    dinheiro: { bg: "#e6f9ec", color: "#1a7f3c" }, // verde — débito / conta corrente
    cartao: { bg: "#e6f0fd", color: "#0050b3" }, // azul — cartão de crédito
    va: { bg: "#fff2e0", color: "#a35b00" }, // laranja — VA
    caju: { bg: "#f5e9ff", color: "#7a1fa2" } // roxo — CAJU
  };

  function tipoFonte(fonte) {
    const f = (fonte || "").trim().toLowerCase();
    if (!f || f === "débito" || f === "debito" || f === "conta corrente" || f === "contacorrente") return "dinheiro";
    if (f === "cartão de crédito" || f === "cartao de credito") return "cartao";
    if (f === "va") return "va";
    if (f === "caju") return "caju";
    return null; // fonte desconhecida — mantém a etiqueta cinza padrão
  }

  function fonteBadge(fonte, label) {
    const texto = label || fonte || "Débito";
    const tipo = tipoFonte(fonte);
    if (!tipo) return `<span class="tag">${texto}</span>`;
    const { bg, color } = FONTE_CORES[tipo];
    return `<span class="tag" style="background:${bg}; color:${color};">${texto}</span>`;
  }

  return { toast, formatBRL, formatDate, renderTable, sortByDateDesc, fonteBadge };
})();
