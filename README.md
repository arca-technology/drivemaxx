# ENTERPRISER • DRIVE MAXX

Catálogo integrado à API v3 do Olist ERP, com autenticação OAuth, busca, filtros, exportação CSV, tema claro/escuro e tabela com cabeçalho e primeira coluna fixos.

## Executar localmente

Requer Node.js 20 ou superior. Não há dependências externas.

1. Copie `config.example.json` para `config.local.json` e preencha suas credenciais.
2. Cadastre na Olist a URL de retorno correspondente ao ambiente utilizado.
3. Execute `npm start` e abra `http://localhost:3000`.

As credenciais também podem ser fornecidas por `OLIST_CLIENT_ID`, `OLIST_CLIENT_SECRET` e `OLIST_REDIRECT_URI`. A porta é configurável por `PORT`.

## Testes

Execute `npm test`. As chamadas à Olist nos testes são simuladas.

## Publicação na Vercel

Este repositório contém a versão local. O servidor HTTP e as sessões em memória ainda precisam ser adaptados para execução na Vercel antes de publicar a integração funcional. Configure as credenciais como variáveis de ambiente do projeto, nunca em arquivos públicos. A URL de retorno OAuth precisa corresponder exatamente ao endereço cadastrado na Olist.

Veja `README.txt` para os detalhes da execução local.
