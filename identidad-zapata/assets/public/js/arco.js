function handleCheckboxChange(checkbox) {
    
    const nextFileInput = checkbox.closest('label').nextElementSibling;

    if (nextFileInput && nextFileInput.type === "file") {
        nextFileInput.style.display = checkbox.checked ? 'block' : 'none';
        if (!checkbox.checked) nextFileInput.value = '';
    }

    // Mostrar u ocultar campo "Otro"
    if (checkbox.value === 'Otro') {
        const otroInput = document.getElementById('otroInputContainer');
        if (otroInput) {
            otroInput.style.display = checkbox.checked ? 'block' : 'none';
            if (!checkbox.checked) {
                const input = otroInput.querySelector('input');
                if (input) input.value = '';
            }
        }
    }
}

// Validar el formulario al enviar
document.addEventListener('DOMContentLoaded', function () {
    const form = document.querySelector('form');

    form.addEventListener('submit', function (event) {
        const checkboxes = document.querySelectorAll('.custom-checkbox');
        let atLeastOneChecked = false;
        let missingFiles = [];
        let otroChecked = false;
        let otroInputValue = '';

        checkboxes.forEach(checkbox => {
            if (checkbox.checked) {
                atLeastOneChecked = true;

                // Verifica si falta archivo
                const fileInput = checkbox.closest('label').nextElementSibling;
                    if (fileInput && fileInput.type === 'file') {
                        if (!fileInput.files.length) {
                            missingFiles.push(checkbox.value);
                        }
                    }

                    // Verifica si seleccionaron "Otro"
                    if (checkbox.value === 'Otro') {
                        otroChecked = true;
                        const otroInput = document.getElementById('otroInputContainer').querySelector('input');
                        otroInputValue = otroInput ? otroInput.value.trim() : '';
                    }
                }
            });

            // Mostrar errores y evitar envío si hay problemas
            if (!atLeastOneChecked) {
                alert('Debes seleccionar al menos un tipo de documento.');
                event.preventDefault();
                return;
            }

            if (missingFiles.length > 0) {
                alert('Faltan archivos para: ' + missingFiles.join(', '));
                event.preventDefault();
                return;
            }

            if (otroChecked && otroInputValue === '') {
                alert('Debes especificar el tipo de documento si seleccionaste "Otro".');
                event.preventDefault();
                return;
            }
        });

        // Inicializar visibilidad de inputs al cargar
        document.querySelectorAll('.custom-checkbox').forEach(cb => {
            handleCheckboxChange(cb);
    });
});


// JavaScript
document.getElementById('otroCheckbox').addEventListener('change', function() {
    const inputContainer = document.getElementById('otroInputContainer');
    const otroInput = document.getElementById('otroInput');
  
    if (this.checked) {
        inputContainer.style.display = 'block';
        otroInput.focus(); // Opcional: dar foco al input
    } else {
        inputContainer.style.display = 'none';
        otroInput.value = ''; // Limpiar el valor cuando se oculta
    } 
});

// JavaScript
document.getElementById('otroCheckboxDos').addEventListener('change', function() {
    const inputContainer = document.getElementById('otroInputContainerDos');
    const otroInput = document.getElementById('otroInputDos');
  
    if (this.checked) {
        inputContainer.style.display = 'block';
        otroInput.focus(); // Opcional: dar foco al input
    } else {
        inputContainer.style.display = 'none';
        otroInput.value = ''; // Limpiar el valor cuando se oculta
    } 
});

// JavaScript
document.getElementById('otroCheckboxTres').addEventListener('change', function() {
    const inputContainer = document.getElementById('otroInputContainerTres');
    const otroInput = document.getElementById('otroInputTres');
  
    if (this.checked) {
        inputContainer.style.display = 'block';
        otroInput.focus(); // Opcional: dar foco al input
    } else {
        inputContainer.style.display = 'none';
        otroInput.value = ''; // Limpiar el valor cuando se oculta
    } 
});


const form = document.getElementById('contactForm');

    form.addEventListener('submit', function(event) {
        const nombre    = document.getElementById('nombre').value.trim();
        const telefono  = document.getElementById('telefono').value;
        const celular   = document.getElementById('celular').value;
        const calle     = document.getElementById('calle').value.trim();
        const colonia   = document.getElementById('colonia').value.trim();
        const email     = document.getElementById('email').value.trim();
        const numero    = document.getElementById('numero').value.trim();
        const poblacion = document.getElementById('poblacion').value.trim();
        const codigo    = document.getElementById('codigo').value.trim();
        const motivo    = document.getElementById('motivo').value.trim();
        const corregir  = document.getElementById('corregir').value.trim();
        const correcto  = document.getElementById('correcto').value.trim();
        const localidad = document.getElementById('localidad').value.trim();
        const documentos = document.getElementById('documentos').value.trim();
        const soloNumeros = /^\d{1,10}$/;
        const letrasYEspacios = /^[A-Za-zÁÉÍÓÚáéíóúÑñ\s]+$/;
        const letrasNumerosEspacios = /^[A-Za-zÁÉÍÓÚáéíóúÑñ0-9\s]+$/;

        // Email básico con antispam: permite letras, números, puntos, guiones, guión bajo antes del @
        const emailValido = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

        if (!soloNumeros.test(telefono) || !soloNumeros.test(celular) || !soloNumeros.test(numero) || !soloNumeros.test(codigo)) {
            alert("Teléfono y celular deben contener solo números y máximo 10 dígitos.");
            event.preventDefault();
            return;
        }

        if (!letrasYEspacios.test(nombre) || !letrasYEspacios.test(poblacion)) {
            alert("El nombre solo debe contener letras y espacios.");
            event.preventDefault();
            return;
        }

        if (!letrasNumerosEspacios.test(calle)) {
            alert("La calle solo debe contener letras, números y espacios.");
            event.preventDefault();
            return;
        }

        if (!letrasNumerosEspacios.test(colonia)) {
            alert("La colonia solo debe contener letras, números y espacios.");
            event.preventDefault();
            return;
        }

        if (!emailValido.test(email)) {
            alert("Ingresa un correo electrónico válido. Solo se permiten letras, números, puntos, guiones y un '@'.");
            event.preventDefault();
            return;
        }
    });

 