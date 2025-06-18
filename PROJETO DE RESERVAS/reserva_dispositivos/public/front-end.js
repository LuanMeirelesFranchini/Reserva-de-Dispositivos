// Espera o documento HTML carregar completamente
document.addEventListener('DOMContentLoaded', () => {

    // Pega os elementos do formulário que nos interessam
    const carrinhoSelect = document.getElementById('carrinho');
    const dataRetiradaInput = document.getElementById('retirada');
    const dataDevolucaoInput = document.getElementById('devolucao');
    const disponibilidadeResultEl = document.getElementById('disponibilidade-resultado');

    // Função que será chamada sempre que um dos campos mudar
    async function verificarDisponibilidade() {
        // Pega os valores atuais dos campos
        const carrinhoId = carrinhoSelect.value;
        const dataRetirada = dataRetiradaInput.value;
        const dataDevolucao = dataDevolucaoInput.value;

        // Se algum campo essencial não estiver preenchido, não faz nada
        if (!carrinhoId || !dataRetirada || !dataDevolucao) {
            disponibilidadeResultEl.textContent = '--';
            return;
        }

        // Mostra uma mensagem de "verificando..."
        disponibilidadeResultEl.textContent = 'Verificando...';

        try {
            // Monta a URL da nossa API com os parâmetros
            const apiUrl = `/api/availability?carrinho_id=<span class="math-inline">\{carrinhoId\}&data\_retirada\=</span>{dataRetirada}&data_devolucao=${dataDevolucao}`;

            // Faz a chamada para a API usando fetch
            const response = await fetch(apiUrl);
            const data = await response.json();

            if (data.error) {
                disponibilidadeResultEl.textContent = 'Não possuimos chromes disponiveis nesse horario';
                console.error(data.error);
            } else {
                // Atualiza o elemento na tela com a resposta da API
                disponibilidadeResultEl.textContent = `${data.disponiveis} disponíveis`;
            }
        } catch (error) {
            disponibilidadeResultEl.textContent = 'Erro na consulta.';
            console.error('Erro ao chamar a API:', error);
        }
    }

    // Adiciona o "espião" para cada um dos campos
    carrinhoSelect.addEventListener('change', verificarDisponibilidade);
    dataRetiradaInput.addEventListener('change', verificarDisponibilidade);
    dataDevolucaoInput.addEventListener('change', verificarDisponibilidade);
});