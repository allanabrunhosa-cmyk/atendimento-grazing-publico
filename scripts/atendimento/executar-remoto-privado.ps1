param([Parameter(Mandatory=$true)][string]$Arquivo,[string]$Saida,[string]$ChaveSsh,[string]$DestinoSsh)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'parametros-privados.ps1')
$taskSshAcesso=Obter-AcessoSshPrivado -ChaveSsh $ChaveSsh -DestinoSsh $DestinoSsh
$taskInicio=[Diagnostics.ProcessStartInfo]::new('ssh');$taskInicio.UseShellExecute=$false;$taskInicio.CreateNoWindow=$true
$taskInicio.RedirectStandardInput=$true;$taskInicio.RedirectStandardOutput=$true;$taskInicio.RedirectStandardError=$true
$taskInicio.StandardInputEncoding=[Text.UTF8Encoding]::new($false);$taskInicio.StandardOutputEncoding=[Text.UTF8Encoding]::new($false);$taskInicio.StandardErrorEncoding=[Text.UTF8Encoding]::new($false)
foreach($taskArg in @('-i',$taskSshAcesso.Chave,'-o','BatchMode=yes',$taskSshAcesso.Destino,'sh -s')){$taskInicio.ArgumentList.Add($taskArg)}
$taskProcesso=[Diagnostics.Process]::Start($taskInicio)
try{
 $taskOut=$taskProcesso.StandardOutput.ReadToEndAsync();$taskErr=$taskProcesso.StandardError.ReadToEndAsync()
 $taskProcesso.StandardInput.Write([IO.File]::ReadAllText((Resolve-Path -LiteralPath $Arquivo)).Replace("`r`n","`n"));$taskProcesso.StandardInput.Close();$taskProcesso.WaitForExit()
 if($taskProcesso.ExitCode -ne 0){if($Saida){[IO.File]::WriteAllText((Join-Path (Get-Location) $Saida),$taskOut.Result,[Text.UTF8Encoding]::new($false))};throw ('Execução remota recusada, código '+$taskProcesso.ExitCode+'. Conferir privadamente; erro bruto suprimido.')}
 if($Saida){[IO.File]::WriteAllText((Join-Path (Get-Location) $Saida),$taskOut.Result,[Text.UTF8Encoding]::new($false))}else{$taskOut.Result}
}finally{$taskProcesso.Dispose()}
