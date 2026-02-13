💻 Sistema de Reservas de Chromebooks - Colégio La Salle

Este é um sistema de gestão e reserva de equipamentos tecnológicos (Chromebooks) desenvolvido para otimizar a logística pedagógica do Colégio La Salle. O sistema permite que professores realizem agendamentos com base na disponibilidade em tempo real dos carrinhos institucionais.

🚀 Funcionalidades

👨‍🏫 Para Professores

Login Institucional: Autenticação segura via Google OAuth 2.0 (restrito ao domínio @prof.soulasalle.com.br).

Verificação em Tempo Real: Consulta automática de disponibilidade de Chromebooks no horário selecionado.

Minhas Reservas: Painel para visualizar agendamentos futuros e realizar cancelamentos.

Agenda Google: Integração opcional para adicionar a reserva automaticamente ao calendário do professor.

🛠️ Para a Equipa de TI / Operacional

Painel de Gestão: Visualização de todas as reservas ativas por ordem cronológica.

Filtro de Data: Localização rápida de reservas para um dia específico.

Gestão de Utilizadores: Controle de permissões (Professor, Operacional, Admin).

Histórico: Registo completo de todas as reservas já concluídas ou canceladas.

📋 Regras de Negócio

Para garantir a organização da equipa de TI, o sistema impõe as seguintes condições:

Antecedência Mínima: Reservas só podem ser feitas com no mínimo 24 horas de antecedência.

Capacidade dos Carrinhos: O sistema impede reservas que excedam a capacidade física do carrinho no horário escolhido.

Domínios Permitidos: Apenas e-mails institucionais configurados no Google Workspace do colégio têm acesso.

🛠️ Tecnologias Utilizadas

Backend: Node.js com Express

Base de Dados: SQLite (leve e sem necessidade de servidor externo)

Autenticação: Passport.js (Google OAuth 2.0)

Frontend: EJS (Templates dinâmicos)

Estilização: Pico CSS (Framework minimalista e responsivo)

Componentes: Flatpickr (Calendários e seleção de horas)

⚙️ Instalação e Configuração

1. Clonar o Repositório

git clone [https://github.com/teu-usuario/reserva-chromebooks.git](https://github.com/teu-usuario/reserva-chromebooks.git)
cd reserva-chromebooks


2. Instalar Dependências

npm install


3. Configurar Variáveis de Ambiente

Crie um ficheiro .env na raiz do projeto com as seguintes chaves:

GOOGLE_CLIENT_ID="teu_id_aqui"
GOOGLE_CLIENT_SECRET="tua_chave_secreta_aqui"
SESSION_SECRET="uma_frase_longa_e_aleatoria"
INITIAL_ADMIN_EMAIL="teu_email@prof.soulasalle.com.br"


4. Inicializar a Base de Dados

Execute o script de setup para criar as tabelas e os carrinhos padrão:

node setup.js


5. Iniciar o Sistema

# Para desenvolvimento
node index.js

# Para produção (recomendado)
pm2 start index.js --name "reserva-chromebooks"


📱 Responsividade

O sistema foi desenhado para ser totalmente responsivo, adaptando-se naturalmente a:

Monitores Desktop (Wide)

Notebooks

Tablets e Smartphones (Android/iOS)

📄 Licença

Este projeto é de uso exclusivo do Colégio La Salle. Todos os direitos reservados.

Desenvolvido por: Luan Meireles Franchini / Michael Dantas Moreira

Contacto: luanmeireles.31@gmail.com
