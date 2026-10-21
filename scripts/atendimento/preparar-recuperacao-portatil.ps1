[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$Diretorio,
  [Parameter(Mandatory=$true)][string]$Node
)
$ErrorActionPreference='Stop'
# Usa a mesma validação de proprietário, ACL e ancestrais do cofre existente.
& (Join-Path $PSScriptRoot 'usar-cofre.ps1') -Diretorio $Diretorio -Node $Node -Acao verificar | Out-Null
$taskRaiz=[IO.Path]::GetFullPath($Diretorio)
$taskPasta=Join-Path $taskRaiz 'cofre'
$taskArquivo=Join-Path $taskPasta 'config.portatil.enc'
$taskChaveArquivo=Join-Path $taskPasta 'recuperacao-chave.dpapi'
if (Test-Path -LiteralPath $taskArquivo) { throw 'Cópia portátil já existe; não substituir chaves/configurações.' }
$taskConteudo=$null; $taskChave=$null; $taskProcesso=$null
try {
  $taskConteudo=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes((Join-Path $taskPasta 'config.dpapi')),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
  if (Test-Path -LiteralPath $taskChaveArquivo) {
    if ((Get-Item -LiteralPath $taskChaveArquivo).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Chave não pode seguir atalhos.' }
    $taskChave=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($taskChaveArquivo),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
  } else {
    $taskChave=[Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
    $taskProtegida=[Security.Cryptography.ProtectedData]::Protect($taskChave,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
    $taskSaida=[IO.File]::Open($taskChaveArquivo,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try { $taskSaida.Write($taskProtegida,0,$taskProtegida.Length); $taskSaida.Flush($true) } finally { $taskSaida.Dispose() }
  }
  if ($taskChave.Length -ne 32) { throw 'Chave de recuperação divergente.' }
  $taskInicio=[Diagnostics.ProcessStartInfo]::new()
  $taskInicio.FileName=[IO.Path]::GetFullPath($Node)
  $taskInicio.ArgumentList.Add((Join-Path $PSScriptRoot 'selar-cofre-portatil.mjs'))
  $taskInicio.ArgumentList.Add($taskArquivo)
  $taskInicio.UseShellExecute=$false
  $taskInicio.CreateNoWindow=$true
  $taskInicio.RedirectStandardInput=$true
  $taskInicio.RedirectStandardOutput=$true
  $taskInicio.RedirectStandardError=$true
  $taskProcesso=[Diagnostics.Process]::new(); $taskProcesso.StartInfo=$taskInicio
  if (-not $taskProcesso.Start()) { throw 'Executor privado indisponível.' }
  $taskEntrada=@{chave=[Convert]::ToBase64String($taskChave);conteudo=[Convert]::ToBase64String($taskConteudo)} | ConvertTo-Json -Compress
  $taskProcesso.StandardInput.Write($taskEntrada); $taskProcesso.StandardInput.Close()
  if (-not $taskProcesso.WaitForExit(30000)) { $taskProcesso.Kill($true); throw 'Executor privado interrompido por tempo.' }
  if ($taskProcesso.ExitCode -ne 0) { throw 'Cópia portátil recusada; nenhum conteúdo privado registrado.' }
  [pscustomobject]@{Estado='Cópia portátil cifrada e recuperada sem DPAPI';Arquivo=$taskArquivo;ChaveExternaComprovada=$false;BackupRealRestaurado=$false}
} finally {
  if ($taskProcesso) { $taskProcesso.Dispose() }
  if ($taskConteudo) { [Array]::Clear($taskConteudo,0,$taskConteudo.Length) }
  if ($taskChave) { [Array]::Clear($taskChave,0,$taskChave.Length) }
  $taskEntrada=$null
}
