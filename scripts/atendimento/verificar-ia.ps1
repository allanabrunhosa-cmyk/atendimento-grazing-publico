[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$Diretorio,[Parameter(Mandatory=$true)][string]$Node)
$ErrorActionPreference='Stop'
& (Join-Path $PSScriptRoot 'usar-cofre.ps1') -Diretorio $Diretorio -Node $Node -Acao verificar | Out-Null
$taskCofre=Join-Path ([IO.Path]::GetFullPath($Diretorio)) 'cofre'
$taskOrigem=@(Get-ChildItem -LiteralPath $taskCofre -File | Where-Object Name -Match '^configuracoes-origem-\d{8}T\d{9}Z\.portatil\.enc$' | Sort-Object Name)[-1]
if(-not $taskOrigem){throw 'Cópias privadas necessárias indisponíveis.'}
$taskChave=$null;$taskProcesso=$null
try {
 $taskChave=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes((Join-Path $taskCofre 'recuperacao-chave.dpapi')),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
 $taskInicio=[Diagnostics.ProcessStartInfo]::new();$taskInicio.FileName=[IO.Path]::GetFullPath($Node)
 $taskInicio.ArgumentList.Add((Join-Path $PSScriptRoot 'verificar-ia.mjs'))
 $taskInicio.UseShellExecute=$false;$taskInicio.CreateNoWindow=$true
 $taskInicio.RedirectStandardInput=$true;$taskInicio.RedirectStandardOutput=$true;$taskInicio.RedirectStandardError=$true
 $taskProcesso=[Diagnostics.Process]::new();$taskProcesso.StartInfo=$taskInicio
 if(-not $taskProcesso.Start()){throw 'Verificador privado indisponível.'}
 $taskEntrada=@{chave=[Convert]::ToBase64String($taskChave);cofre=$taskCofre;origem=$taskOrigem.FullName} | ConvertTo-Json -Compress
 $taskProcesso.StandardInput.Write($taskEntrada);$taskProcesso.StandardInput.Close()
 $taskSaida=$taskProcesso.StandardOutput.ReadToEndAsync();$taskErro=$taskProcesso.StandardError.ReadToEndAsync()
 if(-not $taskProcesso.WaitForExit(120000)){$taskProcesso.Kill($true);throw 'Verificação interrompida por tempo.'}
 if($taskProcesso.ExitCode -ne 0){throw 'Verificação privada recusada; não emitir configuração/erro bruto.'}
 $taskSaida.GetAwaiter().GetResult() | ConvertFrom-Json
} finally {if($taskProcesso){$taskProcesso.Dispose()};if($taskChave){[Array]::Clear($taskChave,0,$taskChave.Length)};$taskEntrada=$null}
