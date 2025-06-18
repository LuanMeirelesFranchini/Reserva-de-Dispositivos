const sqlite3 = require('sqlite3').verbose();

// Abre a conexão com o banco de dados
const db = new sqlite3.Database('./reservas.db', (err) => {
    if (err) {
        return console.error("Erro ao conectar ao banco:", err.message);
    }
    console.log('Conectado ao banco de dados de reservas.');
});

db.serialize(() => {
    // Passo 1: Criar a tabela 'carrinhos'
    db.run(`
        CREATE TABLE IF NOT EXISTS carrinhos (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          nome TEXT NOT NULL,
          localizacao TEXT NOT NULL,
          capacidade INTEGER NOT NULL
        )
    `, (err) => {
        if (err) return console.error("Erro ao criar tabela carrinhos:", err.message);
        console.log("Tabela 'carrinhos' criada com sucesso.");

        // Passo 2: Inserir os dados na tabela 'carrinhos'
        // Este passo só começa DEPOIS que a tabela carrinhos foi criada com sucesso.
        const carrinhos = [
            { nome: 'Carrinho 1', localizacao: 'Bloco A - 1º Andar', capacidade: 35 },
            { nome: 'Carrinho 2', localizacao: 'Bloco A - 2º Andar', capacidade: 35 },
            { nome: 'Carrinho 3', localizacao: 'Bloco A - 3º Andar', capacidade: 34 },
            { nome: 'Carrinho 4', localizacao: 'Corredor Bloco C', capacidade: 35 },
            { nome: 'Carrinho 5', localizacao: 'Sala Maker Bloco E', capacidade: 35 }
        ];

        const stmt = db.prepare("INSERT INTO carrinhos (nome, localizacao, capacidade) VALUES (?, ?, ?)");
        carrinhos.forEach(c => stmt.run(c.nome, c.localizacao, c.capacidade));
        
        stmt.finalize((err) => {
            if (err) return console.error("Erro ao inserir carrinhos:", err.message);
            console.log("Todos os carrinhos foram inseridos com sucesso.");

            // Passo 3: Criar a tabela 'reservas'
            // Este passo só começa DEPOIS que a inserção dos carrinhos terminou.
            db.run(`
                CREATE TABLE IF NOT EXISTS reservas (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  nome_professor TEXT NOT NULL,
                  quantidade INTEGER NOT NULL,
                  data_retirada TEXT NOT NULL,
                  data_devolucao TEXT NOT NULL,
                  sala TEXT NOT NULL,
                  status TEXT NOT NULL,
                  carrinho_id INTEGER NOT NULL, 
                  FOREIGN KEY (carrinho_id) REFERENCES carrinhos (id)
                )
            `, (err) => {
                if (err) return console.error("Erro ao criar tabela reservas:", err.message);
                console.log("Tabela 'reservas' atualizada com sucesso.");

                // Passo 4 (FINAL): Fechar o banco de dados
                // Este é o último lugar, garantindo que tudo terminou.
                db.close((err) => {
                    if (err) return console.error("Erro ao fechar o banco:", err.message);
                    console.log('Conexão com o banco de dados fechada com sucesso.');
                });
            });
        });
    });
});