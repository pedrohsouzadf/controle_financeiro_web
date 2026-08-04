// ==========================================================
// LEMBRETE DIÁRIO NO WHATSAPP
// ----------------------------------------------------------
// Disparada todo dia às 20h (horário de Brasília) por um agendamento do
// EventBridge (ver template.yaml). Lê os mesmos dados do DynamoDB usados
// pelo dashboard, calcula o saldo real do mês (a mesma lógica de
// js/dashboard.js) e envia uma mensagem de template pelo WhatsApp Cloud
// API (Meta) avisando o saldo e se as despesas do dia já foram lançadas.
// ==========================================================

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";

const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client);
const ssm = new SSMClient({});

const TABLE_NAME = process.env.TABLE_NAME;
const WHATSAPP_TOKEN_PARAM = process.env.WHATSAPP_TOKEN_PARAM;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const RECIPIENT_NUMBER = process.env.RECIPIENT_NUMBER;
const TEMPLATE_NAME = process.env.TEMPLATE_NAME || "lembrete_financas_diario";

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

async function getWhatsAppToken() {
  const result = await ssm.send(
    new GetParameterCommand({ Name: WHATSAPP_TOKEN_PARAM, WithDecryption: true })
  );
  return result.Parameter.Value;
}

// ---------- Mesma lógica de datas/cálculo do js/dashboard.js ----------

function monthKey(dateStr) {
  if (!dateStr) return null;
  const s = String(dateStr).substring(0, 7);
  return /^\d{4}-\d{2}$/.test(s) ? s : null;
}

// Horário de Brasília é fixo em UTC-3 (sem horário de verão desde 2019).
function agoraBR() {
  return new Date(Date.now() - 3 * 60 * 60 * 1000);
}

function currentMonthKeyBR() {
  const now = agoraBR();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function todayKeyBR() {
  const now = agoraBR();
  return `${currentMonthKeyBR()}-${String(now.getUTCDate()).padStart(2, "0")}`;
}

function isRecorrente(r) {
  return r.recorrente === true || r.recorrente === "true" || r.recorrente === "on";
}

function tipoReceita(r) {
  return r.tipo === "beneficio" ? "beneficio" : "renda";
}

function isContaCorrente(item) {
  const fonte = (item.fonte || "").trim().toLowerCase();
  const dinheiro = ["", "conta corrente", "contacorrente", "débito", "debito", "cartão de crédito", "cartao de credito"];
  return dinheiro.includes(fonte);
}

function formatBRL(v) {
  return Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

async function calcularResumo() {
  const key = currentMonthKeyBR();
  const hoje = todayKeyBR();

  const [receitas, despesas, fixos, cartao] = await Promise.all([
    queryByType("RECEITAS"),
    queryByType("DESPESAS"),
    queryByType("FIXOS"),
    queryByType("CARTAO")
  ]);

  const receitasRendaMes = receitas
    .filter((r) => {
      const rMonth = monthKey(r.data);
      if (!rMonth || tipoReceita(r) !== "renda") return false;
      return isRecorrente(r) ? rMonth <= key : rMonth === key;
    })
    .reduce((s, r) => s + (Number(r.valor) || 0), 0);

  const despesasDiaADiaMes = despesas.filter((d) => monthKey(d.data) === key);
  const despesasDiaContaCorrenteMes = despesasDiaADiaMes
    .filter(isContaCorrente)
    .reduce((s, d) => s + (Number(d.valor) || 0), 0);

  const cartaoMes = cartao
    .filter((c) => {
      const cMonth = monthKey(c.data);
      if (!cMonth) return false;
      return isRecorrente(c) ? cMonth <= key : cMonth === key;
    })
    .reduce((s, c) => s + (Number(c.valor) || 0), 0);

  const fixosContaCorrenteMes = fixos
    .filter((f) => String(f.ativo) !== "false")
    .filter(isContaCorrente)
    .reduce((s, f) => s + (Number(f.valorMensal) || 0), 0);

  const despesasContaCorrenteMes = despesasDiaContaCorrenteMes + fixosContaCorrenteMes + cartaoMes;
  const saldo = receitasRendaMes - despesasContaCorrenteMes;

  const lancouHoje = despesas.some((d) => d.data === hoje) || cartao.some((c) => c.data === hoje);

  return { saldo, lancouHoje };
}

async function enviarWhatsApp(token, parametrosCorpo) {
  const url = `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to: RECIPIENT_NUMBER,
    type: "template",
    template: {
      name: TEMPLATE_NAME,
      language: { code: "pt_BR" },
      components: [
        {
          type: "body",
          parameters: parametrosCorpo.map((text) => ({ type: "text", text }))
        }
      ]
    }
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Erro ao enviar WhatsApp: ${JSON.stringify(json)}`);
  }
  return json;
}

export const handler = async () => {
  const { saldo, lancouHoje } = await calcularResumo();
  const token = await getWhatsAppToken();

  // A ordem dos parâmetros precisa bater com as variáveis {{1}} e {{2}} do
  // template aprovado no WhatsApp Manager (ver README para o texto exato).
  await enviarWhatsApp(token, [formatBRL(saldo), lancouHoje ? "Sim" : "Ainda não"]);

  return { ok: true };
};
