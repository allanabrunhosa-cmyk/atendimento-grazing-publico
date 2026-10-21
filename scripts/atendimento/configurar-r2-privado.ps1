[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$Diretorio,[Parameter(Mandatory=$true)][string]$Node,[ValidateSet('preparar','selar')][string]$Acao='preparar',[switch]$ChaveExterna)
$ErrorActionPreference='Stop'
$taskRaiz=[IO.Path]::GetFullPath($Diretorio)
if($ChaveExterna){
  # Novo computador/perfil: nenhum acesso ao DPAPI do perfil anterior.
  $taskAcl=Get-Acl -LiteralPath $taskRaiz
  if(-not $taskAcl.AreAccessRulesProtected -or $taskAcl.Access.Count -ne 2 -or $taskAcl.Owner -ne [Security.Principal.WindowsIdentity]::GetCurrent().Name){throw 'Cofre privado com protecao inesperada.'}
  foreach($taskRegra in $taskAcl.Access){if($taskRegra.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -notin @([Security.Principal.WindowsIdentity]::GetCurrent().User.Value,'S-1-5-18') -or $taskRegra.AccessControlType -ne 'Allow'){throw 'Acesso privado inesperado.'}}
  $taskAncestral=$taskRaiz
  while($taskAncestral){if(Test-Path -LiteralPath (Join-Path $taskAncestral '.git')){throw 'Cofre nao pode estar em Git.'};if((Get-Item -LiteralPath $taskAncestral).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Cofre nao pode seguir atalhos.'};$taskAncestral=[IO.Path]::GetDirectoryName($taskAncestral)}
  $taskCofre=Join-Path $taskRaiz 'cofre'
  if(-not (Get-Item -LiteralPath $taskCofre).PSIsContainer -or (Get-Item -LiteralPath $taskCofre).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Cofre portatil nao pode seguir atalhos.'}
  $taskAclCofre=Get-Acl -LiteralPath $taskCofre
  if($taskAclCofre.Access.Count -ne 2){throw 'Acesso privado inesperado.'}
  foreach($taskRegra in $taskAclCofre.Access){if($taskRegra.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -notin @([Security.Principal.WindowsIdentity]::GetCurrent().User.Value,'S-1-5-18') -or $taskRegra.AccessControlType -ne 'Allow'){throw 'Acesso privado inesperado.'}}
}else{
  & (Join-Path $PSScriptRoot 'usar-cofre.ps1') -Diretorio $taskRaiz -Node $Node -Acao verificar | Out-Null
}
$taskFormulario=Join-Path $taskRaiz 'cofre/R2-CONFIGURACAO-PRIVADA.txt'
$taskChave=$null; $taskProcesso=$null
try {
  if($Acao -eq 'preparar') {
    if(-not (Test-Path -LiteralPath $taskFormulario)) {
      $taskModelo=@'
# Preencha neste arquivo privado, sem enviar pelo chat.
# Copie a conta e o endpoint S3 exibidos no R2. Region permanece auto.
# Credencial S3 Object Read & Write restrita somente ao bucket abaixo.
# Nao usar token global, conta administradora ou chave de recuperacao.
ACCOUNT_ID=
ENDPOINT=
BUCKET=grazing-donatella-backups
REGION=auto
ACCESS_KEY_ID=
SECRET_ACCESS_KEY=
'@
      $taskArquivo=[IO.File]::Open($taskFormulario,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
      try{$taskBytes=[Text.UTF8Encoding]::new($false).GetBytes($taskModelo);$taskArquivo.Write($taskBytes,0,$taskBytes.Length);$taskArquivo.Flush($true)}finally{$taskArquivo.Dispose()}
    }
    if((Get-Item -LiteralPath $taskFormulario).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Formulario privado nao pode seguir atalhos.'}
    [pscustomobject]@{FormularioPrivado=$taskFormulario;ConteudoExibido=$false;NenhumaCredencialCriada=$true}
    return
  }
  if((Get-Item -LiteralPath $taskFormulario).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Formulario privado nao pode seguir atalhos.'}
  if((Get-Item -LiteralPath $taskFormulario).Length -gt 8192){throw 'Formulario excede o limite.'}
  $taskTexto=[IO.File]::ReadAllText($taskFormulario)
  if($ChaveExterna){
    $taskRecuperacao=Join-Path $taskRaiz 'cofre/R2-RECUPERACAO-IPHONE.txt'
    if((Get-Item -LiteralPath $taskRecuperacao).Attributes -band [IO.FileAttributes]::ReparsePoint -or (Get-Item -LiteralPath $taskRecuperacao).Length -gt 2048){throw 'Formulario de recuperacao inesperado.'}
    $taskTextoChave=[IO.File]::ReadAllText($taskRecuperacao);$taskMatch=[regex]::Matches($taskTextoChave,'(?m)^CHAVE_DO_IPHONE=([a-fA-F0-9]{64})\s*$')
    if($taskMatch.Count -ne 1){throw 'Chave externa nao preenchida corretamente; nenhum valor exibido.'}
    $taskChave=[Convert]::FromHexString($taskMatch[0].Groups[1].Value)
  }else{
    $taskChave=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes((Join-Path $taskRaiz 'cofre/recuperacao-chave.dpapi')),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
  }
  if($taskChave.Length -ne 32){throw 'Chave portatil divergente.'}
  $taskDestino=Join-Path $taskRaiz ('cofre/r2-'+[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')+'.portatil.enc')
  $taskInicio=[Diagnostics.ProcessStartInfo]::new()
  $taskInicio.FileName=[IO.Path]::GetFullPath($Node)
  $taskInicio.ArgumentList.Add((Join-Path $PSScriptRoot 'selar-configuracao-r2.mjs'));$taskInicio.ArgumentList.Add($taskDestino)
  $taskInicio.UseShellExecute=$false;$taskInicio.CreateNoWindow=$true
  $taskInicio.RedirectStandardInput=$true;$taskInicio.RedirectStandardOutput=$true;$taskInicio.RedirectStandardError=$true
  $taskProcesso=[Diagnostics.Process]::new();$taskProcesso.StartInfo=$taskInicio
  if(-not $taskProcesso.Start()){throw 'Selador privado indisponivel.'}
  $taskEntrada=@{chave=[Convert]::ToBase64String($taskChave);formulario=$taskTexto} | ConvertTo-Json -Compress
  $taskProcesso.StandardInput.Write($taskEntrada);$taskProcesso.StandardInput.Close()
  $taskSaida=$taskProcesso.StandardOutput.ReadToEndAsync();$taskErro=$taskProcesso.StandardError.ReadToEndAsync()
  if(-not $taskProcesso.WaitForExit(30000)){$taskProcesso.Kill($true);throw 'Selagem privada interrompida por tempo.'}
  if($taskProcesso.ExitCode -ne 0){$taskCodigo=$taskErro.Result.Trim();if($taskCodigo -match '^R2_[A-Z_]+$'){throw ($taskCodigo+'; formulario preservado.')}throw 'Selagem privada recusada; formulario preservado.'}
  # O selador releu/decifrou o arquivo gravado. So entao remove este formulario.
  Remove-Item -LiteralPath $taskFormulario
  [pscustomobject]@{ConfiguracaoR2='Cifrada, relida e recuperada';ArquivoPrivado=$taskDestino;FormularioTemporarioRemovido=$true;ChaveMestraEnviadaVPS=$false;AcessoR2Testado=$false}
} finally {
  if($taskProcesso){$taskProcesso.Dispose()}
  if($taskChave){[Array]::Clear($taskChave,0,$taskChave.Length)}
  $taskTexto=$null;$taskEntrada=$null;$taskTextoChave=$null;$taskMatch=$null
}
