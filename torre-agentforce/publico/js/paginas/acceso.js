import { escapar } from '../sistema.js';

const form = document.getElementById('form-acceso');
const salida = document.getElementById('resultado');
const boton = document.getElementById('entrar');

// Si ya hay sesión de asesor, no tiene caso volver a pedirla.
try {
  const s = await (await fetch('/publico/sesion')).json();
  if (s.rol === 'admin') location.replace('panel.html');
} catch {
  // Sin respuesta del servidor el formulario sigue sirviendo; el intento de entrar
  // dirá qué pasó. No se bloquea la página por esto.
}

function aviso(tono, titulo, detalle) {
  const estilos =
    tono === 'error'
      ? 'border-red-500/30 bg-red-950/50 text-red-200'
      : 'border-emerald-400/25 bg-emerald-500/10 text-emerald-200';
  salida.innerHTML = `
    <div class="border ${estilos} p-4" role="${tono === 'error' ? 'alert' : 'status'}">
      <p class="text-[10px] uppercase tracking-[0.3em] opacity-70 mb-1.5">${escapar(titulo)}</p>
      <p class="text-xs leading-relaxed font-light">${escapar(detalle)}</p>
    </div>`;
}

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const usuario = document.getElementById('usuario').value.trim();
  const clave = document.getElementById('clave').value;

  if (!usuario || !clave) {
    aviso('error', 'Faltan datos', 'Escribe tu usuario y tu contraseña.');
    return;
  }

  boton.disabled = true;
  salida.innerHTML = '';

  try {
    const res = await fetch('/publico/acceso', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario, clave }),
    });
    const cuerpo = await res.json().catch(() => ({}));

    if (res.ok) {
      aviso('ok', 'Sesión iniciada', 'Entrando al panel de conversaciones.');
      location.href = 'panel.html';
      return;
    }

    // El servidor no distingue si falló el usuario o la contraseña, y esta pantalla
    // tampoco: decirlo ayudaría a quien esté probando credenciales ajenas.
    aviso('error', 'No se pudo entrar', cuerpo.mensaje || `El servidor respondió ${res.status}.`);
  } catch (e) {
    aviso('error', 'Sin conexión', `No se pudo contactar el servidor: ${e.message}`);
  } finally {
    boton.disabled = false;
    document.getElementById('clave').value = '';
  }
});
