// ==========================================================
// Dashboard: KPIs, gráficos e insights
// ==========================================================

const Dashboard = (() => {
  let chartCategorias = null;
  let chartEvolucao = null;
  let chartSimulacao = null;

  function monthKey(dateStr) {
    if (!dateStr) return null;
    const s = String(dateStr).substring(0, 7); // YYYY-MM
    return /^\d{4}-\d{2}$/.test(s) ? s : null;
  }

  function currentMonthKey() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }

  function allDespesasDoMes(state, key) {
    const diaADia = state.despesas.filter((d) => monthKey(d.data) === key);
    const cartao = state.cartao.filter((d) => monthKey(d.data) === key);
    const fixos = state.fixos.filter((f) => String(f.ativo) !== "false");
    return { diaADia, cartao, fixos };
  }

  function totalFixosMensal(state) {
    return state.fixos
      .filter((f) => String(f.ativo) !== "false")
      .reduce((sum, f) => sum + (Number(f.valorMensal) || 0), 0);
  }

  function renderKpis(state) {
    const key = currentMonthKey();
    const receitasMes = state.receitas
      .filter((r) => monthKey(r.data) === key)
      .reduce((s, r) => s + (Number(r.valor) || 0), 0);

    const { diaADia, cartao } = allDespesasDoMes(state, key);
    const despesasDiaMes = diaADia.reduce((s, d) => s + (Number(d.valor) || 0), 0);
    const cartaoMes = cartao.reduce((s, d) => s + (Number(d.valor) || 0), 0);
    const fixosMes = totalFixosMensal(state);
    const totalDespesas = despesasDiaMes + cartaoMes + fixosMes;
    const saldo = receitasMes - totalDespesas;

    const totalGuardado = state.poupanca.reduce((s, p) => {
      const v = Number(p.valor) || 0;
      return p.tipo === "retirada" ? s - v : s + v;
    }, 0);

    const kpis = [
      { label: "Receitas do mês", value: receitasMes, cls: "positive" },
      { label: "Despesas do mês", value: totalDespesas, cls: "negative" },
      { label: "Saldo do mês", value: saldo, cls: saldo >= 0 ? "positive" : "negative" },
      { label: "Total guardado", value: totalGuardado, cls: "" }
    ];

    const el = document.getElementById("dashboard-kpis");
    el.innerHTML = kpis
      .map(
        (k) => `
      <div class="card">
        <div class="kpi-label">${k.label}</div>
        <div class="kpi-value ${k.cls}">${UI.formatBRL(k.value)}</div>
      </div>`
      )
      .join("");

    return { receitasMes, totalDespesas, saldo, totalGuardado, despesasDiaMes, cartaoMes, fixosMes };
  }

  function renderChartCategorias(state) {
    const key = currentMonthKey();
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

  function renderChartEvolucao(state) {
    const months = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }

    const receitasSerie = months.map((m) =>
      state.receitas.filter((r) => monthKey(r.data) === m).reduce((s, r) => s + Number(r.valor || 0), 0)
    );
    const despesasSerie = months.map((m) => {
      const diaADia = state.despesas
        .filter((d) => monthKey(d.data) === m)
        .reduce((s, d) => s + Number(d.valor || 0), 0);
      const cartao = state.cartao
        .filter((d) => monthKey(d.data) === m)
        .reduce((s, d) => s + Number(d.valor || 0), 0);
      return diaADia + cartao + totalFixosMensal(state);
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

    if (kpis.saldo < 0) {
      insights.push(`⚠️ Seu saldo do mês está negativo em ${UI.formatBRL(Math.abs(kpis.saldo))}. Suas despesas superaram as receitas.`);
    } else if (kpis.receitasMes > 0) {
      const pct = ((kpis.saldo / kpis.receitasMes) * 100).toFixed(0);
      insights.push(`✅ Você está guardando ${pct}% da sua receita este mês (${UI.formatBRL(kpis.saldo)}).`);
    }

    if (kpis.cartaoMes > 0 && kpis.receitasMes > 0) {
      const pctCartao = ((kpis.cartaoMes / kpis.receitasMes) * 100).toFixed(0);
      if (pctCartao > 30) {
        insights.push(`💳 O cartão de crédito já consome ${pctCartao}% da sua receita do mês. Vale ficar de olho.`);
      }
    }

    if (kpis.fixosMes > 0 && kpis.receitasMes > 0) {
      const pctFixos = ((kpis.fixosMes / kpis.receitasMes) * 100).toFixed(0);
      insights.push(`📄 Seus gastos fixos representam ${pctFixos}% da sua receita mensal (${UI.formatBRL(kpis.fixosMes)}).`);
    }

    // categoria com maior gasto
    const key = currentMonthKey();
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
