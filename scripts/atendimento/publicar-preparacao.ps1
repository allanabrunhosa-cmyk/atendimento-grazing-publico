[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$Diretorio,[string]$ChaveSsh,[string]$DestinoSsh,[string]$RaizRemota)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'parametros-privados.ps1')
$taskSshAcesso=Obter-AcessoSshPrivado -ChaveSsh $ChaveSsh -DestinoSsh $DestinoSsh
$taskRaizRemota=Obter-RaizRemotaPrivada -Raiz $RaizRemota -Variavel ATENDIMENTO_RAIZ_REMOTA_HOMOLOGACAO
$taskRaiz=[IO.Path]::GetFullPath($Diretorio)
$taskArquivo=Join-Path $taskRaiz 'cofre/config.dpapi'
$taskAcl=Get-Acl -LiteralPath $taskRaiz
if (-not $IsWindows -or -not $taskAcl.AreAccessRulesProtected -or $taskAcl.Access.Count -ne 2) { throw 'Cofre privado não preparado.' }
$taskConfig=[Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($taskArquivo),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)) | ConvertFrom-Json -AsHashtable
if (-not $taskConfig.ATENDIMENTO_HOMOLOGACAO_SENHA_ADMIN -and -not $taskConfig.DATABASE_URL) {
  $taskAdmin=[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
  $taskColetor=[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
  $taskConfig.ATENDIMENTO_HOMOLOGACAO_SENHA_ADMIN=$taskAdmin
  $taskConfig.DATABASE_URL="postgresql://donatella_coletor:${taskColetor}@127.0.0.1:65437/donatella_preparacao"
  $taskBytes=[Text.Encoding]::UTF8.GetBytes(($taskConfig | ConvertTo-Json -Compress))
  $taskProtegido=[Security.Cryptography.ProtectedData]::Protect($taskBytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
  $taskTemporario=Join-Path $taskRaiz ('cofre/'+[Guid]::NewGuid().ToString()+'.parcial')
  [IO.File]::WriteAllBytes($taskTemporario,$taskProtegido)
  [IO.File]::Replace($taskTemporario,$taskArquivo,(Join-Path $taskRaiz 'cofre/config-anterior.dpapi'))
  [Array]::Clear($taskBytes,0,$taskBytes.Length)
} else {
  $taskAdmin=[string]$taskConfig.ATENDIMENTO_HOMOLOGACAO_SENHA_ADMIN
  $taskUrl=[Uri]$taskConfig.DATABASE_URL
  if ($taskUrl.Scheme -ne 'postgresql' -or $taskUrl.Host -ne '127.0.0.1' -or $taskUrl.Port -ne 65437 -or $taskUrl.AbsolutePath -ne '/donatella_preparacao' -or $taskUrl.UserInfo -notmatch '^donatella_coletor:([a-f0-9]{64})$') { throw 'Configuração privada divergente; não regenerar.' }
  $taskColetor=$Matches[1]
}
if ($taskAdmin -notmatch '^[a-f0-9]{64}$' -or $taskColetor -notmatch '^[a-f0-9]{64}$') { throw 'Chaves privadas divergentes.' }
$taskSsh=@('-i',$taskSshAcesso.Chave,'-o','BatchMode=yes','-o','ConnectTimeout=10')
& ssh @taskSsh $taskSshAcesso.Destino "umask 077; mkdir -p $taskRaizRemota; chmod 700 $taskRaizRemota"
if ($LASTEXITCODE -ne 0) { throw 'Preparação do diretório privado falhou.' }
$taskProjeto=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
& scp @taskSsh (Join-Path $taskProjeto 'infra/atendimento/compose.homologacao.yml') (Join-Path $PSScriptRoot 'sql/005-carga-destino.sql') (Join-Path $PSScriptRoot 'preparar-homologacao.sh') "$($taskSshAcesso.Destino):$taskRaizRemota/"
if ($LASTEXITCODE -ne 0) { throw 'Envio dos arquivos de preparação falhou.' }
$taskInicio=[Diagnostics.ProcessStartInfo]::new('ssh')
$taskInicio.UseShellExecute=$false
$taskInicio.CreateNoWindow=$true
$taskInicio.RedirectStandardInput=$true
$taskInicio.RedirectStandardOutput=$true
$taskInicio.RedirectStandardError=$true
foreach ($taskArg in @($taskSsh + @($taskSshAcesso.Destino,"sh $taskRaizRemota/preparar-homologacao.sh $taskRaizRemota"))) { $taskInicio.ArgumentList.Add($taskArg) }
$taskProcesso=[Diagnostics.Process]::Start($taskInicio)
try {
  $taskSaida=$taskProcesso.StandardOutput.ReadToEndAsync()
  $taskErro=$taskProcesso.StandardError.ReadToEndAsync()
  $taskProcesso.StandardInput.Write($taskAdmin+[char]10)
  $taskProcesso.StandardInput.Write($taskColetor+[char]10)
  $taskProcesso.StandardInput.Close()
  $taskProcesso.WaitForExit()
  if ($taskProcesso.ExitCode -ne 0) { throw 'Preparação interrompida; configuração preservada no cofre, revisar log privado na VPS.' }
  [pscustomobject]@{Estado='Banco privado preparado';Exposicao='Rede Docker interna sem portas publicadas; túnel SSH';OrigemAcessada=$false;ServicoHubAlterado=$false}
} finally { $taskProcesso.Dispose(); $taskAdmin=$null; $taskColetor=$null }
