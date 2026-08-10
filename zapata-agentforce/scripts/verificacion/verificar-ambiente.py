# -*- coding: utf-8 -*-
"""Verificacion exhaustiva del ambiente contra la org real.

Comprueba, campo por campo:
  1. Que cada campo definido localmente exista y sea accesible en la org.
  2. Que ningun campo quede sin FLS (el error que ya nos mordio dos veces).
  3. Que cada campo este en algun page layout (si no, es invisible al capturar).
  4. Que las vistas de lista y compact layouts referencien campos reales.
  5. Que los contratos de entrada y salida de las 8 acciones del plan 8.2
     tengan un campo real donde aterrizar.
"""
import json
import os
import re
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
ROOT = r"C:\Users\Admin\Desktop\zapata-agentforce\force-app\main\default"
DESC = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'desc')

OBJETOS = ['Sucursal__c', 'Modelo_Sucursal__c', 'Slot_Taller__c', 'Regla_Cobertura__c',
           'Lectura_Odometro__c', 'Log_Agente__c', 'Brecha_Conocimiento__c',
           'Sintoma__c', 'Sesion_Diagnostico__c', 'Asset', 'WorkOrder', 'Case',
           'Product2', 'Account', 'Knowledge__kav']

problemas = []
ok = []


def cargar_org(obj):
    p = os.path.join(DESC, obj + '.json')
    if not os.path.isfile(p):
        return None
    d = json.load(open(p, encoding='utf-8'))
    return d.get('result', d)


# --------------------------------------------------- 1. campos local vs org --
locales = {}
for obj in OBJETOS:
    d = os.path.join(ROOT, 'objects', obj, 'fields')
    locales[obj] = (sorted(f.replace('.field-meta.xml', '') for f in os.listdir(d))
                    if os.path.isdir(d) else [])

org_campos = {}
for obj in OBJETOS:
    o = cargar_org(obj)
    if not o:
        problemas.append(f'[{obj}] no se pudo describir en la org')
        continue
    org_campos[obj] = {f['name']: f for f in o['fields']}

total_local = 0
for obj in OBJETOS:
    for api in locales[obj]:
        total_local += 1
        if api not in org_campos.get(obj, {}):
            problemas.append(f'[{obj}.{api}] definido localmente pero NO visible en la org '
                             '(no desplegado o sin FLS)')
ok.append(f'Campos definidos localmente: {total_local}')


# --------------------------------------------------------------- 2. FLS -----
permset = os.path.join(ROOT, 'permissionsets', 'Zapata_Agente_Servicio.permissionset-meta.xml')
ps_xml = open(permset, encoding='utf-8').read()
ps_fields = set(re.findall(r'<field>([^<]+)</field>', ps_xml))

sin_fls = []
for obj in OBJETOS:
    for api in locales[obj]:
        if not api.endswith('__c'):
            continue
        p = os.path.join(ROOT, 'objects', obj, 'fields', api + '.field-meta.xml')
        xml = open(p, encoding='utf-8').read()
        requerido = '<required>true</required>' in xml
        if requerido:
            continue        # FLS implicito
        if f'{obj}.{api}' not in ps_fields:
            sin_fls.append(f'{obj}.{api}')
if sin_fls:
    for f in sin_fls:
        problemas.append(f'[{f}] SIN FLS en el permission set: el agente no lo vera')
else:
    ok.append(f'FLS: los {len(ps_fields)} campos del permission set cubren todo lo no obligatorio')


# ------------------------------------------------- 3. campos en algun layout --
layouts_txt = ''
ldir = os.path.join(ROOT, 'layouts')
for fn in os.listdir(ldir):
    layouts_txt += open(os.path.join(ldir, fn), encoding='utf-8').read()

fuera_de_layout = []
for obj in OBJETOS:
    for api in locales[obj]:
        if not api.endswith('__c'):
            continue
        if f'<field>{api}</field>' not in layouts_txt:
            fuera_de_layout.append(f'{obj}.{api}')
if fuera_de_layout:
    for f in fuera_de_layout:
        problemas.append(f'[{f}] no esta en ningun page layout: invisible al capturar')
else:
    ok.append('Layouts: todos los campos custom aparecen en algun formulario')


# ------------------------------- 4. vistas de lista y compact layouts validos --
for obj in OBJETOS:
    for carpeta, patron in (('listViews', r'<columns>([^<]+)</columns>'),
                            ('compactLayouts', r'<fields>([^<]+)</fields>')):
        d = os.path.join(ROOT, 'objects', obj, carpeta)
        if not os.path.isdir(d):
            continue
        for fn in os.listdir(d):
            xml = open(os.path.join(d, fn), encoding='utf-8').read()
            for campo in re.findall(patron, xml):
                if campo in ('NAME', 'Name'):
                    continue
                if campo not in org_campos.get(obj, {}):
                    problemas.append(f'[{obj}/{carpeta}/{fn}] referencia campo inexistente: {campo}')
ok.append('Vistas de lista y compact layouts: referencias verificadas')


# ----------------------------------- 5. formulas: que existan y sean del tipo --
formulas = []
for obj in OBJETOS:
    for api in locales[obj]:
        p = os.path.join(ROOT, 'objects', obj, 'fields', api + '.field-meta.xml')
        xml = open(p, encoding='utf-8').read()
        if '<formula>' not in xml:
            continue
        f_org = org_campos.get(obj, {}).get(api)
        if not f_org:
            continue
        if not f_org.get('calculated'):
            problemas.append(f'[{obj}.{api}] deberia ser formula pero la org lo tiene como campo normal')
        else:
            formulas.append(f'{obj}.{api}')
ok.append(f'Formulas verificadas como calculadas en la org: {len(formulas)} -> ' + ', '.join(formulas))


# ------------------------- 6. contratos de las 8 acciones del plan seccion 8.2 --
# (accion, [(objeto, campo, para que sirve)])
CONTRATOS = {
    'Buscar_Verificar_Unidad': [
        ('Asset', 'SerialNumber', 'entrada: VIN'),
        ('Account', 'AccountNumber', 'entrada: numero de cuenta'),
        ('Asset', 'Unidad_Verificada__c', 'salida: gate de verificacion'),
        ('Asset', 'Metodo_Verificacion__c', 'salida: segundo factor usado'),
        ('Asset', 'Fecha_Verificacion__c', 'salida: cuando se verifico'),
    ],
    'Registrar_Lectura_Odometro': [
        ('Lectura_Odometro__c', 'Asset__c', 'entrada: unidad'),
        ('Lectura_Odometro__c', 'Kilometraje__c', 'entrada: km'),
        ('Lectura_Odometro__c', 'Fecha_Lectura__c', 'entrada: fecha'),
        ('Lectura_Odometro__c', 'Fuente__c', 'entrada: fuente'),
        ('Asset', 'Ultimo_Odometro_Verificado__c', 'efecto: estampa en Asset'),
        ('Asset', 'Fecha_Odometro_Verificado__c', 'efecto: estampa en Asset'),
    ],
    'Evaluar_Cobertura_Garantia': [
        ('Regla_Cobertura__c', 'Sistema__c', 'entrada: sistema reportado'),
        ('Regla_Cobertura__c', 'Meses_Limite__c', 'regla: limite de meses'),
        ('Regla_Cobertura__c', 'Km_Limite__c', 'regla: limite de km'),
        ('Regla_Cobertura__c', 'Version__c', 'salida: version de regla'),
        ('Regla_Cobertura__c', 'Knowledge_Article_Id__c', 'salida: articulo citado'),
        ('Asset', 'Meses_Desde_Instalacion__c', 'dato: meses cumplidos'),
        ('Asset', 'Dato_Odometro_Vigente__c', 'gate: odometro vigente'),
        ('Asset', 'Estado_Cobertura__c', 'efecto: veredicto guardado'),
        ('Asset', 'Fecha_Ultima_Evaluacion__c', 'efecto: auditoria'),
        ('Asset', 'Cobertura_Citable__c', 'salida: lo unico citable'),
    ],
    'Consultar_Disponibilidad': [
        ('Slot_Taller__c', 'Sucursal__c', 'entrada: sucursal'),
        ('Slot_Taller__c', 'Inicio__c', 'entrada: rango'),
        ('Slot_Taller__c', 'Tipo_Servicio__c', 'entrada: tipo'),
        ('Slot_Taller__c', 'Disponible__c', 'gate: solo disponibles'),
        ('Slot_Taller__c', 'Cupos_Libres__c', 'salida: cupos'),
        ('Modelo_Sucursal__c', 'Modelo__c', 'gate: el taller atiende ese modelo'),
        ('Modelo_Sucursal__c', 'Sistemas_Soportados__c', 'gate: y ese sistema'),
    ],
    'Crear_Orden_Servicio': [
        ('WorkOrder', 'Sintoma_Reportado__c', 'entrada: sintoma literal'),
        ('WorkOrder', 'Idempotency_Key__c', 'gate: evita duplicado'),
        ('WorkOrder', 'Slot_Taller__c', 'entrada: franja'),
        ('WorkOrder', 'Sucursal__c', 'entrada: taller'),
        ('WorkOrder', 'Tipo_Cita__c', 'entrada: tipo de cita'),
        ('WorkOrder', 'Asesor_Responsable__c', 'efecto: dueno de la cita'),
        ('WorkOrder', 'Origen_Atencion__c', 'traza: canal'),
        ('Slot_Taller__c', 'Capacidad_Usada__c', 'efecto: reserva cupo'),
    ],
    'Reprogramar_Orden_Servicio': [
        ('WorkOrder', 'Slot_Taller__c', 'efecto: nueva franja en la MISMA orden'),
        ('WorkOrder', 'Correlation_Id__c', 'traza'),
    ],
    'Crear_Caso_Escalamiento': [
        ('Case', 'Asset__c', 'entrada: unidad'),
        ('Case', 'WorkOrder__c', 'entrada: orden opcional'),
        ('Case', 'Politica_Aplicada__c', 'salida: politica usada'),
        ('Case', 'Correlation_Id__c', 'traza'),
    ],
    'Registrar_Resultado_Diagnostico': [
        ('Sesion_Diagnostico__c', 'Sintoma__c', 'entrada: sintoma'),
        ('Sesion_Diagnostico__c', 'Modelo__c', 'entrada: modelo'),
        ('Sesion_Diagnostico__c', 'Tiene_Herramientas__c', 'entrada: capacidad del usuario'),
        ('Sesion_Diagnostico__c', 'Resultado__c', 'salida: bifurcacion'),
        ('Sesion_Diagnostico__c', 'Pasos_Seguidos__c', 'salida: evidencia'),
        ('Sesion_Diagnostico__c', 'Knowledge_Article_Id__c', 'salida: fuente'),
        ('Sintoma__c', 'Autoservicio_Permitido__c', 'gate: se puede guiar o no'),
        ('Sintoma__c', 'Nivel_Riesgo__c', 'gate: critico no se guia'),
        ('Sintoma__c', 'Senales_De_Alerta__c', 'gate: cuando detenerse'),
    ],
}

print('=' * 78)
print('CONTRATOS DE ENTRADA Y SALIDA DE LAS 8 ACCIONES (plan seccion 8.2)')
print('=' * 78)
faltantes_contrato = 0
for accion, campos in CONTRATOS.items():
    malos = [(o, c, u) for o, c, u in campos if c not in org_campos.get(o, {})]
    estado = 'OK' if not malos else f'FALTAN {len(malos)}'
    print(f'  {accion:34s} {len(campos):2d} campos  {estado}')
    for o, c, u in malos:
        print(f'      FALTA {o}.{c}  ({u})')
        faltantes_contrato += 1
if faltantes_contrato == 0:
    ok.append('Contratos I/O: los 8 tienen todos sus campos en la org')


# ---------------------------------------------------------- Log transversal --
LOG = ['Correlation_Id__c', 'Subagent__c', 'Action_Name__c', 'Outcome__c',
       'Error_Code__c', 'Guardrail_Triggered__c', 'Policy_Version__c',
       'Odometer_Used__c', 'Odometer_Source__c', 'Unit_Verified__c',
       'Knowledge_Article_Version_Id__c', 'Related_Record_Id__c', 'Timestamp__c',
       'Actor__c', 'Session_Key__c', 'Asset__c', 'WorkOrder__c', 'Case__c']
falta_log = [c for c in LOG if c not in org_campos.get('Log_Agente__c', {})]
if falta_log:
    for c in falta_log:
        problemas.append(f'[Log_Agente__c.{c}] falta (plan seccion 10)')
else:
    ok.append(f'Log_Agente__c: los {len(LOG)} campos de la seccion 10 estan completos')


print()
print('=' * 78)
print('RESULTADO')
print('=' * 78)
for o in ok:
    print('  OK  ' + o)
print()
if problemas:
    print(f'  {len(problemas)} PROBLEMAS:')
    for p in problemas:
        print('   X  ' + p)
else:
    print('  Sin problemas. El ambiente esta listo para recibir registros.')
