[CmdletBinding()]
param([switch]$Https,[string]$Diretorio,[string]$ChaveSsh,[string]$DestinoSsh)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'parametros-privados.ps1')
$taskSshAcesso=Obter-AcessoSshPrivado -ChaveSsh $ChaveSsh -DestinoSsh $DestinoSsh
$taskRaiz=Obter-DiretorioPrivado -Diretorio $Diretorio
$taskBytes=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes((Join-Path $taskRaiz 'cofre/servicos-homologacao.dpapi')),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
try{
 $taskConfig=[Text.Encoding]::UTF8.GetString($taskBytes)|ConvertFrom-Json
 $p=[Diagnostics.ProcessStartInfo]::new('ssh');$p.UseShellExecute=$false;$p.CreateNoWindow=$true;$p.RedirectStandardInput=$true;$p.RedirectStandardOutput=$true;$p.RedirectStandardError=$true
 foreach($a in @('-i',$taskSshAcesso.Chave,'-o','BatchMode=yes',$taskSshAcesso.Destino,'docker exec -i grazing-donatella-consulta-v2 node /release/smoke-consulta.mjs')){$p.ArgumentList.Add($a)}
 $c=[Diagnostics.Process]::Start($p)
 try{$o=$c.StandardOutput.ReadToEndAsync();$e=$c.StandardError.ReadToEndAsync();$c.StandardInput.Write((@{senha=$taskConfig.senhaEntrega;origem=$(if($Https){'https://atendimento.grazinghub.com.br'}else{'http://localhost:3000'})}|ConvertTo-Json -Compress));$c.StandardInput.Close();$c.WaitForExit();if($c.ExitCode -ne 0){throw 'Smoke falhou; saída privada não exibida.'};$o.Result}finally{$c.Dispose()}
}finally{[Array]::Clear($taskBytes,0,$taskBytes.Length);$taskConfig=$null}
