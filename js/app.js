// ==========================================================
// App principal — página única: Resumo, Orçamento por categoria,
// Gastos (dinheiro ou cartão), Contas fixas, Receita, Quitação de
// parcelas antigas e Poupança.
// ==========================================================

(function () {
  function showConfigBannerIfNeeded() {
    const banner = document.getElementById("config-banner");
    if (!Api.isConfigured()) banner.classList.add("show");
    else banner.classList.remove("show");
  }

  // Referências preenchidas em init() — usadas pelos botões "Editar" das tabelas.
  let receitasEditor, despesasEditor;

  function setTabTotal(elId, value) {
    const el = document.getElementById(elId);
    if (el) el.textContent = UI.formatBRL(value);
  }

  // ---------- MÊS ATUAL ----------
  function monthKey(dateStr) {
    if (!dateStr) return null;
    const s = String(dateStr).substring(0, 7); // YYYY-MM
    return /^\d{4}-\d{2}$/.test(s) ? s : null;
  }

  function currentMonthKey() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }

  function isRecorrente(item) {
    return item.recorrente === true || item.recorrente === "true" || item.recorrente === "on";
  }

  // Um lançamento recorrente conta em todo mês a partir da data em que foi
  // cadastrado (igual salário, aluguel, assinatura). Um lançamento avulso
  // conta só no mês exato da data.
  function contaNoMes(item, key) {
    const m = monthKey(item.data);
    if (!m) return false;
    return isRecorrente(item) ? m <= key : m === key;
  }

  // ---------- CÁLCULOS CENTRAIS (usados pelo Resumo e pelo Orçamento) ----------
  function receitaDoMes(state, key) {
    return state.receitas.filter((r) => contaNoMes(r, key)).reduce((s, r) => s + Number(r.valor || 0), 0);
  }

  // Tudo que é compromisso fixo do mês: despesas marcadas "Recorrente",
  // contas fixas antigas (pk FIXOS, ainda não migradas) e a parcela mensal
  // de parcelamentos antigos (Quitação) ainda em aberto.
  function gastosFixosDoMes(state, key) {
    const despesasRecorrentes = state.despesas.filter((d) => isRecorrente(d) && contaNoMes(d, key));
    const fixosLegado = state.fixos.filter((f) => String(f.ativo) !== "false");
    const quitacaoEmAberto = (state.quitacao || []).filter((q) => !isQuitada(q));

    const totalRecorrentes = despesasRecorrentes.reduce((s, d) => s + Number(d.valor || 0), 0);
    const totalFixosLegado = fixosLegado.reduce((s, f) => s + Number(f.valorMensal || 0), 0);
    const totalQuitacao = quitacaoEmAberto.reduce((s, q) => {
      const qtd = Math.max(1, Number(q.qtdParcelas) || 1);
      return s + Number(q.valorTotal || 0) / qtd;
    }, 0);

    return {
      total: totalRecorrentes + totalFixosLegado + totalQuitacao,
      despesasRecorrentes,
      fixosLegado,
      quitacaoEmAberto
    };
  }

  // Despesas avulsas (não recorrentes) do mês atual — são o que conta contra
  // o orçamento por categoria. As recorrentes já foram contabilizadas como
  // Gasto Fixo acima, então não entram de novo aqui (evita contar 2x).
  function despesasVariaveisDoMes(state, key) {
    return state.despesas.filter((d) => !isRecorrente(d) && monthKey(d.data) === key);
  }

  function gastoPorCategoria(despesas) {
    const totais = {};
    despesas.forEach((d) => {
      const cat = d.categoria || "Outros";
      totais[cat] = (totais[cat] || 0) + Number(d.valor || 0);
    });
    return totais;
  }

  function isCartao(d) {
    return d.formaPagamento === "cartao";
  }

  // ---------- RESUMO DO MÊS ----------
  function renderResumo() {
    const state = Store.get();
    const key = currentMonthKey();
    const receita = receitaDoMes(state, key);
    const fixos = gastosFixosDoMes(state, key).total;
    const orcamento = Orcamento.calcular(receita, fixos);
    const livre = receita - fixos - orcamento.poupancaSugerida;

    setTabTotal("resumo-receita", receita);
    setTabTotal("resumo-fixos", fixos);
    setTabTotal("resumo-poupanca-sugerida", orcamento.poupancaSugerida);
    const livreEl = document.getElementById("resumo-livre");
    if (livreEl) {
      livreEl.textContent = UI.formatBRL(livre);
      livreEl.className = "kpi-value " + (livre >= 0 ? "positive" : "negative");
    }

    const metaTexto = document.getElementById("poupanca-meta-sugerida-texto");
    if (metaTexto) metaTexto.textContent = UI.formatBRL(orcamento.poupancaSugerida);

    return { state, key, receita, fixos, orcamento };
  }

  // ---------- ORÇAMENTO POR CATEGORIA ----------
  function renderOrcamento() {
    const state = Store.get();
    const key = currentMonthKey();
    const receita = receitaDoMes(state, key);
    const fixos = gastosFixosDoMes(state, key).total;
    const orcamento = Orcamento.calcular(receita, fixos);
    const gastoPorCat = gastoPorCategoria(despesasVariaveisDoMes(state, key));

    const tbody = document.querySelector("#table-orcamento tbody");
    if (!tbody) return;

    if (receita <= 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Cadastre uma receita pra ver quanto você pode gastar em cada categoria.</td></tr>`;
      return;
    }

    tbody.innerHTML = Orcamento.ORDEM_CATEGORIAS.map((cat) => {
      const sugerido = orcamento.porCategoria[cat] || 0;
      const gasto = gastoPorCat[cat] || 0;
      const restante = sugerido - gasto;
      const pct = sugerido > 0 ? Math.min(100, (gasto / sugerido) * 100) : gasto > 0 ? 100 : 0;
      const estourou = sugerido > 0 && gasto > sugerido;
      const classeBarra = estourou ? "over" : pct >= 80 ? "warn" : "";
      return `
        <tr>
          <td>${cat}</td>
          <td>${UI.formatBRL(sugerido)}</td>
          <td>${UI.formatBRL(gasto)}</td>
          <td class="${restante < 0 ? "value-out" : ""}">${UI.formatBRL(restante)}</td>
          <td>
            <div class="progress-bar"><div class="progress-bar-fill ${classeBarra}" style="width:${pct}%;"></div></div>
          </td>
        </tr>`;
    }).join("");
  }

  // ---------- RECEITA ----------
  function renderReceitas() {
    const rows = UI.sortByDateDesc(Store.get().receitas);
    setTabTotal("total-receitas-tab", rows.reduce((s, r) => s + Number(r.valor || 0), 0));
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
      [
        { label: "Editar", className: "btn secondary", onClick: (row) => receitasEditor.startEdit(row) },
        {
          label: "Excluir",
          className: "btn danger",
          onClick: async (row) => {
            if (!confirm("Excluir esta receita?")) return;
            try {
              await Store.deleteItem("receitas", row.id);
              renderTudo();
              UI.toast("Receita excluída");
            } catch (e) {
              UI.toast(e.message, true);
            }
          }
        }
      ]
    );
  }

  // ---------- GASTOS (dinheiro ou cartão, dia a dia) ----------
  function renderDespesas() {
    const state = Store.get();
    const key = currentMonthKey();
    const rows = UI.sortByDateDesc(state.despesas.filter((d) => contaNoMes(d, key)));

    const totalMes = rows.reduce((s, d) => s + Number(d.valor || 0), 0);
    const totalCartao = rows.filter(isCartao).reduce((s, d) => s + Number(d.valor || 0), 0);
    setTabTotal("total-despesas-tab", totalMes);
    setTabTotal("total-cartao-mes", totalCartao);

    UI.renderTable(
      document.querySelector("#table-despesas tbody"),
      rows,
      [
        { render: (r) => UI.formatDate(r.data) },
        { field: "descricao" },
        { render: (r) => `<span class="tag">${r.categoria || "Outros"}</span>` },
        {
          render: (r) =>
            isCartao(r)
              ? `<span class="tag" style="background:#fff2e0;color:#a35b00;">💳 Cartão</span>`
              : `<span class="tag" style="background:#e6f0fd;color:#0050b3;">💵 Outro</span>`
        },
        {
          render: (r) => {
            const valor = `<span class="value-out">${UI.formatBRL(r.valor)}</span>`;
            return isRecorrente(r) ? `${valor} <span class="tag" style="background:#e6f9ec;color:#1a7f3c;">Recorrente</span>` : valor;
          }
        }
      ],
      [
        { label: "Editar", className: "btn secondary", onClick: (row) => despesasEditor.startEdit(row) },
        {
          label: "Excluir",
          className: "btn danger",
          onClick: async (row) => {
            if (!confirm("Excluir este gasto?")) return;
            try {
              await Store.deleteItem("despesas", row.id);
              renderTudo();
              UI.toast("Gasto excluído");
            } catch (e) {
              UI.toast(e.message, true);
            }
          }
        }
      ]
    );
  }

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
      <span>💡 Você tem ${pendentes.length} ${pendentes.length === 1 ? "conta fixa antiga" : "contas fixas antigas"} de uma versão anterior do app. Elas já contam no total de Gastos Fixos, mas migre pra "Gastos do mês" (marcando "Recorrente") pra poder editar normalmente.</span>
      <button type="button" class="btn secondary" id="btn-migrar-fixos">Migrar gastos fixos antigos</button>
    `;
    document.getElementById("btn-migrar-fixos").addEventListener("click", migrarFixosAntigos);
  }

  async function migrarFixosAntigos() {
    const pendentes = Store.get().fixos.filter((f) => String(f.ativo) !== "false");
    if (!pendentes.length) return;
    if (!confirm(`Migrar ${pendentes.length} conta(s) fixa(s) antiga(s) pra "Gastos do mês"? Cada uma vira um gasto recorrente, e a versão antiga é removida.`)) return;
    try {
      for (const f of pendentes) {
        await Store.addItem("despesas", {
          data: new Date().toISOString().substring(0, 10),
          descricao: f.descricao,
          categoria: f.categoria || "Outros",
          valor: f.valorMensal,
          formaPagamento: "dinheiro",
          recorrente: "true"
        });
        await Store.deleteItem("fixos", f.id);
      }
      renderTudo();
      UI.toast("Contas fixas migradas com sucesso");
    } catch (e) {
      UI.toast(e.message, true);
    }
  }

  // ---------- CONTAS FIXAS DESTE MÊS (checklist de pagamento) ----------
  // Puramente visual/local: guarda em localStorage quais contas recorrentes
  // já foram marcadas como pagas neste mês. Não sincroniza com o backend
  // nem entra em nenhum cálculo — reseta sozinho todo mês porque a chave do
  // localStorage inclui o mês atual.
  function mesAtualKey() {
    return currentMonthKey();
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
    const key = currentMonthKey();
    const { despesasRecorrentes, fixosLegado, quitacaoEmAberto } = gastosFixosDoMes(state, key);

    const itens = [
      ...despesasRecorrentes.map((d) => ({ chave: `despesas:${d.id}`, descricao: d.descricao, categoria: d.categoria, valor: d.valor })),
      ...fixosLegado.map((f) => ({ chave: `fixos:${f.id}`, descricao: f.descricao, categoria: f.categoria, valor: f.valorMensal })),
      ...quitacaoEmAberto.map((q) => {
        const qtd = Math.max(1, Number(q.qtdParcelas) || 1);
        const pagas = parcelasPagasDe(q);
        return {
          chave: `quitacao:${q.id}`,
          descricao: `${q.descricao} (parcela ${pagas + 1}/${qtd})`,
          categoria: "Parcelamento antigo",
          valor: Number(q.valorTotal || 0) / qtd
        };
      })
    ].sort((a, b) => String(a.descricao).localeCompare(String(b.descricao), "pt-BR"));

    if (!itens.length) {
      el.innerHTML = `<p class="empty-state" style="margin:0;">Nenhuma conta fixa cadastrada ainda. Marque "Recorrente" ao lançar um gasto pra ela aparecer aqui todo mês.</p>`;
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
              renderTudo();
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
        renderTudo();
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
    const depositos = state.poupanca.filter((p) => p.tipo === "deposito").reduce((s, p) => s + Number(p.valor || 0), 0);
    const retiradas = state.poupanca.filter((p) => p.tipo === "retirada").reduce((s, p) => s + Number(p.valor || 0), 0);
    return saldoInicial + depositos - retiradas;
  }

  function renderPoupanca() {
    const rows = UI.sortByDateDesc(Store.get().poupanca);
    const depositos = rows.filter((p) => p.tipo === "deposito").reduce((s, p) => s + Number(p.valor || 0), 0);
    const retiradas = rows.filter((p) => p.tipo === "retirada").reduce((s, p) => s + Number(p.valor || 0), 0);
    document.getElementById("poupanca-total").textContent = UI.formatBRL(totalGuardadoAtual());
    document.getElementById("poupanca-depositos").textContent = UI.formatBRL(depositos);
    document.getElementById("poupanca-retiradas").textContent = UI.formatBRL(retiradas);

    UI.renderTable(
      document.querySelector("#table-poupanca tbody"),
      rows,
      [
        { render: (r) => UI.formatDate(r.data) },
        { render: (r) => (r.tipo === "deposito" ? "Depósito" : "Retirada") },
        { render: (r) => `<span class="${r.tipo === "deposito" ? "value-in" : "value-out"}">${UI.formatBRL(r.valor)}</span>` },
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
              renderTudo();
              UI.toast("Movimentação excluída");
            } catch (e) {
              UI.toast(e.message, true);
            }
          }
        }
      ]
    );
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

  // Cadastro simples (sem edição) — usado em Receitas, Poupança e Quitação.
  function setupForm(formId, sheetKey, onSuccess) {
    const form = document.getElementById(formId);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const data = formToObject(form);
      try {
        await Store.addItem(sheetKey, data);
        form.reset();
        onSuccess();
        UI.toast("Adicionado com sucesso");
      } catch (err) {
        UI.toast(err.message, true);
      }
    });
  }

  // Cadastro + edição — usado em Receitas e Gastos.
  // Retorna { startEdit(row) } para os botões "Editar" das tabelas chamarem.
  function setupEditableForm(formId, sheetKey, onSuccess) {
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
        onSuccess();
      } catch (err) {
        UI.toast(err.message, true);
      }
    });

    return { startEdit };
  }

  // Salva o saldo inicial já guardado (fica gravado na aba Config do
  // DynamoDB), controlado por um painel lateral aberto pelo ícone de engrenagem.
  function setupPoupancaConfig() {
    const form = document.getElementById("form-poupanca-config");
    const saldoInput = document.getElementById("config-saldo-inicial");
    const openBtn = document.getElementById("btn-open-poupanca-config");
    const closeBtn = document.getElementById("btn-close-poupanca-config");
    const overlay = document.getElementById("poupanca-config-overlay");
    const panel = document.getElementById("poupanca-config-panel");

    function preencherComConfigAtual() {
      const config = Store.get().config || {};
      if (document.activeElement !== saldoInput) {
        saldoInput.value = config.saldoInicial ?? "";
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
        renderTudo();
        UI.toast("Configurações salvas");
        closePanel();
      } catch (err) {
        UI.toast(err.message, true);
      }
      return false;
    });

    return { preencherComConfigAtual };
  }

  // ---------- RENDER GERAL ----------
  // Como agora é tudo uma página só e as contas são baratas, simplesmente
  // re-renderiza tudo a cada mudança — evita ter que lembrar manualmente
  // quais seções dependem de qual dado.
  function renderTudo() {
    const state = Store.get();
    renderResumo();
    renderOrcamento();
    renderReceitas();
    renderDespesas();
    renderDespesasMigracaoBanner(state.fixos);
    renderContasFixasMes();
    renderQuitacao();
    renderPoupanca();
  }

  async function init() {
    Store.loadCache();
    showConfigBannerIfNeeded();

    setupForm("form-poupanca", "poupanca", renderTudo);
    setupForm("form-quitacao", "quitacao", renderTudo);

    receitasEditor = setupEditableForm("form-receitas", "receitas", renderTudo);
    despesasEditor = setupEditableForm("form-despesas", "despesas", renderTudo);

    const poupancaConfig = setupPoupancaConfig();

    try {
      await Store.refresh();
    } catch (e) {
      UI.toast("Não foi possível carregar os dados: " + e.message, true);
    }

    renderTudo();
    poupancaConfig.preencherComConfigAtual();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
