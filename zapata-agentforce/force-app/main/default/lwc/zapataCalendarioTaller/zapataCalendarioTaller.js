import { LightningElement, wire, track } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import getSlots from '@salesforce/apex/ZapataAgendaController.getSlots';
import getSucursales from '@salesforce/apex/ZapataAgendaController.getSucursales';

const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
    'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export default class ZapataCalendarioTaller extends NavigationMixin(LightningElement) {
    @track offsetSemanas = 0;
    @track sucursalId = '';
    @track slots = [];
    cargando = true;
    error;

    sucursales = [];

    // ------------------------------------------------------------ filtros --
    @wire(getSucursales)
    recibirSucursales({ data, error }) {
        if (data) {
            this.sucursales = data;
        } else if (error) {
            this.error = this.mensajeDeError(error);
        }
    }

    get opcionesSucursal() {
        return [{ label: 'Todas las sucursales', value: '' }].concat(
            this.sucursales.map((s) => ({
                label: s.Ciudad__c ? `${s.Name} — ${s.Ciudad__c}` : s.Name,
                value: s.Id
            }))
        );
    }

    // -------------------------------------------------------------- rango --
    get inicioSemana() {
        const hoy = new Date();
        hoy.setHours(0, 0, 0, 0);
        // getDay(): 0 = domingo. Se corre para que la semana empiece en lunes.
        const desplazamiento = (hoy.getDay() + 6) % 7;
        hoy.setDate(hoy.getDate() - desplazamiento + this.offsetSemanas * 7);
        return hoy;
    }

    get finSemana() {
        const f = new Date(this.inicioSemana);
        f.setDate(f.getDate() + 7);
        return f;
    }

    @wire(getSlots, { desde: '$inicioSemanaISO', hasta: '$finSemanaISO', sucursalId: '$sucursalId' })
    recibirSlots({ data, error }) {
        this.cargando = false;
        if (data) {
            this.slots = data;
            this.error = undefined;
        } else if (error) {
            this.slots = [];
            this.error = this.mensajeDeError(error);
        }
    }

    get inicioSemanaISO() {
        return this.inicioSemana.toISOString();
    }

    get finSemanaISO() {
        return this.finSemana.toISOString();
    }

    get etiquetaRango() {
        const a = this.inicioSemana;
        const b = new Date(this.finSemana);
        b.setDate(b.getDate() - 1);
        if (a.getMonth() === b.getMonth()) {
            return `${a.getDate()} – ${b.getDate()} de ${MESES[a.getMonth()]} ${a.getFullYear()}`;
        }
        return `${a.getDate()} ${MESES[a.getMonth()]} – ${b.getDate()} ${MESES[b.getMonth()]} ${b.getFullYear()}`;
    }

    get esSemanaActual() {
        return this.offsetSemanas === 0;
    }

    // ---------------------------------------------------------- la rejilla --
    get dias() {
        const inicio = this.inicioSemana;
        const hoy = new Date();
        hoy.setHours(0, 0, 0, 0);

        return DIAS.map((nombre, i) => {
            const fecha = new Date(inicio);
            fecha.setDate(fecha.getDate() + i);
            const siguiente = new Date(fecha);
            siguiente.setDate(siguiente.getDate() + 1);

            const delDia = this.slots
                .filter((s) => {
                    const t = new Date(s.inicio).getTime();
                    return t >= fecha.getTime() && t < siguiente.getTime();
                })
                .map((s) => this.decorar(s));

            const esHoy = fecha.getTime() === hoy.getTime();
            const finDeSemana = i >= 5;

            return {
                clave: `dia-${i}`,
                nombre,
                numero: fecha.getDate(),
                esHoy,
                slots: delDia,
                vacio: delDia.length === 0,
                clase: `columna${esHoy ? ' columna-hoy' : ''}${finDeSemana ? ' columna-finde' : ''}`,
                claseCabecera: `cabecera${esHoy ? ' cabecera-hoy' : ''}`
            };
        });
    }

    decorar(s) {
        const libres = s.cuposLibres === undefined || s.cuposLibres === null ? 0 : s.cuposLibres;
        const total = s.capacidadTotal || 0;
        let estado = 'libre';
        if (!s.disponible || libres <= 0) {
            estado = 'lleno';
        } else if (total > 0 && libres / total <= 0.34) {
            estado = 'casi';
        }
        return {
            ...s,
            clave: s.slotId,
            hora: `${this.hhmm(s.inicio)} – ${this.hhmm(s.fin)}`,
            cupos: `${libres} de ${total}`,
            clase: `franja franja-${estado}`,
            titulo: `${s.sucursal} · ${s.tipoServicio || 'Sin tipo'} · ${libres} de ${total} cupos`
        };
    }

    hhmm(valor) {
        const d = new Date(valor);
        return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }

    // -------------------------------------------------------------- totales --
    get resumen() {
        const total = this.slots.length;
        const disponibles = this.slots.filter((s) => s.disponible && s.cuposLibres > 0).length;
        const cupos = this.slots.reduce((a, s) => a + (s.cuposLibres || 0), 0);
        const citas = this.slots.reduce((a, s) => a + (s.ordenes || 0), 0);
        return { total, disponibles, cupos, citas };
    }

    get sinFranjas() {
        return !this.cargando && this.slots.length === 0;
    }

    // -------------------------------------------------------------- acciones --
    semanaAnterior() {
        this.offsetSemanas -= 1;
    }

    semanaSiguiente() {
        this.offsetSemanas += 1;
    }

    volverAHoy() {
        this.offsetSemanas = 0;
    }

    cambiarSucursal(evento) {
        this.sucursalId = evento.detail.value;
    }

    abrirSlot(evento) {
        const id = evento.currentTarget.dataset.id;
        this[NavigationMixin.Navigate]({
            type: 'standard__recordPage',
            attributes: { recordId: id, objectApiName: 'Slot_Taller__c', actionName: 'view' }
        });
    }

    mensajeDeError(e) {
        if (e && e.body && e.body.message) {
            return e.body.message;
        }
        return 'No se pudieron cargar las franjas de taller.';
    }
}
