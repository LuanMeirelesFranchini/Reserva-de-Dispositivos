const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

/**
 * BOT DE NAVEGAÇÃO (E2E) - PLAYWRIGHT
 * Versão: Teste de Fluxo Completo (Ajustado para Flatpickr)
 * --------------------------------
 * Correção: Campos 'readonly' do Flatpickr agora são preenchidos via JavaScript.
 */

const AUTH_PATH = path.join(__dirname, '../auth/session.json');

async function iniciarBot() {
    console.log("🤖 Bot: Verificando motores...");

    if (!fs.existsSync(path.join(__dirname, '../auth'))) {
        fs.mkdirSync(path.join(__dirname, '../auth'));
    }

    let storageState = fs.existsSync(AUTH_PATH) ? AUTH_PATH : undefined;
    
    const browser = await chromium.launch({ 
        headless: false, 
        slowMo: 1000 
    });

    const context = await browser.newContext({ storageState });
    const page = await context.newPage();

    try {
        await page.goto('http://localhost:3000/');

        // --- PASSO 1: Garantir Autenticação ---
        if (page.url().includes('/login')) {
            console.log("\n--- PASSO 1: Login Manual Necessário ---");
            console.log("👉 Por favor, faça o login manualmente.");
            await page.waitForURL('**/', { timeout: 120000 });
            await context.storageState({ path: AUTH_PATH });
            console.log("✅ Sessão salva!");
        } else {
            console.log("🚀 Sessão ativa detectada!");
        }

        // --- PASSO 2: Realizar uma Reserva de Teste ---
        console.log("\n--- PASSO 2: Testando Fluxo de Reserva ---");
        
        // 1. Seleciona o carrinho
        await page.selectOption('select[name="carrinho_id"]', { index: 1 });
        console.log("🛒 Carrinho selecionado.");

        // 2. Define a quantidade
        await page.fill('input[name="quantidade"]', '5');
        console.log("🔢 Quantidade preenchida: 5");

        // 3. Datas (Ajuste para campos Readonly/Flatpickr)
        const amanha = new Date();
        amanha.setDate(amanha.getDate() + 2);
        const dataFormatada = amanha.toISOString().slice(0, 16).replace('T', ' '); // YYYY-MM-DD HH:mm

        const depoisDeAmanha = new Date(amanha);
        depoisDeAmanha.setHours(depoisDeAmanha.getHours() + 2);
        const dataFimFormatada = depoisDeAmanha.toISOString().slice(0, 16).replace('T', ' ');

        console.log("📅 Inserindo datas via script (contornando readonly)...");
        
        // Usamos evaluate para forçar o valor nos inputs que o Flatpickr bloqueia
        await page.evaluate(({ inicio, fim }) => {
            const inputInicio = document.querySelector('input[name="data_retirada"]');
            const inputFim = document.querySelector('input[name="data_devolucao"]');
            
            // Removemos o readonly, inserimos o valor e avisamos o sistema que mudou
            inputInicio.removeAttribute('readonly');
            inputInicio.value = inicio;
            inputInicio.dispatchEvent(new Event('input', { bubbles: true }));
            inputInicio.dispatchEvent(new Event('change', { bubbles: true }));

            inputFim.removeAttribute('readonly');
            inputFim.value = fim;
            inputFim.dispatchEvent(new Event('input', { bubbles: true }));
            inputFim.dispatchEvent(new Event('change', { bubbles: true }));
        }, { inicio: dataFormatada, fim: dataFimFormatada });

        // 4. Bloco e Sala (Baseado no seu index.js que separa os dois)
        // Certifique-se de que os nomes dos selects no seu index.ejs são 'bloco' e 'sala'
        await page.selectOption('select[name="bloco"]', { index: 1 });
        console.log("🏢 Bloco selecionado.");

        // Aguarda um pouco para o script de salas carregar (se houver dependência)
        await page.waitForTimeout(500);
        await page.selectOption('select[name="sala"]', { index: 1 });
        console.log("📍 Sala selecionada.");

        await page.screenshot({ path: 'screenshots/antes-de-reservar.png' });
        
        // 5. Clica no botão de enviar
        console.log("🖱️ Clicando no botão de reservar...");
        await page.click('button[type="submit"]');

        // --- PASSO 3: Validar Sucesso ---
        console.log("\n--- PASSO 3: Validando Resultado ---");
        
        // Espera a mensagem de sucesso ou redirecionamento
        await page.waitForTimeout(3000); 
        const urlFinal = page.url();
        const conteudo = await page.content();
        
        if (urlFinal.includes('sucesso') || conteudo.includes('sucesso')) {
            console.log("✅ Reserva realizada com sucesso no sistema!");
        } else {
            console.error("❌ Falha na reserva. Verifique a screenshot 'screenshots/erro-fluxo.png'");
            await page.screenshot({ path: 'screenshots/erro-fluxo.png' });
        }

    } catch (error) {
        console.error("\n❌ Erro durante o teste de fluxo:", error.message);
        await page.screenshot({ path: 'screenshots/crash-error.png' });
    } finally {
        console.log("\n🏁 Bot: Processo finalizado.");
        await page.waitForTimeout(5000);
        await browser.close();
    }
}

// Pasta de capturas
if (!fs.existsSync('./screenshots')) fs.mkdirSync('./screenshots');

iniciarBot();