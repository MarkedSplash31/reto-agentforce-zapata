   // Sanitizar entradas en tiempo real
    document.querySelectorAll('#telefono, #celular, #numero, #codigo').forEach(input => {
        input.addEventListener('input', () => {
            input.value = input.value.replace(/\D/g, '').slice(0, 10);
        });
    });

    document.querySelectorAll('#nombre, #poblacion, #motivo, #corregir, #correcto, #localidad, #documentos').forEach(input => {
        input.addEventListener('input', () => {
            input.value = input.value.replace(/[^A-Za-zÁÉÍÓÚáéíóúÑñ0-9\s]/g, '');
        });
    });

    document.querySelectorAll('#calle, #colonia').forEach(input => {
        input.addEventListener('input', () => {
            input.value = input.value.replace(/[^A-Za-zÁÉÍÓÚáéíóúÑñ0-9\s]/g, '');
        });
    });

    // (Opcional) Restringir caracteres especiales en email mientras se escribe (permite @, punto, guiones)
    document.getElementById('email').addEventListener('input', (e) => {
          e.target.value = e.target.value.replace(/[^a-zA-Z0-9@._-]/g, '');
    });