// Espera o documento HTML carregar completamente antes de executar o script.
document.addEventListener('DOMContentLoaded', () => {

    // --- CONFIGURAÇÃO DO FLATPCIKR ---
    // Criamos um objeto com as configurações que queremos para o nosso calendário.
    const configFlatpickr = {
        enableTime: true,           // Permite selecionar a hora
        dateFormat: "Y-m-d H:i",    // Formato que o backend espera (ex: 2025-06-23 16:30)
        time_24hr: true,            // Usa o formato de 24 horas
        locale: "pt",               // Aplica a tradução para português que carregamos no HTML
    };

    // Ativa o Flatpickr nos nossos dois campos de data, usando a configuração acima.
    // Ele encontra os campos pelos seus IDs.
    flatpickr("#retirada", configFlatpickr);
    flatpickr("#devolucao", configFlatpickr);
    // --- FIM DA CONFIGURAÇÃO DO FLATPCIKR ---


    // Pega os elementos do formulário que nos interessam para a verificação.
    const carrinhoSelect = document.getElementById('carrinho');
    const dataRetiradaInput = document.getElementById('retirada');
    const dataDevolucaoInput = document.getElementById('devolucao');
    const disponibilidadeResultEl = document.getElementById('disponibilidade-resultado');

    // A função para verificar a disponibilidade continua a mesma.
    async function verificarDisponibilidade() {
        const carrinhoId = carrinhoSelect.value;
        const dataRetirada = dataRetiradaInput.value;
        const dataDevolucao = dataDevolucaoInput.value;

        if (!carrinhoId || !dataRetirada || !dataDevolucao) {
            disponibilidadeResultEl.textContent = '--';
            return;
        }
        
        const inicio = new Date(dataRetirada);
        const fim = new Date(dataDevolucao);

        if (fim <= inicio) {
            disponibilidadeResultEl.textContent = 'Devolução deve ser após a retirada.';
            return;
        }

        disponibilidadeResultEl.textContent = 'Verificando...';

        try {
            const params = new URLSearchParams({
                carrinho_id: carrinhoId,
                data_retirada: dataRetirada,
                data_devolucao: dataDevolucao
            });
            const apiUrl = `/api/availability?${params.toString()}`;
            
            const response = await fetch(apiUrl);
            const data = await response.json();

            if (data.error) {
                disponibilidadeResultEl.textContent = 'Erro!';
                console.error('Erro retornado pela API:', data.error);
            } else {
                disponibilidadeResultEl.textContent = `${data.disponiveis} disponíveis`;
            }
        } catch (error) {
            disponibilidadeResultEl.textContent = 'Erro na consulta.';
            console.error('Erro ao chamar a API:', error);
        }
    }

    // --- EVENT LISTENERS (GATILHOS) - MODO CORRETO PARA FLATPCIKR ---
    
    // O seletor de carrinho continua com o evento 'change' padrão.
    carrinhoSelect.addEventListener('change', verificarDisponibilidade);

    // Para os campos com Flatpickr, precisamos usar o evento 'onChange' da própria biblioteca.
    // Acessamos a instância do flatpickr criada no elemento e adicionamos nossa função ao seu gatilho.
    document.getElementById('retirada')._flatpickr.config.onChange.push(verificarDisponibilidade);
    document.getElementById('devolucao')._flatpickr.config.onChange.push(verificarDisponibilidade);
});