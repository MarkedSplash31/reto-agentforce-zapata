# Verificación del ambiente

Tres capas de prueba. Se corren en este orden.

## 1. Verificación estática (campos, FLS, layouts, contratos)

```bash
# 1a. Extraer el estado real de la org
mkdir -p scripts/verificacion/desc
for o in Sucursal__c Modelo_Sucursal__c Slot_Taller__c Regla_Cobertura__c \
         Lectura_Odometro__c Log_Agente__c Brecha_Conocimiento__c Sintoma__c \
         Sesion_Diagnostico__c Asset WorkOrder Case Product2 Account Knowledge__kav; do
  sf sobject describe --sobject $o --target-org zapata --json > scripts/verificacion/desc/$o.json
done

# 1b. Comparar contra la definición local
python scripts/verificacion/verificar-ambiente.py
```

Comprueba que cada campo exista en la org, tenga FLS, aparezca en algún formulario,
que vistas y compact layouts no referencien campos muertos, que las fórmulas sean
fórmulas de verdad, y que las 8 acciones del plan tengan todos sus campos.

## 2. Cadena completa de negocio

```bash
sf apex run --file scripts/apex/prueba-humo.apex --target-org zapata
```

Crea modelo → sucursal → slot → unidad → regla → diagnóstico → orden → log,
verifica las fórmulas y la idempotencia, y hace **rollback**. La org queda en 0.

## 3. Reglas de validación y blindaje de cobertura

```bash
sf apex run --file scripts/apex/prueba-validaciones.apex --target-org zapata
sf apex run --file scripts/apex/prueba-blindaje-cobertura.apex --target-org zapata
```

Ambas hacen rollback. La primera confirma que las validaciones bloquean datos malos;
la segunda que un veredicto de garantía viejo degrada solo a `REQUIERE_DATO`.

## Trampa conocida

El error que más veces se repitió durante la construcción: **un campo nuevo sin FLS
en el permission set es invisible aunque esté desplegado**. Si algo "no existe" pero
sí aparece en Setup, regenera el permission set antes de buscar otra causa.
