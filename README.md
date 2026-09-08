# Meu Financeiro

Site pessoal para organizar suas finanças: receitas (inclusive recorrentes, como salário), despesas (avulsas ou recorrentes, como aluguel), cartão de crédito, poupança com simulação, e um dashboard com insights. Os dados ficam salvos numa stack **AWS serverless** (API Gateway + Lambda + DynamoDB), e o site é hospedado gratuitamente no **GitHub Pages**.

---

## Como funciona

- O site é HTML/CSS/JS puro (sem build, sem servidor próprio).
- Ele se conecta a uma **API HTTP na AWS** (API Gateway → Lambda → DynamoDB), protegida por uma **API key**.
- A infraestrutura é definida como código em `aws/template.yaml` (AWS SAM) — você cria tudo com um único comando.

---

## Pré-requisitos

- Conta AWS ativa.
- [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) instalada e configurada (`aws configure`).
- [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html) instalada.
- Node.js instalado (para o `sam build` empacotar as dependências da Lambda).

---

## Passo 1 — Gerar a API key

No terminal, gere uma chave aleatória e guarde ela (você vai usar em dois lugares: no deploy e no `config.js`):

```bash
openssl rand -hex 24
```

---

## Passo 2 — Fazer o deploy da infraestrutura AWS

1. Entre na pasta `aws`:

```bash
cd financas-app/aws
```

2. Rode o build (baixa as dependências da Lambda e empacota):

```bash
sam build
```

3. Rode o deploy guiado (primeira vez):

```bash
sam deploy --guided
```

Durante o assistente, responda:
- **Stack Name**: `meu-financeiro` (ou o nome que preferir)
- **AWS Region**: a região mais próxima de você, ex: `sa-east-1` (São Paulo)
- **Parameter ApiKeyValue**: cole a chave gerada no Passo 1
- **Confirm changes before deploy**: `Y`
- **Allow SAM CLI IAM role creation**: `Y`
- **Save arguments to configuration file**: `Y` (assim da próxima vez basta rodar `sam deploy`)

4. Ao final, o terminal mostra os **Outputs**, algo como:

```
Outputs
-----------------------------------------------------------------
Key                 ApiUrl
Value               https://abc123xyz.execute-api.sa-east-1.amazonaws.com/data

Key                 TableName
Value               meu-financeiro
-----------------------------------------------------------------
```

Copie o valor de `ApiUrl`.

> Isso cria: uma tabela DynamoDB (`meu-financeiro`), uma função Lambda, e uma API Gateway HTTP API — tudo no modelo "pay per request" (você só paga pelo uso; para uso pessoal, deve ficar dentro do free tier da AWS).

---

## Passo 3 — Configurar o site

1. Abra o arquivo `js/config.js`.
2. Cole a URL da API e a API key geradas nos passos anteriores:

```js
const API_URL = "https://abc123xyz.execute-api.sa-east-1.amazonaws.com/data";
const API_KEY = "a_chave_que_voce_gerou_com_openssl";
```

3. Salve o arquivo.

> ⚠️ A API key fica visível no código-fonte do site (afinal, é um site estático rodando no navegador). Ela serve para afastar acesso casual/bots, não é uma proteção contra alguém que examine o código. Se quiser uma proteção mais forte, dá pra evoluir para Amazon Cognito depois.

---

## Passo 4 — Testar localmente (opcional, mas recomendado)

1. Abra um terminal na pasta `financas-app`.
2. Rode: `python3 -m http.server 8000`
3. Acesse `http://localhost:8000` no navegador.
4. Tente adicionar uma receita ou despesa. Se aparecer na tabela, está tudo certo. Você pode conferir os dados direto na AWS: Console AWS → DynamoDB → Tabelas → `meu-financeiro` → Explorar itens.

---

## Passo 5 — Publicar no GitHub Pages

1. Dentro da pasta `financas-app`, garanta que o `git` já está inicializado e conectado ao seu repositório (se você já configurou isso antes, pule para o commit).
2. Suba as mudanças:

```bash
git add .
git commit -m "Backend AWS"
git push
```

3. No GitHub, o site publicado em `https://SEU_USUARIO.github.io/NOME_DO_REPO/` já vai usar a nova API automaticamente.

---

## Passo 6 — Lembrete diário no WhatsApp (opcional)

Todo dia às 20h (horário de Brasília), uma Lambda separada (`aws/lambda/lembrete.mjs`) te manda uma mensagem fixa de WhatsApp lembrando de lançar as despesas do dia:

```
Boa noite! Você já lançou suas despesas de hoje? Não esqueça de revisar seu sistema de finanças.
```

Ela é disparada por um agendamento do EventBridge e envia a mensagem via [CallMeBot](https://www.callmebot.com), um serviço comunitário gratuito para automações pessoais — sem precisar de conta Meta Business/verificação de empresa (útil se sua conta Meta estiver restrita ou você não quiser lidar com aprovação de app). Essa mensagem é sempre a mesma, não consulta nada no DynamoDB.

> ⚠️ O CallMeBot é um serviço de terceiros, não-oficial, mantido por voluntários. É de graça e funciona bem para mandar mensagem só para o seu próprio número, mas pode ficar instável, ter fila de espera para novos usuários, ou mudar de regras sem aviso. Se algum dia ele parar de funcionar, dá pra voltar para a API oficial da Meta (guardamos a versão anterior no histórico do git) ou trocar por um lembrete via e-mail (Amazon SES).

### 6.1 — Ativar o CallMeBot no seu WhatsApp

1. Adicione o número do CallMeBot aos seus contatos: **+34 644 51 95 23**.
2. Pelo WhatsApp, mande para esse número a mensagem:
   ```
   I allow callmebot to send me messages
   ```
3. Em alguns minutos você recebe de volta uma mensagem com sua **apikey** (um número). Guarde ela.

Se não receber resposta, o serviço pode estar com fila cheia — tente de novo mais tarde (veja o aviso em [callmebot.com](https://www.callmebot.com/blog/free-api-whatsapp-messages/)).

### 6.2 — Fazer o deploy com os novos parâmetros

Como esse recurso adiciona parâmetros novos ao `template.yaml`, rode o deploy no modo guiado de novo (ele reaproveita as respostas anteriores como padrão, então é só apertar Enter nas que não mudaram):

```bash
cd aws
sam build
sam deploy --guided
```

Quando perguntar, informe:
- **WhatsAppRecipientNumber**: seu número (o mesmo que ativou o CallMeBot), formato internacional sem símbolos (ex: `5561999999999`)
- **CallMeBotApiKey**: a apikey que você recebeu no passo anterior

### 6.3 — Testar sem esperar o horário

```bash
aws lambda invoke --function-name $(aws cloudformation describe-stack-resources --stack-name meu-financeiro --logical-resource-id LembreteFunction --query "StackResources[0].PhysicalResourceId" --output text) /tmp/saida.json && cat /tmp/saida.json
```

Se der erro, o `cat /tmp/saida.json` mostra a resposta do CallMeBot — os erros mais comuns são apikey incorreta ou número que nunca mandou a mensagem de ativação do passo 6.1.

### Custo

Gratuito — sem limite de mensagens para o seu próprio número, sem cartão de crédito, sem cobrança da AWS além do já previsto (a Lambda roda 1x por dia, bem dentro do free tier).

---

## Passo 7 — Open Finance: importar transações do banco e do cartão (opcional)

O sistema pode puxar automaticamente as transações da sua conta corrente e do seu cartão de crédito, via [Pluggy](https://www.pluggy.ai) (uma iniciadora de Open Finance regulada pelo Banco Central), e lançar cada uma como Despesa ou Receita — com categoria adivinhada por palavra-chave (editável depois, igual qualquer lançamento manual).

Isso roda automaticamente 1x por dia (madrugada) e também sob demanda, pelo botão **🔄 Atualizar** na aba Despesas.

> ⚠️ A categorização automática é só uma sugestão por palavra-chave (não usa o categorizador pago da Pluggy) — revise e ajuste quando precisar. Compras no cartão só entram como despesa quando são a compra em si; o pagamento da fatura não vira lançamento novo (as compras que a compõem já foram lançadas individualmente).

### 7.1 — Conectar suas contas no Meu Pluggy

1. Crie uma conta gratuita em [meu.pluggy.ai](https://meu.pluggy.ai) e conecte sua conta bancária e seu cartão de crédito (login direto com o banco, via Open Finance). Isso é de graça e sem prazo de expiração, pra uso pessoal.

### 7.2 — Pegar as credenciais no Dashboard da Pluggy

1. Crie uma conta em [dashboard.pluggy.ai](https://dashboard.pluggy.ai).
2. Você já tem uma aplicação de desenvolvimento criada por padrão (ex: "Pluggy Demo App") — anote o **Client ID** e revele o **Client Secret**.
3. Clique no ícone de "play" (▷) dessa aplicação pra abrir o widget de conexão.
4. Na busca de instituição, procure por **"Meu Pluggy"** (não escolha seu banco direto — isso exigiria liberação de dados reais, que a aplicação de desenvolvimento não tem). Faça login com a conta que você criou no passo 7.1.
5. Autorize o acesso. Repita esse passo pra cada banco diferente que você tem conectado no Meu Pluggy (se conta e cartão forem do mesmo banco, geralmente vêm juntos numa conexão só).
6. Cada conexão feita aparece listada na aplicação, com um **itemId** (um código tipo `de7bbf5a-abf2-47e4-94b1-586b36758423`) — copie o itemId de cada uma.

### 7.3 — Fazer o deploy com os novos parâmetros

```bash
cd aws
sam build
sam deploy --guided
```

Quando perguntar, informe:
- **PluggyClientId**: o Client ID da sua aplicação no Dashboard da Pluggy
- **PluggyClientSecret**: o Client Secret da mesma aplicação
- **PluggyItemIds**: os itemId's das conexões do passo 7.2, separados por vírgula (ex: `de7bbf5a-abf2-47e4-94b1-586b36758423,a5c763cb-0952-457b-9936-630f79c5b016`)

### Custo

Gratuito pra uso pessoal, sem prazo de expiração (a Pluggy cobra só de quem usa a API pra atender clientes/produto comercial).

---

## Atualizando o backend depois

Sempre que você editar `aws/lambda/index.mjs` ou `aws/template.yaml`, rode de novo dentro da pasta `aws`:

```bash
sam build
sam deploy
```

(depois da primeira vez com `--guided`, não precisa mais do `--guided`, ele reaproveita as respostas salvas).

---

## Estrutura do projeto

```
financas-app/
├── index.html              # Página principal (todas as abas)
├── css/style.css           # Estilo visual
├── js/
│   ├── config.js           # URL e API key da sua API AWS — EDITAR AQUI
│   ├── api.js               # Comunicação com a API
│   ├── store.js             # Estado da aplicação + cache local
│   ├── ui.js                 # Funções utilitárias de interface
│   ├── dashboard.js          # Gráficos, insights e simulação de poupança
│   └── app.js                 # Lógica principal (navegação, formulários, tabelas)
└── aws/
    ├── template.yaml          # Infraestrutura como código (AWS SAM)
    └── lambda/
        ├── index.mjs           # Função Lambda da API (all/add/delete/update/setConfig/syncPluggy)
        ├── lembrete.mjs        # Função Lambda do lembrete diário no WhatsApp
        ├── pluggy.mjs          # Lógica compartilhada da sincronização com a Pluggy (Open Finance)
        ├── pluggy-sync.mjs     # Função Lambda da sincronização diária automática
        └── package.json        # Dependências da Lambda (AWS SDK v3)
```

## Modelo de dados (DynamoDB)

A tabela `meu-financeiro` usa single-table design:

- **Partition key (`pk`)**: o tipo do item — `RECEITAS`, `DESPESAS`, `FIXOS`, `CARTAO`, `POUPANCA`, `QUITACAO`, `CONFIG` ou `PLUGGY_SYNC` (controle interno de deduplicação da sincronização com a Pluggy — não aparece na tela).
- **Sort key (`sk`)**: o `id` do item (ou a chave de configuração, no caso de `CONFIG`).

Isso permite buscar todos os itens de um tipo com uma única `Query` (rápido e barato), em vez de varrer a tabela inteira.

## Funcionalidades

- **Receitas**: adicione e exclua entradas de dinheiro. Marque como "Recorrente" receitas fixas como salário — elas entram automaticamente no cálculo de todos os meses seguintes, sem precisar recadastrar. Receitas avulsas (freelance, etc.) contam só no mês da data informada.
- **Despesas**: registre qualquer gasto por categoria. Marque como "Recorrente" contas fixas (aluguel, internet, academia) — elas entram automaticamente todo mês, sem precisar recadastrar. Também aparecem aqui, automaticamente: assinaturas recorrentes cadastradas no Cartão de crédito e as parcelas em aberto da Quitação de parcelas antigas. Se você configurar o Open Finance (Passo 7), as transações do banco e do cartão também entram sozinhas, marcadas com a tag "🔄 Importado".
- **Cartão de crédito**: controle compras, parcelas e por qual cartão foram feitas. Inclui também a Quitação de parcelas antigas, pra organizar parcelamentos de compras passadas ainda não quitados.
- **Poupança**: registre depósitos e retiradas, veja o total guardado.
- **Simulação**: informe quanto quer guardar por mês e a rentabilidade esperada para projetar o valor futuro.
- **Dashboard**: KPIs do mês, gráfico de despesas por categoria, evolução de receitas x despesas nos últimos 6 meses, e insights automáticos sobre seus hábitos financeiros.

## Custos estimados

Para uso pessoal (algumas dezenas de lançamentos por mês), o custo deve ficar em centavos de dólar por mês ou dentro do free tier:
- **DynamoDB** (pay-per-request): cobra por requisição de leitura/escrita — uso pessoal fica bem abaixo de 1 milhão de requisições/mês (limite do free tier).
- **Lambda**: 1 milhão de execuções grátis por mês.
- **API Gateway (HTTP API)**: primeiros 12 meses com free tier; depois é por milhão de requisições.

Vale acompanhar o [Billing Dashboard](https://console.aws.amazon.com/billing/) da AWS de vez em quando.

## Notas sobre privacidade e segurança

Seus dados ficam na sua própria conta AWS, numa tabela DynamoDB que só sua Lambda acessa. A API é protegida por uma API key simples — suficiente para uso pessoal, mas lembre-se que ela fica visível no código do site. Não compartilhe o link do seu repositório junto com capturas de tela do `config.js`.
