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

  // Referências preenchidas em init() — usadas pelos botões "Editar" das tabelas.
  let receitasEditor, despesasEditor, fixosEditor, cartaoEditor;

  function setTabTotal(elId, value) {
    const el = document.getElementById(elId);
    if (el) el.textContent = UI.formatBRL(value);
  }

  // ---------- FILTRO POR MÊS ----------
  // Estado do filtro selecionado em cada aba ("todos" ou "YYYY-MM").
  const filtroMes = { receitas: "todos", despesas: "todos", fixos: "todos", cartao: "todos", poupanca: "todos" };
  const NOMES_MES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

  function mesesDisponiveis(rows, field) {
    const meses = new Set();
    rows.forEach((r) => {
      const v = r[field];
      if (v && /^\d{4}-\d{2}/.test(String(v))) meses.add(String(v).substring(0, 7));
    });
    return [...meses].sort().reverse();
  }

  function formatarMesLabel(mesKey) {
    const [y, m] = mesKey.split("-");
    return `${NOMES_MES[Number(m) - 1]}/${y}`;
  }

  // Popula o <select> de filtro de mês de uma aba com os meses realmente
  // presentes nos dados, preservando a seleção atual quando possível.
  function popularFiltroMes(selectId, rows, field, filtroKey, onChange) {
    const select = document.getElementById(selectId);
    if (!select) return;
    const meses = mesesDisponiveis(rows, field);
    const atual = filtroMes[filtroKey];
    const valorSelecionado = meses.includes(atual) ? atual : "todos";
    select.innerHTML =
      `<option value="todos">Todos os meses</option>` +
      meses.map((m) => `<option value="${m}">${formatarMesLabel(m)}</option>`).join("");
    select.value = valorSelecionado;
    filtroMes[filtroKey] = valorSelecionado;
    select.onchange = () => {
      filtroMes[filtroKey] = select.value;
      onChange();
    };
  }

  function filtrarPorMes(rows, field, filtroKey) {
    const mes = filtroMes[filtroKey];
    if (mes === "todos") return rows;
    return rows.filter((r) => String(r[field] || "").startsWith(mes));
  }

  // ---------- FILTRO POR GRUPO (Necessidades/Desejos/Investimentos/Extraordinários) ----------
  // Estado do filtro de grupo selecionado em cada aba ("todos" ou a chave do
  // grupo em Categories.CATEGORY_GROUPS).
  const filtroGrupo = { despesas: "todos", fixos: "todos", cartao: "todos" };

  // As opções são fixas (vêm de Categories.CATEGORY_GROUPS), então só
  // preenchemos o <select> uma vez — não precisa recriar a cada render.
  function popularFiltroGrupo(selectId, filtroKey, onChange) {
    const select = document.getElementById(selectId);
    if (!select || select.dataset.populated) return;
    select.dataset.populated = "true";
    const opcoes = Object.entries(Categories.CATEGORY_GROUPS)
      .map(([key, g]) => `<option value="${key}">${g.label}</option>`)
      .join("");
    select.innerHTML = `<option value="todos">Todos os grupos</option>${opcoes}`;
    select.value = filtroGrupo[filtroKey];
    select.onchange = () => {
      filtroGrupo[filtroKey] = select.value;
      onChange();
    };
  }

  function filtrarPorGrupo(rows, filtroKey) {
    const grupo = filtroGrupo[filtroKey];
    if (grupo === "todos") return rows;
    return rows.filter((r) => Categories.grupoDaCategoria(r.categoria) === grupo);
  }

  // ---------- RECEITAS ----------
  function renderReceitas() {
    const all = UI.sortByDateDesc(Store.get().receitas);
    popularFiltroMes("filtro-mes-receitas", all, "data", "receitas", renderReceitas);
    const rows = filtrarPorMes(all, "data", "receitas");
    setTabTotal("total-receitas-tab", rows.reduce((s, r) => s + Number(r.valor || 0), 0));
    UI.renderTable(
      document.querySelector("#table-receitas tbody"),
      rows,
      [
        { render: (r) => UI.formatDate(r.data) },
        { field: "descricao" },
        { render: (r) => `<span class="tag">${r.categoria}</span>` },
        {
          render: (r) =>
            r.tipo === "beneficio"
              ? `<span class="tag" style="background:#fff2e0;color:#a35b00;">Benefício</span>`
              : `<span class="tag">Renda</span>`
        },
        { render: (r) => `<span class="value-in">${UI.formatBRL(r.valor)}</span>` },
        { render: (r) => (isRecorrente(r) ? `<span class="tag" style="background:#e6f9ec;color:#1a7f3c;">Recorrente</span>` : "") }
      ],
      [
        { label: "Editar", className: "btn secondary", onClick: (row) => receitasEditor.startEdit(row) },
        {
          label: "Excluir",
          className: "btn danger",
          onClick: async (row) => {
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
        }
      ]
    );
  }

  // ---------- DESPESAS DIA A DIA ----------
  // Mostra, no cabeçalho da aba, o total gasto em cada fonte de pagamento
  // (Débito, VA, CAJU — dentro do filtro de mês aplicado), como pílulas
  // ordenadas do maior para o menor gasto.
  function renderDespesasPorFonte(rows) {
    const el = document.getElementById("despesas-por-fonte");
    if (!el) return;
    const porFonte = {};
    rows.forEach((r) => {
      const fonte = r.fonte || "Débito";
      porFonte[fonte] = (porFonte[fonte] || 0) + Number(r.valor || 0);
    });
    const entradas = Object.entries(porFonte).sort((a, b) => b[1] - a[1]);
    el.innerHTML = entradas.length
      ? entradas.map(([fonte, val]) => UI.fonteBadge(fonte, `${fonte}: ${UI.formatBRL(val)}`)).join("")
      : "";
  }

  function renderDespesas() {
    const all = UI.sortByDateDesc(Store.get().despesas);
    popularFiltroMes("filtro-mes-despesas", all, "data", "despesas", renderDespesas);
    popularFiltroGrupo("filtro-grupo-despesas", "despesas", renderDespesas);
    const rows = filtrarPorGrupo(filtrarPorMes(all, "data", "despesas"), "despesas");
    setTabTotal("total-despesas-tab", rows.reduce((s, r) => s + Number(r.valor || 0), 0));
    renderDespesasPorFonte(rows);
    UI.renderTable(
      document.querySelector("#table-despesas tbody"),
      rows,
      [
        { render: (r) => UI.formatDate(r.data) },
        { field: "descricao" },
        { render: (r) => `<span class="tag">${r.categoria}</span>` },
        { render: (r) => UI.fonteBadge(r.fonte) },
        { render: (r) => `<span class="value-out">${UI.formatBRL(r.valor)}</span>` }
      ],
      [
        { label: "Editar", className: "btn secondary", onClick: (row) => despesasEditor.startEdit(row) },
        {
          label: "Excluir",
          className: "btn danger",
          onClick: async (row) => {
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
        }
      ]
    );
  }

  // ---------- GASTOS FIXOS ----------
  // Mostra, no cabeçalho da aba, o total mensal por fonte de pagamento
  // (CAJU, VA, Conta corrente, Cartão de crédito) como pílulas.
  function renderFixosPorFonte(rows) {
    const el = document.getElementById("fixos-por-fonte");
    if (!el) return;
    const porFonte = {};
    rows.forEach((r) => {
      const fonte = r.fonte && r.fonte !== "—" ? r.fonte : "Conta corrente";
      porFonte[fonte] = (porFonte[fonte] || 0) + Number(r.valorMensal || 0);
    });
    const entradas = Object.entries(porFonte).sort((a, b) => b[1] - a[1]);
    el.innerHTML = entradas.length
      ? entradas.map(([fonte, val]) => UI.fonteBadge(fonte, `${fonte}: ${UI.formatBRL(val)}`)).join("")
      : "";
  }

  // Combina os gastos fixos por boleto com as assinaturas recorrentes do
  // cartão de crédito numa única lista, já que ambos são compromissos fixos.
  // O filtro de mês só se aplica às assinaturas do cartão (que têm data de
  // cadastro) — os boletos são compromissos contínuos, sem mês específico.
  function renderFixos() {
    const state = Store.get();
    const boletos = state.fixos.map((f) => ({
      ...f,
      origem: "fixos",
      valorMensal: f.valorMensal,
      formaPagamento: "Boleto",
      fonte: f.fonte || "Conta corrente",
      vencimentoLabel: `Dia ${f.diaVencimento}`
    }));
    const cartaoRecorrentesTodos = state.cartao.filter(isRecorrente).map((c) => ({
      ...c,
      origem: "cartao",
      valorMensal: c.valor,
      formaPagamento: c.cartao ? `Cartão (${c.cartao})` : "Cartão de crédito",
      fonte: "Cartão de crédito",
      vencimentoLabel: "—"
    }));

    popularFiltroMes("filtro-mes-fixos", cartaoRecorrentesTodos, "data", "fixos", renderFixos);
    popularFiltroGrupo("filtro-grupo-fixos", "fixos", renderFixos);
    const cartaoRecorrentes = filtrarPorMes(cartaoRecorrentesTodos, "data", "fixos");

    const rows = filtrarPorGrupo([...boletos, ...cartaoRecorrentes], "fixos");
    setTabTotal("total-fixos-tab", rows.reduce((s, r) => s + Number(r.valorMensal || 0), 0));
    renderFixosPorFonte(rows);

    UI.renderTable(
      document.querySelector("#table-fixos tbody"),
      rows,
      [
        { field: "descricao" },
        { render: (r) => `<span class="tag">${r.categoria}</span>` },
        { field: "formaPagamento" },
        { render: (r) => (r.fonte && r.fonte !== "—" ? UI.fonteBadge(r.fonte) : "—") },
        { render: (r) => `<span class="value-out">${UI.formatBRL(r.valorMensal)}</span>` },
        { field: "vencimentoLabel" },
        {
          render: (r) =>
            r.origem === "cartao"
              ? `<span style="font-size:12px; color:var(--text-muted);">Automático</span>`
              : `<label class="toggle-switch">
                   <input type="checkbox" class="fixo-pago-toggle" data-id="${r.id}" ${isPago(r) ? "checked" : ""} />
                   <span class="toggle-slider"></span>
                 </label>`
        }
      ],
      [
        {
          label: "Editar",
          className: "btn secondary",
          onClick: (row) => {
            if (row.origem === "cartao") {
              UI.toast('Este item vem do Cartão de crédito — edite por lá', true);
              switchView("cartao");
              return;
            }
            fixosEditor.startEdit(row);
          }
        },
        {
          label: "Excluir",
          className: "btn danger",
          onClick: async (row) => {
            const msg =
              row.origem === "cartao"
                ? "Este item vem da aba Cartão de crédito. Excluir?"
                : "Excluir este gasto fixo?";
            if (!confirm(msg)) return;
            try {
              await Store.deleteItem(row.origem, row.id);
              renderFixos();
              if (row.origem === "cartao") renderCartao();
              Dashboard.render(Store.get());
              UI.toast("Gasto fixo excluído");
            } catch (e) {
              UI.toast(e.message, true);
            }
          }
        }
      ]
    );

    // Toggle "Pago" atualiza na hora — o dashboard só soma esse gasto fixo
    // no total do mês enquanto ele estiver marcado como pago.
    document.querySelectorAll(".fixo-pago-toggle").forEach((cb) => {
      cb.addEventListener("change", async () => {
        try {
          await Store.updateItem("fixos", cb.dataset.id, { pago: cb.checked ? "true" : "false" });
          renderFixos();
          Dashboard.render(Store.get());
          UI.toast(cb.checked ? "Marcado como pago" : "Marcado como pendente");
        } catch (e) {
          UI.toast(e.message, true);
        }
      });
    });
  }

  // ---------- CARTÃO DE CRÉDITO ----------
  // Mostra, no cabeçalho da aba, quanto do total é recorrente (assinaturas
  // fixas) e quanto é variável (compras avulsas, parceladas ou não).
  function renderCartaoRecorrenteVariavel(rows) {
    const el = document.getElementById("cartao-recorrente-variavel");
    if (!el) return;
    const recorrenteTotal = rows.filter(isRecorrente).reduce((s, r) => s + Number(r.valor || 0), 0);
    const variavelTotal = rows.filter((r) => !isRecorrente(r)).reduce((s, r) => s + Number(r.valor || 0), 0);
    el.innerHTML = `
      <span class="tag" style="background:#e6f9ec; color:#1a7f3c;">Recorrente: ${UI.formatBRL(recorrenteTotal)}</span>
      <span class="tag" style="background:#e6f0fd; color:#0050b3;">Variável: ${UI.formatBRL(variavelTotal)}</span>
    `;
  }

  function renderCartao() {
    const all = UI.sortByDateDesc(Store.get().cartao);
    popularFiltroMes("filtro-mes-cartao", all, "data", "cartao", renderCartao);
    popularFiltroGrupo("filtro-grupo-cartao", "cartao", renderCartao);
    const rows = filtrarPorGrupo(filtrarPorMes(all, "data", "cartao"), "cartao");
    setTabTotal("total-cartao-tab", rows.reduce((s, r) => s + Number(r.valor || 0), 0));
    renderCartaoRecorrenteVariavel(rows);
    UI.renderTable(
      document.querySelector("#table-cartao tbody"),
      rows,
      [
        { render: (r) => UI.formatDate(r.data) },
        { field: "descricao" },
        { render: (r) => `<span class="tag">${r.categoria}</span>` },
        { field: "cartao" },
        { render: (r) => (isRecorrente(r) ? "—" : `${r.parcelaAtual || 1}/${r.parcelasTotal || 1}`) },
        { render: (r) => `<span class="value-out">${UI.formatBRL(r.valor)}</span>` },
        { render: (r) => (isRecorrente(r) ? `<span class="tag" style="background:#e6f9ec;color:#1a7f3c;">Recorrente</span>` : "") }
      ],
      [
        { label: "Editar", className: "btn secondary", onClick: (row) => cartaoEditor.startEdit(row) },
        {
          label: "Excluir",
          className: "btn danger",
          onClick: async (row) => {
            if (!confirm("Excluir este lançamento do cartão?")) return;
            try {
              await Store.deleteItem("cartao", row.id);
              renderCartao();
              renderFixos();
              Dashboard.render(Store.get());
              UI.toast("Lançamento excluído");
            } catch (e) {
              UI.toast(e.message, true);
            }
          }
        }
      ]
    );
  }

  // ---------- QUITAÇÃO DE PARCELAS ANTIGAS ----------
  function isQuitada(item) {
    return item.quitada === true || item.quitada === "true";
  }

  function renderQuitacao() {
    // Itens em aberto primeiro, os já quitados vão para o final da lista.
    const rows = Store.get().quitacao.slice().sort((a, b) => Number(isQuitada(a)) - Number(isQuitada(b)));
    const totalEmAberto = rows
      .filter((r) => !isQuitada(r))
      .reduce((s, r) => s + Number(r.valorTotal || 0), 0);
    setTabTotal("total-quitacao-tab", totalEmAberto);

    UI.renderTable(
      document.querySelector("#table-quitacao tbody"),
      rows,
      [
        { field: "cartao" },
        { field: "descricao" },
        { render: (r) => `<span class="value-out">${UI.formatBRL(r.valorTotal)}</span>` },
        { field: "qtdParcelas" },
        { render: (r) => UI.formatBRL(Number(r.valorTotal || 0) / Math.max(1, Number(r.qtdParcelas || 1))) },
        {
          render: (r) =>
            `<input type="checkbox" class="quitacao-checkbox" data-id="${r.id}" ${isQuitada(r) ? "checked" : ""} style="width:auto;" />`
        }
      ],
      [
        {
          label: "Excluir",
          className: "btn danger",
          onClick: async (row) => {
            if (!confirm("Excluir este parcelamento?")) return;
            try {
              await Store.deleteItem("quitacao", row.id);
              renderQuitacao();
              UI.toast("Parcelamento excluído");
            } catch (e) {
              UI.toast(e.message, true);
            }
          }
        }
      ]
    );

    // O checkbox "Quitada" atualiza na hora, sem precisar reabrir o formulário.
    document.querySelectorAll(".quitacao-checkbox").forEach((cb) => {
      cb.addEventListener("change", async () => {
        try {
          await Store.updateItem("quitacao", cb.dataset.id, { quitada: cb.checked ? "true" : "false" });
          renderQuitacao();
          UI.toast(cb.checked ? "Marcado como quitado" : "Marcado como em aberto");
        } catch (e) {
          UI.toast(e.message, true);
        }
      });
    });
  }

  // ---------- POUPANÇA ----------
  function totalGuardadoAtual() {
    const state = Store.get();
    const saldoInicial = Number(state.config.saldoInicial || 0);
    const depositos = state.poupanca
      .filter((p) => p.tipo === "deposito")
      .reduce((s, p) => s + Number(p.valor || 0), 0);
    const retiradas = state.poupanca
      .filter((p) => p.tipo === "retirada")
      .reduce((s, p) => s + Number(p.valor || 0), 0);
    return saldoInicial + depositos - retiradas;
  }

  function renderPoupanca() {
    const all = UI.sortByDateDesc(Store.get().poupanca);
    popularFiltroMes("filtro-mes-poupanca", all, "data", "poupanca", renderPoupanca);
    const rows = filtrarPorMes(all, "data", "poupanca");
    const depositos = rows.filter((p) => p.tipo === "deposito").reduce((s, p) => s + Number(p.valor || 0), 0);
    const retiradas = rows.filter((p) => p.tipo === "retirada").reduce((s, p) => s + Number(p.valor || 0), 0);
    // "Total guardado" continua sendo o saldo acumulado real (não filtrado por
    // mês) — o filtro aqui só afeta a lista de movimentações e os totais de
    // depósitos/retiradas exibidos.
    document.getElementById("poupanca-total").textContent = UI.formatBRL(totalGuardadoAtual());
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
      [
        {
          label: "Excluir",
          className: "btn danger",
          onClick: async (row) => {
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
        }
      ]
    );
  }

  // ---------- HELPERS ----------
  function isRecorrente(item) {
    return item.recorrente === true || item.recorrente === "true" || item.recorrente === "on";
  }

  // Um gasto fixo é considerado "pago" por padrão (registros antigos não têm
  // esse campo ainda) — só vira "pendente" quando explicitamente marcado
  // como false pelo toggle da aba Gastos Fixos.
  function isPago(item) {
    return item.pago !== false && item.pago !== "false";
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

  // Preenche o formulário com os dados de uma linha existente, para edição.
  function fillForm(form, row) {
    Array.from(form.elements).forEach((el) => {
      if (!el.name) return;
      if (el.type === "checkbox") {
        el.checked = isRecorrente(row);
        el.dispatchEvent(new Event("change"));
      } else if (row[el.name] !== undefined && row[el.name] !== null) {
        el.value = row[el.name];
      }
    });
  }

  // Cadastro simples (sem edição) — usado em Receitas e Poupança.
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

  // Cadastro + edição — usado em Despesas do dia a dia, Gastos Fixos e Cartão.
  // Retorna { startEdit(row) } para os botões "Editar" das tabelas chamarem.
  function setupEditableForm(formId, sheetKey, renderFn) {
    const form = document.getElementById(formId);
    const submitBtn = form.querySelector('button[type="submit"]');
    let editingId = null;

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn secondary";
    cancelBtn.textContent = "Cancelar edição";
    cancelBtn.style.display = "none";
    submitBtn.insertAdjacentElement("afterend", cancelBtn);

    function stopEdit() {
      editingId = null;
      form.reset();
      const recorrenteCb = form.querySelector('input[name="recorrente"]');
      if (recorrenteCb) recorrenteCb.dispatchEvent(new Event("change"));
      submitBtn.textContent = "Adicionar";
      cancelBtn.style.display = "none";
    }

    function startEdit(row) {
      editingId = row.id;
      fillForm(form, row);
      submitBtn.textContent = "Salvar edição";
      cancelBtn.style.display = "inline-block";
      form.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    cancelBtn.addEventListener("click", stopEdit);

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const data = formToObject(form);
      try {
        if (editingId) {
          await Store.updateItem(sheetKey, editingId, data);
          UI.toast("Atualizado com sucesso");
        } else {
          await Store.addItem(sheetKey, data);
          UI.toast("Adicionado com sucesso");
        }
        stopEdit();
        renderFn();
        Dashboard.render(Store.get());
      } catch (err) {
        UI.toast(err.message, true);
      }
    });

    return { startEdit };
  }

  // Quando "Recorrente" é marcado no cartão, desabilita e zera os campos de
  // parcela (assinaturas não têm número de parcelas).
  function setupCartaoRecorrenteToggle() {
    const checkbox = document.getElementById("cartao-recorrente");
    const parcelaAtualInput = document.querySelector('#form-cartao [name="parcelaAtual"]');
    const parcelasTotalInput = document.querySelector('#form-cartao [name="parcelasTotal"]');
    const wrap1 = document.getElementById("cartao-parcela-atual-wrap");
    const wrap2 = document.getElementById("cartao-parcelas-total-wrap");

    function apply() {
      const recorrente = checkbox.checked;
      [parcelaAtualInput, parcelasTotalInput].forEach((input) => {
        input.disabled = recorrente;
      });
      [wrap1, wrap2].forEach((wrap) => {
        wrap.style.opacity = recorrente ? "0.4" : "1";
      });
      if (recorrente) {
        parcelaAtualInput.value = "1";
        parcelasTotalInput.value = "1";
      }
    }

    checkbox.addEventListener("change", apply);
    apply();
  }

  // Salva o saldo inicial já guardado e a meta de investimento mensal
  // (ambos ficam gravados na aba Config da planilha/DynamoDB), controlados
  // por um painel lateral aberto através do ícone de engrenagem.
  function setupPoupancaConfig() {
    const form = document.getElementById("form-poupanca-config");
    const saldoInput = document.getElementById("config-saldo-inicial");
    const metaInput = document.getElementById("config-meta-mensal");
    const openBtn = document.getElementById("btn-open-poupanca-config");
    const closeBtn = document.getElementById("btn-close-poupanca-config");
    const overlay = document.getElementById("poupanca-config-overlay");
    const panel = document.getElementById("poupanca-config-panel");

    function preencherComConfigAtual() {
      const config = Store.get().config || {};
      if (document.activeElement !== saldoInput) {
        saldoInput.value = config.saldoInicial ?? "";
      }
      if (document.activeElement !== metaInput) {
        metaInput.value = config.metaInvestimentoMensal ?? "";
      }
    }

    function openPanel() {
      preencherComConfigAtual();
      overlay.classList.add("open");
      panel.classList.add("open");
    }

    function closePanel() {
      overlay.classList.remove("open");
      panel.classList.remove("open");
    }

    openBtn.addEventListener("click", openPanel);
    closeBtn.addEventListener("click", closePanel);
    overlay.addEventListener("click", closePanel);

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        await Store.setConfigValue("saldoInicial", saldoInput.value || "0");
        await Store.setConfigValue("metaInvestimentoMensal", metaInput.value || "0");
        renderPoupanca();
        preencherSimulacaoComPadroes();
        Dashboard.render(Store.get());
        UI.toast("Configurações salvas");
        closePanel();
      } catch (err) {
        UI.toast(err.message, true);
      }
      return false;
    });

    return { preencherComConfigAtual };
  }

  // Pré-preenche a simulação com o total guardado atual e a meta mensal
  // configurada, sem sobrescrever se o usuário já estiver mexendo nos campos.
  function preencherSimulacaoComPadroes() {
    const simInicial = document.getElementById("sim-inicial");
    const simMensal = document.getElementById("sim-mensal");
    const config = Store.get().config || {};
    if (simInicial && !simInicial.value) simInicial.value = totalGuardadoAtual().toFixed(2);
    if (simMensal && !simMensal.value && config.metaInvestimentoMensal) {
      simMensal.value = Number(config.metaInvestimentoMensal).toFixed(2);
    }
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

    setupForm("form-poupanca", "poupanca", renderPoupanca);
    setupForm("form-quitacao", "quitacao", renderQuitacao);

    receitasEditor = setupEditableForm("form-receitas", "receitas", renderReceitas);
    despesasEditor = setupEditableForm("form-despesas", "despesas", renderDespesas);
    fixosEditor = setupEditableForm("form-fixos", "fixos", renderFixos);
    cartaoEditor = setupEditableForm("form-cartao", "cartao", () => {
      renderCartao();
      renderFixos();
    });

    setupCartaoRecorrenteToggle();
    const poupancaConfig = setupPoupancaConfig();
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
    renderQuitacao();
    renderPoupanca();
    poupancaConfig.preencherComConfigAtual();
    preencherSimulacaoComPadroes();
    Dashboard.render(Store.get());
  }

  document.addEventListener("DOMContentLoaded", init);
})();
