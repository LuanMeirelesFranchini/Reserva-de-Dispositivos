# Sistema de Reservas de Chromebooks

Sistema web para reserva e gestao de carrinhos de Chromebooks do Colegio La Salle. A aplicacao permite que professores consultem disponibilidade em tempo real, criem reservas, recebam confirmacao por e-mail e acompanhem seus agendamentos. A equipe operacional e administradores contam com painel de gestao, inventario, historico, dashboard e auditoria.

## Principais Funcionalidades

- Login institucional com Google OAuth 2.0.
- Controle de acesso por perfil: `professor`, `operacional` e `admin`.
- Reserva de carrinhos por quantidade, bloco, sala, data e horario.
- Validacao de disponibilidade considerando reservas ativas sobrepostas.
- Bloqueio de reservas no passado, com antecedencia minima de 24 horas e limite de 30 dias para usuarios nao administradores.
- Confirmacao por e-mail com anexo `.ics` e link para Google Calendar.
- Opcao de criar evento no Google Calendar do usuario.
- Painel administrativo para acompanhar reservas ativas.
- Conclusao e cancelamento de reservas com registro de auditoria.
- Inventario de carrinhos com capacidade total e itens indisponiveis.
- Dashboard com indicadores de uso.
- Exclusao logica de usuarios para preservar historico de reservas.

## Tecnologias

- Node.js
- Express 5
- EJS
- MySQL com `mysql2`
- Passport.js com estrategia Google OAuth 2.0
- Express Session com store MySQL proprio
- Nodemailer
- Pico CSS

## Estrutura do Projeto

```text
PROJETO DE RESERVAS/reserva_dispositivos/
  index.js                       # Entrada da aplicacao Express
  admin.js                       # Rotas administrativas
  reservas.js                    # Rotas de reservas e disponibilidade
  database.js                    # Adaptador MySQL usado pelo projeto
  setup.js                       # Criacao inicial das tabelas e dados base
  migrate.js                     # Atualizacoes incrementais do banco
  salas-data.js                  # Dados e utilitarios de salas
  config/
    mysql-session-store.js       # Store de sessoes em MySQL
    passport.js                  # Configuracao do Google OAuth
  helpers/
    app-helpers.js               # Helpers compartilhados por rotas
  middlewares/
    auth.js                      # Middlewares de autenticacao/autorizacao
  routes/
    admin.js                     # Proxy para rotas administrativas
    reservas.js                  # Proxy para rotas de reservas
  services/
    calendar-service.js          # Geracao de link Google Calendar e ICS
    email-service.js             # Envio de e-mails
    reservation-service.js       # Calculo otimizado de disponibilidade
  views/                         # Templates EJS
  public/                        # CSS, JS e imagens
  scripts/                       # Scripts auxiliares
```

## Requisitos

- Node.js instalado.
- MySQL em execucao.
- Credenciais OAuth 2.0 do Google.
- Conta SMTP ou senha de app para envio de e-mails.

## Configuracao

Entre na pasta da aplicacao:

```bash
cd "PROJETO DE RESERVAS/reserva_dispositivos"
```

Instale as dependencias:

```bash
npm install
```

Crie o arquivo `.env` com base em `.env.example`:

```bash
cp .env.example .env
```

Configure as variaveis principais:

```env
PORT=3000
NODE_ENV=development

DB_HOST=localhost
DB_PORT=3306
DB_USER=reserva_user
DB_PASSWORD=sua_senha
DB_NAME=reserva_dispositivos
DB_CONNECTION_LIMIT=10

SESSION_SECRET=troque_este_segredo
TOKEN_ENCRYPTION_KEY=chave_longa_para_tokens_google

GOOGLE_CLIENT_ID=seu_google_client_id
GOOGLE_CLIENT_SECRET=seu_google_client_secret
GOOGLE_CALENDAR_ENABLED=false
ALLOWED_DOMAINS=lasalle.org.br,prof.soulasalle.com.br

SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
EMAIL_USER=seu_email
EMAIL_PASS=sua_senha_de_app
EMAIL_FROM="Colegio La Salle <nao-responda@lasalle.org.br>"

INITIAL_ADMIN_EMAIL=admin@exemplo.com
INITIAL_ADMIN_PASSWORD=uma_senha_forte_com_12_ou_mais_caracteres
MANAGER_EMAIL=admin@exemplo.com
```

## Banco de Dados

Crie o banco e usuario no MySQL antes de executar o setup. Exemplo:

```sql
CREATE DATABASE reserva_dispositivos CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'reserva_user'@'localhost' IDENTIFIED BY 'sua_senha';
GRANT ALL PRIVILEGES ON reserva_dispositivos.* TO 'reserva_user'@'localhost';
FLUSH PRIVILEGES;
```

Execute o setup inicial:

```bash
npm run setup
```

Para aplicar atualizacoes estruturais em um banco existente:

```bash
npm run migrate
```

Observacao para Windows PowerShell: se `npm run ...` for bloqueado pela politica de execucao, use:

```powershell
npm.cmd run setup
npm.cmd run migrate
```

## Execucao

Ambiente local:

```bash
npm start
```

A aplicacao sobe em:

```text
http://localhost:3000
```

## Perfis de Usuario

- `professor`: cria reservas, visualiza as proprias reservas e cancela reservas ativas proprias.
- `operacional`: acessa gestao de reservas, historico e dashboard.
- `admin`: gerencia usuarios, inventario, auditoria e todas as areas administrativas.

## Regras de Reserva

- A data de retirada nao pode estar no passado.
- Professores precisam reservar com pelo menos 24 horas de antecedencia.
- Professores podem reservar no maximo com 30 dias de antecedencia.
- Administradores podem criar reservas sem esses bloqueios de prazo.
- A sala precisa existir no cadastro de salas.
- O sistema considera reservas ativas sobrepostas para calcular disponibilidade.
- A capacidade disponivel considera `capacidade - indisponiveis`.

## Usuarios e Exclusao

A exclusao de usuarios e logica, nao fisica. Isso evita erro de chave estrangeira no MySQL e preserva o historico de reservas.

Quando um administrador exclui um usuario:

- `ativo` passa para `0`.
- O usuario deixa de aparecer em `Gerir Utilizadores`.
- E-mail, senha e tokens Google sao removidos/descaracterizados.
- Reservas antigas e ativas continuam ligadas ao registro para historico, dashboard e auditoria.
- A acao `USUARIO_EXCLUIDO` e registrada em `audit_logs`.

## Google OAuth

Configure no Google Cloud Console:

- Tipo de app: Web application.
- Redirect URI local:

```text
http://localhost:3000/auth/google/callback
```

Em producao, cadastre tambem a URL publica:

```text
https://seu-dominio/auth/google/callback
```

Os dominios permitidos podem ser ajustados com `ALLOWED_DOMAINS`.

## E-mail e Calendario

O sistema usa Nodemailer para enviar confirmacoes. Cada reserva criada tenta enviar:

- E-mail de confirmacao.
- Anexo `.ics` para Outlook/Apple Calendar.
- Link de criacao no Google Calendar.

Se o usuario marcar a opcao de adicionar ao calendario e possuir `google_refresh_token`, o sistema tenta criar o evento diretamente no Google Calendar.

## Scripts Disponiveis

```bash
npm start           # Inicia o servidor
npm run setup       # Cria tabelas e dados iniciais
npm run migrate     # Aplica migracoes incrementais
```

## Observacoes de Manutencao

- Rode `npm run migrate` apos atualizar o codigo em ambientes existentes.
- Evite apagar registros diretamente no MySQL; use as telas administrativas para preservar auditoria.
- Verifique `audit_logs` para rastrear alteracoes sensiveis.
- Mantenha `.env` fora do Git.
- Antes de alteracoes grandes, faca backup do banco MySQL.

## Licenca e Uso

Projeto de uso interno do Colegio La Salle.

Desenvolvido por Luan Meireles Franchini / Michael Dantas Moreira.
