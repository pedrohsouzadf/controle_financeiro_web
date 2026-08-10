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

  function monthKey(dateStr) {
    if (!dateStr) return null;
    const s = String(dateStr).substring(0, 7); // YYYY-MM
    return /^\d{4}-\d{2}$/.test(s) ? s : null;
  }

  function currentMonthKey() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }

  // Mês efetivamente usado pelos cálculos do dashboard: o escolhido no
  // filtro, ou o mês atual se nada foi selecionado ainda.
  function mesAtivo() {
    return mesSelecionado || currentMonthKey();
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

  // Receitas sem "tipo" definido (cadastradas antes dessa opção existir) são
  // tratadas como "renda" por padrão.
  function tipoReceita(r) {
    return r.tipo === "beneficio" ? "beneficio" : "renda";
  }

  // Uma despesa/gasto fixo é "conta corrente" se não tiver fonte definida ou
  // se a fonte for explicitamente "Conta corrente". Qualquer outro valor
  // (VA, CAJU, etc.) é tratado como pago por um benefício, não por dinheiro real.
  function isContaCorrente(item) {
    const fonte = (item.fonte || "").trim().toLowerCase();
    const dinheiro = ["", "conta corrente", "contacorrente", "débito", "debito", "cartão de crédito", "cartao de credito"];
    return dinheiro.includes(fonte);
  }

  // Um gasto fixo é considerado "pago" por padrão (registros antigos não têm
  // esse campo ainda) — só some das somas do dashboard quando explicitamente
  // marcado como pendente pelo toggle da aba Gastos Fixos.
  function isPago(item) {
    return item.pago !== false && item.pago !== "false";
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
    const fixos = state.fixos.filter((f) => String(f.ativo) !== "false" && isPago(f));
    return { diaADia, cartao, fixos };
  }

  function totalFixosMensal(state, { apenasContaCorrente = false } = {}) {
    return state.fixos
      .filter((f) => String(f.ativo) !== "false" && isPago(f))
      .filter((f) => !apenasContaCorrente || isContaCorrente(f))
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
  // "tipo" filtra por 'renda' ou 'beneficio'; sem filtro, soma tudo.
  function receitasDoMes(state, key, tipo = null) {
    return state.receitas
      .filter((r) => {
        const rMonth = monthKey(r.data);
        if (!rMonth) return false;
        if (tipo && tipoReceita(r) !== tipo) return false;
        return isRecorrente(r) ? rMonth <= key : rMonth === key;
      })
      .reduce((s, r) => s + (Number(r.valor) || 0), 0);
  }

  // Agrupa as receitas do mês (de um tipo — renda ou benefício) pela
  // descrição, pra mostrar "de onde vem cada uma" nos cards do dashboard.
  function receitasPorDescricao(state, key, tipo) {
    const totais = {};
    state.receitas
      .filter((r) => {
        const rMonth = monthKey(r.data);
        if (!rMonth || tipoReceita(r) !== tipo) return false;
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

    const receitasRendaMes = receitasDoMes(state, key, "renda");
    const receitasBeneficioMes = receitasDoMes(state, key, "beneficio");
    const receitasMes = receitasRendaMes + receitasBeneficioMes;

    const { diaADia, cartao } = allDespesasDoMes(state, key);
    const despesasDiaMes = diaADia.reduce((s, d) => s + (Number(d.valor) || 0), 0);
    const despesasDiaContaCorrenteMes = diaADia
      .filter(isContaCorrente)
      .reduce((s, d) => s + (Number(d.valor) || 0), 0);

    const cartaoMes = cartao.reduce((s, d) => s + (Number(d.valor) || 0), 0);
    const cartaoRecorrenteMes = cartao
      .filter(isRecorrente)
      .reduce((s, d) => s + (Number(d.valor) || 0), 0);

    const fixosMes = totalFixosMensal(state);
    const fixosContaCorrenteMes = totalFixosMensal(state, { apenasContaCorrente: true });
    // Parcelas de parcelamentos antigos (Quitação) ainda em aberto — contam
    // como gasto fixo em dinheiro real, sempre pagas no cartão de crédito.
    const quitacaoMes = quitacaoMensal(state);
    const gastosFixosTotais = fixosMes + cartaoRecorrenteMes + quitacaoMes;

    // Total gasto de fato (todas as fontes) — só para referência/insights.
    const totalDespesas = despesasDiaMes + cartaoMes + fixosMes + quitacaoMes;

    // Saldo real: só considera receita de renda (dinheiro de verdade) menos
    // despesas pagas com conta corrente. Gastos cobertos por VA/CAJU não
    // entram aqui, porque também não entraram como "renda".
    const despesasContaCorrenteMes = despesasDiaContaCorrenteMes + fixosContaCorrenteMes + cartaoMes + quitacaoMes;
    const saldo = receitasRendaMes - despesasContaCorrenteMes;

    const saldoInicial = Number(state.config.saldoInicial || 0);
    const totalGuardado =
      saldoInicial +
      state.poupanca.reduce((s, p) => {
        const v = Number(p.valor) || 0;
        return p.tipo === "retirada" ? s - v : s + v;
      }, 0);

    const metaInvestimentoMensal = Number(state.config.metaInvestimentoMensal || 0);

    // Decompõe "Gastos totais" (dinheiro real) em fixo e variável, pra ficar
    // explícito o que é compromisso recorrente (boleto + assinatura no
    // cartão) e o que é gasto do dia a dia (inclusive compras avulsas no
    // cartão, que são variáveis mesmo sendo pagas com cartão).
    const gastosFixosDinheiroMes = fixosContaCorrenteMes + cartaoRecorrenteMes + quitacaoMes;
    const gastosVariaveisDinheiroMes = despesasDiaContaCorrenteMes + (cartaoMes - cartaoRecorrenteMes);

    // Quanto ainda resta pra gastar em cada benefício (VA, CAJU) este mês —
    // recebido menos já gasto, por fonte.
    const fontesBeneficio = saldoPorFonte(state, key);
    const saldoBeneficiosTotal = fontesBeneficio.reduce((s, f) => s + f.saldo, 0);

    // De onde vem cada receita de renda (ex: salário de cada um), pra mostrar
    // como detalhe dentro do card "Total receitas".
    const receitasRendaDetalhe = receitasPorDescricao(state, key, "renda");

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
      "Total receitas - renda",
      receitasRendaMes,
      "positive",
      receitasRendaDetalhe.length
        ? receitasRendaDetalhe.map(([nome, val]) => linhaDetalhe(`${nome}: ${UI.formatBRL(val)}`)).join("")
        : semDados("Nenhuma receita de renda neste mês.")
    );

    const cardTotalBeneficios = cardComDetalhe(
      "Total Benefícios",
      receitasBeneficioMes,
      "positive",
      fontesBeneficio.length
        ? fontesBeneficio.map((f) => `<div style="margin-top:6px; font-size:13px;">${UI.fonteBadge(f.nome)} <span style="color:var(--text-muted);">${UI.formatBRL(f.recebido)}</span></div>`).join("")
        : semDados("Nenhum benefício neste mês.")
    );

    const cardSaldoBeneficios = cardComDetalhe(
      "Saldo Benefícios",
      saldoBeneficiosTotal,
      saldoBeneficiosTotal >= 0 ? "positive" : "negative",
      fontesBeneficio.length
        ? fontesBeneficio
            .map(
              (f) => `
          <div style="margin-top:6px; font-size:13px;">
            ${UI.fonteBadge(f.nome)}
            <span style="color:var(--text-muted);">restam ${UI.formatBRL(f.saldo)}</span>
          </div>`
            )
            .join("")
        : semDados("Sem benefícios cadastrados neste mês.")
    );

    // Gastos fixos e variáveis juntos numa única caixa (lado a lado), pra
    // não ocupar duas caixas inteiras só pra mostrar a decomposição do total.
    const cardFixosEVariaveis = `
      <div class="card">
        <div class="kpi-label" style="text-transform:uppercase;">Gastos Fixos e Variáveis</div>
        <div style="display:flex; gap:24px; margin-top:4px;">
          <div>
            <div style="font-size:12px; color:var(--text-muted);">Fixos</div>
            <div class="kpi-value negative" style="font-size:22px;">${UI.formatBRL(gastosFixosDinheiroMes)}</div>
          </div>
          <div>
            <div style="font-size:12px; color:var(--text-muted);">Variáveis</div>
            <div class="kpi-value negative" style="font-size:22px;">${UI.formatBRL(gastosVariaveisDinheiroMes)}</div>
          </div>
        </div>
      </div>`;

    const rotuloGrupo = (texto, comMargem) => `
      <div style="font-size:12px; font-weight:700; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.04em; margin:${comMargem ? "24px" : "0"} 0 10px;">${texto}</div>`;

    const el = document.getElementById("dashboard-kpis");
    el.innerHTML = `
      ${rotuloGrupo("Receitas", false)}
      <div class="grid cols-3">${cardTotalReceitas}${cardTotalBeneficios}${cardSaldoBeneficios}</div>
      ${rotuloGrupo("Despesas", true)}
      <div class="grid cols-3">
        ${cardFixosEVariaveis}
        ${cardSimples("Gastos totais", despesasContaCorrenteMes, "negative")}
        ${cardSimples("Saldo Salários", saldo, saldo >= 0 ? "positive" : "negative")}
      </div>
    `;

    return {
      receitasMes,
      receitasRendaMes,
      receitasBeneficioMes,
      totalDespesas,
      despesasContaCorrenteMes,
      saldo,
      totalGuardado,
      metaInvestimentoMensal,
      despesasDiaMes,
      cartaoMes,
      cartaoRecorrenteMes,
      fixosMes,
      gastosFixosTotais,
      gastosFixosDinheiroMes,
      gastosVariaveisDinheiroMes
    };
  }

  // Saldo restante de cada benefício (VA, CAJU, etc.): quanto foi recebido
  // esse mês (receita recorrente do tipo "benefício") menos quanto já foi
  // gasto com despesas/gastos fixos que informaram essa mesma fonte.
  function saldoPorFonte(state, key) {
    const { diaADia, fixos } = allDespesasDoMes(state, key);

    const beneficios = state.receitas.filter((r) => {
      const rMonth = monthKey(r.data);
      if (!rMonth) return false;
      if (tipoReceita(r) !== "beneficio") return false;
      return isRecorrente(r) ? rMonth <= key : rMonth === key;
    });

    const nomes = [...new Set(beneficios.map((b) => (b.descricao || "").trim()).filter(Boolean))];

    return nomes.map((nome) => {
      const nomeLower = nome.toLowerCase();
      const recebido = beneficios
        .filter((b) => (b.descricao || "").trim().toLowerCase() === nomeLower)
        .reduce((s, b) => s + (Number(b.valor) || 0), 0);
      const gastoDiaADia = diaADia
        .filter((d) => (d.fonte || "").trim().toLowerCase() === nomeLower)
        .reduce((s, d) => s + (Number(d.valor) || 0), 0);
      const gastoFixos = fixos
        .filter((f) => (f.fonte || "").trim().toLowerCase() === nomeLower)
        .reduce((s, f) => s + (Number(f.valorMensal) || 0), 0);
      const gasto = gastoDiaADia + gastoFixos;
      return { nome, recebido, gasto, saldo: recebido - gasto };
    });
  }

  // Teto de cada grupo (Necessidades/Desejos/Futuro) = % da soma de TODAS as
  // receitas do mês (renda + benefícios), seguindo a regra 50/30/20.
  // O grupo "Futuro" também soma os depósitos de poupança feitos no mês,
  // já que investir é justamente o objetivo desse grupo.
  // O grupo "Gastos Extraordinários" fica de fora do painel de orçamento —
  // são gastos pontuais (mudança, imprevistos) que não devem contar nos
  // tetos do 50/30/20, então são somados à parte (ver extraordinariosDoMes).
  function orcamentoPorGrupo(state, key) {
    const totalReceitas = receitasDoMes(state, key);
    const { diaADia, cartao, fixos } = allDespesasDoMes(state, key);

    const gastoPorGrupo = { necessidades: 0, desejos: 0, futuro: 0, extraordinarios: 0 };
    // Dentro de cada grupo, separa quanto do gasto veio de dinheiro real
    // (débito/cartão/conta corrente) e quanto veio de benefício (VA/CAJU) —
    // útil porque só a parte em dinheiro compete com a meta de investimento.
    const gastoPorGrupoDinheiro = { necessidades: 0, desejos: 0, futuro: 0, extraordinarios: 0 };
    const gastoPorGrupoBeneficio = { necessidades: 0, desejos: 0, futuro: 0, extraordinarios: 0 };

    const registrar = (item, valor, categoria) => {
      const grupo = Categories.grupoDaCategoria(categoria);
      gastoPorGrupo[grupo] += valor;
      if (isContaCorrente(item)) gastoPorGrupoDinheiro[grupo] += valor;
      else gastoPorGrupoBeneficio[grupo] += valor;
    };

    [...diaADia, ...cartao].forEach((d) => registrar(d, Number(d.valor || 0), d.categoria));
    fixos.forEach((f) => registrar(f, Number(f.valorMensal || 0), f.categoria));

    const depositosMes = state.poupanca
      .filter((p) => monthKey(p.data) === key && p.tipo === "deposito")
      .reduce((s, p) => s + Number(p.valor || 0), 0);
    gastoPorGrupo.futuro += depositosMes;
    gastoPorGrupoDinheiro.futuro += depositosMes;

    // O grupo "Investimentos" (ex-Futuro e Prioridades) tem um valor alvo fixo
    // definido pelo usuário (R$ 1.100), em vez do percentual sobre a renda.
    const TETO_FIXO_INVESTIMENTOS = 1100;

    return Object.entries(Categories.CATEGORY_GROUPS)
      .filter(([grupoKey]) => grupoKey !== "extraordinarios")
      .map(([grupoKey, g]) => ({
        key: grupoKey,
        label: g.label,
        percentAlvo: g.percentAlvo,
        teto: grupoKey === "futuro" ? TETO_FIXO_INVESTIMENTOS : totalReceitas * (g.percentAlvo / 100),
        realizado: gastoPorGrupo[grupoKey] || 0,
        dinheiro: gastoPorGrupoDinheiro[grupoKey] || 0,
        beneficio: gastoPorGrupoBeneficio[grupoKey] || 0
      }));
  }

  // Total gasto em "Gastos Extraordinários" no mês — mostrado à parte, sem
  // teto, já que são gastos pontuais fora do orçamento normal.
  function extraordinariosDoMes(state, key) {
    const { diaADia, cartao, fixos } = allDespesasDoMes(state, key);
    const ehExtraordinario = (item) => Categories.grupoDaCategoria(item.categoria) === "extraordinarios";
    const totalDiaADia = diaADia.filter(ehExtraordinario).reduce((s, d) => s + Number(d.valor || 0), 0);
    const totalCartao = cartao.filter(ehExtraordinario).reduce((s, d) => s + Number(d.valor || 0), 0);
    const totalFixos = fixos.filter(ehExtraordinario).reduce((s, f) => s + Number(f.valorMensal || 0), 0);
    return totalDiaADia + totalCartao + totalFixos;
  }

  function renderOrcamentoGrupos(state) {
    const el = document.getElementById("dashboard-orcamento-grupos");
    if (!el) return;
    const key = mesAtivo();
    const grupos = orcamentoPorGrupo(state, key);

    el.innerHTML = `
      <h3>Orçamento por grupo (regra 50/30/20)</h3>
      <div class="grid cols-3">
        ${grupos
          .map((g) => {
            const pct = g.teto > 0 ? Math.min(100, (g.realizado / g.teto) * 100) : 0;
            const over = g.realizado > g.teto;
            return `
          <div>
            <div class="kpi-label">${g.label} (${g.percentAlvo}%)</div>
            <div class="kpi-value ${over ? "negative" : "positive"}">
              ${UI.formatBRL(g.realizado)}
              <span style="font-size:12px; color:var(--text-muted); font-weight:400;">/ ${UI.formatBRL(g.teto)}</span>
            </div>
            <div style="background:#eceef1; border-radius:999px; height:6px; margin-top:8px; overflow:hidden;">
              <div style="width:${pct}%; height:100%; background:${over ? "var(--red)" : "var(--green)"};"></div>
            </div>
            ${
              g.realizado > 0
                ? `<div style="margin-top:8px; font-size:12px; color:var(--text-muted);">Dinheiro: ${UI.formatBRL(g.dinheiro)} · Benefício: ${UI.formatBRL(g.beneficio)}</div>`
                : ""
            }
          </div>`;
          })
          .join("")}
      </div>`;
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
          `🎯 Sua meta de investir ${UI.formatBRL(kpis.metaInvestimentoMensal)}/mês cabe no seu saldo real — depois de investir, ainda sobram ${UI.formatBRL(folga)}.`
        );
      } else {
        insights.push(
          `⚠️ Sua meta de investir ${UI.formatBRL(kpis.metaInvestimentoMensal)}/mês está ${UI.formatBRL(Math.abs(folga))} acima do seu saldo real deste mês. Vale revisar gastos ou ajustar a meta.`
        );
      }
    }

    if (kpis.saldo < 0) {
      insights.push(
        `⚠️ Seu saldo real do mês está negativo em ${UI.formatBRL(Math.abs(kpis.saldo))} (considerando só renda e gastos de conta corrente).`
      );
    } else if (kpis.receitasRendaMes > 0) {
      const pct = ((kpis.saldo / kpis.receitasRendaMes) * 100).toFixed(0);
      insights.push(`✅ Você está guardando ${pct}% da sua renda este mês (${UI.formatBRL(kpis.saldo)}).`);
    }

    if (kpis.cartaoMes > 0 && kpis.receitasRendaMes > 0) {
      const pctCartao = ((kpis.cartaoMes / kpis.receitasRendaMes) * 100).toFixed(0);
      if (pctCartao > 30) {
        insights.push(`💳 O cartão de crédito já consome ${pctCartao}% da sua renda do mês. Vale ficar de olho.`);
      }
    }

    if (kpis.gastosFixosTotais > 0 && kpis.receitasRendaMes > 0) {
      const pctFixos = ((kpis.gastosFixosTotais / kpis.receitasRendaMes) * 100).toFixed(0);
      insights.push(
        `📄 Seus gastos fixos (boleto + cartão recorrente + parcelas antigas) representam ${pctFixos}% da sua renda mensal (${UI.formatBRL(kpis.gastosFixosTotais)}).`
      );
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

    const extraordinariosMes = extraordinariosDoMes(state, key);
    if (extraordinariosMes > 0) {
      insights.push(
        `🏗️ Você teve ${UI.formatBRL(extraordinariosMes)} em gastos extraordinários este mês (categoria "Gastos Extraordinários") — esse valor não conta nos tetos do orçamento 50/30/20.`
      );
    }

    if (!insights.length) {
      insights.push("Adicione receitas e despesas para começar a ver insights por aqui.");
    }

    const el = document.getElementById("insights-list");
    el.innerHTML = insights.map((i) => `<p style="margin:8px 0; font-size:14px;">${i}</p>`).join("");
  }

  function render(state) {
    popularFiltroMesDashboard(state);
    const kpis = renderKpis(state);
    renderOrcamentoGrupos(state);
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
