param(
    [string]$TargetOrg = 'zapata',
    [string]$EvidenceDirectory = (Join-Path $PSScriptRoot 'evidence')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Invoke-SfJson {
    param([string[]]$Arguments)
    $raw = & sf @Arguments --json 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Salesforce CLI fallo: $($raw -join [Environment]::NewLine)"
    }
    return (($raw -join [Environment]::NewLine) | ConvertFrom-Json)
}

function Query-Records {
    param([string]$Soql)
    $response = Invoke-SfJson @('data', 'query', '--target-org', $TargetOrg, '--query', $Soql)
    return @($response.result.records)
}

function Assert-Count {
    param([string]$Label, [object[]]$Records, [int]$Expected)
    if ($Records.Count -ne $Expected) {
        throw "${Label}: se esperaban $Expected registros y se encontraron $($Records.Count). Se aborta para no reclasificar datos fuera del seed conocido."
    }
}

function Write-SanitizedBackup {
    param([string]$Name, [object[]]$Records, [string[]]$Fields, [string]$Stamp)
    $safe = @(foreach ($record in $Records) {
        $row = [ordered]@{ Id = $record.Id }
        foreach ($field in $Fields) { $row[$field] = $record.$field }
        [pscustomobject]$row
    })
    $path = Join-Path $EvidenceDirectory "$Name.before.$Stamp.json"
    [ordered]@{
        generatedAtUtc = [DateTime]::UtcNow.ToString('o')
        targetOrgAlias = $TargetOrg
        sanitization = 'Solo Id tecnico y valores de control previos; sin nombres, VIN, cuenta, ubicacion ni contenido.'
        object = $Name
        count = $safe.Count
        records = @($safe)
    } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $path -Encoding utf8
    return $path
}

function Update-Bulk {
    param([string]$ObjectName, [object[]]$Rows, [string[]]$Columns, [string]$Stamp)
    if ($Rows.Count -eq 0) { return $null }
    $csvPath = Join-Path $EvidenceDirectory "$ObjectName.migration.$Stamp.csv"
    $Rows | Select-Object $Columns | Export-Csv -LiteralPath $csvPath -NoTypeInformation -Encoding utf8
    $response = Invoke-SfJson @(
        'data', 'update', 'bulk', '--target-org', $TargetOrg, '--sobject', $ObjectName,
        '--file', $csvPath, '--line-ending', 'CRLF', '--wait', '20'
    )
    $jobId = if ($response.result.PSObject.Properties.Name -contains 'jobId') {
        $response.result.jobId
    } elseif (($response.result.PSObject.Properties.Name -contains 'jobInfo') -and
              ($response.result.jobInfo.PSObject.Properties.Name -contains 'id')) {
        $response.result.jobInfo.id
    } elseif ($response.result.PSObject.Properties.Name -contains 'id') {
        $response.result.id
    } else {
        $null
    }
    return [ordered]@{
        object = $ObjectName
        rows = $Rows.Count
        jobId = $jobId
        csv = $csvPath
    }
}

New-Item -ItemType Directory -Force -Path $EvidenceDirectory | Out-Null
$stamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')

# Las tres cardinalidades de seed son un fusible: si cambian, el script no adivina.
$knowledge = Query-Records "SELECT Id, Version_Politica__c FROM Knowledge__kav WHERE IsLatestVersion = true ORDER BY Id"
$slots = Query-Records "SELECT Id, Procedencia__c FROM Slot_Taller__c ORDER BY Id"
$assets = Query-Records "SELECT Id, Unidad_Verificada__c, Procedencia__c FROM Asset ORDER BY Id"
Assert-Count 'Knowledge latest' $knowledge 20
Assert-Count 'Slot_Taller__c seed' $slots 729
Assert-Count 'Asset seed' $assets 15

# Para transacciones no se presupone cardinalidad: solo se etiqueta lo previo que
# siga sin clasificación. Las nuevas escrituras del Flow ya traen su propia marca.
$workOrders = Query-Records "SELECT Id, Procedencia__c FROM WorkOrder WHERE Procedencia__c = null ORDER BY Id"
$varadas = Query-Records "SELECT Id, Procedencia__c FROM Unidad_Varada__c WHERE Procedencia__c = null ORDER BY Id"

$backups = @(
    Write-SanitizedBackup 'Knowledge__kav' $knowledge @('Version_Politica__c') $stamp
    Write-SanitizedBackup 'Slot_Taller__c' $slots @('Procedencia__c') $stamp
    Write-SanitizedBackup 'Asset' $assets @('Unidad_Verificada__c', 'Procedencia__c') $stamp
    Write-SanitizedBackup 'WorkOrder' $workOrders @('Procedencia__c') $stamp
    Write-SanitizedBackup 'Unidad_Varada__c' $varadas @('Procedencia__c') $stamp
)

# Knowledge publicado no admite update directo. El script Apex crea/reutiliza el
# Draft, cambia solo la marca y publica la nueva version; si ya esta marcada no hace nada.
$knowledgePending = @($knowledge | Where-Object {
    $_.Version_Politica__c -ne 'v1.0-sintetica-no-verificada'
}).Count
$knowledgeMigration = Invoke-SfJson @(
    'apex', 'run', '--target-org', $TargetOrg,
    '--file', (Join-Path $PSScriptRoot 'migrate-knowledge.apex')
)
$slotRows = @($slots | Where-Object { $_.Procedencia__c -ne 'SITIO_WEB_CAPACIDAD_ASUMIDA' } | ForEach-Object {
    [pscustomobject]@{ Id = $_.Id; Procedencia__c = 'SITIO_WEB_CAPACIDAD_ASUMIDA' }
})
$assetRows = @($assets | Where-Object { $_.Unidad_Verificada__c -ne $false -or $_.Procedencia__c -ne 'SEED_SINTETICO_NO_VERIFICADO' } | ForEach-Object {
    [pscustomobject]@{ Id = $_.Id; Unidad_Verificada__c = $false; Procedencia__c = 'SEED_SINTETICO_NO_VERIFICADO' }
})
$workOrderRows = @($workOrders | ForEach-Object {
    [pscustomobject]@{ Id = $_.Id; Procedencia__c = 'PRUEBA_TRANSACCIONAL_SIN_FUENTE_CONFIRMADA' }
})
$varadaRows = @($varadas | ForEach-Object {
    [pscustomobject]@{ Id = $_.Id; Procedencia__c = 'PRUEBA_TRANSACCIONAL_SIN_FUENTE_CONFIRMADA' }
})

$jobs = @(
    Update-Bulk 'Slot_Taller__c' $slotRows @('Id', 'Procedencia__c') $stamp
    Update-Bulk 'Asset' $assetRows @('Id', 'Unidad_Verificada__c', 'Procedencia__c') $stamp
    Update-Bulk 'WorkOrder' $workOrderRows @('Id', 'Procedencia__c') $stamp
    Update-Bulk 'Unidad_Varada__c' $varadaRows @('Id', 'Procedencia__c') $stamp
) | Where-Object { $null -ne $_ }
$jobs = @(
    [ordered]@{
        object = 'Knowledge__kav'
        rows = $knowledgePending
        operation = 'Draft -> update Version_Politica__c -> publish'
        success = $knowledgeMigration.result.success
    }
    $jobs
)

$post = [ordered]@{
    knowledgeSynthetic = (Query-Records "SELECT COUNT(Id) total FROM Knowledge__kav WHERE IsLatestVersion = true AND Version_Politica__c = 'v1.0-sintetica-no-verificada'")[0].total
    slotsAssumed = (Query-Records "SELECT COUNT(Id) total FROM Slot_Taller__c WHERE Procedencia__c = 'SITIO_WEB_CAPACIDAD_ASUMIDA'")[0].total
    slotsOperational = (Query-Records "SELECT COUNT(Id) total FROM Slot_Taller__c WHERE Procedencia__c = 'OPERACIONAL_VERIFICADO'")[0].total
    assetsSyntheticUnverified = (Query-Records "SELECT COUNT(Id) total FROM Asset WHERE Unidad_Verificada__c = false AND Procedencia__c = 'SEED_SINTETICO_NO_VERIFICADO'")[0].total
    workOrdersTestTransactional = (Query-Records "SELECT COUNT(Id) total FROM WorkOrder WHERE Procedencia__c = 'PRUEBA_TRANSACCIONAL_SIN_FUENTE_CONFIRMADA'")[0].total
    varadasTestTransactional = (Query-Records "SELECT COUNT(Id) total FROM Unidad_Varada__c WHERE Procedencia__c = 'PRUEBA_TRANSACCIONAL_SIN_FUENTE_CONFIRMADA'")[0].total
}

if ($post.knowledgeSynthetic -ne 20 -or $post.slotsAssumed -ne 729 -or
    $post.assetsSyntheticUnverified -ne 15 -or $post.slotsOperational -ne 0) {
    throw "Validacion post-migracion fallo: $($post | ConvertTo-Json -Compress)"
}

$summaryPath = Join-Path $EvidenceDirectory "migration-summary.$stamp.json"
[ordered]@{
    generatedAtUtc = [DateTime]::UtcNow.ToString('o')
    targetOrgAlias = $TargetOrg
    backups = $backups
    jobs = $jobs
    post = $post
} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $summaryPath -Encoding utf8

Get-Content -Raw -LiteralPath $summaryPath
