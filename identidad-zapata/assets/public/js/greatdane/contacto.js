document.addEventListener('input', (e) => {

    const input = e.target;

    if (input.dataset.validate === 'phone') {

        input.value = input.value
            .replace(/\D/g, '')
            .slice(0, 10);
    }

    if (input.dataset.validate === 'letters') {

        input.value = input.value.replace(
            /[^A-Za-zÁÉÍÓÚáéíóúÑñ\s]/g,
            ''
        );
    }

    if (input.dataset.validate === 'alphanumeric') {

        input.value = input.value.replace(
            /[^A-Za-zÁÉÍÓÚáéíóúÑñ0-9\s]/g,
            ''
        );
    }

});