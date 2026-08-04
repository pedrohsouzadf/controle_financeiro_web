// ==========================================================
// Categorias organizadas pela regra 50/30/20
// (Necessidades / Desejos e Estilo de Vida / Futuro e Prioridades)
// ==========================================================

const Categories = (() => {
  const CATEGORY_GROUPS = {
    necessidades: {
      label: "Necessidades",
      percentAlvo: 50,
      categorias: ["Moradia", "Contas Básicas", "Alimentação Básica", "Saúde", "Transporte", "Educação"]
    },
    desejos: {
      label: "Desejos e Estilo de Vida",
      percentAlvo: 30,
      categorias: ["Lazer", "Alimentação Fora", "Assinaturas", "Compras Pessoais", "Outros"]
    },
    futuro: {
      label: "Futuro e Prioridades",
      percentAlvo: 20,
      categorias: ["Dívidas/Financiamento"]
    }
  };

  // Compatibilidade com nomes de categoria usados antes dessa reorganização,
  // para que lançamentos antigos continuem sendo agrupados corretamente.
  const ALIASES = {
    Alimentação: "Alimentação Básica",
    Utilidades: "Contas Básicas",
    Compras: "Compras Pessoais",
    Financiamento: "Dívidas/Financiamento"
  };

  function categoriaCanonica(categoria) {
    return ALIASES[categoria] || categoria;
  }

  function grupoDaCategoria(categoria) {
    const canon = categoriaCanonica(categoria);
    for (const [key, g] of Object.entries(CATEGORY_GROUPS)) {
      if (g.categorias.includes(canon)) return key;
    }
    return "desejos"; // categoria desconhecida cai no grupo mais flexível
  }

  function todasCategorias() {
    return Object.values(CATEGORY_GROUPS).flatMap((g) => g.categorias);
  }

  return { CATEGORY_GROUPS, grupoDaCategoria, categoriaCanonica, todasCategorias };
})();
