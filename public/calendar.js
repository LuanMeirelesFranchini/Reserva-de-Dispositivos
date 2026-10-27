document.addEventListener('DOMContentLoaded', function() {
  const calendarEl = document.getElementById('calendar');

  if (!calendarEl) return; // Nao executa se nao estiver na home

  const carrinhosScript = document.getElementById('carrinhos-data');
  const carrinhos = carrinhosScript ? JSON.parse(carrinhosScript.textContent) : [];

  let currentBlockFilter = 'all';
  const filterSelect = document.getElementById('calendar-block-filter');
  
  if (filterSelect) {
      filterSelect.addEventListener('change', function(e) {
          currentBlockFilter = e.target.value;
          // Re-render colors
          calendar.render(); 
          // Note: calendar.render() might not re-trigger eventsSet se os eventos não mudarem no store, 
          // entao acionamos manualmente o colorDays:
          colorDays(calendar.getEvents());
      });
  }

  const calendar = new FullCalendar.Calendar(calendarEl, {
    initialView: 'dayGridMonth',
    locale: 'pt-br',
    height: 'auto', // Remove o tamanho fixo gigante e o scroll interno
    contentHeight: 'auto',
    headerToolbar: {
      left: 'prev,next today',
      center: 'title',
      right: ''
    },
    buttonIcons: false,
    buttonText: {
      prev: '❮',
      next: '❯',
      today: 'Hoje',
      month: 'Mês'
    },
    allDaySlot: false,
    slotMinTime: '07:00:00',
    slotMaxTime: '23:00:00',
    aspectRatio: 2.2, // Deixa as células do mês mais achatadas (menores verticalmente)
    events: '/api/reservas-eventos', // Nossa nova API
    
    eventsSet: function(events) {
        colorDays(events);
    },
    
    datesSet: function(info) {
        // Sincroniza o novo seletor de input type=month visivel
        const picker = document.getElementById('calendar-month-selector');
        if (picker) {
            const d = info.view.currentStart;
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            picker.value = `${yyyy}-${mm}`;
            
            // Adiciona evento de mudança caso ainda não tenha (é seguro adicionar várias vezes se usarmos função anônima? Melhor no init)
        }
    },
    
    dateClick: function(info) {
        showDayEventsModal(info.date);
    }
  });

  calendar.render();

  // Escuta o seletor visível de mês para navegar
  const monthSelector = document.getElementById('calendar-month-selector');
  if (monthSelector) {
      monthSelector.addEventListener('change', function(e) {
          if (e.target.value) calendar.gotoDate(e.target.value + '-01');
      });
  }

  function colorDays(events) {
    // Primeiro calculamos a capacidade total baseada no filtro atual
    let maxCapacity = 0;
    carrinhos.forEach(c => {
        if (currentBlockFilter === 'all' || c.localizacao.includes(currentBlockFilter)) {
            maxCapacity += c.capacidade;
        }
    });
    
    // Se nenhum carrinho bater com o filtro, evita divisao por zero
    if (maxCapacity === 0) maxCapacity = 1; 

    const cells = document.querySelectorAll('.fc-daygrid-day');
    cells.forEach(cell => {
        const dateStr = cell.getAttribute('data-date');
        if (!dateStr) return;
        
        const [yy, mm, dd] = dateStr.split('-');
        const targetYear = parseInt(yy, 10);
        const targetMonth = parseInt(mm, 10) - 1;
        const targetDay = parseInt(dd, 10);

        const dayEvents = events.filter(e => {
            const props = e.extendedProps;
            const loc = props.localizacao || '';
            // Aplica filtro de bloco
            if (currentBlockFilter !== 'all' && !loc.includes(currentBlockFilter)) {
                return false;
            }

            if (!e.start) return false;
            
            const targetMidnight = new Date(targetYear, targetMonth, targetDay, 0, 0, 0);
            const targetNextMidnight = new Date(targetYear, targetMonth, targetDay + 1, 0, 0, 0);
            
            const eStart = e.start;
            const eEnd = e.end || e.start;
            
            return eStart < targetNextMidnight && eEnd > targetMidnight;
        });

        // Somar a quantidade reservada
        let totalReservado = 0;
        dayEvents.forEach(e => {
            totalReservado += (e.extendedProps.quantidade || 0);
        });

        // Regra de cores pedida:
        // Verde = até 30% da capacidade reservada
        // Amarelo = 30% a 70% da capacidade reservada
        // Vermelho = > 70% da capacidade reservada
        const ocupacao = totalReservado / maxCapacity;
        
        let bgColor = '';
        if (totalReservado === 0) {
            bgColor = 'rgba(16, 185, 129, 0.3)'; // Verde
        } else if (ocupacao <= 0.3) {
            bgColor = 'rgba(16, 185, 129, 0.3)'; // Verde 
        } else if (ocupacao <= 0.7) {
            bgColor = 'rgba(245, 158, 11, 0.4)'; // Amarelo
        } else {
            bgColor = 'rgba(239, 68, 68, 0.4)'; // Vermelho
        }
        
        const frame = cell.querySelector('.fc-daygrid-day-frame');
        if (frame) {
            frame.style.backgroundColor = bgColor;
        }
    });
  }

  function showDayEventsModal(clickedDate) {
    const targetDay = clickedDate.getDate();
    const targetMonth = clickedDate.getMonth();
    const targetYear = clickedDate.getFullYear();

    // Formata a data para exibir no titulo
    const dateStr = clickedDate.toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    document.getElementById('calendar-modal-title').innerText = `Eventos em ${dateStr}`;
    
    const events = calendar.getEvents();
    
    // Filtra eventos que passam por este dia e atendem ao filtro de bloco!
    const dayEvents = events.filter(e => {
        const props = e.extendedProps;
        const loc = props.localizacao || '';
        // Aplica filtro de bloco
        if (currentBlockFilter !== 'all' && !loc.includes(currentBlockFilter)) {
            return false;
        }

        if (!e.start) return false;
        
        const targetMidnight = new Date(targetYear, targetMonth, targetDay, 0, 0, 0);
        const targetNextMidnight = new Date(targetYear, targetMonth, targetDay + 1, 0, 0, 0);
        
        const eStart = e.start;
        const eEnd = e.end || e.start;
        
        return eStart < targetNextMidnight && eEnd > targetMidnight;
    });

    const contentDiv = document.getElementById('calendar-modal-content');
    contentDiv.innerHTML = '';

    if (dayEvents.length === 0) {
        contentDiv.innerHTML = '<p>Não há eventos para este dia neste local.</p>';
    } else {
        dayEvents.forEach(e => {
            const props = e.extendedProps;
            const bgCor = e.backgroundColor || '#00bcd4';
            
            // Monta o card
            const card = document.createElement('article');
            card.style.margin = '0';
            card.style.padding = '1rem';
            card.style.border = '1px solid var(--pico-muted-border-color)';
            card.style.boxShadow = 'none';
            card.style.display = 'flex';
            card.style.flexDirection = 'column';
            card.style.gap = '0.5rem';

            // Titulo (seguro contra XSS via textContent)
            const titleContainer = document.createElement('div');
            titleContainer.style.display = 'flex';
            titleContainer.style.flexWrap = 'wrap';
            titleContainer.style.alignItems = 'center';
            titleContainer.style.gap = '0.5rem';

            const titleHeading = document.createElement('h4');
            titleHeading.style.margin = '0';
            titleHeading.style.fontSize = '1.1rem';
            titleHeading.style.color = 'var(--pico-h1-color)';
            titleHeading.textContent = e.title;
            titleContainer.appendChild(titleHeading);
            card.appendChild(titleContainer);

            // Horarios
            const timeDiv = document.createElement('div');
            timeDiv.style.fontSize = '0.85rem';
            timeDiv.style.color = 'var(--pico-muted-color)';
            const startStr = e.start ? e.start.toLocaleString('pt-BR') : '';
            const endStr = e.end ? e.end.toLocaleString('pt-BR') : '';
            timeDiv.textContent = `${startStr} até ${endStr}`;
            card.appendChild(timeDiv);

            // Badge de status ou tipo
            const badgeContainer = document.createElement('div');
            badgeContainer.style.marginTop = '0.5rem';

            const badgeSpan = document.createElement('span');
            badgeSpan.style.display = 'inline-block';
            badgeSpan.style.padding = '0.2rem 0.6rem';
            badgeSpan.style.borderRadius = '1rem';
            badgeSpan.style.fontSize = '0.75rem';
            badgeSpan.style.fontWeight = '600';
            badgeSpan.style.backgroundColor = `${bgCor}20`;
            badgeSpan.style.color = bgCor;
            badgeSpan.style.border = `1px solid ${bgCor}40`;
            badgeSpan.textContent = props.tipo === 'reserva' ? (props.status || 'Agendada') : 'Bloqueio de Manutenção';

            badgeContainer.appendChild(badgeSpan);
            card.appendChild(badgeContainer);

            contentDiv.appendChild(card);
        });
    }

    // Abre o modal
    document.getElementById('calendar-day-modal').showModal();
  }
});
