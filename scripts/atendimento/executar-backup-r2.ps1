[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$Diretorio,[Parameter(Mandatory=$true)][string]$Node,[ValidateSet('transferir','testar','testar-protecao','preparar-recuperacao','recuperar')][string]$Acao='transferir')
$ErrorActionPreference='Stop'
$taskRaiz=[IO.Path]::GetFullPath($Diretorio)
$taskAcl=Get-Acl -LiteralPath $taskRaiz
if(-not $taskAcl.AreAccessRulesProtected -or $taskAcl.Access.Count -ne 2 -or $taskAcl.Owner -ne [Security.Principal.WindowsIdentity]::GetCurrent().Name){throw 'Cofre privado com protecao inesperada.'}
foreach($taskRegra in $taskAcl.Access){if($taskRegra.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -notin @([Security.Principal.WindowsIdentity]::GetCurrent().User.Value,'S-1-5-18') -or $taskRegra.AccessControlType -ne 'Allow'){throw 'Acesso privado inesperado.'}}
$taskAncestral=$taskRaiz
while($taskAncestral){if(Test-Path -LiteralPath (Join-Path $taskAncestral '.git')){throw 'Cofre nao pode estar em Git.'};if((Get-Item -LiteralPath $taskAncestral).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Cofre nao pode seguir atalhos.'};$taskAncestral=[IO.Path]::GetDirectoryName($taskAncestral)}
$taskFormulario=Join-Path $taskRaiz 'cofre/R2-RECUPERACAO-IPHONE.txt'
if($Acao -eq 'preparar-recuperacao'){
 if(-not (Test-Path -LiteralPath $taskFormulario)){$taskF=[IO.File]::Open($taskFormulario,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None);try{$taskBytes=[Text.UTF8Encoding]::new($false).GetBytes("# Copie a chave da nota bloqueada do iPhone somente depois do sinal =.`r`n# Salve, feche e nao envie a chave ou foto pelo chat.`r`nCHAVE_DO_IPHONE=`r`n");$taskF.Write($taskBytes);$taskF.Flush($true)}finally{$taskF.Dispose()}}
 [pscustomobject]@{FormularioPrivado=$taskFormulario;ChaveNaoExibida=$true};return
}
$taskChave=$null;$taskProcesso=$null
try{
 $taskR2=Get-ChildItem -LiteralPath (Join-Path $taskRaiz 'cofre') -File | Where-Object Name -Match '^r2-.*\.portatil\.enc$' | Sort-Object Name | Select-Object -Last 1
 if(-not $taskR2 -or ($taskR2.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Configuracao R2 cifrada ausente.'}
 $taskEntrada=@{acao=$Acao;raiz=$taskRaiz;configuracaoR2=$taskR2.FullName}
 if($Acao -in @('transferir','testar','testar-protecao')){
  $taskChave=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes((Join-Path $taskRaiz 'cofre/recuperacao-chave.dpapi')),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
 }else{
  if((Get-Item -LiteralPath $taskFormulario).Attributes -band [IO.FileAttributes]::ReparsePoint -or (Get-Item -LiteralPath $taskFormulario).Length -gt 2048){throw 'Formulario de recuperacao inesperado.'}
  $taskTexto=[IO.File]::ReadAllText($taskFormulario);$taskMatch=[regex]::Matches($taskTexto,'(?m)^CHAVE_DO_IPHONE=([a-fA-F0-9]{64})\s*$')
  if($taskMatch.Count -ne 1){throw 'Chave do iPhone nao preenchida corretamente; nenhum valor exibido.'}
  $taskChave=[Convert]::FromHexString($taskMatch[0].Groups[1].Value)
  $taskProva=Get-Content -LiteralPath (Join-Path $taskRaiz 'r2-estado/transferencia-inicial.json') -Raw | ConvertFrom-Json
  if($taskProva.id -notmatch '^[a-f0-9-]{36}$'){throw 'Referencia R2 ausente.'}
  $taskDestino=Join-Path $taskRaiz ('recuperacao-r2-'+[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ'))
  New-Item -ItemType Directory -Path $taskDestino | Out-Null
  $taskEntrada.id=$taskProva.id;$taskEntrada.destino=$taskDestino
 }
 if($taskChave.Length -ne 32){throw 'Chave de recuperacao invalida.'}
 $taskEntrada.chave=[Convert]::ToBase64String($taskChave)
 $taskInicio=[Diagnostics.ProcessStartInfo]::new();$taskInicio.FileName=[IO.Path]::GetFullPath($Node)
 $taskInicio.WorkingDirectory=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
 $taskInicio.ArgumentList.Add('--import');$taskInicio.ArgumentList.Add('tsx');$taskInicio.ArgumentList.Add((Join-Path $PSScriptRoot 'transferir-backup-r2.ts'))
 $taskInicio.UseShellExecute=$false;$taskInicio.CreateNoWindow=$true;$taskInicio.RedirectStandardInput=$true;$taskInicio.RedirectStandardOutput=$true;$taskInicio.RedirectStandardError=$true
 $taskProcesso=[Diagnostics.Process]::new();$taskProcesso.StartInfo=$taskInicio;if(-not $taskProcesso.Start()){throw 'Transferencia R2 indisponivel.'}
 $taskProcesso.StandardInput.Write(($taskEntrada | ConvertTo-Json -Compress));$taskProcesso.StandardInput.Close()
 $taskErro=$taskProcesso.StandardError.ReadToEndAsync()
 while($null -ne ($taskLinha=$taskProcesso.StandardOutput.ReadLine())){Write-Output $taskLinha}
 $taskProcesso.WaitForExit()
 if($taskProcesso.ExitCode -ne 0){$taskCodigo=$taskErro.Result.Trim();if($taskCodigo -match '^(R2|BACKUP|COFRE)_[A-Z_]+$'){throw $taskCodigo};throw 'Execucao R2 interrompida; nenhum segredo registrado.'}
 if($Acao -eq 'recuperar'){
  # Extracao nao comprova restauracao do banco/replay dos incrementais.
  # O formulario privado sera removido ao concluir essas verificacoes reais,
  # permitindo derivar a chave de trabalho somente da copia recuperada do R2.
  [pscustomobject]@{RecuperacaoPrivada=$taskDestino;SemDPAPI=$true;FormularioTemporarioRemovido=$false;AguardaRestauracaoReal=$true}
 }
}finally{if($taskProcesso){$taskProcesso.Dispose()};if($taskChave){[Array]::Clear($taskChave,0,$taskChave.Length)};$taskEntrada=$null;$taskTexto=$null;$taskMatch=$null}
