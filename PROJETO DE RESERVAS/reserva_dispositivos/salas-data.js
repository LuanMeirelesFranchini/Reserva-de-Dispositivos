const SALAS_DATA = [
    { bloco: 'BLOCO A', nome: 'Sala 1' },
    { bloco: 'BLOCO A', nome: 'Sala 2' },
    { bloco: 'BLOCO A', nome: 'Sala 3' },
    { bloco: 'BLOCO A', nome: 'Sala 4' },
    { bloco: 'BLOCO A', nome: 'Sala 5' },
    { bloco: 'BLOCO A', nome: 'Sala 6' },
    { bloco: 'BLOCO A', nome: 'Sala 7' },
    { bloco: 'BLOCO A', nome: 'Sala 8' },
    { bloco: 'BLOCO A', nome: 'Sala 9' },
    { bloco: 'BLOCO A', nome: 'Sala 10' },
    { bloco: 'BLOCO A', nome: 'Sala 11' },
    { bloco: 'BLOCO A', nome: 'Sala 12' },
    { bloco: 'BLOCO A', nome: 'Sala 13' },
    { bloco: 'BLOCO A', nome: 'Sala 14' },
    { bloco: 'BLOCO A', nome: 'Sala 15' },
    { bloco: 'BLOCO A', nome: 'Sala 16' },
    { bloco: 'BLOCO A', nome: 'Sala 17' },
    { bloco: 'BLOCO A', nome: 'Sala 18' },
    { bloco: 'BLOCO A', nome: 'Sala 19' },
    { bloco: 'BLOCO A', nome: 'Sala 20' },
    { bloco: 'BLOCO A', nome: 'Sala 21' },
    { bloco: 'BLOCO A', nome: 'COORD ORIENTACAO ENSINO MEDIO' },
    { bloco: 'BLOCO A', nome: 'COORD ORIENTACAO ANOS FINAIS' },
    { bloco: 'BLOCO A', nome: 'SALA DOS PROFESSORES' },
    { bloco: 'BLOCO A', nome: 'DIRETORIA' },
    { bloco: 'BLOCO A', nome: 'SECRETARIA' },
    { bloco: 'BLOCO A', nome: 'UNILASALLE' },
    { bloco: 'BLOCO A', nome: 'LA SALLE STORE' },
    { bloco: 'BLOCO A', nome: 'RECEPCAO' },
    { bloco: 'BLOCO A', nome: 'QUADRA COBERTA' },
    { bloco: 'BLOCO A', nome: 'SALA MAKER' },
    { bloco: 'BLOCO A', nome: 'SALA CORPO E MOVIMENTO' },
    { bloco: 'BLOCO A', nome: 'SALA DE MUSICA' },
    { bloco: 'BLOCO A', nome: 'SALA DE JUDO' },
    { bloco: 'BLOCO A', nome: 'PATIO' },
    { bloco: 'BLOCO A', nome: 'BIBLIOTECA' },
    { bloco: 'BLOCO A', nome: 'CANTINA' },
    { bloco: 'BLOCO A', nome: 'LAB DE CIENCIAS' },
    { bloco: 'BLOCO A', nome: 'PASTORAL' },
    { bloco: 'BLOCO A', nome: 'SALA DE ATENDIMENTO' },
    { bloco: 'BLOCO A', nome: 'PORTARIA' },
    { bloco: 'BLOCO A', nome: 'CABINE DE SOM' },
    { bloco: 'BLOCO C', nome: 'RH' },
    { bloco: 'BLOCO C', nome: 'TECNOLOGIA' },
    { bloco: 'BLOCO C', nome: 'ASSISTENCIA SOCIAL' },
    { bloco: 'BLOCO C', nome: 'SUPERVISAO ADMINISTRATIVA' },
    { bloco: 'BLOCO C', nome: 'FOTOGRAFIA' },
    { bloco: 'BLOCO C', nome: 'ALMOXARIFADO' },
    { bloco: 'BLOCO C', nome: 'DEPOSITO TI' },
    { bloco: 'BLOCO C', nome: 'REPROGRAFIA' },
    { bloco: 'BLOCO C', nome: 'COWORKING' },
    { bloco: 'BLOCO C', nome: 'DEPOIS DA ESCOLA' },
    { bloco: 'BLOCO C', nome: 'COORD LING ESTRANGEIRA' },
    { bloco: 'BLOCO C', nome: 'PASTORAL' },
    { bloco: 'BLOCO C', nome: 'CAPELA' },
    { bloco: 'BLOCO C', nome: 'ZELADORIA' },
    { bloco: 'BLOCO C', nome: 'NUTRICAO' },
    { bloco: 'BLOCO C', nome: 'REFEITORIO' },
    { bloco: 'BLOCO C', nome: 'REFEITORIO ALUNOS' },
    { bloco: 'BLOCO C', nome: 'SALA DOS PROFESSORES' },
    { bloco: 'BLOCO C', nome: 'SALA DE REUNIAO' },
    { bloco: 'BLOCO C', nome: 'AEE 1' },
    { bloco: 'BLOCO C', nome: 'AEE 2' },
    { bloco: 'BLOCO C', nome: 'SALA INTEGRAL G1' },
    { bloco: 'BLOCO C', nome: 'SALA INTEGRAL G7' },
    { bloco: 'BLOCO C', nome: 'COZINHA' },
    { bloco: 'BLOCO C', nome: 'SALA DE ATENDIMENTO' },
    { bloco: 'BLOCO C', nome: 'SALA DE REFORCO 1' },
    { bloco: 'BLOCO C', nome: 'SALA DE REFORCO 2' },
    { bloco: 'BLOCO C', nome: 'SALA DE SONINHO 1' },
    { bloco: 'BLOCO C', nome: 'SALA DE SONINHO 2' },
    { bloco: 'BLOCO C', nome: 'RH ABEL' },
    { bloco: 'BLOCO C', nome: 'ARQUIVO RH' },
    { bloco: 'BLOCO E', nome: 'Sala 1' },
    { bloco: 'BLOCO E', nome: 'Sala 2' },
    { bloco: 'BLOCO E', nome: 'Sala 3' },
    { bloco: 'BLOCO E', nome: 'Sala 4' },
    { bloco: 'BLOCO E', nome: 'Sala 5' },
    { bloco: 'BLOCO E', nome: 'Sala 6' },
    { bloco: 'BLOCO E', nome: 'Sala 7' },
    { bloco: 'BLOCO E', nome: 'Sala 8' },
    { bloco: 'BLOCO E', nome: 'Sala 9' },
    { bloco: 'BLOCO E', nome: 'Sala 10' },
    { bloco: 'BLOCO E', nome: 'Sala 11' },
    { bloco: 'BLOCO E', nome: 'Sala 12' },
    { bloco: 'BLOCO E', nome: 'Sala 13' },
    { bloco: 'BLOCO E', nome: 'Sala 14' },
    { bloco: 'BLOCO E', nome: 'Sala 15' },
    { bloco: 'BLOCO E', nome: 'SALA MAKER' },
    { bloco: 'BLOCO E', nome: 'COORD ORIENTACAO EF - ANOS INICIAIS' },
    { bloco: 'BLOCO E', nome: 'COORD ORIENTACAO ANOS INICIAIS' },
    { bloco: 'BLOCO E', nome: 'SUPERVISAO PEDAGOGICA' },
    { bloco: 'BLOCO E', nome: 'FORMACAO PEDAGOGICA' },
    { bloco: 'BLOCO E', nome: 'SALA COORD DE TURNO' },
    { bloco: 'BLOCO E', nome: 'CPD' },
    { bloco: 'BLOCO E', nome: 'SALA INTEGRAL G?' },
    { bloco: 'BLOCO E', nome: 'SALA DE ADAPTACAO' },
    { bloco: 'ESPACOS', nome: 'JARDIM' },
    { bloco: 'ESPACOS', nome: 'BIBLIOTECA' },
    { bloco: 'ESPACOS', nome: 'MANUTENCAO' },
    { bloco: 'ESPACOS', nome: 'QUADRA ABERTA' }
];

const COLLATOR_PT_BR = new Intl.Collator('pt-BR', {
    numeric: true,
    sensitivity: 'base'
});

const PALAVRAS_MINUSCULAS = new Set(['', 'as', 'da', 'das', 'de', 'do', 'dos', '']);
const SIGLAS_MAIUSCULAS = new Set(['', 'CPD', 'EF', 'G1', 'G7', 'RH', 'TI']);

function capitalizarPalavra(palavra, indice) {
    const limpa = palavra.trim();
    if (!limpa) {
        return '';
    }

    const maiuscula = limpa.toUpperCase();
    if (SIGLAS_MAIUSCULAS.has(maiuscula) || /^[A-Z]\d+$/.test(maiuscula)) {
        return maiuscula;
    }

    const minuscula = limpa.toLowerCase();
    if (indice > 0 && PALAVRAS_MINUSCULAS.has(minuscula)) {
        return minuscula;
    }

    return minuscula.charAt(0).toUpperCase() + minuscula.slice(1);
}

function formatarLocal(label = '') {
    const texto = String(label).trim().replace(/\s+/g, ' ');
    if (!texto) {
        return '';
    }

    return texto
        .split(' ')
        .map((palavra, indice) => capitalizarPalavra(palavra, indice))
        .join(' ');
}

function ordenarNaturamente(lista, seletor = (item) => item) {
    return [...lista].sort((a, b) => COLLATOR_PT_BR.compare(seletor(a), seletor(b)));
}

function agruparSalasPorBloco(salas = SALAS_DATA) {
    return salas.reduce((acc, sala) => {
        if (!acc[sala.bloco]) {
            acc[sala.bloco] = [];
        }

        acc[sala.bloco].push(sala.nome);
        return acc;
    }, {});
}

function montarSalasParaView(salas = SALAS_DATA) {
    const agrupadas = agruparSalasPorBloco(salas);

    return ordenarNaturamente(
        Object.entries(agrupadas).map(([valor, nomes]) => ({
            valor,
            label: formatarLocal(valor),
            salas: ordenarNaturamente(
                nomes.map((nome) => ({
                    valor: nome,
                    label: formatarLocal(nome)
                })),
                (sala) => sala.label
            )
        })),
        (bloco) => bloco.label
    );
}

function initializeSalasTable(db) {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            db.run(`
                CREATE TABLE IF NOT EXISTS salas (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    bloco TEXT NOT NULL,
                    nome TEXT NOT NULL
                )
            `, (createErr) => {
                if (createErr) {
                    return reject(createErr);
                }

                db.run(`
                    CREATE UNIQUE INDEX IF NOT EXISTS idx_salas_bloco_nome
                    ON salas (bloco, nome)
                `, (indexErr) => {
                    if (indexErr) {
                        return reject(indexErr);
                    }

                    const stmt = db.prepare("INSERT OR IGNORE INTO salas (bloco, nome) VALUES (?, ?)", (prepareErr) => {
                        if (prepareErr) {
                            return reject(prepareErr);
                        }

                        let pending = SALAS_DATA.length;

                        if (pending === 0) {
                            stmt.finalize((finalizeErr) => finalizeErr ? reject(finalizeErr) : resolve());
                            return;
                        }

                        SALAS_DATA.forEach((sala) => {
                            stmt.run(sala.bloco, sala.nome, (runErr) => {
                                if (runErr) {
                                    return reject(runErr);
                                }

                                pending -= 1;
                                if (pending === 0) {
                                    stmt.finalize((finalizeErr) => finalizeErr ? reject(finalizeErr) : resolve());
                                }
                            });
                        });
                    });
                });
            });
        });
    });
}

module.exports = {
    SALAS_DATA,
    agruparSalasPorBloco,
    formatarLocal,
    montarSalasParaView,
    initializeSalasTable
};
