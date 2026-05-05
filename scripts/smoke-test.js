/**
 * BOT DE TESTE DE INFRAESTRUTURA (SMOKE TEST) - VERSÃO 2.0
 * Verifica se as rotas principais do sistema estão respondendo e se a segurança está ativa.
 * Necessita que o servidor esteja rodando.
 * Uso: node scripts/smoke-test.js
 */

const http = require('http');

const routes = [
    { name: 'Página de Login', path: '/login', expected: 'public' },
    { name: 'Dashboard Admin', path: '/admin/dashboard', expected: 'protected' },
    { name: 'Inventário', path: '/admin/inventario', expected: 'protected' }
];

async function checkRoute(route) {
    return new Promise((resolve) => {
        http.get(`http://localhost:3000${route.path}`, (res) => {
            const status = res.statusCode;
            let result = '';

            if (route.expected === 'public' && status === 200) {
                result = `✅ ${route.name}: Acessível (OK)`;
            } else if (route.expected === 'protected' && status === 403) {
                result = `🛡️ ${route.name}: Protegida corretamente (OK)`;
            } else if (status === 302) {
                result = `🔄 ${route.name}: Redirecionado (Login necessário)`;
            } else if (status === 500) {
                result = `🔥 ${route.name}: Erro Interno do Servidor (CRÍTICO)`;
            } else {
                result = `❓ ${route.name}: Status inesperado (${status})`;
            }

            console.log(result);
            resolve(true);
        }).on('error', (e) => {
            console.log(`❌ ${route.name}: Servidor offline (${e.message})`);
            resolve(false);
        });
    });
}

async function runTests() {
    console.log("\n🤖 Bot: Iniciando verificação de integridade e segurança...\n");
    
    for (const route of routes) {
        await checkRoute(route);
    }
    
    console.log("\n🏁 Bot: Testes finalizados.");
    console.log("Nota: Status 403/302 em rotas Admin é o comportamento esperado para bots não logados.\n");
}

runTests();