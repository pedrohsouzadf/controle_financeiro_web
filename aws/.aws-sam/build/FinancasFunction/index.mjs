// ==========================================================
// MEU FINANCEIRO - Backend AWS (Lambda)
// ----------------------------------------------------------
// Roteia as mesmas ações que o front-end já usava com o Google Apps
// Script (all / add / delete / update / setConfig), agora lendo e
// escrevendo numa tabela DynamoDB.
//
// Modelo de dados (single-table design):
//   pk = "RECEITAS" | "DESPESAS" | "FIXOS" | "CARTAO" | "POUPANCA" | "QUITACAO" | "CONFIG"
//   sk = id do item (ou a "chave" de configuração, no caso de CONFIG)
// ==========================================================

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  PutCommand,
  DeleteCommand,
  GetCommand
} from "@aws-sdk/lib-dynamodb";
import { syncAll } from "./pluggy.mjs";

const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME;
const API_KEY = process.env.API_KEY;
const PLUGGY_CLIENT_ID = process.env.PLUGGY_CLIENT_ID;
const PLUGGY_CLIENT_SECRET = process.env.PLUGGY_CLIENT_SECRET;
const PLUGGY_ITEM_IDS = (process.env.PLUGGY_ITEM_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Mapeia a chave usada pelo front-end para a partition key da tabela
const SHEET_TO_PK = {
  receitas: "RECEITAS",
  despesas: "DESPESAS",
  fixos: "FIXOS",
  cartao: "CARTAO",
  poupanca: "POUPANCA",
  quitacao: "QUITACAO"
};

const CORS_HEADERS = {
  "Content-Type": "application/json"
  // O CORS "de verdade" já é tratado pelo API Gateway (CorsConfiguration
  // no template.yaml). Não precisamos duplicar headers aqui.
};

function response(statusCode, body) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body)
  };
}

async function queryByType(pk) {
  const result = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: { ":pk": pk }
    })
  );
  return (result.Items || []).map((item) => {
    const { pk: _pk, sk, ...rest } = item;
    return { id: sk, ...rest };
  });
}

async function getConfig() {
  const result = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: { ":pk": "CONFIG" }
    })
  );
  const config = {};
  (result.Items || []).forEach((item) => {
    config[item.sk] = item.valor;
  });
  return config;
}

async function handleGetAll() {
  const [receitas, despesas, fixos, cartao, poupanca, quitacao, config] = await Promise.all([
    queryByType("RECEITAS"),
    queryByType("DESPESAS"),
    queryByType("FIXOS"),
    queryByType("CARTAO"),
    queryByType("POUPANCA"),
    queryByType("QUITACAO"),
    getConfig()
  ]);
  return response(200, { ok: true, receitas, despesas, fixos, cartao, poupanca, quitacao, config });
}

async function handleAdd(body) {
  const pk = SHEET_TO_PK[body.sheet];
  if (!pk) return response(400, { ok: false, error: "Aba inválida" });

  const id = body.data.id || crypto.randomUUID();
  const item = { pk, sk: id, ...body.data, id: undefined };
  delete item.id; // id fica só como sk, não duplicamos como atributo

  await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
  return response(200, { ok: true, item: { id, ...body.data } });
}

async function handleDelete(body) {
  const pk = SHEET_TO_PK[body.sheet];
  if (!pk) return response(400, { ok: false, error: "Aba inválida" });

  await ddb.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { pk, sk: body.id } }));
  return response(200, { ok: true });
}

async function handleUpdate(body) {
  const pk = SHEET_TO_PK[body.sheet];
  if (!pk) return response(400, { ok: false, error: "Aba inválida" });

  const existing = await ddb.send(
    new GetCommand({ TableName: TABLE_NAME, Key: { pk, sk: body.id } })
  );
  if (!existing.Item) return response(404, { ok: false, error: "Item não encontrado" });

  const merged = { ...existing.Item, ...body.data, pk, sk: body.id };
  await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: merged }));
  return response(200, { ok: true });
}

async function handleSetConfig(body) {
  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: { pk: "CONFIG", sk: body.chave, valor: body.valor }
    })
  );
  return response(200, { ok: true });
}

// Botão "Atualizar" da tela de Despesas: pede pra Pluggy ir buscar dados
// frescos na instituição (best-effort) e lança as transações novas.
async function handleSyncPluggy() {
  const resultado = await syncAll({
    ddb,
    TABLE_NAME,
    clientId: PLUGGY_CLIENT_ID,
    clientSecret: PLUGGY_CLIENT_SECRET,
    itemIds: PLUGGY_ITEM_IDS,
    forceUpdate: true
  });
  return response(200, { ok: true, ...resultado });
}

export const handler = async (event) => {
  try {
    const method = event.requestContext?.http?.method || "GET";

    // Preflight (o API Gateway já responde OPTIONS automaticamente, mas
    // deixamos aqui como segurança extra)
    if (method === "OPTIONS") return response(200, { ok: true });

    // Verificação simples de API key
    const headers = event.headers || {};
    const providedKey = headers["x-api-key"] || headers["X-Api-Key"];
    if (!providedKey || providedKey !== API_KEY) {
      return response(401, { ok: false, error: "API key inválida ou ausente" });
    }

    if (method === "GET") {
      return await handleGetAll();
    }

    if (method === "POST") {
      const body = event.body ? JSON.parse(event.body) : {};
      switch (body.action) {
        case "add":
          return await handleAdd(body);
        case "delete":
          return await handleDelete(body);
        case "update":
          return await handleUpdate(body);
        case "setConfig":
          return await handleSetConfig(body);
        case "syncPluggy":
          return await handleSyncPluggy();
        default:
          return response(400, { ok: false, error: "Ação inválida" });
      }
    }

    return response(405, { ok: false, error: "Método não permitido" });
  } catch (err) {
    console.error(err);
    return response(500, { ok: false, error: err.message });
  }
};
