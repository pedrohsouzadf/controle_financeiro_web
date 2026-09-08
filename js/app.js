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
  let receitasEditor, despesasEditor;

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
        { render: (r) => `<span class="value-in">${UI.formatBRL(r.valor)}</span>` },
        { render: (r) => tagsOrigemLancamento(r) }
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

  // ---------- DESPESAS ----------
  // Aba única para qualquer gasto fora do cartão de crédito. Junta as
  // despesas cadastradas aqui com três coisas que "moram" em outros lugares
  // mas também são gastos: contas fixas antigas ainda não migradas (extinta
  // aba Gastos Fixos), assinaturas recorrentes do cartão, e as parcelas de
  // parcelamentos antigos ainda em aberto (Quitação). "Fixo" e "variável"
  // não existem mais como conceitos separados — o que importa é só se o
  // gasto é "Recorrente" (continua todo mês) ou não.
  function renderDespesasMigracaoBanner(fixos) {
    const el = document.getElementById("despesas-migracao-fixos");
    if (!el) return;
    const pendentes = (fixos || []).filter((f) => String(f.ativo) !== "false");
    if (!pendentes.length) {
      el.style.display = "none";
      el.innerHTML = "";
      return;
    }
    el.style.display = "flex";
    el.style.cssText =
      "display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; background:#e6f0fd; color:#0050b3; padding:10px 14px; border-radius:10px; font-size:13px; margin-bottom:16px;";
    el.innerHTML = `
      <span>💡 Você tem ${pendentes.length} ${pendentes.length === 1 ? "conta fixa antiga" : "contas fixas antigas"} da extinta aba "Gastos Fixos". Elas já aparecem na lista abaixo, mas migre pra essa aba nova pra poder editar normalmente.</span>
      <button type="button" class="btn secondary" id="btn-migrar-fixos">Migrar gastos fixos antigos</button>
    `;
    document.getElementById("btn-migrar-fixos").addEventListener("click", migrarFixosAntigos);
  }

  async function migrarFixosAntigos() {
    const pendentes = Store.get().fixos.filter((f) => String(f.ativo) !== "false");
    if (!pendentes.length) return;
    if (!confirm(`Migrar ${pendentes.length} conta(s) fixa(s) antiga(s) pra essa aba nova? Cada uma vira uma despesa recorrente, e a versão antiga é removida.`)) return;
    try {
      for (const f of pendentes) {
        await Store.addItem("despesas", {
          data: new Date().toISOString().substring(0, 10),
          descricao: f.descricao,
          categoria: f.categoria || "Outros",
          valor: f.valorMensal,
          recorrente: "true"
        });
        await Store.deleteItem("fixos", f.id);
      }
      renderDespesas();
      Dashboard.render(Store.get());
      UI.toast("Contas fixas migradas com sucesso");
    } catch (e) {
      UI.toast(e.message, true);
    }
  }

  function renderDespesas() {
    const state = Store.get();
    const despesasTodas = UI.sortByDateDesc(state.despesas).map((d) => ({ ...d, origem: "despesas" }));
    const cartaoRecorrentesTodos = state.cartao.filter(isRecorrente).map((c) => ({ ...c, origem: "cartao", valor: c.valor }));

    // Sem data específica — compromissos contínuos que sempre aparecem,
    // independente do filtro de mês escolhido.
    const boletosLegado = state.fixos
      .filter((f) => String(f.ativo) !== "false")
      .map((f) => ({ ...f, origem: "fixos", categoria: f.categoria, valor: f.valorMensal, recorrente: "true" }));
    const quitacaoEmAberto = (state.quitacao || [])
      .filter((q) => !isQuitada(q))
      .map((q) => {
        const qtd = Math.max(1, Number(q.qtdParcelas) || 1);
        const pagas = parcelasPagasDe(q);
        return {
          ...q,
          origem: "quitacao",
          descricao: `${q.descricao} (parcela ${pagas + 1}/${qtd})`,
          categoria: "Parcelamento antigo",
          valor: Number(q.valorTotal || 0) / qtd,
          recorrente: "true"
        };
      });

    const comData = [...despesasTodas, ...cartaoRecorrentesTodos];
    popularFiltroMes("filtro-mes-despesas", comData, "data", "despesas", renderDespesas);
    popularFiltroGrupo("filtro-grupo-despesas", "despesas", renderDespesas);

    const rows = [
      ...filtrarPorGrupo(filtrarPorMes(comData, "data", "despesas"), "despesas"),
      ...filtrarPorGrupo([...boletosLegado, ...quitacaoEmAberto], "despesas")
    ];

    setTabTotal("total-despesas-tab", rows.reduce((s, r) => s + Number(r.valor || 0), 0));
    renderDespesasMigracaoBanner(state.fixos);
    renderContasFixasMes();

    UI.renderTable(
      document.querySelector("#table-despesas tbody"),
      rows,
      [
        { render: (r) => (r.data ? UI.formatDate(r.data) : "—") },
        { field: "descricao" },
        { render: (r) => `<span class="tag">${r.categoria || "Outros"}</span>` },
        { render: (r) => `<span class="value-out">${UI.formatBRL(r.valor)}</span>` },
        { render: (r) => tagsOrigemLancamento(r) }
      ],
      [
        {
          label: "Editar",
          className: "btn secondary",
          onClick: (row) => {
            if (row.origem === "cartao") {
              UI.toast("Item antigo do cartão (cadastro manual) — não dá mais pra editar, só excluir", true);
              return;
            }
            if (row.origem === "quitacao") {
              UI.toast("Este item vem da Quitação de parcelas antigas — edite por lá", true);
              switchView("cartao");
              return;
            }
            if (row.origem === "fixos") {
              UI.toast('Item antigo — clique em "Migrar gastos fixos antigos" acima pra poder editar', true);
              return;
            }
            despesasEditor.startEdit(row);
          }
        },
        {
          label: "Excluir",
          className: "btn danger",
          onClick: async (row) => {
            const msg =
              row.origem === "cartao"
                ? "Este item vem da aba Cartão de crédito. Excluir?"
                : row.origem === "quitacao"
                ? "Este parcelamento vem da Quitação de parcelas antigas. Excluir o parcelamento inteiro?"
                : "Excluir esta despesa?";
            if (!confirm(msg)) return;
            try {
              await Store.deleteItem(row.origem, row.id);
              renderDespesas();
              if (row.origem === "cartao") renderCartao();
              if (row.origem === "quitacao") renderQuitacao();
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

  // ---------- CONTAS FIXAS DESTE MÊS (checklist de pagamento) ----------
  // Puramente visual/local: guarda em localStorage quais contas recorrentes
  // já foram marcadas como pagas neste mês, pra você conferir no dia do
  // pagamento sem esquecer nenhuma. Não sincroniza com o backend nem entra
  // em nenhum cálculo do dashboard — reseta sozinho todo mês porque a chave
  // do localStorage inclui o mês atual.
  function mesAtualKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  function chaveContaPaga() {
    return `meu-financeiro-contas-pagas-${mesAtualKey()}`;
  }

  function contasPagasDoMes() {
    try {
      const raw = localStorage.getItem(chaveContaPaga());
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  function isContaPaga(chave) {
    return !!contasPagasDoMes()[chave];
  }

  function setContaPaga(chave, paga) {
    const pagas = contasPagasDoMes();
    if (paga) {
      pagas[chave] = true;
    } else {
      delete pagas[chave];
    }
    try {
      localStorage.setItem(chaveContaPaga(), JSON.stringify(pagas));
    } catch (e) {
      /* ignore */
    }
  }

  function renderContasFixasMes() {
    const el = document.getElementById("despesas-fixas-mes-lista");
    if (!el) return;
    const state = Store.get();

    const recorrentes = state.despesas.filter(isRecorrente).map((d) => ({
      chave: `despesas:${d.id}`,
      descricao: d.descricao,
      categoria: d.categoria,
      valor: d.valor
    }));
    const cartaoRecorrente = state.cartao.filter(isRecorrente).map((c) => ({
      chave: `cartao:${c.id}`,
      descricao: c.descricao,
      categoria: c.categoria,
      valor: c.valor
    }));
    const fixosLegado = state.fixos
      .filter((f) => String(f.ativo) !== "false")
      .map((f) => ({
        chave: `fixos:${f.id}`,
        descricao: f.descricao,
        categoria: f.categoria,
        valor: f.valorMensal
      }));
    const quitacaoEmAberto = (state.quitacao || [])
      .filter((q) => !isQuitada(q))
      .map((q) => {
        const qtd = Math.max(1, Number(q.qtdParcelas) || 1);
        const pagas = parcelasPagasDe(q);
        return {
          chave: `quitacao:${q.id}`,
          descricao: `${q.descricao} (parcela ${pagas + 1}/${qtd})`,
          categoria: "Parcelamento antigo",
          valor: Number(q.valorTotal || 0) / qtd
        };
      });

    const itens = [...recorrentes, ...cartaoRecorrente, ...fixosLegado, ...quitacaoEmAberto].sort((a, b) =>
      String(a.descricao).localeCompare(String(b.descricao), "pt-BR")
    );

    if (!itens.length) {
      el.innerHTML = `<p class="empty-state" style="margin:0;">Nenhuma conta recorrente cadastrada ainda.</p>`;
      return;
    }

    const pagasCount = itens.filter((i) => isContaPaga(i.chave)).length;

    const linhas = itens
      .map((item) => {
        const paga = isContaPaga(item.chave);
        return `
          <label style="display:flex; align-items:center; gap:10px; padding:8px 0; border-bottom:1px solid #eee; ${paga ? "opacity:0.55;" : ""}">
            <input type="checkbox" data-chave="${item.chave}" ${paga ? "checked" : ""} style="width:18px; height:18px; flex-shrink:0;" />
            <span style="flex:1; ${paga ? "text-decoration:line-through;" : ""}">${item.descricao} <span class="tag">${item.categoria || "Outros"}</span></span>
            <span style="${paga ? "text-decoration:line-through;" : ""}">${UI.formatBRL(item.valor)}</span>
          </label>
        `;
      })
      .join("");

    el.innerHTML = `
      <p style="font-size:13px; font-weight:600; margin:0 0 8px;">${pagasCount} de ${itens.length} pagas</p>
      ${linhas}
    `;

    el.querySelectorAll("input[type=checkbox]").forEach((cb) => {
      cb.addEventListener("change", () => {
        setContaPaga(cb.dataset.chave, cb.checked);
        renderContasFixasMes();
      });
    });
  }

  // ---------- CARTÃO DE CRÉDITO (dados do Pluggy / Open Finance) ----------
  // Só leitura: mostra o total de cada fatura trazida pela sincronização
  // com a Pluggy e as compras que a compõem. Não existe mais cadastro
  // manual aqui — um cartão sem conexão deve ser lançado na aba Despesas.
  function renderCartao() {
    const faturas = (Store.get().pluggyFaturas || [])
      .slice()
      .sort((a, b) => String(b.dueDate || "").localeCompare(String(a.dueDate || "")));

    const total = faturas.reduce((s, f) => s + Number(f.totalAmount || 0), 0);
    setTabTotal("total-cartao-tab", total);

    const vazioEl = document.getElementById("cartao-pluggy-vazio");
    const listaEl = document.getElementById("cartao-pluggy-faturas");
    if (!listaEl) return;

    if (!faturas.length) {
      if (vazioEl) vazioEl.style.display = "block";
      listaEl.innerHTML = "";
      return;
    }
    if (vazioEl) vazioEl.style.display = "none";

    listaEl.innerHTML = faturas
      .map((f) => {
        const compras = f.compras || [];
        const linhasCompras = compras.length
          ? compras
              .map(
                (c) => `
                  <tr>
                    <td>${UI.formatDate(c.data)}</td>
                    <td>${c.descricao}</td>
                    <td><span class="value-out">${UI.formatBRL(c.valor)}</span></td>
                  </tr>`
              )
              .join("")
          : `<tr><td colspan="3" class="empty-state">Nenhuma compra encontrada nessa fatura</td></tr>`;

        return `
          <div class="card" style="margin-bottom:16px;">
            <div class="section-title-row" style="margin-bottom:8px;">
              <div>
                <h3 style="margin:0;">${f.contaNome || "Cartão"}</h3>
                <p style="font-size:12px; color:var(--text-muted); margin:2px 0 0;">
                  ${f.dueDate ? `Vencimento: ${UI.formatDate(f.dueDate)}` : "Fatura em aberto"}
                  ${f.billClosingDate ? ` · Fechada em ${UI.formatDate(f.billClosingDate)}` : ""}
                </p>
              </div>
              <div class="kpi-value" style="font-size:18px;">${UI.formatBRL(f.totalAmount)}</div>
            </div>
            <table>
              <thead><tr><th>Data</th><th>Descrição</th><th>Valor</th></tr></thead>
              <tbody>${linhasCompras}</tbody>
            </table>
          </div>
        `;
      })
      .join("");
  }

  // ---------- QUITAÇÃO DE PARCELAS ANTIGAS ----------
  // Quantas parcelas já foram pagas, sempre limitado entre 0 e o total de
  // parcelas. Compatível com o campo antigo "quitada" (checkbox único): se o
  // item não tem "parcelasPagas" mas já estava marcado quitado, assume tudo pago.
  function parcelasPagasDe(item) {
    const total = Math.max(1, Number(item.qtdParcelas) || 1);
    if (item.parcelasPagas !== undefined && item.parcelasPagas !== null && item.parcelasPagas !== "") {
      return Math.min(Math.max(Number(item.parcelasPagas) || 0, 0), total);
    }
    const legadoQuitado = item.quitada === true || item.quitada === "true";
    return legadoQuitado ? total : 0;
  }

  // Só é considerado quitado quando TODAS as parcelas foram marcadas como
  // pagas — não dá pra marcar "quitado" direto, tem que ir parcela por parcela.
  function isQuitada(item) {
    const total = Math.max(1, Number(item.qtdParcelas) || 1);
    return parcelasPagasDe(item) >= total;
  }

  function renderQuitacao() {
    // Itens em aberto primeiro, os já quitados vão para o final da lista.
    const rows = Store.get().quitacao.slice().sort((a, b) => Number(isQuitada(a)) - Number(isQuitada(b)));

    const totalEmAberto = rows.reduce((s, r) => {
      const qtd = Math.max(1, Number(r.qtdParcelas) || 1);
      const pagas = parcelasPagasDe(r);
      const valorParcela = Number(r.valorTotal || 0) / qtd;
      return s + valorParcela * (qtd - pagas);
    }, 0);
    setTabTotal("total-quitacao-tab", totalEmAberto);

    UI.renderTable(
      document.querySelector("#table-quitacao tbody"),
      rows,
      [
        { field: "cartao" },
        { field: "descricao" },
        { render: (r) => `<span class="value-out">${UI.formatBRL(r.valorTotal)}</span>` },
        {
          render: (r) => {
            const qtd = Math.max(1, Number(r.qtdParcelas) || 1);
            const pagas = parcelasPagasDe(r);
            return `
              <div style="display:flex; align-items:center; gap:6px;">
                <button type="button" class="btn secondary parcela-menos" data-id="${r.id}" style="padding:2px 9px;" ${pagas <= 0 ? "disabled" : ""}>−</button>
                <span style="min-width:46px; text-align:center; font-weight:600;">${pagas}/${qtd}</span>
                <button type="button" class="btn secondary parcela-mais" data-id="${r.id}" style="padding:2px 9px;" ${pagas >= qtd ? "disabled" : ""}>+</button>
              </div>`;
          }
        },
        { render: (r) => UI.formatBRL(Number(r.valorTotal || 0) / Math.max(1, Number(r.qtdParcelas) || 1)) },
        {
          render: (r) => {
            const qtd = Math.max(1, Number(r.qtdParcelas) || 1);
            const pagas = parcelasPagasDe(r);
            const valorParcela = Number(r.valorTotal || 0) / qtd;
            return UI.formatBRL(valorParcela * (qtd - pagas));
          }
        },
        {
          render: (r) =>
            isQuitada(r)
              ? `<span class="tag" style="background:#e6f9ec; color:#1a7f3c;">Quitado</span>`
              : `<span class="tag" style="background:#fff2e0; color:#a35b00;">Em aberto</span>`
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
              renderDespesas();
              Dashboard.render(Store.get());
              UI.toast("Parcelamento excluído");
            } catch (e) {
              UI.toast(e.message, true);
            }
          }
        }
      ]
    );

    // Os botões +/- atualizam a parcela paga na hora, sem precisar de formulário.
    async function ajustarParcela(id, delta) {
      const row = Store.get().quitacao.find((q) => String(q.id) === String(id));
      if (!row) return;
      const qtd = Math.max(1, Number(row.qtdParcelas) || 1);
      const novo = Math.min(Math.max(parcelasPagasDe(row) + delta, 0), qtd);
      try {
        await Store.updateItem("quitacao", row.id, { parcelasPagas: String(novo) });
        renderQuitacao();
        // A parcela paga sai (ou entra) na lista de Despesas e nas somas
        // do dashboard, então os dois precisam ser atualizados também.
        renderDespesas();
        Dashboard.render(Store.get());
        UI.toast(novo >= qtd ? "Parcelamento quitado! 🎉" : delta > 0 ? "Parcela marcada como paga" : "Parcela desmarcada");
      } catch (e) {
        UI.toast(e.message, true);
      }
    }

    document.querySelectorAll(".parcela-mais").forEach((btn) => {
      btn.addEventListener("click", () => ajustarParcela(btn.dataset.id, 1));
    });
    document.querySelectorAll(".parcela-menos").forEach((btn) => {
      btn.addEventListener("click", () => ajustarParcela(btn.dataset.id, -1));
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

  // ---------- INVESTIMENTOS (dados do Pluggy / Open Finance) ----------
  const TIPOS_INVESTIMENTO = {
    FIXED_INCOME: "Renda Fixa",
    MUTUAL_FUND: "Fundo",
    EQUITY: "Ações/FIIs",
    ETF: "ETF",
    SECURITY: "Previdência",
    COE: "COE",
    OTHER: "Outro"
  };

  function renderInvestimentosPluggy() {
    const investimentos = (Store.get().pluggyInvestimentos || [])
      .slice()
      .sort((a, b) => Number(b.valor || 0) - Number(a.valor || 0));

    const total = investimentos.reduce((s, i) => s + Number(i.valor || 0), 0);
    const totalEl = document.getElementById("total-investimentos-pluggy");
    if (totalEl) totalEl.textContent = UI.formatBRL(total);

    const vazioEl = document.getElementById("investimentos-pluggy-vazio");
    const cardEl = document.getElementById("investimentos-pluggy-card");
    if (!cardEl) return;

    if (!investimentos.length) {
      if (vazioEl) vazioEl.style.display = "block";
      cardEl.style.display = "none";
      return;
    }
    if (vazioEl) vazioEl.style.display = "none";
    cardEl.style.display = "block";

    UI.renderTable(
      document.querySelector("#table-investimentos-pluggy tbody"),
      investimentos,
      [
        { field: "nome" },
        { render: (i) => `<span class="tag">${TIPOS_INVESTIMENTO[i.tipo] || i.tipo || "Outro"}</span>` },
        { render: (i) => `<span class="value-in">${UI.formatBRL(i.valor)}</span>` },
        {
          render: (i) =>
            i.rentabilidadeUltimos12Meses != null ? `${Number(i.rentabilidadeUltimos12Meses).toFixed(2)}%` : "—"
        },
        { render: (i) => (i.dataAtualizacao ? UI.formatDate(i.dataAtualizacao) : "—") }
      ],
      []
    );
  }

  // ---------- HELPERS ----------
  function isRecorrente(item) {
    return item.recorrente === true || item.recorrente === "true" || item.recorrente === "on";
  }

  // Badges de "Recorrente" e/ou "Importado" (veio automaticamente da
  // sincronização com a Pluggy/Open Finance) numa célula só.
  function tagsOrigemLancamento(r) {
    const tags = [];
    if (isRecorrente(r)) tags.push(`<span class="tag" style="background:#e6f9ec;color:#1a7f3c;">Recorrente</span>`);
    if (r.origemImportacao === "pluggy") {
      tags.push(`<span class="tag" style="background:#eef2ff;color:#4338ca;">🔄 Importado</span>`);
    }
    return tags.join(" ");
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

  // ---------- SINCRONIZAÇÃO COM A PLUGGY (OPEN FINANCE) ----------
  // Botão "Atualizar" da aba Despesas: pede pro backend buscar transações
  // novas do banco/cartão conectados e lançar automaticamente. A
  // sincronização diária automática já roda sozinha (Lambda agendada) —
  // esse botão é só pra quando o usuário quer forçar uma busca na hora.
  function setupSyncPluggy() {
    const btn = document.getElementById("btn-sync-pluggy");
    if (!btn) return;
    const textoOriginal = btn.textContent;
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "Sincronizando…";
      try {
        const res = await Api.syncPluggy();
        await Store.refresh();
        renderReceitas();
        renderDespesas();
        renderCartao();
        renderInvestimentosPluggy();
        Dashboard.render(Store.get());
        const msg =
          res.importadas > 0
            ? `${res.importadas} ${res.importadas === 1 ? "transação nova importada" : "transações novas importadas"}`
            : "Nada novo por enquanto — já está tudo atualizado";
        UI.toast(msg);
      } catch (e) {
        UI.toast("Erro ao sincronizar: " + e.message, true);
      } finally {
        btn.disabled = false;
        btn.textContent = textoOriginal;
      }
    });
  }

  async function init() {
    Store.loadCache();
    setupNav();
    showConfigBannerIfNeeded();

    setupForm("form-poupanca", "poupanca", renderPoupanca);
    setupForm("form-quitacao", "quitacao", () => {
      renderQuitacao();
      renderDespesas();
    });

    receitasEditor = setupEditableForm("form-receitas", "receitas", renderReceitas);
    despesasEditor = setupEditableForm("form-despesas", "despesas", renderDespesas);

    setupSyncPluggy();
    const poupancaConfig = setupPoupancaConfig();

    try {
      await Store.refresh();
    } catch (e) {
      UI.toast("Não foi possível carregar os dados: " + e.message, true);
    }

    renderReceitas();
    renderDespesas();
    renderCartao();
    renderQuitacao();
    renderPoupanca();
    renderInvestimentosPluggy();
    poupancaConfig.preencherComConfigAtual();
    Dashboard.render(Store.get());
  }

  document.addEventListener("DOMContentLoaded", init);
})();
