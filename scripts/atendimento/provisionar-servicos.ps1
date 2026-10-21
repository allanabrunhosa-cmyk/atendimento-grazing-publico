[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$Diretorio,[Parameter(Mandatory=$true)][string]$Node,[string]$ChaveSsh,[string]$DestinoSsh,[string]$RaizRemota)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'parametros-privados.ps1')
$taskSshAcesso=Obter-AcessoSshPrivado -ChaveSsh $ChaveSsh -DestinoSsh $DestinoSsh
$taskRaizRemota=Obter-RaizRemotaPrivada -Raiz $RaizRemota -Variavel ATENDIMENTO_RAIZ_REMOTA_HOMOLOGACAO
& (Join-Path $PSScriptRoot 'usar-cofre.ps1') -Diretorio $Diretorio -Node $Node -Acao verificar | Out-Null
$taskPasta=Join-Path ([IO.Path]::GetFullPath($Diretorio)) 'cofre'
$taskContaPermitida=(Get-Content -LiteralPath (Join-Path $taskPasta 'homologacao-conta-revisao.json') -Raw|ConvertFrom-Json).contaHubInformada
if(-not $taskContaPermitida -or $taskContaPermitida.Length -gt 254){throw 'Revisão explícita da conta ausente.'}
function ExecutarPrivado([string]$Programa,[string[]]$Argumentos,[string]$Entrada){
 $p=[Diagnostics.ProcessStartInfo]::new($Programa);$p.UseShellExecute=$false;$p.CreateNoWindow=$true;$p.RedirectStandardInput=$true;$p.RedirectStandardOutput=$true;$p.RedirectStandardError=$true
 foreach($a in $Argumentos){$p.ArgumentList.Add($a)}
 $c=[Diagnostics.Process]::Start($p)
 try{$o=$c.StandardOutput.ReadToEndAsync();$e=$c.StandardError.ReadToEndAsync();$c.StandardInput.Write($Entrada);$c.StandardInput.Close();$c.WaitForExit();if($c.ExitCode -ne 0){throw 'Execução privada interrompida; não revelar saída.'};return $o.Result}finally{$c.Dispose()}
}
$taskSsh=@('-i',$taskSshAcesso.Chave,'-o','BatchMode=yes',$taskSshAcesso.Destino)
$taskArquivo=Join-Path $taskPasta 'servicos-homologacao.dpapi'
$taskBytes=$null;$taskChave=$null
try{
 if(Test-Path -LiteralPath $taskArquivo){$taskBytes=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($taskArquivo),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);$taskServicos=[Text.Encoding]::UTF8.GetString($taskBytes)|ConvertFrom-Json -AsHashtable}
 else{
  $taskBytes=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes((Join-Path $taskPasta 'config.dpapi')),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
  $taskConfig=[Text.Encoding]::UTF8.GetString($taskBytes)|ConvertFrom-Json -AsHashtable
  $taskConta=ExecutarPrivado 'ssh' ($taskSsh+@("cat $taskRaizRemota/consulta/conta-hub.json")) '' | ConvertFrom-Json
  if($taskConta.Count -ne 1 -or $taskConta[0].email -ne $taskContaPermitida -or -not $taskConta[0].ativo -or $taskConta[0].excluidoEm){throw 'Conta informada não confere.'}
  $taskUrl=[UriBuilder]::new($taskConfig.DATABASE_URL)
  if($taskUrl.Host -ne '127.0.0.1' -or $taskUrl.Port -ne 65437 -or $taskUrl.Path -ne '/donatella_preparacao' -or $taskUrl.UserName -ne 'donatella_coletor'){throw 'Destino divergente.'}
  $taskUrl.Host='grazing-donatella-homologacao-v2-banco';$taskUrl.Port=5432
  $taskColetor=@{}
  foreach($n in @('ATENDIMENTO_EXECUCAO_CARGA','ATENDIMENTO_ORIGEM_URL','ATENDIMENTO_ORIGEM_PUBLISHABLE_KEY','ATENDIMENTO_ORIGEM_COLETOR_TOKEN','ATENDIMENTO_CARGA_SECRET')){$taskColetor[$n]=$taskConfig[$n]}
  $taskColetor.DATABASE_URL=$taskUrl.Uri.AbsoluteUri
  $taskSenhaBanco=[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
  $taskSenhaEntrega=[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(18)).Replace('+','-').Replace('/','_')
  $taskSalt=[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(16)).ToLowerInvariant()
  $taskHash=ExecutarPrivado $Node @('-e',"let t='';process.stdin.on('data',p=>t+=p).on('end',()=>{const d=JSON.parse(t);process.stdout.write(require('node:crypto').scryptSync(d.senha,d.salt,32).toString('hex'))})") (@{senha=$taskSenhaEntrega;salt=$taskSalt}|ConvertTo-Json -Compress)
  $taskConsulta=@{databaseUrl=('postgresql://donatella_consulta:'+ $taskSenhaBanco+'@grazing-donatella-homologacao-v2-banco:5432/donatella_preparacao');hubUsuarioId=$taskConta[0].id;versaoAcesso=1;sessaoSecret=[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32));senhaSalt=$taskSalt;senhaHash=$taskHash;origem=$taskColetor.ATENDIMENTO_ORIGEM_URL.TrimEnd('/');materializadoEm=[DateTime]::UtcNow.ToString('o')}
  $taskServicos=@{coletor=$taskColetor;consulta=$taskConsulta;senhaBanco=$taskSenhaBanco;senhaEntrega=$taskSenhaEntrega;revisao=@{contaHubConferida=$true;permissao='somente_leitura_homologacao';adminHerdado=$false;credencialHubCopiada=$false;conferidoEm=[DateTime]::UtcNow.ToString('o')}}
  $taskNovos=[Text.Encoding]::UTF8.GetBytes(($taskServicos|ConvertTo-Json -Depth 8 -Compress))
  [IO.File]::WriteAllBytes($taskArquivo,[Security.Cryptography.ProtectedData]::Protect($taskNovos,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))
  [Array]::Clear($taskNovos,0,$taskNovos.Length)
 }
 # A chave mestra permanece no cofre/telefone. Só a chave de trabalho da carga vai ao coletor.
 $taskChave=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes((Join-Path $taskPasta 'recuperacao-chave.dpapi')),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
 if($taskChave.Length -ne 32 -or $taskServicos.coletor.ATENDIMENTO_CARGA_SECRET -eq [Convert]::ToHexString($taskChave).ToLowerInvariant()){throw 'Separação de chaves não comprovada.'}
 $taskPortatil=Join-Path $taskPasta 'servicos-homologacao.portatil.enc'
 if(-not(Test-Path -LiteralPath $taskPortatil)){
  $taskConteudo=[Text.Encoding]::UTF8.GetBytes(($taskServicos|ConvertTo-Json -Depth 8 -Compress))
  ExecutarPrivado $Node @((Join-Path $PSScriptRoot 'selar-cofre-portatil.mjs'),$taskPortatil) (@{chave=[Convert]::ToBase64String($taskChave);conteudo=[Convert]::ToBase64String($taskConteudo)}|ConvertTo-Json -Compress) | Out-Null
  [Array]::Clear($taskConteudo,0,$taskConteudo.Length)
 }
 foreach($nome in @('coletor','consulta')){ExecutarPrivado 'ssh' ($taskSsh+@("umask 077; cat > $taskRaizRemota/consulta/$nome.json")) ($taskServicos[$nome]|ConvertTo-Json -Depth 8 -Compress)|Out-Null}
 $taskSql="ALTER ROLE donatella_consulta LOGIN PASSWORD '$($taskServicos.senhaBanco)';"
 ExecutarPrivado 'ssh' ($taskSsh+@('docker exec -i grazing-donatella-homologacao-v2-banco psql -X -q -U donatella_homologacao_admin -d donatella_preparacao -v ON_ERROR_STOP=1')) $taskSql | Out-Null
 $taskEntrega=Join-Path $taskPasta 'ACESSO-HOMOLOGACAO-PRIVADO.txt'
 [IO.File]::WriteAllText($taskEntrega,"Homologação de consulta: https://atendimento.grazinghub.com.br`r`nE-mail: $taskContaPermitida`r`nSenha exclusiva: $($taskServicos.senhaEntrega)`r`nNão use a senha do HUB. Não envie este arquivo pelo chat.`r`n")
 [pscustomobject]@{CredenciaisServicos='Provisionadas com escopo limitado';ChaveMestraNaVps=$false;ContaHub='Identificação/atividade conferidas, senha não copiada';RecuperacaoConfiguracao='Cópia portátil cifrada preservada fora da VPS';ArquivoAcesso=$taskEntrega}
}finally{if($taskBytes){[Array]::Clear($taskBytes,0,$taskBytes.Length)};if($taskChave){[Array]::Clear($taskChave,0,$taskChave.Length)};$taskConfig=$null;$taskServicos=$null}
