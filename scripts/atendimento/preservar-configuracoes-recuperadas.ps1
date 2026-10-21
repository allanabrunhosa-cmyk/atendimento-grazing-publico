[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$Diretorio,[Parameter(Mandatory=$true)][string]$Node,[switch]$IncluirChaveAcessoVps,[string]$ChaveSsh,[string]$DestinoSsh)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'parametros-privados.ps1')
$taskSshAcesso=Obter-AcessoSshPrivado -ChaveSsh $ChaveSsh -DestinoSsh $DestinoSsh
& (Join-Path $PSScriptRoot 'usar-cofre.ps1') -Diretorio $Diretorio -Node $Node -Acao verificar | Out-Null
$taskRaiz=[IO.Path]::GetFullPath($Diretorio)
$taskChave=$null; $taskConteudo=$null; $taskProcesso=$null
try {
  $taskChave=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes((Join-Path $taskRaiz 'cofre/recuperacao-chave.dpapi')),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
  if($taskChave.Length -ne 32){throw 'Chave portátil divergente.'}
  # Somente leitura da cópia isolada; stdout privado fica em memória, sem logs/arquivo cru.
  $taskInicio=[Diagnostics.ProcessStartInfo]::new()
  $taskInicio.FileName='ssh.exe'; $taskInicio.UseShellExecute=$false; $taskInicio.CreateNoWindow=$true
  $taskInicio.RedirectStandardInput=$true; $taskInicio.RedirectStandardOutput=$true; $taskInicio.RedirectStandardError=$true
  foreach($taskArg in @('-i',$taskSshAcesso.Chave,'-o','BatchMode=yes','-o','ConnectTimeout=10',$taskSshAcesso.Destino,'docker exec -i grazing-donatella-recuperacao-v2-banco psql -X -qAt -v ON_ERROR_STOP=1 -h /tmp -U postgres -d postgres')){$taskInicio.ArgumentList.Add($taskArg)}
  $taskProcesso=[Diagnostics.Process]::new(); $taskProcesso.StartInfo=$taskInicio
  if(-not $taskProcesso.Start()){throw 'Leitor privado indisponível.'}
  $taskProcesso.StandardInput.WriteLine("BEGIN READ ONLY; SELECT json_build_object('nina_settings',(SELECT json_agg(to_jsonb(t)) FROM public.nina_settings t),'system_settings',(SELECT json_agg(to_jsonb(t)) FROM public.system_settings t),'cron_job_definitions',(SELECT json_agg(to_jsonb(t)) FROM cron.job t)); ROLLBACK;")
  $taskProcesso.StandardInput.Close()
  $taskSaida=$taskProcesso.StandardOutput.ReadToEndAsync(); $taskErro=$taskProcesso.StandardError.ReadToEndAsync()
  if(-not $taskProcesso.WaitForExit(30000)){$taskProcesso.Kill($true);throw 'Leitura privada interrompida por tempo.'}
  if($taskProcesso.ExitCode -ne 0){throw 'Leitura privada recusada; não emitir conteúdo da consulta.'}
  $taskJson=$taskSaida.GetAwaiter().GetResult()
  $taskDados=$taskJson | ConvertFrom-Json -AsHashtable
  if(-not $taskDados.ContainsKey('nina_settings') -or -not $taskDados.ContainsKey('system_settings')){throw 'Formato privado divergente.'}
  if($IncluirChaveAcessoVps){
    # Exige a opção explícita do proprietário; nunca inclui a chave por padrão.
    $taskAcesso=$taskSshAcesso.Chave
    if((Get-Item -LiteralPath $taskAcesso).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Chave de acesso não pode seguir atalhos.'}
    $taskDados['acesso_vps']=@{host=$taskSshAcesso.Destino.Split('@')[1];usuario=$taskSshAcesso.Destino.Split('@')[0];chavePrivada=[IO.File]::ReadAllText($taskAcesso)}
  }
  $taskConteudo=[Text.Encoding]::UTF8.GetBytes(($taskDados | ConvertTo-Json -Depth 100 -Compress))
  $taskProcesso.Dispose(); $taskProcesso=$null
  $taskArquivo=Join-Path $taskRaiz ('cofre/configuracoes-origem-'+[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')+'.portatil.enc')
  $taskInicio=[Diagnostics.ProcessStartInfo]::new(); $taskInicio.FileName=[IO.Path]::GetFullPath($Node)
  $taskInicio.ArgumentList.Add((Join-Path $PSScriptRoot 'selar-cofre-portatil.mjs')); $taskInicio.ArgumentList.Add($taskArquivo)
  $taskInicio.UseShellExecute=$false; $taskInicio.CreateNoWindow=$true
  $taskInicio.RedirectStandardInput=$true; $taskInicio.RedirectStandardOutput=$true; $taskInicio.RedirectStandardError=$true
  $taskProcesso=[Diagnostics.Process]::new(); $taskProcesso.StartInfo=$taskInicio
  if(-not $taskProcesso.Start()){throw 'Selador privado indisponível.'}
  $taskEntrada=@{chave=[Convert]::ToBase64String($taskChave);conteudo=[Convert]::ToBase64String($taskConteudo)} | ConvertTo-Json -Compress
  $taskProcesso.StandardInput.Write($taskEntrada); $taskProcesso.StandardInput.Close()
  $taskSaida=$taskProcesso.StandardOutput.ReadToEndAsync(); $taskErro=$taskProcesso.StandardError.ReadToEndAsync()
  if(-not $taskProcesso.WaitForExit(30000)){$taskProcesso.Kill($true);throw 'Selagem privada interrompida por tempo.'}
  if($taskProcesso.ExitCode -ne 0){throw 'Selagem privada recusada.'}
  [pscustomobject]@{ConfiguracoesReais='Cifradas, relidas e recuperadas sem DPAPI';Chave='Mesma chave com custódia no iPhone';RecuperacaoAcessoVps=[bool]$IncluirChaveAcessoVps;ConfiguracoesCloudExternasPreservadas=$false;AppSecretMetaPreservado=$false}
} finally {
  if($taskProcesso){$taskProcesso.Dispose()}
  if($taskChave){[Array]::Clear($taskChave,0,$taskChave.Length)}
  if($taskConteudo){[Array]::Clear($taskConteudo,0,$taskConteudo.Length)}
  $taskEntrada=$null; $taskJson=$null; $taskDados=$null
}
