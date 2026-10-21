[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$Diretorio,
  [Parameter(Mandatory=$true)][string]$Node,
  [ValidateSet('verificar','coletar','sincronizar','conferir-sincronizacao','ensaiar-backup','revalidar-backup')][string]$Acao='verificar',
  [switch]$CapturaComprovada,
  [string[]]$Argumentos=@()
)
$ErrorActionPreference='Stop'
if (-not $IsWindows) { throw 'Este cofre exige o usuário do Windows que o preparou.' }
$taskRaiz=[IO.Path]::GetFullPath($Diretorio)
$taskAcl=Get-Acl -LiteralPath $taskRaiz
$taskUsuario=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$taskSistema='S-1-5-18'
if (-not $taskAcl.AreAccessRulesProtected -or $taskAcl.Access.Count -ne 2 -or $taskAcl.Owner -ne [Security.Principal.WindowsIdentity]::GetCurrent().Name) { throw 'Proteção do cofre divergente.' }
foreach ($taskRegra in $taskAcl.Access) {
  if ($taskRegra.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -notin @($taskUsuario,$taskSistema) -or $taskRegra.AccessControlType -ne 'Allow') { throw 'Principal inesperado no cofre.' }
}
$taskAncestral=$taskRaiz
while ($taskAncestral) {
  if (Test-Path -LiteralPath (Join-Path $taskAncestral '.git')) { throw 'Cofre não pode ficar em repositório.' }
  if ((Get-Item -LiteralPath $taskAncestral).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Cofre não pode seguir atalhos.' }
  $taskAncestral=[IO.Path]::GetDirectoryName($taskAncestral)
}
$taskArquivo=Join-Path $taskRaiz 'cofre/config.dpapi'
if ((Get-Item -LiteralPath (Join-Path $taskRaiz 'cofre')).Attributes -band [IO.FileAttributes]::ReparsePoint -or (Get-Item -LiteralPath $taskArquivo).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Configuração não pode seguir atalhos.' }
$taskBytes=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($taskArquivo),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
$taskConfig=[Text.Encoding]::UTF8.GetString($taskBytes) | ConvertFrom-Json -AsHashtable
if ($Acao -eq 'verificar') {
  if ($Argumentos.Count) { throw 'Verificação não recebe argumentos.' }
  [pscustomobject]@{Cofre='Protegido e legível pelo proprietário';CapturaAutorizada=($taskConfig.ATENDIMENTO_CAPTURA_APROVADA -eq '1');BackupVerificado=($taskConfig.ATENDIMENTO_BACKUP_EXTERNO_VERIFICADO -eq '1')}
  [Array]::Clear($taskBytes,0,$taskBytes.Length)
  return
}
if ($Acao -in @('ensaiar-backup','revalidar-backup') -and $Argumentos.Count) { throw 'Ensaio não recebe argumentos.' }
$taskPermitidas=@('DATABASE_URL','ATENDIMENTO_EXECUCAO_CARGA','ATENDIMENTO_ORIGEM_URL','ATENDIMENTO_ORIGEM_PUBLISHABLE_KEY','ATENDIMENTO_ORIGEM_SERVICE_ROLE_KEY','ATENDIMENTO_ORIGEM_COLETOR_TOKEN','ATENDIMENTO_CARGA_SECRET','ATENDIMENTO_BACKUP_PRIVADO','ATENDIMENTO_CAPTURA_APROVADA','ATENDIMENTO_BACKUP_EXTERNO_VERIFICADO')
$taskAmbiente=@{}
try {
  if ($CapturaComprovada) {
    if ($Acao -notin @('coletar','sincronizar','conferir-sincronizacao')) { throw 'Comprovação só habilita coleta autorizada.' }
    $taskBanco=Get-Content -LiteralPath (Join-Path $taskRaiz 'banco/recuperacao-revalidada.json') -Raw | ConvertFrom-Json
    $taskFisico=Get-Content -LiteralPath (Join-Path $taskRaiz 'banco/recuperacao-fisica-validada.json') -Raw | ConvertFrom-Json
    $taskPortatil=Get-Content -LiteralPath (Join-Path $taskRaiz 'cofre/recuperacao-portatil-comprovada.json') -Raw | ConvertFrom-Json
    $taskCaptura=Get-Content -LiteralPath (Join-Path $taskRaiz 'banco/captura-instalada-validada.json') -Raw | ConvertFrom-Json
    if (-not $taskBanco.realNativeRestore -or -not $taskBanco.equalAllTableData -or -not $taskFisico.recuperacaoPorChaveOriginal -or -not $taskPortatil.arquivoHash -or -not $taskCaptura.captura_instalada -or $taskCaptura.triggers_ativos_corretos -ne 37 -or -not $taskCaptura.continuidade_rpc -or -not $taskCaptura.snapshot_rpc -or -not $taskCaptura.sem_token_negado -or -not $taskCaptura.token_errado_negado) { throw 'Evidências reais incompletas.' }
    $taskDestino=[UriBuilder]::new($taskConfig.DATABASE_URL)
    if ($taskDestino.Host -ne '127.0.0.1' -or $taskDestino.Port -ne 65437 -or $taskDestino.Path -ne '/donatella_preparacao' -or $taskDestino.UserName -ne 'donatella_coletor') { throw 'Destino de coleta inesperado.' }
    # Habilitação limitada a este processo: não altera o cofre portátil ou serviços.
    # Os RPCs revalidam continuidade e os 37 triggers a cada leitura/confirmação.
    $taskConfig.ATENDIMENTO_CAPTURA_APROVADA='1'
    $taskConfig.ATENDIMENTO_BACKUP_EXTERNO_VERIFICADO='1'
  }
  foreach ($taskNome in $taskPermitidas) {
    $taskAmbiente[$taskNome]=[Environment]::GetEnvironmentVariable($taskNome,'Process')
    [Environment]::SetEnvironmentVariable($taskNome,[string]$taskConfig[$taskNome],'Process')
  }
  if ($Acao -in @('ensaiar-backup','revalidar-backup')) {
    $taskUrl=[UriBuilder]::new($taskConfig.DATABASE_URL)
    if ($taskUrl.Host -ne '127.0.0.1' -or $taskUrl.Port -ne 65437 -or $taskUrl.Path -ne '/donatella_preparacao') { throw 'Destino privado inesperado.' }
    $taskUrl.Path='/donatella_ensaio_restauracao'
    [Environment]::SetEnvironmentVariable('DATABASE_URL',$taskUrl.Uri.AbsoluteUri,'Process')
    if ($Acao -eq 'revalidar-backup') { $Argumentos=@('--revalidar') }
  }
  $taskProjeto=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
  $taskScript=switch ($Acao) { 'coletar' {'coletar.ts'} 'sincronizar' {'sincronizar.ts'} 'conferir-sincronizacao' {'conferir-sincronizacao.ts'} default {'ensaiar-backup.ts'} }
  Push-Location -LiteralPath $taskProjeto
  try { & $Node --conditions=react-server --import tsx (Join-Path $PSScriptRoot $taskScript) @Argumentos; if ($LASTEXITCODE -ne 0) { throw 'Execução privada interrompida; não registrar o conteúdo da configuração.' } }
  finally { Pop-Location }
} finally {
  foreach ($taskNome in $taskAmbiente.Keys) { [Environment]::SetEnvironmentVariable($taskNome,$taskAmbiente[$taskNome],'Process') }
  [Array]::Clear($taskBytes,0,$taskBytes.Length)
  $taskConfig=$null
}
