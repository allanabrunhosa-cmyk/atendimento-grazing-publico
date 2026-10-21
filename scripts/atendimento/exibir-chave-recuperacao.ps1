[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$Diretorio,
  [Parameter(Mandatory=$true)][string]$Node,
  [ValidateSet('entregar','conferir')][string]$Acao='entregar',
  [switch]$RecriarConferencia
)
$ErrorActionPreference='Stop'
# Abrir visivelmente somente quando o usuário pedir essa entrega privada.
& (Join-Path $PSScriptRoot 'usar-cofre.ps1') -Diretorio $Diretorio -Node $Node -Acao verificar | Out-Null
$taskPasta=Join-Path ([IO.Path]::GetFullPath($Diretorio)) 'cofre'
if ($RecriarConferencia -and $Acao -ne 'conferir') { throw 'Recriação permite somente o formulário de conferência.' }
if ($Acao -eq 'conferir') {
  $taskDestino=Join-Path $taskPasta 'CONFERENCIA-CHAVE-IPHONE.txt'
  $taskExiste=Test-Path -LiteralPath $taskDestino
  if ($taskExiste -and -not $RecriarConferencia) { throw 'Conferência já preparada; não substituir.' }
  if ($taskExiste -and ((Get-Item -LiteralPath $taskDestino).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Conferência não pode seguir atalhos.' }
  $taskTexto="# Copie SOMENTE a chave guardada na nota do iPhone para depois do sinal de igual.`r`n# Salve este arquivo e feche esta aba do Bloco de Notas. Nao envie pelo chat.`r`nCHAVE_DO_IPHONE=`r`n"
  $taskModo=if ($RecriarConferencia) { [IO.FileMode]::Create } else { [IO.FileMode]::CreateNew }
  $taskSaida=[IO.File]::Open($taskDestino,$taskModo,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try { $taskBytes=[Text.Encoding]::UTF8.GetBytes($taskTexto); $taskSaida.Write($taskBytes,0,$taskBytes.Length); $taskSaida.Flush($true) } finally { $taskSaida.Dispose() }
  Start-Process -FilePath 'notepad.exe' -ArgumentList ('"'+$taskDestino+'"') -WindowStyle Normal
  [pscustomobject]@{Estado='Conferência privada aberta';RecuperacaoExternaComprovada=$false}
  return
}
$taskChaveArquivo=Join-Path $taskPasta 'recuperacao-chave.dpapi'
if ((Get-Item -LiteralPath $taskChaveArquivo).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Chave não pode seguir atalhos.' }
$taskChave=$null
try {
  $taskChave=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($taskChaveArquivo),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
  if ($taskChave.Length -ne 32) { throw 'Chave de recuperação divergente.' }
  $taskDestino=Join-Path $taskPasta 'CHAVE-RECUPERACAO-CUSTODIA-PRIVADA.txt'
  if (Test-Path -LiteralPath $taskDestino) { throw 'Arquivo de entrega já existe; não substituir nem reexibir automaticamente.' }
  $taskTexto="DONATELLA - CHAVE PRIVADA DE RECUPERACAO`r`n`r`nGuarde a linha abaixo em uma nota bloqueada do iCloud. Nao envie pelo chat, e-mail ou Git.`r`n`r`n$([Convert]::ToHexString($taskChave).ToLowerInvariant())`r`n`r`nEsta chave recupera config.portatil.enc. A senha da nota deve ser recuperavel por voce. Depois de guardar e conferir a chave, este arquivo de entrega sera removido.`r`n"
  $taskSaida=[IO.File]::Open($taskDestino,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try { $taskBytes=[Text.Encoding]::UTF8.GetBytes($taskTexto); $taskSaida.Write($taskBytes,0,$taskBytes.Length); $taskSaida.Flush($true) }
  finally { $taskSaida.Dispose(); if ($taskBytes) { [Array]::Clear($taskBytes,0,$taskBytes.Length) } }
  Start-Process -FilePath 'notepad.exe' -ArgumentList ('"'+$taskDestino+'"') -WindowStyle Normal
  [pscustomobject]@{Estado='Arquivo privado aberto para custódia pelo usuário';ChaveExibidaNoLog=$false;RecuperacaoExternaComprovada=$false}
} finally { if ($taskChave) { [Array]::Clear($taskChave,0,$taskChave.Length) }; $taskTexto=$null }
