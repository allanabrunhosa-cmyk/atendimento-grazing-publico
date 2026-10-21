[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$Diretorio,[Parameter(Mandatory=$true)][string]$Node)
$ErrorActionPreference='Stop'
# Não chama DPAPI: chave proveniente da custódia externa e arquivo portátil bastam.
$taskRaiz=[IO.Path]::GetFullPath($Diretorio)
$taskUsuario=[Security.Principal.WindowsIdentity]::GetCurrent()
$taskAcl=Get-Acl -LiteralPath $taskRaiz
if (-not $taskAcl.AreAccessRulesProtected -or $taskAcl.Owner -ne $taskUsuario.Name -or $taskAcl.Access.Count -ne 2) { throw 'Cofre privado divergente.' }
foreach ($taskRegra in $taskAcl.Access) {
  if ($taskRegra.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -notin @($taskUsuario.User.Value,'S-1-5-18') -or $taskRegra.AccessControlType -ne 'Allow') { throw 'Principal inesperado.' }
}
$taskAncestral=$taskRaiz
while ($taskAncestral) {
  if ((Test-Path -LiteralPath (Join-Path $taskAncestral '.git')) -or ((Get-Item -LiteralPath $taskAncestral).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Cofre não pode seguir Git/atalhos.' }
  $taskAncestral=[IO.Path]::GetDirectoryName($taskAncestral)
}
$taskPasta=Join-Path $taskRaiz 'cofre'
$taskEntradaArquivo=Join-Path $taskPasta 'CONFERENCIA-CHAVE-IPHONE.txt'
$taskArquivo=Join-Path $taskPasta 'config.portatil.enc'
$taskEntrega=Join-Path $taskPasta 'CHAVE-RECUPERACAO-CUSTODIA-PRIVADA.txt'
foreach ($taskCaminho in @($taskPasta,$taskEntradaArquivo,$taskArquivo)) {
  if ((Get-Item -LiteralPath $taskCaminho).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Arquivo não pode seguir atalhos.' }
}
if ((Test-Path -LiteralPath $taskEntrega) -and ((Get-Item -LiteralPath $taskEntrega).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Entrega não pode seguir atalhos.' }
$taskTexto=[IO.File]::ReadAllText($taskEntradaArquivo)
$taskEncontradas=[regex]::Matches($taskTexto,'(?m)^CHAVE_DO_IPHONE=([a-fA-F0-9]{64})\s*$')
if ($taskEncontradas.Count -ne 1) { throw 'Conferência ainda não preenchida ou inválida; não imprimir conteúdo.' }
$taskProcesso=[Diagnostics.Process]::new()
try {
  $taskInicio=[Diagnostics.ProcessStartInfo]::new()
  $taskInicio.FileName=[IO.Path]::GetFullPath($Node)
  $taskInicio.ArgumentList.Add((Join-Path $PSScriptRoot 'verificar-cofre-portatil.mjs')); $taskInicio.ArgumentList.Add($taskArquivo)
  $taskInicio.UseShellExecute=$false; $taskInicio.CreateNoWindow=$true
  $taskInicio.RedirectStandardInput=$true; $taskInicio.RedirectStandardOutput=$true; $taskInicio.RedirectStandardError=$true
  $taskProcesso.StartInfo=$taskInicio
  if (-not $taskProcesso.Start()) { throw 'Executor indisponível.' }
  $taskProcesso.StandardInput.Write($taskEncontradas[0].Groups[1].Value); $taskProcesso.StandardInput.Close()
  if (-not $taskProcesso.WaitForExit(30000)) { $taskProcesso.Kill($true); throw 'Conferência interrompida por tempo.' }
  if ($taskProcesso.ExitCode -ne 0 -or $taskProcesso.StandardOutput.ReadToEnd().Trim() -ne 'RECUPERACAO_PORTATIL_VERIFICADA_SEM_DPAPI') { throw 'Chave não recuperou o cofre portátil; conteúdo não registrado.' }
  $taskRegistro=@{verificadoEm=[DateTime]::UtcNow.ToString('o');custodia='Notas bloqueadas iCloud, informadas pelo usuário';recuperacao='Node AES-256-GCM com chave reintroduzida pelo usuário; sem DPAPI';arquivoHash=(Get-FileHash -LiteralPath $taskArquivo -Algorithm SHA256).Hash.ToLowerInvariant();bancoRealRestaurado=$false}
  $taskRegistroArquivo=Join-Path $taskPasta 'recuperacao-portatil-comprovada.json'
  $taskSaida=[IO.File]::Open($taskRegistroArquivo,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try { $taskBytes=[Text.Encoding]::UTF8.GetBytes(($taskRegistro | ConvertTo-Json)); $taskSaida.Write($taskBytes,0,$taskBytes.Length); $taskSaida.Flush($true) } finally { $taskSaida.Dispose() }
  # Somente os dois arquivos de entrega criados por esta tarefa. Destinos absolutos
  # conferidos dentro do cofre antes de qualquer remoção; nunca recursiva.
  foreach ($taskCaminho in @($taskEntradaArquivo,$taskEntrega)) {
    $taskAlvo=[IO.Path]::GetFullPath($taskCaminho)
    if (-not $taskAlvo.StartsWith($taskPasta+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Destino de limpeza inesperado.' }
    if (Test-Path -LiteralPath $taskAlvo) { Remove-Item -LiteralPath $taskAlvo }
  }
  [pscustomobject]@{Estado='Cofre recuperado com chave da custódia externa sem DPAPI';BancoRealRestaurado=$false;ArquivosDeEntregaRemovidos=$true}
} finally { $taskProcesso.Dispose(); $taskTexto=$null; $taskEncontradas=$null }
