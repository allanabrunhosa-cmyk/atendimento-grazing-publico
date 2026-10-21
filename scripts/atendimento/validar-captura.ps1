[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$Diretorio,[Parameter(Mandatory=$true)][string]$Node)
$ErrorActionPreference='Stop'
& (Join-Path $PSScriptRoot 'usar-cofre.ps1') -Diretorio $Diretorio -Node $Node -Acao verificar | Out-Null
$taskCofre=Join-Path ([IO.Path]::GetFullPath($Diretorio)) 'cofre'
$taskBytes=$null;$taskProcesso=$null
try {
 $taskBytes=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes((Join-Path $taskCofre 'config.dpapi')),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
 $taskConfig=[Text.Encoding]::UTF8.GetString($taskBytes) | ConvertFrom-Json -AsHashtable
 $taskEntrada=@{cofre=$taskCofre;config=@{
   ATENDIMENTO_ORIGEM_URL=$taskConfig.ATENDIMENTO_ORIGEM_URL
   ATENDIMENTO_ORIGEM_PUBLISHABLE_KEY=$taskConfig.ATENDIMENTO_ORIGEM_PUBLISHABLE_KEY
   ATENDIMENTO_ORIGEM_COLETOR_TOKEN=$taskConfig.ATENDIMENTO_ORIGEM_COLETOR_TOKEN
 }} | ConvertTo-Json -Compress
 $taskInicio=[Diagnostics.ProcessStartInfo]::new();$taskInicio.FileName=[IO.Path]::GetFullPath($Node)
 $taskInicio.ArgumentList.Add((Join-Path $PSScriptRoot 'validar-captura.mjs'))
 $taskInicio.UseShellExecute=$false;$taskInicio.CreateNoWindow=$true
 $taskInicio.RedirectStandardInput=$true;$taskInicio.RedirectStandardOutput=$true;$taskInicio.RedirectStandardError=$true
 $taskProcesso=[Diagnostics.Process]::new();$taskProcesso.StartInfo=$taskInicio
 if(-not $taskProcesso.Start()){throw 'Validador privado indisponível.'}
 $taskProcesso.StandardInput.Write($taskEntrada);$taskProcesso.StandardInput.Close()
 $taskSaida=$taskProcesso.StandardOutput.ReadToEndAsync();$taskErro=$taskProcesso.StandardError.ReadToEndAsync()
 if(-not $taskProcesso.WaitForExit(150000)){$taskProcesso.Kill($true);throw 'Validação interrompida por tempo.'}
 if($taskProcesso.ExitCode -ne 0){throw 'Validação privada recusada; não emitir erro bruto.'}
 $taskSaida.GetAwaiter().GetResult() | ConvertFrom-Json
} finally {
 if($taskProcesso){$taskProcesso.Dispose()};if($taskBytes){[Array]::Clear($taskBytes,0,$taskBytes.Length)}
 $taskEntrada=$null;$taskConfig=$null
}
