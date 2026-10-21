param([Parameter(Mandatory=$true)][string]$Node)
$ErrorActionPreference='Stop'
$taskBase=[IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$taskRaiz=Join-Path $taskBase ('donatella-meta-ficticio-'+[Guid]::NewGuid().ToString())
if(-not [IO.Path]::GetFullPath($taskRaiz).StartsWith($taskBase,[StringComparison]::OrdinalIgnoreCase)){throw 'Teste fora da pasta temporária.'}
$taskKey=[Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
try {
  New-Item -ItemType Directory -Path $taskRaiz | Out-Null
  $taskUsuario=[Security.Principal.WindowsIdentity]::GetCurrent().User
  $taskAcl=[Security.AccessControl.DirectorySecurity]::new();$taskAcl.SetOwner($taskUsuario);$taskAcl.SetAccessRuleProtection($true,$false)
  foreach($taskPrincipal in @($taskUsuario,[Security.Principal.SecurityIdentifier]::new('S-1-5-18'))){
    $taskRegra=[Security.AccessControl.FileSystemAccessRule]::new($taskPrincipal,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
    $taskAcl.AddAccessRule($taskRegra)
  }
  Set-Acl -LiteralPath $taskRaiz -AclObject $taskAcl
  New-Item -ItemType Directory -Path (Join-Path $taskRaiz 'cofre') | Out-Null
  foreach($taskPar in @(@('config.dpapi',[Text.Encoding]::UTF8.GetBytes('{"ATENDIMENTO_CAPTURA_APROVADA":"0","ATENDIMENTO_BACKUP_EXTERNO_VERIFICADO":"0"}')),@('recuperacao-chave.dpapi',$taskKey))){
    [IO.File]::WriteAllBytes((Join-Path $taskRaiz ('cofre/'+$taskPar[0])),[Security.Cryptography.ProtectedData]::Protect($taskPar[1],$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))
  }
  $taskFormulario=Join-Path $taskRaiz 'cofre/META-RECUPERACAO-PRIVADA.txt'
  [IO.File]::WriteAllText($taskFormulario,'APP_SECRET_META=')
  $taskRecusou=$false
  try {& (Join-Path $PSScriptRoot 'preservar-segredo-meta.ps1') -Diretorio $taskRaiz -Node $Node | Out-Null}catch{$taskRecusou=$true}
  if(-not $taskRecusou -or -not (Test-Path -LiteralPath $taskFormulario) -or @(Get-ChildItem -LiteralPath (Join-Path $taskRaiz 'cofre') -Filter '*.enc').Count){throw 'Formulário inválido não foi bloqueado.'}
  [IO.File]::WriteAllText($taskFormulario,('APP_SECRET_META='+('f'*32)))
  & (Join-Path $PSScriptRoot 'preservar-segredo-meta.ps1') -Diretorio $taskRaiz -Node $Node | Out-Null
  if(Test-Path -LiteralPath $taskFormulario){throw 'Formulário temporário não foi removido após prova.'}
  $taskEncrypted=@(Get-ChildItem -LiteralPath (Join-Path $taskRaiz 'cofre') -Filter '*.enc')
  if($taskEncrypted.Count -ne 1 -or $taskEncrypted[0].Length -le 32){throw 'Cópia cifrada não preservada.'}
  [pscustomobject]@{Teste='Formulário vazio recusado; segredo fictício cifrado/relido/decifrado pela CLI; formulário removido somente após êxito';Aprovado=$true} | ConvertTo-Json -Compress
} finally {
  [Array]::Clear($taskKey,0,$taskKey.Length)
  $taskResolvido=[IO.Path]::GetFullPath($taskRaiz)
  if($taskResolvido.StartsWith($taskBase,[StringComparison]::OrdinalIgnoreCase) -and (Split-Path $taskResolvido -Leaf) -match '^donatella-meta-ficticio-[a-f0-9-]{36}$' -and (Test-Path -LiteralPath $taskResolvido)){
    Remove-Item -LiteralPath $taskResolvido -Recurse -Force
  }
}
