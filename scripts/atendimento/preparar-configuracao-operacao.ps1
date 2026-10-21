[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$Diretorio,[Parameter(Mandatory=$true)][string]$Node,[Parameter(Mandatory=$true)][string]$CanalPrivado)
$ErrorActionPreference='Stop'
$taskCanalPrivado=[IO.Path]::GetFullPath($CanalPrivado)
if(-not (Test-Path -LiteralPath $taskCanalPrivado -PathType Leaf)){throw 'Arquivo privado de metadados do canal indisponível.'}
& (Join-Path $PSScriptRoot 'usar-cofre.ps1') -Diretorio $Diretorio -Node $Node -Acao verificar | Out-Null
$taskCofre=Join-Path ([IO.Path]::GetFullPath($Diretorio)) 'cofre'
$taskMeta=@(Get-ChildItem -LiteralPath $taskCofre -File | Where-Object Name -Match '^meta-\d{8}T\d{9}Z\.portatil\.enc$' | Sort-Object Name)[-1]
$taskOrigem=@(Get-ChildItem -LiteralPath $taskCofre -File | Where-Object Name -Match '^configuracoes-origem-\d{8}T\d{9}Z\.portatil\.enc$' | Sort-Object Name)[-1]
if(-not $taskMeta -or -not $taskOrigem){throw 'Cópias privadas necessárias indisponíveis.'}
$taskChave=$null;$taskProcesso=$null
try {
 $taskChave=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes((Join-Path $taskCofre 'recuperacao-chave.dpapi')),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
 $taskInicio=[Diagnostics.ProcessStartInfo]::new([IO.Path]::GetFullPath($Node));$taskInicio.UseShellExecute=$false;$taskInicio.CreateNoWindow=$true
 $taskInicio.ArgumentList.Add((Join-Path $PSScriptRoot 'preparar-configuracao-operacao.mjs'))
 $taskInicio.RedirectStandardInput=$true;$taskInicio.RedirectStandardOutput=$true;$taskInicio.RedirectStandardError=$true
 $taskProcesso=[Diagnostics.Process]::Start($taskInicio)
 $taskEntrada=@{chave=[Convert]::ToBase64String($taskChave);cofre=$taskCofre;meta=$taskMeta.FullName;origem=$taskOrigem.FullName;canalPrivado=$taskCanalPrivado} | ConvertTo-Json -Compress
 $taskProcesso.StandardInput.Write($taskEntrada);$taskProcesso.StandardInput.Close()
 $taskSaida=$taskProcesso.StandardOutput.ReadToEndAsync();$taskErro=$taskProcesso.StandardError.ReadToEndAsync()
 if(-not $taskProcesso.WaitForExit(60000)){$taskProcesso.Kill($true);throw 'Conferência privada interrompida por prazo.'}
 if($taskProcesso.ExitCode -ne 0){throw 'Conferência privada recusada; nenhuma credencial registrada.'}
 $taskSaida.GetAwaiter().GetResult() | ConvertFrom-Json
}finally{if($taskProcesso){$taskProcesso.Dispose()};if($taskChave){[Array]::Clear($taskChave,0,$taskChave.Length)};$taskEntrada=$null}
