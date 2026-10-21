[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$Diretorio,[Parameter(Mandatory=$true)][string]$Node,[ValidateSet('copiar','listar','conferir-etags')][string]$Acao='copiar',[string]$ManifestoAtual)
$ErrorActionPreference='Stop'
& (Join-Path $PSScriptRoot 'usar-cofre.ps1') -Diretorio $Diretorio -Node $Node -Acao verificar | Out-Null
$taskRaiz=[IO.Path]::GetFullPath($Diretorio)
$taskBytes=$null
$taskAmbiente=@{}
try {
  $taskBytes=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes((Join-Path $taskRaiz 'cofre/config.dpapi')),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
  $taskConfig=[Text.Encoding]::UTF8.GetString($taskBytes) | ConvertFrom-Json -AsHashtable
  foreach ($taskNome in @('ATENDIMENTO_ORIGEM_URL','ATENDIMENTO_ORIGEM_PUBLISHABLE_KEY')) {
    $taskAmbiente[$taskNome]=[Environment]::GetEnvironmentVariable($taskNome,'Process')
    [Environment]::SetEnvironmentVariable($taskNome,[string]$taskConfig[$taskNome],'Process')
  }
  $taskScript=switch($Acao){'listar'{'listar-storage-atual.mjs'}'conferir-etags'{'conferir-etags-storage.mjs'}default{'backup-arquivos.mjs'}}
  if($ManifestoAtual -and ($Acao -ne 'copiar' -or $ManifestoAtual -notmatch '^storage-live-[a-f0-9-]{36}\.json$')){throw 'Manifesto de alterações inválido.'}
  $taskArgumentos=@($taskRaiz); if($ManifestoAtual){$taskArgumentos+=$ManifestoAtual}
  & $Node (Join-Path $PSScriptRoot $taskScript) @taskArgumentos
  if ($LASTEXITCODE -ne 0) { throw 'Cópia física incompleta; preservar versões e conferir evidência privada antes de considerar arquivos reconciliados.' }
} finally {
  foreach ($taskNome in $taskAmbiente.Keys) { [Environment]::SetEnvironmentVariable($taskNome,$taskAmbiente[$taskNome],'Process') }
  if ($taskBytes) { [Array]::Clear($taskBytes,0,$taskBytes.Length) }
  $taskConfig=$null
}
