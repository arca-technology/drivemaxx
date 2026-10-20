ENTERPRISER • DRIVE MAXX — Produtos

Rodar localmente (Node.js 20 ou superior, sem dependências):
  npm start
  Abra http://localhost:3000

AUTENTICAR
1. No ERP Olist, vá em Configurações > Geral > Aplicativos > DRIVE MAXX.
2. Cadastre exatamente: http://localhost:3000/auth/callback
   A URL da imagem (https://app.drivemaxx.com.br/) não retorna a este servidor local.
3. Habilite a permissão de leitura de Produtos e salve.
4. No site local, clique em Autenticar com Olist, entre na conta e autorize.

CONFIGURAÇÃO
As credenciais fornecidas estão em config.local.json, somente no servidor.
O arquivo está no .gitignore e não é servido pelo site.
Você pode usar config.example.json para criar outra configuração.
Variáveis opcionais: OLIST_CLIENT_ID, OLIST_CLIENT_SECRET,
OLIST_REDIRECT_URI, PORT. Se mudar a porta, ajuste também redirectUri.
O servidor escuta apenas 127.0.0.1.

TESTE POR HTTPS (OPCIONAL)
O executável oficial Cloudflare Tunnel está em .local/tools/cloudflared.exe.
O túnel ainda NÃO está ativo. Sua ativação depende da autorização do usuário.
Com autorização, execute em outro terminal:
  .\.local\tools\cloudflared.exe tunnel --url http://127.0.0.1:3000 --no-autoupdate
O comando fornece uma URL HTTPS temporária. Cadastre essa URL acrescida de
/auth/callback no aplicativo Olist e no redirectUri de config.local.json.
Reinicie o servidor e acesse o endereço HTTPS. Nesse modo, localhost encaminha
para a URL HTTPS para preservar o cookie de autenticação no retorno da Olist.
O endereço é público, mas os produtos exigem uma sessão Olist autenticada.
O tráfego do site passa pela Cloudflare. A URL muda ao recriar um Quick Tunnel.

RECURSOS
Cabeçalho com nome ENTERPRISER • DRIVE MAXX, título PRODUTOS centralizado
e alternância claro/escuro persistida neste navegador.
Toolbar com busca por descrição, SKU, GTIN ou ID; filtro de situação;
atualização e exportação CSV do resultado filtrado completo.
Cabeçalho e primeira coluna (produto) fixos na área rolável.
Ordenação por produto, SKU, situação ou preço de venda.
O catálogo é consultado em lotes de até 100 produtos. Todas as páginas
são percorridas automaticamente. O rodapé informa o progresso.
A tabela mostra 50, 100 ou 200 produtos por página para manter a fluidez.
O CSV só fica disponível depois da carga completa.
Não há produtos de demonstração no uso normal.

SESSÃO
Tokens ficam apenas na memória do servidor; o navegador recebe cookie HttpOnly.
O token é renovado automaticamente. Ao reiniciar o servidor é necessário
autenticar novamente. Desconectar limpa a sessão local, sem encerrar o login no ERP.
As credenciais atuais são de aplicativo privado da conta Olist que o criou.

VALIDAÇÃO
  npm test
Os testes usam respostas simuladas da Olist, sem acessar sua conta.
A autenticação real precisa ser concluída pelo usuário.

Documentação oficial consultada:
https://api-docs.erp.olist.com/documentacao/comecando/autenticacao
https://api-docs.erp.olist.com/api-reference/produtos/listar-produtos
