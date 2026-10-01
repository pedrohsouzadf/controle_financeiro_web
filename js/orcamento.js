// ==========================================================
// Orçamento sugerido por categoria, baseado na regra 50-30-20
// (50% necessidades, 30% desejos/estilo de vida, 20% objetivos
// financeiros) — uma das referências mais usadas em educação
// financeira para dividir a renda mensal.
//
// Dentro de cada fatia, a gente distribui por categoria usando pesos
// que refletem o quanto cada uma costuma pesar no orçamento de uma
// família (mercado/transporte pesam mais que educação, por exemplo).
// São só um ponto de partida — dá pra ajustar os números abaixo se
// quiser uma divisão diferente pra sua realidade.
// ==========================================================

const Orcamento = (() => {
  const PERCENT_NECESSIDADES = 0.5;
  const PERCENT_DESEJOS = 0.3;
  const PERCENT_POUPANCA = 0.2;

  // Pesos dentro do que sobra de "Necessidades" depois de descontar os
  // Gastos Fixos (aluguel, condomínio, contas básicas, parcelas antigas
  // em aberto — tudo isso já é compromisso fixo). O que sobra é pra
  // cobrir os gastos variáveis essenciais do dia a dia.
  const PESOS_NECESSIDADES = {
    "Alimentação Básica": 0.45,
    Transporte: 0.3,
    Saúde: 0.15,
    Educação: 0.1
  };

  // Pesos dentro dos 30% de "Desejos e Estilo de Vida".
  const PESOS_DESEJOS = {
    "Alimentação Fora": 0.3,
    Lazer: 0.3,
    "Compras Pessoais": 0.25,
    Assinaturas: 0.15
  };

  // Ordem de exibição da tabela de orçamento por categoria.
  const ORDEM_CATEGORIAS = [
    "Alimentação Básica",
    "Alimentação Fora",
    "Transporte",
    "Saúde",
    "Lazer",
    "Compras Pessoais",
    "Assinaturas",
    "Educação"
  ];

  // Calcula o orçamento sugerido de cada categoria variável, dado:
  //  - receitaMensal: total de receita do mês
  //  - gastosFixosMensal: soma de tudo que é compromisso fixo (despesas
  //    recorrentes + contas fixas antigas + parcelas de Quitação em
  //    aberto) — já considerado "gasto" dentro dos 50% de Necessidades.
  function calcular(receitaMensal, gastosFixosMensal) {
    const receita = Math.max(0, Number(receitaMensal) || 0);
    const fixo = Math.max(0, Number(gastosFixosMensal) || 0);

    const necessidadesTotal = receita * PERCENT_NECESSIDADES;
    const necessidadesRestante = Math.max(0, necessidadesTotal - fixo);
    const desejosTotal = receita * PERCENT_DESEJOS;
    const poupancaSugerida = receita * PERCENT_POUPANCA;

    const porCategoria = {};
    Object.entries(PESOS_NECESSIDADES).forEach(([cat, peso]) => {
      porCategoria[cat] = necessidadesRestante * peso;
    });
    Object.entries(PESOS_DESEJOS).forEach(([cat, peso]) => {
      porCategoria[cat] = desejosTotal * peso;
    });

    return {
      necessidadesTotal,
      necessidadesRestante,
      desejosTotal,
      poupancaSugerida,
      porCategoria
    };
  }

  return {
    calcular,
    ORDEM_CATEGORIAS,
    PERCENT_NECESSIDADES,
    PERCENT_DESEJOS,
    PERCENT_POUPANCA
  };
})();
