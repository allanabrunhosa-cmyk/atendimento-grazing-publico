[CmdletBinding()]
param([string]$ChaveSsh,[string]$DestinoSsh)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'parametros-privados.ps1')
$taskSshAcesso=Obter-AcessoSshPrivado -ChaveSsh $ChaveSsh -DestinoSsh $DestinoSsh
$taskSsh=@('-i',$taskSshAcesso.Chave,'-o','BatchMode=yes','-o','ConnectTimeout=10')
$taskIp=& ssh @taskSsh $taskSshAcesso.Destino 'docker inspect grazing-donatella-homologacao-v2-banco --format "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}"'
if ($LASTEXITCODE -ne 0 -or $taskIp -notmatch '^172\.(1[6-9]|2[0-9]|3[01])\.\d{1,3}\.\d{1,3}$') { throw 'Endereço interno da preparação não comprovado.' }
# Execução em primeiro plano. Encerrar esta sessão fecha somente o túnel.
& ssh @taskSsh -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -N -L "127.0.0.1:65437:${taskIp}:5432" $taskSshAcesso.Destino
if ($LASTEXITCODE -ne 0) { throw 'Túnel privado interrompido.' }
