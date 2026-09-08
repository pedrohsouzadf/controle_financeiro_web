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

import { PutCommand, GetCommand } from "@aws-sdk/lib-dynamodb";

const PLUGGY_API_URL = "https://api.pluggy.ai";

// Quantos dias pra trás buscar a cada sincronização. Não precisa ser
// "desde a última vez" — como cada transação é deduplicada pelo id dela
// (guardado em PLUGGY_SYNC), é seguro pedir uma janela generosa toda vez;
// isso também pega correções que o banco faça em transações recentes.
const JANELA_DIAS = 20;

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

  for (const itemId of itemIds) {
    if (forceUpdate) await solicitarAtualizacaoItem(apiKey, itemId);

    const contas = await listarContas(apiKey, itemId);
    for (const conta of contas) {
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
  }

  return { importadas, ignoradas };
}
