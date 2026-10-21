[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$Origem,
  [Parameter(Mandatory=$true)][string]$Diretorio,
  [Parameter(Mandatory=$true)][string]$Node
)
$ErrorActionPreference='Stop'
& (Join-Path $PSScriptRoot 'usar-cofre.ps1') -Diretorio $Diretorio -Node $Node -Acao verificar | Out-Null
$taskInventario=Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot '../../docs/features/donatella-crm/INVENTARIO-CODIGO.json') | ConvertFrom-Json
$taskRevisao=(& git -C $Origem rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $taskRevisao -ne $taskInventario.revisao -or $taskInventario.manifesto.Count -ne 216) { throw 'Versão de código divergiu do inventário já conferido.' }
$taskDestino=Join-Path ([IO.Path]::GetFullPath($Diretorio)) "arquivos/codigo-$taskRevisao.zip"
$taskManifesto=Join-Path ([IO.Path]::GetFullPath($Diretorio)) "arquivos/codigo-$taskRevisao.manifesto.json"
if ((Test-Path -LiteralPath $taskDestino) -or (Test-Path -LiteralPath $taskManifesto)) { throw 'Cópia de código já existe; não substituir.' }
$taskCaminhos=@($taskInventario.manifesto | ForEach-Object {
  if ($_.arquivo -notmatch '^[a-zA-Z0-9_./-]+$' -or $_.arquivo.Split('/') -contains '..' -or $_.arquivo.StartsWith('/') -or $_.arquivo -eq '.env' -or $_.sha256 -notmatch '^[a-f0-9]{64}$') { throw 'Manifesto de código inesperado.' }
  $_.arquivo
})
& git -C $Origem archive --format=zip "--output=$taskDestino" $taskRevisao -- @taskCaminhos
if ($LASTEXITCODE -ne 0) { throw 'Preservação de código interrompida.' }
$taskZip=[IO.Compression.ZipFile]::OpenRead($taskDestino)
try {
  $taskEntradas=@($taskZip.Entries | Where-Object { -not $_.FullName.EndsWith('/') })
  if ($taskEntradas.Count -ne $taskInventario.manifesto.Count) { throw 'Quantidade de arquivos divergente.' }
  foreach ($taskItem in $taskInventario.manifesto) {
    $taskEntrada=$taskZip.GetEntry($taskItem.arquivo)
    if (-not $taskEntrada) { throw 'Arquivo de código ausente.' }
    $taskLeitura=$taskEntrada.Open()
    try { $taskHash=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($taskLeitura)).ToLowerInvariant() }
    finally { $taskLeitura.Dispose() }
    if ($taskHash -ne $taskItem.sha256) { throw 'Integridade do código divergente.' }
  }
} finally { $taskZip.Dispose() }
$taskRegistro=@{revisao=$taskRevisao;arquivos=$taskEntradas.Count;sha256=(Get-FileHash -LiteralPath $taskDestino -Algorithm SHA256).Hash.ToLowerInvariant();validacao='216 arquivos relidos do ZIP e comparados ao manifesto';configuracaoPrivada='cofre separado; segredos Cloud/Meta ainda pendentes';bancoRestaurado=$false}
[IO.File]::WriteAllText($taskManifesto,($taskRegistro | ConvertTo-Json),[Text.UTF8Encoding]::new($false))
[pscustomobject]@{Estado='Código preservado e relido com integridade';Arquivos=$taskEntradas.Count;Revisao=$taskRevisao;BancoRestaurado=$false}
