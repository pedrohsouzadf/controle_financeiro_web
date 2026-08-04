// ==========================================================
// App principal: navegação entre abas, formulários e tabelas
// ==========================================================

(function () {
  function showConfigBannerIfNeeded() {
    const banner = document.getElementById("config-banner");
    if (!Api.isConfigured()) banner.classList.add("show");
    else banner.classList.remove("show");
  }

  function switchView(viewName) {
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    document.getElementById(`view-${viewName}`).classList.add("active");
    document.querySelectorAll("nav.tabs button").forEach((b) => b.classList.remove("active"));
    document.querySelector(`nav.tabs button[data-view="${viewName}"]`).classList.add("active");
    if (viewName === "dashboard") Dashboard.render(Store.get());
  }

  function setupNav() {
    document.querySelectorAll("nav.tabs button").forEach((btn) => {
      btn.addEventListener("click", () => switchView(btn.dataset.view));
    });
  }

  // ---------- RECEITAS ----------
  function renderReceitas() {
    const rows = UI.sortByDateDesc(Store.get().receitas);
    UI.renderTable(
      document.querySelector("#table-receitas tbody"),
      rows,
      [
        { render: (r) => UI.formatDate(r.data) },
        { field: "descricao" },
        { render: (r) => `<span class="tag">${r.categoria}</span>` },
        { render: (r) => `<span class="value-in">${UI.formatBRL(r.valor)}</span>` },
        { render: (r) => (isRecorrente(r) ? `<span class="tag" style="background:#e6f9ec;color:#1a7f3c;">Recorrente</span>` : "") }
      ],
      async (row) => {
        if (!confirm("Excluir esta receita?")) return;
        try {
          await Store.deleteItem("receitas", row.id);
          renderReceitas();
          Dashboard.render(Store.get());
          UI.toast("Receita excluída");
        } catch (e) {
          UI.toast(e.message, true);
        }
      }
    );
  }

  // ---------- DESPESAS DIA A DIA ----------
  function renderDespesas() {
    const rows = UI.sortByDateDesc(Store.get().despesas);
    UI.renderTable(
      document.querySelector("#table-despesas tbody"),
      rows,
      [
        { render: (r) => UI.formatDate(r.data) },
        { field: "descricao" },
        { render: (r) => `<span class="tag">${r.categoria}</span>` },
        { render: (r) => `<span class="value-out">${UI.formatBRL(r.valor)}</span>` }
      ],
      async (row) => {
        if (!confirm("Excluir esta despesa?")) return;
        try {
          await Store.deleteItem("despesas", row.id);
          renderDespesas();
          Dashboard.render(Store.get());
          UI.toast("Despesa excluída");
        } catch (e) {
          UI.toast(e.message, true);
        }
      }
    );
  }

  // ---------- GASTOS FIXOS ----------
  function renderFixos() {
    const rows = Store.get().fixos;
    UI.renderTable(
      document.querySelector("#table-fixos tbody"),
      rows,
      [
        { field: "descricao" },
        { render: (r) => `<span class="tag">${r.categoria}</span>` },
        { render: (r) => `<span class="value-out">${UI.formatBRL(r.valorMensal)}</span>` },
        { render: (r) => `Dia ${r.diaVencimento}` }
      ],
      async (row) => {
        if (!confirm("Excluir este gasto fixo?")) return;
        try {
          await Store.deleteItem("fixos", row.id);
          renderFixos();
          Dashboard.render(Store.get());
          UI.toast("Gasto fixo excluído");
        } catch (e) {
          UI.toast(e.message, true);
        }
      }
    );
  }

  // ---------- CARTÃO DE CRÉDITO ----------
  function renderCartao() {
    const rows = UI.sortByDateDesc(Store.get().cartao);
    UI.renderTable(
      document.querySelector("#table-cartao tbody"),
      rows,
      [
        { render: (r) => UI.formatDate(r.data) },
        { field: "descricao" },
        { render: (r) => `<span class="tag">${r.categoria}</span>` },
        { field: "cartao" },
        { render: (r) => `${r.parcelaAtual || 1}/${r.parcelasTotal || 1}` },
        { render: (r) => `<span class="value-out">${UI.formatBRL(r.valor)}</span>` }
      ],
      async (row) => {
        if (!confirm("Excluir este lançamento do cartão?")) return;
        try {
          await Store.deleteItem("cartao", row.id);
          renderCartao();
          Dashboard.render(Store.get());
          UI.toast("Lançamento excluído");
        } catch (e) {
          UI.toast(e.message, true);
        }
      }
    );
  }

  // ---------- POUPANÇA ----------
  function renderPoupanca() {
    const rows = UI.sortByDateDesc(Store.get().poupanca);
    const depositos = rows.filter((p) => p.tipo === "deposito").reduce((s, p) => s + Number(p.valor || 0), 0);
    const retiradas = rows.filter((p) => p.tipo === "retirada").reduce((s, p) => s + Number(p.valor || 0), 0);
    document.getElementById("poupanca-total").textContent = UI.formatBRL(depositos - retiradas);
    document.getElementById("poupanca-depositos").textContent = UI.formatBRL(depositos);
    document.getElementById("poupanca-retiradas").textContent = UI.formatBRL(retiradas);

    UI.renderTable(
      document.querySelector("#table-poupanca tbody"),
      rows,
      [
        { render: (r) => UI.formatDate(r.data) },
        { render: (r) => (r.tipo === "deposito" ? "Depósito" : "Retirada") },
        {
          render: (r) =>
            `<span class="${r.tipo === "deposito" ? "value-in" : "value-out"}">${UI.formatBRL(r.valor)}</span>`
        },
        { field: "observacao" }
      ],
      async (row) => {
        if (!confirm("Excluir esta movimentação?")) return;
        try {
          await Store.deleteItem("poupanca", row.id);
          renderPoupanca();
          Dashboard.render(Store.get());
          UI.toast("Movimentação excluída");
        } catch (e) {
          UI.toast(e.message, true);
        }
      }
    );
  }

  // ---------- HELPERS ----------
  function isRecorrente(item) {
    return item.recorrente === true || item.recorrente === "true" || item.recorrente === "on";
  }

  // ---------- FORM HANDLERS ----------
  function formToObject(form) {
    const data = {};
    new FormData(form).forEach((value, key) => (data[key] = value));
    // Checkboxes não marcados não aparecem no FormData — força valor explícito
    form.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      data[cb.name] = cb.checked ? "true" : "false";
    });
    return data;
  }

  function setupForm(formId, sheetKey, onSuccess) {
    const form = document.getElementById(formId);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const data = formToObject(form);
      try {
        await Store.addItem(sheetKey, data);
        form.reset();
        onSuccess();
        Dashboard.render(Store.get());
        UI.toast("Adicionado com sucesso");
      } catch (err) {
        UI.toast(err.message, true);
      }
    });
  }

  function setupSimulacao() {
    const form = document.getElementById("form-simulacao");
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const inicial = Number(document.getElementById("sim-inicial").value) || 0;
      const mensal = Number(document.getElementById("sim-mensal").value) || 0;
      const taxa = Number(document.getElementById("sim-taxa").value) || 0;
      const meses = Number(document.getElementById("sim-meses").value) || 12;

      const result = Dashboard.simular({ inicial, mensal, taxaMensalPct: taxa, meses });

      const resultEl = document.getElementById("simulacao-result");
      resultEl.style.display = "block";
      resultEl.innerHTML = `
        <div class="grid cols-3">
          <div><div class="kpi-label">Valor final estimado</div><div class="kpi-value positive">${UI.formatBRL(result.saldoFinal)}</div></div>
          <div><div class="kpi-label">Total aportado</div><div class="kpi-value">${UI.formatBRL(result.totalAportado)}</div></div>
          <div><div class="kpi-label">Rendimento estimado</div><div class="kpi-value positive">${UI.formatBRL(result.totalJuros)}</div></div>
        </div>
      `;

      document.getElementById("sim-chart-wrap").style.display = "block";
      Dashboard.renderChartSimulacao(result.serie);
    });
  }

  async function init() {
    Store.loadCache();
    setupNav();
    showConfigBannerIfNeeded();

    setupForm("form-receitas", "receitas", renderReceitas);
    setupForm("form-despesas", "despesas", renderDespesas);
    setupForm("form-fixos", "fixos", renderFixos);
    setupForm("form-cartao", "cartao", renderCartao);
    setupForm("form-poupanca", "poupanca", renderPoupanca);
    setupSimulacao();

    try {
      await Store.refresh();
    } catch (e) {
      UI.toast("Não foi possível carregar os dados: " + e.message, true);
    }

    renderReceitas();
    renderDespesas();
    renderFixos();
    renderCartao();
    renderPoupanca();
    Dashboard.render(Store.get());
  }

  document.addEventListener("DOMContentLoaded", init);
})();
