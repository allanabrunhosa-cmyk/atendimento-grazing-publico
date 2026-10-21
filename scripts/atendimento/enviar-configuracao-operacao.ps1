param([string]$Diretorio,[string]$ChaveSsh,[string]$DestinoSsh,[string]$RaizRemota)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'parametros-privados.ps1')
$taskSshAcesso=Obter-AcessoSshPrivado -ChaveSsh $ChaveSsh -DestinoSsh $DestinoSsh
$Diretorio=Obter-DiretorioPrivado -Diretorio $Diretorio
$taskRaizRemota=Obter-RaizRemotaPrivada -Raiz $RaizRemota -Variavel ATENDIMENTO_RAIZ_REMOTA_OPERACAO
$taskArquivo=Join-Path $Diretorio 'cofre\operacao-trabalho.json'
if(-not (Test-Path -LiteralPath $taskArquivo -PathType Leaf)){throw 'Configuração privada ausente.'}
$taskConfig=[IO.File]::ReadAllText($taskArquivo)
$taskCodigo=@'
import sys,json,os
from pathlib import Path
from urllib.parse import urlparse
r=Path(sys.argv[1])
b=json.loads((r/'bancos.json').read_text());p=json.load(sys.stdin)
if p.get('versao')!=1 or not all(p.get(k) for k in ['meta','ia','woocommerce','voz']):raise SystemExit('CONFIGURACAO_PRIVADA_RECUSADA')
if any(k in p for k in ['chave','chaveMestra','recuperacao']):raise SystemExit('CHAVE_MESTRA_RECUSADA')
c={**p,**b,'centralBanco':urlparse(b['centralDatabaseUrl']).path[1:],'modo':'homologacao','autoridade':'origem','enviosHabilitados':False,'iaAutomatica':False,'orcamentoIAcentavos':0,'equipes':[{'id':'apoio','nome':'Apoio interno'}]}
c['ia']['model']='claude-sonnet-4-5-20250929'
f=r/'operacao.json'
with f.open('x') as o:json.dump(c,o);o.flush();os.fsync(o.fileno())
f.chmod(0o600)
print(json.dumps({'configuracaoDestinoPreparada':True,'chaveMestraTransferida':False,'enviosReais':False,'agenteAutomatico':False,'webhookAlterado':False}))
'@
$taskInicio=[Diagnostics.ProcessStartInfo]::new('ssh');$taskInicio.UseShellExecute=$false;$taskInicio.CreateNoWindow=$true
$taskInicio.RedirectStandardInput=$true;$taskInicio.RedirectStandardOutput=$true;$taskInicio.RedirectStandardError=$true
$taskInicio.StandardInputEncoding=[Text.UTF8Encoding]::new($false);$taskInicio.StandardOutputEncoding=[Text.UTF8Encoding]::new($false)
$taskRemoto="python3 -c '"+$taskCodigo.Replace("'","'\''")+"' "+$taskRaizRemota+'/configuracao'
foreach($taskArg in @('-i',$taskSshAcesso.Chave,'-o','BatchMode=yes',$taskSshAcesso.Destino,$taskRemoto)){$taskInicio.ArgumentList.Add($taskArg)}
$taskProcesso=[Diagnostics.Process]::Start($taskInicio)
try{
 $taskOut=$taskProcesso.StandardOutput.ReadToEndAsync();$taskErr=$taskProcesso.StandardError.ReadToEndAsync()
 $taskProcesso.StandardInput.Write($taskConfig);$taskProcesso.StandardInput.Close();$taskProcesso.WaitForExit()
 if($taskProcesso.ExitCode -ne 0){throw 'Configuração privada recusada; nenhuma credencial emitida nos logs.'}
 $taskOut.Result
}finally{$taskProcesso.Dispose();$taskConfig=$null}
