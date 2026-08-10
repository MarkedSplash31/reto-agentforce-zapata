const SANITIZE_RULES = {
    numeric:      (val) => val.replace(/\D/g, ''),
    alpha:        (val) => val.replace(/[^\p{L}\s]/gu, ''),
    alphanumeric: (val) => val.replace(/[^\p{L}0-9\s]/gu, ''),
    address:      (val) => val.replace(/[^\p{L}0-9\s#.,\-\/°]/gu, ''),
    email:        (val) => val.replace(/[^a-zA-Z0-9@._+-]/g, ''),
    comment:      (val) => val.replace(/[<>]/g, ''),
};

function applySanitization(input) {
    const rule = input.dataset.sanitize;
    const maxLength = input.dataset.maxlength;

    if (!rule || !SANITIZE_RULES[rule]) return;

    input.addEventListener('input', () => {
        let value = SANITIZE_RULES[rule](input.value);

        if (maxLength) {
            value = value.slice(0, parseInt(maxLength));
        }

        input.value = value;
    });
}

// Inicializar todos los inputs que tengan data-sanitize
document.querySelectorAll('[data-sanitize]').forEach(applySanitization);