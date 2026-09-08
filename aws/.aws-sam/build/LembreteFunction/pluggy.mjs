// ==========================================================
// Integração com a Pluggy (Open Finance / Meu Pluggy)
// ----------------------------------------------------------
// Puxa transações das contas conectadas (banco + cartão) e lança cada uma
// como Despesa ou Receita, com categoria adivinhada por palavra-chave
// (editável depois, igual qualquer outro lançamento). Usado tanto pela
// sincronização diária automática (pluggy-sync.mjs) quanto pelo botão
// "Atualizar" manual (ação "syncPluggy" em index.mjs).
//
// Compartilhado entre as duas Lambdas porque o SAM empacota a pasta
// aws/lambda/ inteira pra cada função (CodeUri: lambda/ no template.yaml).
// ==========================================================

import { PutCommand, GetCommand, QueryCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";

const PLUGGY_API_URL = "https://api.pluggy.ai";

// Quantos dias pra trás buscar a cada sincronização. Não precisa ser
// "desde a última vez" — como cada transação é deduplicada pelo id dela
// (guardado em PLUGGY_SYNC), é seguro pedir uma janela generosa toda vez;
// isso também pega correções que o banco faça em transações recentes.
const JANELA_DIAS = 20;

// Janela usada só pra montar a lista de compras por fatura (aba Cartão de
// crédito) — mais larga que a de cima porque queremos mostrar também
// faturas já fechadas dos últimos meses, não só a compra recém-chegada.
const JANELA_DIAS_FATURAS = 120;

// Categorias precisam bater exatamente com as usadas no front-end
// (js/categories.js e os <select> de Despesas/Receitas no index.html).
const REGRAS_CATEGORIA_DESPESA = [
  [/ifood|rappi|uber\s?eats|restaurante|lanchonete|burger|pizza|mcdonald|habib|padaria|bar\b/i, "Alimentação Fora"],
  [/supermercado|mercado(?!\s?pago)|hortifruti|atacad|hiper\b|sacolao|sacolão/i, "Alimentação Básica"],
  [/farmacia|farmácia|drogaria|hospital|clinica|clínica|laboratorio|laboratório|plano de saude|unimed|amil|odonto/i, "Saúde"],
  [/\buber\b|99app|99pop|\btaxi\b|táxi|posto|combustivel|combustível|estacionamento|pedagio|pedágio|\bmetro\b|onibus|ônibus|ipva|detran/i, "Transporte"],
  [/aluguel|condominio|condomínio|imobiliaria|imobiliária/i, "Moradia"],
  [/energia|eletropaulo|cemig|enel\b|copel|cpfl|light sa|companhia de agua|saneamento|sabesp|caesb|gas natural|\bclaro\b|\bvivo\b|\btim\b|algar|internet|net serv|oi fibra/i, "Contas Básicas"],
  [/netflix|spotify|amazon prime|disney|\bhbo\b|youtube premium|deezer|globoplay|apple\.com\/bill/i, "Assinaturas"],
  [/escola|faculdade|universidade|\bcurso\b|udemy|alura|colegio|colégio/i, "Educação"],
  [/cinema|ingresso|\bshow\b|teatro|\bsteam\b|playstation|\bxbox\b|balada/i, "Lazer"],
  [/shopping|magazine|americanas|mercado livre|\bshein\b|renner|amazon\.com|riachuelo|\bc&a\b|ponto frio|casas bahia/i, "Compras Pessoais"],
  [/emprestimo|empréstimo|financiamento/i, "Dívidas/Financiamento"]
];

const REGRAS_CATEGORIA_RECEITA = [
  [/sal[aá]rio|folha de pagamento|holerite/i, "Salário"],
  [/freelance|freela|honorario|honorário|nota fiscal/i, "Freelance"],
  [/rendimento|dividendo|resgate|aplicacao|aplicação/i, "Investimentos"],
  [/presente|doacao|doação/i, "Presente"]
];

function categorizar(descricao, regras, categoriaPadrao) {
  const texto = String(descricao || "");
  for (const [regex, categoria] of regras) {
    if (regex.test(texto)) return categoria;
  }
  return categoriaPadrao;
}

function formatarData(date) {
  return date.toISOString().substring(0, 10);
}

// Resolve o cursor "next" retornado pela Pluggy (vem como querystring
// relativa, ex: "?accountId=...&after=...") pra uma URL completa.
function resolverProximaUrl(next) {
  if (!next) return null;
  if (next.startsWith("http")) return next;
  const path = next.startsWith("?") ? `/transactions${next}` : next;
  return `${PLUGGY_API_URL}${path}`;
}

let apiKeyCache = { valor: null, expiraEm: 0 };

async function getApiKey(clientId, clientSecret) {
  const agora = Date.now();
  if (apiKeyCache.valor && agora < apiKeyCache.expiraEm) return apiKeyCache.valor;

  const res = await fetch(`${PLUGGY_API_URL}/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId, clientSecret })
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.apiKey) {
    throw new Error(`Erro ao autenticar na Pluggy: ${json.message || res.status}`);
  }
  apiKeyCache = {
    valor: json.apiKey,
    // Expira em 2h; renovamos com 5 minutos de folga.
    expiraEm: agora + 2 * 60 * 60 * 1000 - 5 * 60 * 1000
  };
  return apiKeyCache.valor;
}

async function pluggyFetch(url, apiKey, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { "X-API-KEY": apiKey, "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Erro na API da Pluggy (${url}): ${json.message || res.status}`);
  }
  return json;
}

async function listarContas(apiKey, itemId) {
  const json = await pluggyFetch(`${PLUGGY_API_URL}/accounts?itemId=${encodeURIComponent(itemId)}`, apiKey);
  return json.results || [];
}

async function listarTransacoes(apiKey, accountId, from, to) {
  let todas = [];
  let url = `${PLUGGY_API_URL}/transactions?accountId=${encodeURIComponent(accountId)}&from=${from}&to=${to}&pageSize=500`;
  while (url) {
    const json = await pluggyFetch(url, apiKey);
    todas = todas.concat(json.results || []);
    url = resolverProximaUrl(json.next);
  }
  return todas;
}

async function listarBills(apiKey, accountId) {
  const json = await pluggyFetch(`${PLUGGY_API_URL}/bills?accountId=${encodeURIComponent(accountId)}`, apiKey);
  return json.results || [];
}

async function listarInvestimentos(apiKey, itemId) {
  let todos = [];
  let page = 1;
  // Poucos investimentos de pessoa física raramente passam de 1 página,
  // mas seguimos totalPages por segurança.
  while (true) {
    const json = await pluggyFetch(
      `${PLUGGY_API_URL}/investments?itemId=${encodeURIComponent(itemId)}&pageSize=500&page=${page}`,
      apiKey
    );
    todos = todos.concat(json.results || []);
    const totalPages = json.totalPages || 1;
    if (page >= totalPages) break;
    page++;
  }
  return todos;
}

// Apaga tudo de uma entidade "espelho" da Pluggy (faturas ou investimentos)
// antes de regravar. Diferente de Despesas/Receitas (que são lançamentos
// individuais e deduplicados por id), essas duas telas mostram o retorno
// mais recente da Pluggy tal como ele é — então uma fatura que sai da
// resposta (cartão cancelado) ou um investimento resgatado não pode ficar
// órfão pra sempre na tabela.
async function limparEntidade(ddb, TABLE_NAME, pk) {
  const result = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: { ":pk": pk }
    })
  );
  for (const item of result.Items || []) {
    await ddb.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { pk, sk: item.sk } }));
  }
}

// Busca as faturas (bills) de uma conta de cartão e agrupa as transações
// dela por fatura, usando o campo billId que a Pluggy devolve nas
// transações já associadas a uma fatura. Grava uma "foto" de cada fatura
// (total + lista de compras) — puramente informativo, não mexe em
// Despesas/Receitas (essas continuam sendo lançadas como já eram).
async function sincronizarFaturasDaConta(ddb, TABLE_NAME, apiKey, itemId, conta) {
  const bills = await listarBills(apiKey, conta.id);
  if (!bills.length) return 0;

  const hoje = new Date();
  const de = new Date(hoje);
  de.setDate(de.getDate() - JANELA_DIAS_FATURAS);
  const transacoes = await listarTransacoes(apiKey, conta.id, formatarData(de), formatarData(hoje));

  const comprasPorFatura = new Map();
  transacoes.forEach((tx) => {
    if (!tx.billId) return;
    // Só compras (valor positivo) — pagamentos da própria fatura/estornos
    // não interessam aqui, é só "no que eu gastei nessa fatura".
    if (!(Number(tx.amount) > 0)) return;
    if (!comprasPorFatura.has(tx.billId)) comprasPorFatura.set(tx.billId, []);
    comprasPorFatura.get(tx.billId).push({
      id: tx.id,
      data: String(tx.date).substring(0, 10),
      descricao: String(tx.description || "Compra").trim().substring(0, 140),
      valor: Number(tx.amount)
    });
  });

  let gravadas = 0;
  for (const bill of bills) {
    const compras = (comprasPorFatura.get(bill.id) || []).sort((a, b) => (a.data < b.data ? 1 : -1));
    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          pk: "PLUGGY_FATURA",
          sk: bill.id,
          itemId,
          contaId: conta.id,
          contaNome: conta.name || conta.number || "Cartão",
          dueDate: bill.dueDate ? String(bill.dueDate).substring(0, 10) : null,
          billClosingDate: bill.billClosingDate ? String(bill.billClosingDate).substring(0, 10) : null,
          totalAmount: Number(bill.totalAmount || 0),
          minimumPaymentAmount: bill.minimumPaymentAmount != null ? Number(bill.minimumPaymentAmount) : null,
          compras
        }
      })
    );
    gravadas++;
  }
  return gravadas;
}

// Busca os investimentos de um item (banco ou corretora conectados) e
// grava uma "foto" de cada um — mesma lógica de sobrescrever tudo a cada
// sincronização que as faturas, pelo mesmo motivo.
async function sincronizarInvestimentosDoItem(ddb, TABLE_NAME, apiKey, itemId) {
  const investimentos = await listarInvestimentos(apiKey, itemId);
  let gravados = 0;
  for (const inv of investimentos) {
    // Já resgatado/transferido — não faz sentido continuar mostrando.
    if (inv.status === "TOTAL_WITHDRAWAL") continue;
    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          pk: "PLUGGY_INVESTIMENTO",
          sk: inv.id,
          itemId,
          nome: inv.name || "Investimento",
          tipo: inv.type || null,
          subtipo: inv.subtype || null,
          valor: Number(inv.balance ?? inv.amount ?? 0),
          valorInvestido: inv.amountOriginal != null ? Number(inv.amountOriginal) : null,
          rentabilidadeAnual: inv.annualRate != null ? Number(inv.annualRate) : null,
          rentabilidadeUltimos12Meses: inv.lastTwelveMonthsRate != null ? Number(inv.lastTwelveMonthsRate) : null,
          dataAtualizacao: inv.date ? String(inv.date).substring(0, 10) : null
        }
      })
    );
    gravados++;
  }
  return gravados;
}

// Pede pra Pluggy ir atualizar o item direto na instituição financeira
// (usado só no botão manual "Atualizar"). É melhor esforço: se falhar,
// seguimos com os dados que já estão disponíveis em vez de travar o botão.
async function solicitarAtualizacaoItem(apiKey, itemId) {
  try {
    await pluggyFetch(`${PLUGGY_API_URL}/items/${encodeURIComponent(itemId)}`, apiKey, { method: "PATCH" });
  } catch (e) {
    console.warn(`Não foi possível solicitar atualização do item ${itemId} (seguindo com os dados atuais):`, e.message);
  }
}

async function jaImportada(ddb, TABLE_NAME, transactionId) {
  const existente = await ddb.send(
    new GetCommand({ TableName: TABLE_NAME, Key: { pk: "PLUGGY_SYNC", sk: transactionId } })
  );
  return !!existente.Item;
}

async function marcarComoImportada(ddb, TABLE_NAME, transactionId) {
  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: { pk: "PLUGGY_SYNC", sk: transactionId, importadoEm: new Date().toISOString() }
    })
  );
}

// Ponto de entrada principal: sincroniza todas as contas de todos os itens
// configurados e lança as transações novas como Despesas/Receitas.
export async function syncAll({ ddb, TABLE_NAME, clientId, clientSecret, itemIds, forceUpdate }) {
  if (!clientId || !clientSecret || !itemIds || !itemIds.length) {
    throw new Error("Pluggy não configurado (faltam PLUGGY_CLIENT_ID/PLUGGY_CLIENT_SECRET/PLUGGY_ITEM_IDS)");
  }

  const apiKey = await getApiKey(clientId, clientSecret);

  const hoje = new Date();
  const de = new Date(hoje);
  de.setDate(de.getDate() - JANELA_DIAS);
  const from = formatarData(de);
  const to = formatarData(hoje);

  let importadas = 0;
  let ignoradas = 0;
  let faturas = 0;
  let investimentos = 0;

  // Faturas e investimentos são um espelho do que a Pluggy retorna agora —
  // limpamos tudo antes de regravar (ver comentário em limparEntidade).
  await limparEntidade(ddb, TABLE_NAME, "PLUGGY_FATURA");
  await limparEntidade(ddb, TABLE_NAME, "PLUGGY_INVESTIMENTO");

  for (const itemId of itemIds) {
    if (forceUpdate) await solicitarAtualizacaoItem(apiKey, itemId);

    const contas = await listarContas(apiKey, itemId);
    for (const conta of contas) {
      if (conta.type === "CREDIT") {
        faturas += await sincronizarFaturasDaConta(ddb, TABLE_NAME, apiKey, itemId, conta);
      }

      const transacoes = await listarTransacoes(apiKey, conta.id, from, to);

      for (const tx of transacoes) {
        // Só lançamos transações já confirmadas pelo banco — as PENDING
        // (fatura em aberto, parcela futura) ainda podem mudar de valor.
        if (tx.status !== "POSTED") continue;

        if (await jaImportada(ddb, TABLE_NAME, tx.id)) {
          ignoradas++;
          continue;
        }

        let sheet;
        let valor;

        if (conta.type === "CREDIT") {
          // Convenção da Pluggy pra cartão: valor positivo = compra nova
          // (despesa); valor negativo = pagamento da fatura ou estorno.
          // O pagamento da fatura não vira lançamento novo — as compras
          // que o compõem já foram lançadas individualmente, então
          // duplicaria (e como despesa, ainda inverteria o sinal).
          if (!(Number(tx.amount) > 0)) {
            await marcarComoImportada(ddb, TABLE_NAME, tx.id);
            continue;
          }
          sheet = "despesas";
          valor = Number(tx.amount);
        } else {
          sheet = tx.type === "CREDIT" ? "receitas" : "despesas";
          valor = Math.abs(Number(tx.amount));
        }

        const categoria =
          sheet === "despesas"
            ? categorizar(tx.description, REGRAS_CATEGORIA_DESPESA, "Outros")
            : categorizar(tx.description, REGRAS_CATEGORIA_RECEITA, "Outros");

        const pk = sheet === "despesas" ? "DESPESAS" : "RECEITAS";
        const id = crypto.randomUUID();
        const item = {
          pk,
          sk: id,
          data: String(tx.date).substring(0, 10),
          descricao: String(tx.description || "Transação importada").trim().substring(0, 140),
          categoria,
          valor,
          origemImportacao: "pluggy"
        };

        await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
        await marcarComoImportada(ddb, TABLE_NAME, tx.id);
        importadas++;
      }
    }

    investimentos += await sincronizarInvestimentosDoItem(ddb, TABLE_NAME, apiKey, itemId);
  }

  return { importadas, ignoradas, faturas, investimentos };
}
