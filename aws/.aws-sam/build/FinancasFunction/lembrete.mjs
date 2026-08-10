// ==========================================================
// LEMBRETE DIÁRIO NO WHATSAPP
// ----------------------------------------------------------
// Disparada todo dia às 20h (horário de Brasília) por um agendamento do
// EventBridge (ver template.yaml). Manda uma mensagem fixa de WhatsApp via
// CallMeBot (https://www.callmebot.com) lembrando de lançar as despesas do
// dia. Usamos o CallMeBot em vez da API oficial da Meta porque ele não
// exige conta Meta Business/verificação de empresa — é um serviço
// comunitário gratuito, pensado justamente para automações pessoais que
// mandam mensagem só para o próprio número.
//
// Essa mensagem não depende de nenhum dado do DynamoDB (não mostra mais
// saldo nem se você já lançou algo hoje) — é só um lembrete fixo.
// ==========================================================

const CALLMEBOT_PHONE = process.env.CALLMEBOT_PHONE;
const CALLMEBOT_APIKEY = process.env.CALLMEBOT_APIKEY;

const MENSAGEM =
  "Boa noite! Você já lançou suas despesas de hoje? Não esqueça de revisar seu sistema de finanças.";

// A API do CallMeBot é só um GET com o texto da mensagem — sem templates
// pré-aprovados, então montamos a frase final direto aqui.
async function enviarWhatsApp(texto) {
  const url =
    `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(CALLMEBOT_PHONE)}` +
    `&text=${encodeURIComponent(texto)}&apikey=${encodeURIComponent(CALLMEBOT_APIKEY)}`;

  const res = await fetch(url);
  const body = await res.text();
  // Loga sempre (sucesso ou falha) para dar pra ver a resposta real do
  // CallMeBot no CloudWatch Logs quando algo não bate.
  console.log("Resposta do CallMeBot:", res.status, body);
  // O CallMeBot responde 200 mesmo em alguns erros — checa o texto do corpo.
  if (!res.ok || /error|invalid|not.*found|not.*allowed/i.test(body)) {
    throw new Error(`Erro ao enviar WhatsApp via CallMeBot: ${body}`);
  }
  return body;
}

export const handler = async () => {
  const resposta = await enviarWhatsApp(MENSAGEM);
  return { ok: true, resposta };
};
