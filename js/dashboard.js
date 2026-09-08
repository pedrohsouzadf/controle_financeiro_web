// ==========================================================
// Dashboard: KPIs, gráficos e insights
// ==========================================================

const Dashboard = (() => {
  let chartCategorias = null;
  let chartEvolucao = null;
  let chartSimulacao = null;

  // Mês selecionado no filtro do dashboard ("YYYY-MM"). Null = mês atual.
  let mesSelecionado = null;
  const NOMES_MES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

  // Modo do dashboard: "mensal" trava tudo no mês atual e esconde o filtro
  // (visão rápida de "como estou indo esse mês"); "geral" mostra o filtro
  // de mês e deixa escolher qualquer período pra olhar pra trás. Começa em
  // "mensal" — é a checagem mais comum ao abrir o app.
  let modoDashboard = "mensal";

  function monthKey(dateStr) {
    if (!dateStr) return null;
    const s = String(dateStr).substring(0, 7); // YYYY-MM
    return /^\d{4}-\d{2}$/.test(s) ? s : null;
  }

  function currentMonthKey() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }

  // Mês efetivamente usado pelos cálculos do dashboard: na "visão mensal"
  // é sempre o mês atual; na "visão geral" é o escolhido no filtro (ou o
  // mês atual se nada foi selecionado ainda).
  function mesAtivo() {
    if (modoDashboard === "mensal") return currentMonthKey();
    return mesSelecionado || currentMonthKey();
  }

  // Alterna entre "Visão geral" (com filtro de mês) e "Visão mensal" (travada
  // no mês atual, sem filtro). Puramente de navegação — não muda nenhum
  // cálculo, só qual mês entra em mesAtivo().
  function renderModoToggle() {
    const btnGeral = document.getElementById("btn-dashboard-geral");
    const btnMensal = document.getElementById("btn-dashboard-mensal");
    const filtro = document.getElementById("filtro-mes-dashboard");
    if (!btnGeral || !btnMensal) return;

    btnGeral.classList.toggle("active", modoDashboard === "geral");
    btnMensal.classList.toggle("active", modoDashboard === "mensal");
    if (filtro) filtro.style.display = modoDashboard === "geral" ? "" : "none";

    btnGeral.onclick = () => {
      modoDashboard = "geral";
      render(Store.get());
    };
    btnMensal.onclick = () => {
      modoDashboard = "mensal";
      mesSelecionado = currentMonthKey();
      render(Store.get());
    };
  }

  function formatarMesLabel(mesKey) {
    const [y, m] = mesKey.split("-");
    return `${NOMES_MES[Number(m) - 1]}/${y}`;
  }

  // Junta os meses que aparecem em receitas/despesas/cartão/poupança, mais o
  // mês atual (garantido sempre presente, mesmo sem nenhum lançamento ainda).
  function mesesDisponiveis(state) {
    const meses = new Set([currentMonthKey()]);
    const addFrom = (arr, field) => {
      (arr || []).forEach((r) => {
        const v = r[field];
        if (v && /^\d{4}-\d{2}/.test(String(v))) meses.add(String(v).substring(0, 7));
      });
    };
    addFrom(state.receitas, "data");
    addFrom(state.despesas, "data");
    addFrom(state.cartao, "data");
    addFrom(state.poupanca, "data");
    return [...meses].sort().reverse();
  }

  // Popula o <select> de mês do dashboard, preservando a seleção atual, e
  // re-renderiza tudo quando o usuário troca de mês.
  function popularFiltroMesDashboard(state) {
    const select = document.getElementById("filtro-mes-dashboard");
    if (!select) return;
    // Na "visão mensal" o filtro fica escondido (controlado por
    // renderModoToggle) e o mês é sempre o atual — não precisa popular nada.
    if (modoDashboard === "mensal") return;
    const meses = mesesDisponiveis(state);
    const atual = mesSelecionado || currentMonthKey();
    const valorSelecionado = meses.includes(atual) ? atual : currentMonthKey();
    select.innerHTML = meses.map((m) => `<option value="${m}">${formatarMesLabel(m)}</option>`).join("");
    select.value = valorSelecionado;
    mesSelecionado = valorSelecionado;
    select.onchange = () => {
      mesSelecionado = select.value;
      render(state);
    };
  }

  function isRecorrente(r) {
    return r.recorrente === true || r.recorrente === "true" || r.recorrente === "on";
  }

  // Itens do cartão marcados como recorrentes (academia, streaming, seguro...)
  // contam em todo mês a partir da data de cadastro, igual às receitas fixas.
  // Itens não recorrentes contam só no mês exato da data informada.
  function cartaoDoMes(state, key) {
    return state.cartao.filter((c) => {
      const cMonth = monthKey(c.data);
      if (!cMonth) return false;
      return isRecorrente(c) ? cMonth <= key : cMonth === key;
    });
  }

  function allDespesasDoMes(state, key) {
    const diaADia = state.despesas.filter((d) => monthKey(d.data) === key);
    const cartao = cartaoDoMes(state, key);
    const fixos = state.fixos.filter((f) => String(f.ativo) !== "false");
    return { diaADia, cartao, fixos };
  }

  function totalFixosMensal(state) {
    return state.fixos
      .filter((f) => String(f.ativo) !== "false")
      .reduce((sum, f) => sum + (Number(f.valorMensal) || 0), 0);
  }

  // Quantas parcelas de um parcelamento antigo (Quitação) já foram pagas.
  // Compatível com o campo antigo "quitada" (checkbox único).
  function parcelasPagasDeQuitacao(item) {
    const total = Math.max(1, Number(item.qtdParcelas) || 1);
    if (item.parcelasPagas !== undefined && item.parcelasPagas !== null && item.parcelasPagas !== "") {
      return Math.min(Math.max(Number(item.parcelasPagas) || 0, 0), total);
    }
    const legadoQuitado = item.quitada === true || item.quitada === "true";
    return legadoQuitado ? total : 0;
  }

  function isQuitacaoQuitada(item) {
    const total = Math.max(1, Number(item.qtdParcelas) || 1);
    return parcelasPagasDeQuitacao(item) >= total;
  }

  // Soma o valor da parcela de cada parcelamento antigo ainda em aberto.
  // Enquanto não estiver 100% quitado, essa parcela é um compromisso mensal
  // real (dinheiro sai da conta todo mês) — por isso conta como gasto fixo,
  // igual a um boleto ou uma assinatura recorrente do cartão.
  function quitacaoMensal(state) {
    return (state.quitacao || [])
      .filter((q) => !isQuitacaoQuitada(q))
      .reduce((s, q) => s + Number(q.valorTotal || 0) / Math.max(1, Number(q.qtdParcelas) || 1), 0);
  }

  // Receitas recorrentes contam em todo mês a partir da data de cadastro.
  // Receitas não recorrentes contam só no mês exato da data informada.
  function receitasDoMes(state, key) {
    return state.receitas
      .filter((r) => {
        const rMonth = monthKey(r.data);
        if (!rMonth) return false;
        return isRecorrente(r) ? rMonth <= key : rMonth === key;
      })
      .reduce((s, r) => s + (Number(r.valor) || 0), 0);
  }

  // Agrupa as receitas do mês pela descrição, pra mostrar "de onde vem cada
  // uma" (salário de cada um, freelance, etc.) no card "Total receitas".
  function receitasPorDescricao(state, key) {
    const totais = {};
    state.receitas
      .filter((r) => {
        const rMonth = monthKey(r.data);
        if (!rMonth) return false;
        return isRecorrente(r) ? rMonth <= key : rMonth === key;
      })
      .forEach((r) => {
        const nome = (r.descricao || "Outros").trim() || "Outros";
        totais[nome] = (totais[nome] || 0) + Number(r.valor || 0);
      });
    return Object.entries(totais).sort((a, b) => b[1] - a[1]);
  }

  function renderKpis(state) {
    const key = mesAtivo();

    const receitasMes = receitasDoMes(state, key);
    const receitasDetalhe = receitasPorDescricao(state, key);

    const { diaADia, cartao } = allDespesasDoMes(state, key);
    const despesasDiaMes = diaADia.reduce((s, d) => s + (Number(d.valor) || 0), 0);
    const cartaoMes = cartao.reduce((s, d) => s + (Number(d.valor) || 0), 0);
    const cartaoRecorrenteMes = cartao.filter(isRecorrente).reduce((s, d) => s + (Number(d.valor) || 0), 0);
    const fixosMes = totalFixosMensal(state);
    // Parcelas de parcelamentos antigos (Quitação) ainda em aberto — contam
    // como gasto do mês, igual a qualquer outra despesa recorrente.
    const quitacaoMes = quitacaoMensal(state);

    const gastosMes = despesasDiaMes + cartaoMes + fixosMes + quitacaoMes;
    const saldo = receitasMes - gastosMes;

    const saldoInicial = Number(state.config.saldoInicial || 0);
    const totalGuardado =
      saldoInicial +
      state.poupanca.reduce((s, p) => {
        const v = Number(p.valor) || 0;
        return p.tipo === "retirada" ? s - v : s + v;
      }, 0);

    const metaInvestimentoMensal = Number(state.config.metaInvestimentoMensal || 0);

    const cardSimples = (label, value, cls) => `
      <div class="card">
        <div class="kpi-label" style="text-transform:uppercase;">${label}</div>
        <div class="kpi-value ${cls}">${UI.formatBRL(value)}</div>
      </div>`;

    const cardComDetalhe = (label, value, cls, linhas) => `
      <div class="card">
        <div class="kpi-label" style="text-transform:uppercase;">${label}</div>
        <div class="kpi-value ${cls}">${UI.formatBRL(value)}</div>
        ${linhas}
      </div>`;

    const linhaDetalhe = (texto) => `<div style="margin-top:6px; font-size:13px; color:var(--text-muted);">${texto}</div>`;
    const semDados = (texto) => linhaDetalhe(texto);

    const cardTotalReceitas = cardComDetalhe(
      "Total receitas",
      receitasMes,
      "positive",
      receitasDetalhe.length
        ? receitasDetalhe.map(([nome, val]) => linhaDetalhe(`${nome}: ${UI.formatBRL(val)}`)).join("")
        : semDados("Nenhuma receita neste mês.")
    );

    const el = document.getElementById("dashboard-kpis");
    el.innerHTML = `
      <div class="grid cols-3">
        ${cardTotalReceitas}
        ${cardSimples("Gastos do mês", gastosMes, "negative")}
        ${cardSimples("Saldo do mês", saldo, saldo >= 0 ? "positive" : "negative")}
      </div>
    `;

    return {
      receitasMes,
      gastosMes,
      saldo,
      totalGuardado,
      metaInvestimentoMensal,
      despesasDiaMes,
      cartaoMes,
      cartaoRecorrenteMes,
      fixosMes,
      quitacaoMes
    };
  }

  function renderChartCategorias(state) {
    const key = mesAtivo();
    const { diaADia, cartao, fixos } = allDespesasDoMes(state, key);

    const porCategoria = {};
    diaADia.forEach((d) => {
      porCategoria[d.categoria] = (porCategoria[d.categoria] || 0) + Number(d.valor || 0);
    });
    cartao.forEach((d) => {
      porCategoria[d.categoria] = (porCategoria[d.categoria] || 0) + Number(d.valor || 0);
    });
    fixos.forEach((f) => {
      porCategoria[f.categoria] = (porCategoria[f.categoria] || 0) + Number(f.valorMensal || 0);
    });

    const labels = Object.keys(porCategoria);
    const values = Object.values(porCategoria);
    const colors = ["#0071e3", "#34c759", "#ff9500", "#ff3b30", "#af52de", "#5ac8fa", "#ffcc00", "#8e8e93"];

    const ctx = document.getElementById("chart-categorias");
    if (chartCategorias) chartCategorias.destroy();

    if (!labels.length) {
      ctx.getContext("2d").clearRect(0, 0, ctx.width, ctx.height);
      return;
    }

    chartCategorias = new Chart(ctx, {
      type: "doughnut",
      data: {
        labels,
        datasets: [{ data: values, backgroundColor: colors }]
      },
      options: {
        maintainAspectRatio: false,
        plugins: { legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 11 } } } }
      }
    });
  }

  // Mês mais antigo com algum lançamento real (receita, despesa, cartão ou
  // poupança) — usado pra não desenhar barras de despesa em meses anteriores
  // ao começo do uso do sistema (gastos fixos/parcelas antigas não têm data
  // de cadastro, então sem esse corte eles apareceriam "fantasma" em todo
  // mês do gráfico, mesmo sem nenhum dado real registrado ali).
  function primeiroMesComDados(state) {
    const meses = new Set();
    const addFrom = (arr, field) => {
      (arr || []).forEach((r) => {
        const v = r[field];
        if (v && /^\d{4}-\d{2}/.test(String(v))) meses.add(String(v).substring(0, 7));
      });
    };
    addFrom(state.receitas, "data");
    addFrom(state.despesas, "data");
    addFrom(state.cartao, "data");
    addFrom(state.poupanca, "data");
    if (!meses.size) return currentMonthKey();
    return [...meses].sort()[0];
  }

  function renderChartEvolucao(state) {
    const primeiroMes = primeiroMesComDados(state);
    const months = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (key >= primeiroMes) months.push(key);
    }

    const receitasSerie = months.map((m) => receitasDoMes(state, m));
    const despesasSerie = months.map((m) => {
      const diaADia = state.despesas
        .filter((d) => monthKey(d.data) === m)
        .reduce((s, d) => s + Number(d.valor || 0), 0);
      const cartao = cartaoDoMes(state, m).reduce((s, d) => s + Number(d.valor || 0), 0);
      return diaADia + cartao + totalFixosMensal(state) + quitacaoMensal(state);
    });

    const ctx = document.getElementById("chart-evolucao");
    if (chartEvolucao) chartEvolucao.destroy();
    chartEvolucao = new Chart(ctx, {
      type: "bar",
      data: {
        labels: months.map((m) => {
          const [y, mo] = m.split("-");
          return `${mo}/${y.slice(2)}`;
        }),
        datasets: [
          { label: "Receitas", data: receitasSerie, backgroundColor: "#34c759" },
          { label: "Despesas", data: despesasSerie, backgroundColor: "#ff3b30" }
        ]
      },
      options: {
        maintainAspectRatio: false,
        plugins: { legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 11 } } } },
        scales: { y: { beginAtZero: true } }
      }
    });
  }

  function renderInsights(state, kpis) {
    const insights = [];

    if (kpis.metaInvestimentoMensal > 0) {
      const folga = kpis.saldo - kpis.metaInvestimentoMensal;
      if (folga >= 0) {
        insights.push(
          `🎯 Sua meta de investir ${UI.formatBRL(kpis.metaInvestimentoMensal)}/mês cabe no seu saldo do mês — depois de investir, ainda sobram ${UI.formatBRL(folga)}.`
        );
      } else {
        insights.push(
          `⚠️ Sua meta de investir ${UI.formatBRL(kpis.metaInvestimentoMensal)}/mês está ${UI.formatBRL(Math.abs(folga))} acima do seu saldo deste mês. Vale revisar gastos ou ajustar a meta.`
        );
      }
    }

    if (kpis.saldo < 0) {
      insights.push(`⚠️ Seu saldo do mês está negativo em ${UI.formatBRL(Math.abs(kpis.saldo))}.`);
    } else if (kpis.receitasMes > 0) {
      const pct = ((kpis.saldo / kpis.receitasMes) * 100).toFixed(0);
      insights.push(`✅ Você está guardando ${pct}% da sua renda este mês (${UI.formatBRL(kpis.saldo)}).`);
    }

    if (kpis.cartaoMes > 0 && kpis.receitasMes > 0) {
      const pctCartao = ((kpis.cartaoMes / kpis.receitasMes) * 100).toFixed(0);
      if (pctCartao > 30) {
        insights.push(`💳 O cartão de crédito já consome ${pctCartao}% da sua renda do mês. Vale ficar de olho.`);
      }
    }

    // categoria com maior gasto
    const key = mesAtivo();
    const { diaADia, cartao, fixos } = allDespesasDoMes(state, key);
    const porCategoria = {};
    [...diaADia, ...cartao].forEach((d) => {
      porCategoria[d.categoria] = (porCategoria[d.categoria] || 0) + Number(d.valor || 0);
    });
    fixos.forEach((f) => {
      porCategoria[f.categoria] = (porCategoria[f.categoria] || 0) + Number(f.valorMensal || 0);
    });
    const top = Object.entries(porCategoria).sort((a, b) => b[1] - a[1])[0];
    if (top) {
      insights.push(`🏆 Sua maior categoria de gasto este mês é "${top[0]}", com ${UI.formatBRL(top[1])}.`);
    }

    if (kpis.totalGuardado > 0) {
      insights.push(`🏦 Você já tem ${UI.formatBRL(kpis.totalGuardado)} guardados. Continue assim!`);
    }

    if (!insights.length) {
      insights.push("Adicione receitas e despesas para começar a ver insights por aqui.");
    }

    const el = document.getElementById("insights-list");
    el.innerHTML = insights.map((i) => `<p style="margin:8px 0; font-size:14px;">${i}</p>`).join("");
  }

  function render(state) {
    renderModoToggle();
    popularFiltroMesDashboard(state);
    const kpis = renderKpis(state);
    renderChartCategorias(state);
    renderChartEvolucao(state);
    renderInsights(state, kpis);
  }

  function simular({ inicial, mensal, taxaMensalPct, meses }) {
    const taxa = taxaMensalPct / 100;
    let saldo = inicial;
    const serie = [saldo];
    for (let m = 1; m <= meses; m++) {
      saldo = saldo * (1 + taxa) + mensal;
      serie.push(saldo);
    }
    const totalAportado = inicial + mensal * meses;
    const totalJuros = saldo - totalAportado;
    return { saldoFinal: saldo, totalAportado, totalJuros, serie };
  }

  function renderChartSimulacao(serie) {
    const ctx = document.getElementById("chart-simulacao");
    if (chartSimulacao) chartSimulacao.destroy();
    chartSimulacao = new Chart(ctx, {
      type: "line",
      data: {
        labels: serie.map((_, i) => `Mês ${i}`),
        datasets: [
          {
            label: "Valor acumulado",
            data: serie,
            borderColor: "#0071e3",
            backgroundColor: "rgba(0,113,227,0.1)",
            fill: true,
            tension: 0.3
          }
        ]
      },
      options: {
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true } }
      }
    });
  }

  return { render, simular, renderChartSimulacao };
})();
