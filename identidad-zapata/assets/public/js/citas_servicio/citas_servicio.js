
    // ====== Wizard nav helpers ======
    const $ = (sel, ctx=document) => ctx.querySelector(sel);
    const $$ = (sel, ctx=document) => [...ctx.querySelectorAll(sel)];

    const panels = [$('#step1'), $('#step2'), $('#step3')];
    const steps = $$('.flex.items-center.gap-3');

    function goTo(step){
      panels.forEach((p,i)=> p.classList.toggle('hidden', i !== (step-1)) );
      steps.forEach((s,i)=>{
        const badge = s.querySelector('span.w-6');
        if(i < step){
          s.classList.remove('opacity-40');
          if(badge){
            badge.classList.remove('bg-neutral-800','text-gray-400');
            badge.classList.add('bg-white','text-black');
          }
        } else {
          s.classList.add('opacity-40');
          if(badge){
            badge.classList.add('bg-neutral-800','text-gray-400');
            badge.classList.remove('bg-white','text-black');
          }
        }
      });
      window.scrollTo({top:0, behavior:'smooth'});
    }

    // ====== Paso 1 -> Paso 2  ======
    $('#toStep2').addEventListener('click',()=>{
      const required = ['brand','model','year','dealer','plate','km'];
      let ok = true;
      required.forEach(id=>{ const el = $('#'+id); el.classList.remove('ring-4','ring-red-200','border-red-500'); if(!el.checkValidity()){ ok=false; el.classList.add('ring-4','ring-red-200','border-red-500'); }});
      if(ok) goTo(2);
    });

    // Botones Volver
    $$('[data-back]').forEach(b=> b.addEventListener('click',()=>{
      const current = panels.findIndex(p=>!p.classList.contains('hidden')) + 1;
      goTo(Math.max(1, current-1));
    }));

    // ====== Calendario  ======
    const pad = n => String(n).padStart(2,'0');
    const fmtISO = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
    const months = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
    const dows = ['L','M','M','J','V','S','D'];

    let viewDate = new Date(); viewDate.setDate(1);
    let selectedDate = null; let selectedSlot = null;

    const monthLabel = $('#monthLabel');
    const daysEl = $('#days'); const dowEl = $('#dow');
    const selectedDateText = $('#selectedDateText');
    
    const timesEl = $('#times'); const summary = $('#summary');
    const nextBtn = $('#toStep3');

    dowEl.innerHTML = dows.map(l=>`<div class=\"py-1\">${l}</div>`).join('');

    $('#prevMonth').addEventListener('click',()=>{ viewDate.setMonth(viewDate.getMonth()-1); renderCalendar(); });
    $('#nextMonth').addEventListener('click',()=>{ viewDate.setMonth(viewDate.getMonth()+1); renderCalendar(); });

    // const TEST_MODE = false;

    // // 🔁 Cambia solo esta fecha para probar
    // const FIXED_NOW = '2026-02-06T18:30:00'; // sábado 3:30 pm

    // if (TEST_MODE) {
    //   const RealDate = Date;

    //   window.Date = class extends RealDate {
    //     constructor(...args) {
    //       if (args.length === 0) {
    //         super(FIXED_NOW);
    //       } else {
    //         super(...args);
    //       }
    //     }

    //     static now() {
    //       return new RealDate(FIXED_NOW).getTime();
    //     }
    //   };
    // }


    function renderCalendar(){
      
      // Indica los dias festivos o no hábiles
      const holidays = [
        '2026-04-02',
        '2026-04-03',
        '2026-04-04',
        '2026-05-01',
      ];

      const y = viewDate.getFullYear(); const m = viewDate.getMonth();
      monthLabel.textContent = `${months[m]} ${y}`;
      const firstDow = (new Date(y,m,1).getDay()+6)%7; // L=0..D=6
      const lastDay = new Date(y,m+1,0).getDate();
      const today = new Date();
      today.setHours(0,0,0,0);

      const cells = [];
      for(let i=0;i<firstDow;i++) cells.push('<div class="p-1"></div>');
      for(let d=1; d<=lastDay; d++){
        const dateObj = new Date(y,m,d);
        
        const isSunday = dateObj.getDay() === 0;;
        const isPast = dateObj < today;
        const minDate = getMinDate();
        const isBeforeMin = dateObj < minDate;

        const isHoliday = holidays.includes(fmtISO(dateObj));
        const isDisabled = isPast || isSunday || isBeforeMin || isHoliday;

        const isSel = selectedDate && fmtISO(dateObj)===fmtISO(selectedDate);
        cells.push(`<button type=\"button\" data-date=\"${fmtISO(dateObj)}\" ${isDisabled ?'disabled aria-disabled=\"true\"':''} class=\"p-1\">
          <span class=\"block aspect-square rounded-md text-base ${isDisabled ?'p-2 text-gray-700':'p-2 cursor-pointer text-gray-300 hover:bg-white/5 rounded-none transition'} ${isSel?'!p-2 !cursor-pointer !text-gray-300 !bg-amber-400/20 !text-amber-400 !font-medium':''} grid place-content-center\">${d}</span>
        </button>`);
      }
      daysEl.innerHTML = cells.join('');

      // ===== CORRECCIÓN: crear Date sin desajuste de zona horaria =====
      $$('#days [data-date]').forEach(btn=>{
          btn.addEventListener('click', ()=>{
              if(btn.hasAttribute('disabled')) return;

              const parts = btn.getAttribute('data-date').split('-'); // ["YYYY","MM","DD"]
              selectedDate = new Date(parts[0], parts[1]-1, parts[2]); // mes=0-11
              selectedSlot = null;

              renderCalendar();
              loadSlotsForDate(selectedDate);
              updateSummary();
          });
      });
    }

    function updateSummary(){
      selectedDateText.textContent = selectedDate ? new Intl.DateTimeFormat('es-MX',{day:'2-digit',month:'2-digit',year:'numeric'}).format(selectedDate) : '—';
      if(selectedDate && selectedSlot){
        summary.innerHTML = `<span class='inline-flex items-center text-base gap-2 px-3 py-1 rounded-full text-gray-300 bg-amber-400/20 text-amber-400  border-zinc-300 '>${new Intl.DateTimeFormat('es-MX',{day:'2-digit',month:'short',year:'numeric'}).format(selectedDate)} · ${selectedSlot}</span>`;
        nextBtn.disabled = false;
      } else { summary.textContent = ''; nextBtn.disabled = true; }
    }

    // horarios para citas
    function getSlots(date){
      const dow = (date.getDay()+6)%7; // L=0..D=6
      // const base = ['09:00 AM','10:00 AM','11:00 AM','12:00 PM','01:00 PM','02:00 PM','03:00 PM','04:00 PM'];
      // if(dow>=5) return ['09:00 AM','12:00 PM'];
      const base = ['Mañana','Tarde'];
      // Domingo nunca (extra seguridad)
      if(dow === 6) return [];
      // Sábado solo mañana
      if(dow === 5) return ['Mañana'];
      // fechas bloqueadas 
      const d = date.getDate();
      if(d===15 || d===22) return [];
      return base;
    }

    function getMinDate(){
      const now = new Date();
      const today = new Date();
      today.setHours(0,0,0,0);

      const day = now.getDay(); // 0=dom, 6=sab
      const hour = now.getHours() + now.getMinutes()/60;

      let min = new Date(today);

      // Domingo → martes
      if(day === 0){
        min.setDate(min.getDate() + 2);
        return min;
      }

      // Sábado
      if(day === 6){
        if(hour < 14){
          // antes de las 2:00 pm → lunes
          min.setDate(min.getDate() + 2);
        } else {
          // después de las 2:00 pm → martes
          min.setDate(min.getDate() + 3);
        }
        return min;
      }


      // Viernes después de 5:30 pm → lunes
      if(day === 5 && hour >= 17.5){
        min.setDate(min.getDate() + 3);
        return min;
      }

      // Cierre diario 5:30 pm → pasado mañana
      if(hour >= 17.5){
        min.setDate(min.getDate() + 2);
        return min;
      }

      // Caso normal → mañana
      min.setDate(min.getDate() + 1);

      return min;
    }


    function loadSlotsForDate(date){
      timesEl.innerHTML = `<p class='text-white text-base'>Cargando horarios…</p>`;
      setTimeout(()=>{
        const slots = getSlots(date);
        if(!slots.length){ timesEl.innerHTML = `<p class='text-white text-base'>No hay horarios disponibles para esta fecha.</p>`; updateSummary(); return; }
        timesEl.innerHTML = slots.map(s=>`<button type='button' data-slot='${s}' class='border border-white/10 bg-[#0b0c10] py-2.5 text-[11px] font-light hover:border-white/30 transition text-center focus:bg-white focus:text-black focus:font-medium' aria-pressed='false'>${s}</button>`).join('');
        $$('#times [data-slot]').forEach(b=> b.addEventListener('click',()=>{
          $$('#times [data-slot]').forEach(x=>{ x.setAttribute('aria-pressed','false'); x.classList.remove('bg-brand','text-white','border-black'); });
          b.setAttribute('aria-pressed','true');
          b.classList.add('bg-brand','text-white');
          b.classList.add('border-black');
          selectedSlot = b.getAttribute('data-slot');
          updateSummary();
        }));
      }, 200);
    }

    renderCalendar();

    // ====== Submit final ======
    $('#wizardForm').addEventListener('submit', (event)=>{
        event.preventDefault();
        const required = ['name','phone'];
        let ok = true;
        required.forEach(id=>{ const el = $('#'+id); el.classList.remove('ring-4','ring-red-200','border-red-500'); if(!el.checkValidity()){ ok=false; el.classList.add('ring-4','ring-red-200','border-red-500'); }});
        if(!ok) return;

        // Agrega los datos del payload como campos ocultos antes de enviar el formulario
        const payload = {
            brand: $('#brand').value,
            model: $('#model').value,
            year: $('#year').value,
            dealer: $('#dealer').value,
            plate: $('#plate').value,
            km: $('#km').value,
            date: selectedDate ? fmtISO(selectedDate) : null,
            slot: selectedSlot,
            name: $('#name').value,
            phone: $('#phone').value,
            email: $('#email').value,
            notes: $('#notes').value,
            cupon: $('#coupon').value,
            utm_source: $('#utm_source').value,
            utm_medium: $('#utm_medium').value,
            utm_campaign: $('#utm_campaign').value
        };

        Object.entries(payload).forEach(([key, value]) => {
            let input = document.createElement('input');
            input.type = 'hidden';
            input.name = key;
            input.value = value ?? '';
            event.target.appendChild(input);
        });

        // Submit the form al final
        // event.target.submit();
        const botonSubmit = document.getElementById('btnSubmit');
        botonSubmit.disabled = true;

        const toast = $('#toast');
        toast.textContent = `Cita solicitada: ${payload.date} · ${payload.slot}`;
        toast.classList.remove('opacity-0','translate-y-2');
        setTimeout(()=> toast.classList.add('opacity-0','translate-y-2'), 2500);
    });

    // const boton = document.getElementById('toStep3');
    // const overlay = document.getElementById('btnOverlay');

    // overlay.addEventListener('click', function () {
    //   if (boton.disabled) {
    //     alert('Por favor, completa los pasos anteriores antes de continuar.');
    //   }
    // });

    // // Opcional: ocultar el overlay cuando se habilite el botón
    // const observer = new MutationObserver(() => {
    //   overlay.style.display = boton.disabled ? 'block' : 'none';
    // });

    // observer.observe(boton, { attributes: true, attributeFilter: ['disabled'] });
    
    $('#toStep3').addEventListener('click', ()=> goTo(3));
