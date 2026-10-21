# ENTERPRISER • DRIVE MAXX

Catálogo integrado à API v3 do Olist ERP, com login de acesso, autenticação OAuth na Olist, importação de produtos, estoque disponível, agrupamento de variações, filtros por coluna (Ctrl + clique no cabeçalho), gerenciador de colunas, seleção, exportação CSV e tema claro/escuro.

Localmente, defina `appUser` e `appPassword` em `config.local.json` para ativar o login; sem eles o acesso local fica liberado.

## Executar localmente

Requer Node.js 20 ou superior. Não há dependências externas.

1. Copie `config.example.json` para `config.local.json` e preencha suas credenciais.
2. Cadastre na Olist a URL de retorno correspondente ao ambiente utilizado.
3. Execute `npm start` e abra `http://localhost:3000`.

As credenciais também podem ser fornecidas por `OLIST_CLIENT_ID`, `OLIST_CLIENT_SECRET` e `OLIST_REDIRECT_URI`. A porta é configurável por `PORT`.

## Testes

Execute `npm test`. As chamadas à Olist nos testes são simuladas.

## Publicação na Vercel

O arquivo `vercel.json` encaminha `/auth/*`, `/api/*` e a página inicial para `api/index.mjs`. Os arquivos de interface ficam em `public`. O projeto deve usar a raiz do repositório e o preset Other.

Configure no projeto Vercel, ambiente Production:

- `OLIST_CLIENT_ID`: Client ID do aplicativo Olist.
- `OLIST_CLIENT_SECRET`: Client Secret, como variável secreta.
- `OLIST_REDIRECT_URI`: `https://app.drivemaxx.com.br/` (deve ser idêntica à URL cadastrada na Olist).
- `APP_USERNAME` e `APP_PASSWORD` (Sensitive): usuário e senha de acesso ao app. Sem elas, o app fica bloqueado.
- `SESSION_SECRET`: segredo aleatório de pelo menos 32 bytes, como variável secreta. Gere com `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

Após configurar as variáveis, faça um Redeploy. Acesse o domínio `app.drivemaxx.com.br` para autenticar. O endereço `drivemaxx.vercel.app` encaminha para esse domínio antes do login. O callback funciona tanto na raiz cadastrada quanto em `/auth/callback`.

Na Vercel, as sessões são cifradas com AES-256-GCM em cookies HttpOnly e Secure, permitindo o retorno OAuth e renovação dos tokens entre instâncias. Desconectar apaga os cookies deste navegador; não revoga tokens já emitidos pela Olist. Localmente, as sessões continuam em memória. As credenciais locais nunca são incluídas no deploy.

Veja `README.txt` para os detalhes da execução local.
