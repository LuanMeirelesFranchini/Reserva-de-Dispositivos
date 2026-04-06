// Aguarda que o documento HTML esteja totalmente carregado
document.addEventListener('DOMContentLoaded', () => {

    // Seleciona os elementos principais da interface
    const btnReservar = document.getElementById('btnReservar') || document.querySelector('button[type="submit"]');
    const disponibilidadeResultEl = document.getElementById('disponibilidade-resultado');

    // --- CONFIGURACAO BASE PARA O FLATPICKR (Calendario) ---
    const configBase = {
        enableTime: true,
        time_24hr: true,
        minuteIncrement: 30,
        locale: "pt",
        dateFormat: "Y-m-d H:i",
        minTime: "07:00",
        maxTime: "18:00",
        maxDate: new Date().fp_incr(30), // Permite reservas ate 30 dias no futuro
        onReady: function(selectedDates, dateStr, instance) {
            // Regra de negocio: minimo de 24 horas de antecedencia para reservas
            const minDateTime = new Date(Date.now() + 24 * 60 * 60 * 1000);
            instance._minDateTimeStrict = minDateTime;
            instance.set('minDate', minDateTime);
        }
    };

    // Inicializacao do calendario de retirada
    const fpRetirada = flatpickr("#retirada", {
        ...configBase,
        placeholder: "Data e hora de retirada",
        onChange: function(selectedDates, dateStr, instance) {
            const selectedDate = selectedDates[0];
            const strict = instance._minDateTimeStrict;

            // Ajusta o horario minimo se a data selecionada for exatamente o limite das 24h
            if (selectedDate && selectedDate.toDateString() === strict.toDateString()) {
                instance.set('minTime', strict.toTimeString().substring(0, 5));
            } else {
                instance.set('minTime', "07:00");
            }

            // Protecao contra datas invertidas
            if (selectedDate) {
                fpDevolucao.set('minDate', selectedDate);

                const dataDevValue = document.getElementById('devolucao').value;
                if (dataDevValue && new Date(dataDevValue) <= selectedDate) {
                    document.getElementById('devolucao').value = "";
                }
            }
            verificarDisponibilidade();
        }
    });

    // Inicializacao do calendario de devolucao
    const fpDevolucao = flatpickr("#devolucao", {
        ...configBase,
        placeholder: "Data e hora de devolucao",
        onChange: function() {
            verificarDisponibilidade();
        }
    });

    async function verificarDisponibilidade() {
        const carrinhoId = document.getElementById('carrinho').value;
        const dataRetirada = document.getElementById('retirada').value;
        const dataDevolucao = document.getElementById('devolucao').value;

        // Se faltarem dados, reinicia o estado visual
        if (!carrinhoId || !dataRetirada || !dataDevolucao) {
            disponibilidadeResultEl.textContent = '--';
            disponibilidadeResultEl.style.color = '';
            if (btnReservar) btnReservar.disabled = false;
            return;
        }

        const inicio = new Date(dataRetirada);
        const fim = new Date(dataDevolucao);

        // Validacao final de seguranca: a devolucao nunca pode ser antes da retirada
        if (fim <= inicio) {
            disponibilidadeResultEl.textContent = 'Erro: A devolucao deve ser apos a retirada.';
            disponibilidadeResultEl.style.color = '#d32f2f';
            if (btnReservar) btnReservar.disabled = true;
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

            const response = await fetch(`/api/availability?${params.toString()}`, {
                headers: { 'Accept': 'application/json' }
            });
            const contentType = response.headers.get('content-type') || '';

            if (!contentType.includes('application/json')) {
                throw new Error('Resposta inesperada do servidor.');
            }

            const data = await response.json();

            if (!response.ok || data.error) {
                disponibilidadeResultEl.textContent = data.error || 'Erro na consulta ao sistema.';
                disponibilidadeResultEl.style.color = '#d32f2f';
                if (btnReservar) btnReservar.disabled = true;
                return;
            }

            disponibilidadeResultEl.textContent = `${data.disponiveis} Chromebooks disponiveis`;

            if (data.disponiveis <= 0) {
                disponibilidadeResultEl.style.color = 'red';
                if (btnReservar) btnReservar.disabled = true;
            } else {
                disponibilidadeResultEl.style.color = 'green';
                if (btnReservar) btnReservar.disabled = false;
            }
        } catch (error) {
            disponibilidadeResultEl.textContent = 'Erro de ligacao.';
            disponibilidadeResultEl.style.color = '#d32f2f';
            if (btnReservar) btnReservar.disabled = true;
            console.error('Erro na chamada da API:', error);
        }
    }

    // Escuta mudancas na selecao do carrinho
    document.getElementById('carrinho').addEventListener('change', verificarDisponibilidade);
});
