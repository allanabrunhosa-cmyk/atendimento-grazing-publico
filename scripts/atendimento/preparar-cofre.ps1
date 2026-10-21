[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$Origem,
  [Parameter(Mandatory=$true)][string]$Diretorio
)
$ErrorActionPreference='Stop'
if (-not $IsWindows) { throw 'Este cofre usa a proteção do usuário do Windows.' }
$taskCofre=[System.IO.Path]::GetFullPath($Diretorio)
$taskOrigem=[System.IO.Path]::GetFullPath($Origem)
if (Test-Path -LiteralPath $taskCofre) { throw 'O diretório já existe; não substituir nem regenerar suas chaves.' }
if (-not (Test-Path -LiteralPath (Join-Path $taskOrigem '.git'))) { throw 'Informe o checkout independente da origem.' }
$taskAncestral=$taskCofre
while ($taskAncestral) {
  if (Test-Path -LiteralPath (Join-Path $taskAncestral '.git')) { throw 'O cofre deve ficar fora de qualquer repositório.' }
  if (Test-Path -LiteralPath $taskAncestral) {
    if ((Get-Item -LiteralPath $taskAncestral).Attributes -band [System.IO.FileAttributes]::ReparsePoint) { throw 'O cofre não pode seguir atalhos ou junções.' }
  }
  $taskAncestral=[System.IO.Path]::GetDirectoryName($taskAncestral)
}
$taskPublico=@{}
foreach ($taskLinha in [System.IO.File]::ReadAllLines((Join-Path $taskOrigem '.env'))) {
  if ($taskLinha -match '^VITE_SUPABASE_(URL|PUBLISHABLE_KEY)=(.+)$') { $taskPublico[$Matches[1]]=$Matches[2].Trim().Trim('"',"'") }
}
$taskUrl=[System.Uri]$taskPublico['URL']
if ($taskUrl.Scheme -ne 'https' -or $taskUrl.Host -notmatch '^[a-z0-9-]+\.supabase\.co$' -or -not $taskPublico['PUBLISHABLE_KEY']) { throw 'Origem pública não conferida.' }
New-Item -ItemType Directory -Path $taskCofre | Out-Null
$taskUsuario=[System.Security.Principal.WindowsIdentity]::GetCurrent().User
$taskSistema=[System.Security.Principal.SecurityIdentifier]::new('S-1-5-18')
$taskAcl=[System.Security.AccessControl.DirectorySecurity]::new()
$taskAcl.SetOwner($taskUsuario)
$taskAcl.SetAccessRuleProtection($true,$false)
foreach ($taskPrincipal in @($taskUsuario,$taskSistema)) {
  $taskRegra=[System.Security.AccessControl.FileSystemAccessRule]::new($taskPrincipal,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
  $taskAcl.AddAccessRule($taskRegra)
}
Set-Acl -LiteralPath $taskCofre -AclObject $taskAcl
foreach ($taskPasta in @('cargas','arquivos','cofre')) { New-Item -ItemType Directory -Path (Join-Path $taskCofre $taskPasta) | Out-Null }
$taskToken=[Convert]::ToHexString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
$taskChave=[Convert]::ToHexString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
$taskConfig=@{
  ATENDIMENTO_EXECUCAO_CARGA=[Guid]::NewGuid().ToString()
  ATENDIMENTO_ORIGEM_URL=$taskPublico['URL']
  ATENDIMENTO_ORIGEM_PUBLISHABLE_KEY=$taskPublico['PUBLISHABLE_KEY']
  ATENDIMENTO_ORIGEM_COLETOR_TOKEN=$taskToken
  ATENDIMENTO_CARGA_SECRET=$taskChave
  ATENDIMENTO_BACKUP_PRIVADO=(Join-Path $taskCofre 'cargas')
  ATENDIMENTO_CAPTURA_APROVADA='0'
  ATENDIMENTO_BACKUP_EXTERNO_VERIFICADO='0'
}
$taskBytes=[Text.Encoding]::UTF8.GetBytes(($taskConfig | ConvertTo-Json -Compress))
$taskProtegido=[System.Security.Cryptography.ProtectedData]::Protect($taskBytes,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[System.IO.File]::WriteAllBytes((Join-Path $taskCofre 'cofre\config.dpapi'),$taskProtegido)
$taskRestaurado=[System.Security.Cryptography.ProtectedData]::Unprotect([System.IO.File]::ReadAllBytes((Join-Path $taskCofre 'cofre\config.dpapi')),$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser)
if (-not [System.Linq.Enumerable]::SequenceEqual[byte]($taskBytes,$taskRestaurado)) { throw 'Proteção/restauração do cofre divergente.' }
$taskFingerprint=[Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($taskToken))).ToLowerInvariant()
[System.IO.File]::WriteAllText((Join-Path $taskCofre 'cofre\fingerprint.txt'),$taskFingerprint)
$taskAclFinal=Get-Acl -LiteralPath $taskCofre
if (-not $taskAclFinal.AreAccessRulesProtected -or $taskAclFinal.Access.Count -ne 2) { throw 'Permissões locais não comprovadas.' }
[pscustomobject]@{Estado='Preparado';Diretorio=$taskCofre;Protecao='DPAPI CurrentUser + ACL usuário/SYSTEM';RestauracaoDoCofre=$true;CapturaAplicada=$false;DadosReaisCopiados=$false}
