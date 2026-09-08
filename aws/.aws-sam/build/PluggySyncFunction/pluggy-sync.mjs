// ==========================================================
// Sincronização diária automática com a Pluggy (Open Finance)
// ----------------------------------------------------------
// Roda 1x por dia via EventBridge e chama a mesma lógica de sincronização
// usada pelo botão "Atualizar" (ação "syncPluggy" em index.mjs), só que
// sem forçar atualização direto na instituição — a conexão via Meu Pluggy
// já sincroniza sozinha todo dia, então aqui só lemos o que já tem
// disponível e lançamos o que for novo.
// ==========================================================

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { syncAll } from "./pluggy.mjs";

const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME;
const PLUGGY_CLIENT_ID = process.env.PLUGGY_CLIENT_ID;
const PLUGGY_CLIENT_SECRET = process.env.PLUGGY_CLIENT_SECRET;
const PLUGGY_ITEM_IDS = (process.env.PLUGGY_ITEM_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export const handler = async () => {
  try {
    const resultado = await syncAll({
      ddb,
      TABLE_NAME,
      clientId: PLUGGY_CLIENT_ID,
      clientSecret: PLUGGY_CLIENT_SECRET,
      itemIds: PLUGGY_ITEM_IDS,
      forceUpdate: false
    });
    console.log("Sincronização Pluggy concluída:", resultado);
    return { ok: true, ...resultado };
  } catch (err) {
    console.error("Erro na sincronização Pluggy:", err);
    throw err;
  }
};
