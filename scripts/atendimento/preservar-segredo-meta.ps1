[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$Diretorio,[Parameter(Mandatory=$true)][string]$Node)
$ErrorActionPreference='Stop'
& (Join-Path $PSScriptRoot 'usar-cofre.ps1') -Diretorio $Diretorio -Node $Node -Acao verificar | Out-Null
$taskRaiz=[IO.Path]::GetFullPath($Diretorio)
$taskFormulario=Join-Path $taskRaiz 'cofre/META-RECUPERACAO-PRIVADA.txt'
$taskChave=$null; $taskConteudo=$null; $taskProcesso=$null
try {
  if((Get-Item -LiteralPath $taskFormulario).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Formulário não pode seguir atalhos.'}
  if((Get-Item -LiteralPath $taskFormulario).Length -gt 1024){throw 'Formulário excede o limite.'}
  $taskTexto=[IO.File]::ReadAllText($taskFormulario)
  $taskCaptura=[regex]::Match($taskTexto,'\AAPP_SECRET_META=([A-Za-z0-9_-]{32,256})\s*\z')
  if(-not $taskCaptura.Success){throw 'Preencha somente APP_SECRET_META= com a chave do aplicativo, sem outros campos.'}
  $taskChave=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes((Join-Path $taskRaiz 'cofre/recuperacao-chave.dpapi')),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
  if($taskChave.Length -ne 32){throw 'Chave portátil divergente.'}
  $taskConteudo=[Text.Encoding]::UTF8.GetBytes((@{app_id='1468746651147688';app_secret=$taskCaptura.Groups[1].Value;origem='Meta App settings Basic; cópia autorizada para recuperação, sem rotação';preservadoEm=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json -Compress))
  $taskArquivo=Join-Path $taskRaiz ('cofre/meta-'+[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')+'.portatil.enc')
  $taskInicio=[Diagnostics.ProcessStartInfo]::new()
  $taskInicio.FileName=[IO.Path]::GetFullPath($Node)
  $taskInicio.ArgumentList.Add((Join-Path $PSScriptRoot 'selar-cofre-portatil.mjs'))
  $taskInicio.ArgumentList.Add($taskArquivo)
  $taskInicio.UseShellExecute=$false; $taskInicio.CreateNoWindow=$true
  $taskInicio.RedirectStandardInput=$true; $taskInicio.RedirectStandardOutput=$true; $taskInicio.RedirectStandardError=$true
  $taskProcesso=[Diagnostics.Process]::new(); $taskProcesso.StartInfo=$taskInicio
  if(-not $taskProcesso.Start()){throw 'Selador privado indisponível.'}
  $taskEntrada=@{chave=[Convert]::ToBase64String($taskChave);conteudo=[Convert]::ToBase64String($taskConteudo)} | ConvertTo-Json -Compress
  $taskProcesso.StandardInput.Write($taskEntrada); $taskProcesso.StandardInput.Close()
  $taskSaida=$taskProcesso.StandardOutput.ReadToEndAsync(); $taskErro=$taskProcesso.StandardError.ReadToEndAsync()
  if(-not $taskProcesso.WaitForExit(30000)){$taskProcesso.Kill($true);throw 'Selagem privada interrompida por tempo.'}
  if($taskProcesso.ExitCode -ne 0){throw 'Selagem privada recusada; formulário preservado.'}
  # A CLI já relê/decifra o arquivo escrito e compara os bytes antes do êxito.
  # Remove apenas o formulário privado explicitamente criado para esta entrega.
  if([IO.Path]::GetFullPath($taskFormulario) -ne (Join-Path $taskRaiz 'cofre/META-RECUPERACAO-PRIVADA.txt')){throw 'Caminho privado divergente.'}
  Remove-Item -LiteralPath $taskFormulario
  [pscustomobject]@{AppSecretMeta='Cifrado, relido e recuperado';Chave='Mesma chave com custódia comprovada no iPhone';FormularioTemporarioRemovido=$true;CorrespondenciaComAplicativoValidadaNaApi=$false;CapturaLiberada=$false}
} finally {
  if($taskProcesso){$taskProcesso.Dispose()}
  if($taskChave){[Array]::Clear($taskChave,0,$taskChave.Length)}
  if($taskConteudo){[Array]::Clear($taskConteudo,0,$taskConteudo.Length)}
  $taskTexto=$null; $taskCaptura=$null; $taskEntrada=$null
}
