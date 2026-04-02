// Aguarda que o documento HTML esteja totalmente carregado
document.addEventListener('DOMContentLoaded', () => {

    // Seleciona os elementos principais da interface
    const btnReservar = document.getElementById('btnReservar') || document.querySelector('button[type="submit"]');
    const disponibilidadeResultEl = document.getElementById('disponibilidade-resultado');

    // --- CONFIGURAÇÃO BASE PARA O FLATPICKR (Calendário) ---
    const configBase = {
        enableTime: true,
        time_24hr: true,
        minuteIncrement: 30,
        locale: "pt",
        dateFormat: "Y-m-d H:i",
        minTime: "07:00",
        maxTime: "18:00",
        maxDate: new Date().fp_incr(30), // Permite reservas até 30 dias no futuro
        onReady: function(selectedDates, dateStr, instance) {
            // Regra de Negócio: Mínimo de 24 horas de antecedência para reservas
            const minDateTime = new Date(Date.now() + 24 * 60 * 60 * 1000);
            instance._minDateTimeStrict = minDateTime;
            instance.set('minDate', minDateTime);
        }
    };

    // Inicialização do Calendário de Retirada
    const fpRetirada = flatpickr("#retirada", {
        ...configBase,
        placeholder: "Data e hora de retirada",
        onChange: function(selectedDates, dateStr, instance) {
            const selectedDate = selectedDates[0];
            const strict = instance._minDateTimeStrict;

            // Ajusta o horário mínimo se a data selecionada for exatamente o limite das 24h
            if (selectedDate && selectedDate.toDateString() === strict.toDateString()) {
                instance.set('minTime', strict.toTimeString().substring(0, 5));
            } else {
                instance.set('minTime', "07:00");
            }

            // --- PROTEÇÃO CONTRA DATAS INVERTIDAS ---
            if (selectedDate) {
                // Bloqueia no calendário de devolução qualquer data anterior à retirada
                fpDevolucao.set('minDate', selectedDate);
                
                // Se a devolução já estava preenchida e agora ficou inválida, limpa o campo
                const dataDevValue = document.getElementById('devolucao').value;
                if (dataDevValue && new Date(dataDevValue) <= selectedDate) {
                    document.getElementById('devolucao').value = "";
                }
            }
            verificarDisponibilidade();
        }
    });

    // Inicialização do Calendário de Devolução
    const fpDevolucao = flatpickr("#devolucao", {
        ...configBase,
        placeholder: "Data e hora de devolução",
        onChange: function() {
            verificarDisponibilidade();
        }
    });

    /**
     * Função que comunica com a API para verificar se existem Chromebooks 
     * suficientes no intervalo de tempo selecionado.
     */
    async function verificarDisponibilidade() {
        const carrinhoId = document.getElementById('carrinho').value;
        const dataRetirada = document.getElementById('retirada').value;
        const dataDevolucao = document.getElementById('devolucao').value;

        // Se faltarem dados, reinicia o estado visual
        if (!carrinhoId || !dataRetirada || !dataDevolucao) {
            disponibilidadeResultEl.textContent = '--';
            if (btnReservar) btnReservar.disabled = false;
            return;
        }
        
        const inicio = new Date(dataRetirada);
        const fim = new Date(dataDevolucao);

        // Validação final de segurança: A devolução nunca pode ser antes da retirada
        if (fim <= inicio) {
            disponibilidadeResultEl.textContent = 'Erro: A devolução deve ser após a retirada.';
            disponibilidadeResultEl.style.color = '#d32f2f';
            if (btnReservar) btnReservar.disabled = true; // Trava o envio do formulário
            return;
        } else {
            disponibilidadeResultEl.style.color = '';
            if (btnReservar) btnReservar.disabled = false;
        }

        disponibilidadeResultEl.textContent = 'A verificar disponibilidade...';

        try {
            const params = new URLSearchParams({
                carrinho_id: carrinhoId,
                data_retirada: dataRetirada,
                data_devolucao: dataDevolucao
            });
            
            const response = await fetch(`/api/availability?${params.toString()}`);
            const data = await response.json();

            if (data.error) {
                disponibilidadeResultEl.textContent = 'Erro na consulta ao sistema.';
                if (btnReservar) btnReservar.disabled = true;
            } else {
                disponibilidadeResultEl.textContent = `${data.disponiveis} Chromebooks disponíveis`;
                
                // Se a quantidade for 0 ou negativa, impede a reserva
                if (data.disponiveis <= 0) {
                    disponibilidadeResultEl.style.color = 'red';
                    if (btnReservar) btnReservar.disabled = true;
                } else {
                    disponibilidadeResultEl.style.color = 'green';
                    if (btnReservar) btnReservar.disabled = false;
                }
            }
        } catch (error) {
            disponibilidadeResultEl.textContent = 'Erro de ligação.';
            console.error('Erro na chamada da API:', error);
        }
    }

    // Escuta mudanças na seleção do carrinho
    document.getElementById('carrinho').addEventListener('change', verificarDisponibilidade);
});