# Meu Financeiro

Site pessoal para organizar suas finanças: receitas, despesas do dia a dia, gastos fixos (boleto), cartão de crédito, poupança com simulação, e um dashboard com insights. Os dados ficam salvos numa planilha do **Google Sheets**, e o site é hospedado gratuitamente no **GitHub Pages**.

---

## Como funciona

- O site é HTML/CSS/JS puro (sem build, sem servidor próprio).
- Ele se conecta a um **Google Apps Script** publicado como "App da Web", que lê e escreve numa planilha do Google Sheets.
- Assim seus dados ficam guardados na sua conta do Google, e o site pode ser hospedado de graça no GitHub Pages.

---

## Passo 1 — Criar a planilha e o Apps Script

1. Acesse [sheets.google.com](https://sheets.google.com) e crie uma planilha nova. Dê o nome que quiser, ex: "Meu Financeiro - Dados".
2. No menu, vá em **Extensões > Apps Script**.
3. Apague todo o código de exemplo (`function myFunction() {...}`) que aparece no editor.
4. Abra o arquivo `apps-script/Code.gs` (nesta pasta do projeto), copie todo o conteúdo e cole no editor do Apps Script.
5. Clique no ícone de salvar (💾) e dê um nome ao projeto, ex: "Meu Financeiro API".
6. Clique em **Implantar** (Deploy) → **Nova implantação**.
   - Clique no ícone de engrenagem ao lado de "Selecionar tipo" e escolha **App da Web**.
   - Em "Executar como": deixe **Eu (seu e-mail)**.
   - Em "Quem pode acessar": escolha **Qualquer pessoa**.
   - Clique em **Implantar**.
7. O Google vai pedir para autorizar o script — clique em **Autorizar acesso**, escolha sua conta, e se aparecer um aviso de "app não verificado", clique em **Avançado** → **Acessar Meu Financeiro API (não seguro)**. Isso é normal para scripts pessoais criados por você mesmo.
8. Copie a **URL do app da Web** (termina em `/exec`). Você vai usar essa URL no próximo passo.

> Sempre que você alterar o código do `Code.gs`, precisa ir em **Implantar > Gerenciar implantações**, editar a implantação existente e criar uma **nova versão** para as mudanças valerem.

---

## Passo 2 — Configurar o site

1. Abra o arquivo `js/config.js`.
2. Substitua `COLE_AQUI_A_URL_DO_SEU_APPS_SCRIPT` pela URL copiada no passo anterior, entre aspas. Exemplo:

```js
const API_URL = "https://script.google.com/macros/s/AKfycb.../exec";
```

3. Salve o arquivo.

---

## Passo 3 — Testar localmente (opcional, mas recomendado)

Antes de publicar, você pode testar o site no seu computador:

1. Abra um terminal na pasta `financas-app`.
2. Rode: `python3 -m http.server 8000`
3. Acesse `http://localhost:8000` no navegador.
4. Tente adicionar uma receita ou despesa. Se aparecer na tabela e você ver a linha aparecer na sua planilha do Google Sheets, está tudo certo!

---

## Passo 4 — Publicar no GitHub Pages

1. Crie uma conta no [GitHub](https://github.com) caso ainda não tenha.
2. Crie um repositório novo (pode ser público), ex: `meu-financeiro`.
3. No seu computador, dentro da pasta `financas-app`, rode os comandos abaixo (substituindo pela URL do seu repositório):

```bash
git init
git add .
git commit -m "Primeira versão do Meu Financeiro"
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/meu-financeiro.git
git push -u origin main
```

4. No GitHub, entre no repositório → **Settings** → **Pages** (menu lateral).
5. Em "Build and deployment" → "Source", escolha **Deploy from a branch**.
6. Em "Branch", escolha `main` e a pasta `/ (root)`. Clique em **Save**.
7. Aguarde 1-2 minutos. O GitHub vai mostrar o link do seu site, algo como:
   `https://SEU_USUARIO.github.io/meu-financeiro/`

Pronto! Seu site estará no ar. Qualquer atualização futura, basta editar os arquivos e rodar:

```bash
git add .
git commit -m "Atualização"
git push
```

---

## Estrutura do projeto

```
financas-app/
├── index.html              # Página principal (todas as abas)
├── css/style.css           # Estilo visual
├── js/
│   ├── config.js           # URL da sua API (Apps Script) — EDITAR AQUI
│   ├── api.js               # Comunicação com o Apps Script
│   ├── store.js             # Estado da aplicação + cache local
│   ├── ui.js                 # Funções utilitárias de interface
│   ├── dashboard.js          # Gráficos, insights e simulação de poupança
│   └── app.js                 # Lógica principal (navegação, formulários, tabelas)
└── apps-script/
    └── Code.gs               # Backend (cole no Google Apps Script)
```

## Funcionalidades

- **Receitas**: adicione e exclua entradas de dinheiro (salário, freelance, etc).
- **Despesas do dia a dia**: registre gastos variáveis por categoria.
- **Gastos fixos (boleto)**: cadastre contas recorrentes com valor mensal e dia de vencimento.
- **Cartão de crédito**: controle compras, parcelas e por qual cartão foram feitas.
- **Poupança**: registre depósitos e retiradas, veja o total guardado.
- **Simulação**: informe quanto quer guardar por mês e a rentabilidade esperada para projetar o valor futuro.
- **Dashboard**: KPIs do mês, gráfico de despesas por categoria, evolução de receitas x despesas nos últimos 6 meses, e insights automáticos sobre seus hábitos financeiros.

## Notas sobre privacidade

Seus dados ficam apenas na sua planilha do Google Sheets — nenhum dado passa por servidores de terceiros além do próprio Google. Como o "App da Web" fica com acesso "Qualquer pessoa", evite compartilhar a URL do Apps Script publicamente, pois quem tiver o link poderá ler/gravar na planilha.
