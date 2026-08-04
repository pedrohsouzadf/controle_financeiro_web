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

  return { toast, formatBRL, formatDate, renderTable, sortByDateDesc };
})();
