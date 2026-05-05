document.addEventListener('DOMContentLoaded', () => {
    const menus = document.querySelectorAll('.user-menu-container');

    menus.forEach((menu) => {
        const button = menu.querySelector('.user-menu-button');
        if (!button) return;

        button.addEventListener('click', (event) => {
            event.stopPropagation();

            const willOpen = !menu.classList.contains('is-open');
            menus.forEach((item) => {
                item.classList.remove('is-open');
                const itemButton = item.querySelector('.user-menu-button');
                if (itemButton) itemButton.setAttribute('aria-expanded', 'false');
            });

            menu.classList.toggle('is-open', willOpen);
            button.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
        });
    });

    document.addEventListener('click', (event) => {
        menus.forEach((menu) => {
            if (!menu.contains(event.target)) {
                menu.classList.remove('is-open');
                const button = menu.querySelector('.user-menu-button');
                if (button) button.setAttribute('aria-expanded', 'false');
            }
        });
    });

    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;

        menus.forEach((menu) => {
            menu.classList.remove('is-open');
            const button = menu.querySelector('.user-menu-button');
            if (button) button.setAttribute('aria-expanded', 'false');
        });
    });
});
