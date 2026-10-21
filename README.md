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
- `SUPABASE_URL` e `SUPABASE_SECRET_KEY` (Sensitive): banco **enterpriser.bms**. Com elas, o app passa a usar a tabela de usuários (admin e comprador), guarda o catálogo em `olist_products`, a conexão Olist da empresa (cifrada) e os pedidos. A chave fica só no servidor.
- `APP_USERNAME` e `APP_PASSWORD` (Sensitive): login único usado apenas enquanto o Supabase não estiver configurado.
- `CRON_SECRET` (opcional): se definida, protege a renovação agendada do token Olist (`/api/cron/olist-refresh`, 03h e 15h UTC).
- `WEBHOOK_SECRET` (Sensitive): token do webhook de estoque da Olist. URL a cadastrar em Configurações → Webhooks → lançamentos de estoque: `https://app.drivemaxx.com.br/api/webhooks/estoque?token=<WEBHOOK_SECRET>`.
- `BLOB_READ_WRITE_TOKEN`: criada ao conectar um Vercel Blob privado ao projeto. Guarda o cache do catálogo e os avisos do webhook, compactados e cifrados.
- `SESSION_SECRET`: segredo aleatório de pelo menos 32 bytes, como variável secreta. Gere com `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

Após configurar as variáveis, faça um Redeploy. Acesse o domínio `app.drivemaxx.com.br` para autenticar. O endereço `drivemaxx.vercel.app` encaminha para esse domínio antes do login. O callback funciona tanto na raiz cadastrada quanto em `/auth/callback`.

Na Vercel, as sessões são cifradas com AES-256-GCM em cookies HttpOnly e Secure, permitindo o retorno OAuth e renovação dos tokens entre instâncias. Desconectar apaga os cookies deste navegador; não revoga tokens já emitidos pela Olist. Localmente, as sessões continuam em memória. As credenciais locais nunca são incluídas no deploy.

Veja `README.txt` para os detalhes da execução local.

## Módulos (com Supabase)

- **Produtos**: admin importa da Olist, define a margem por produto (ou a margem padrão em Configurações) e oculta produtos dos compradores. Compradores veem só produtos visíveis e ativos, com preço = custo (ou custo médio) + margem.
- **Sacola e pedidos**: o comprador seleciona produtos, informa as quantidades e salva. O pedido fica no app e é criado na Olist (contato buscado ou criado pelo CNPJ). Se a Olist recusar, o pedido fica com erro e o admin pode reenviar.
- **Usuários**: o admin cria compradores a partir do CNPJ do cliente (consulta pública CNPJá e CNPJ.ws), ativa, desativa e redefine senhas.
- Permissões necessárias no aplicativo Olist: Produtos, Estoque, Contatos e Pedidos.
