$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'parametros-privados.ps1')
$taskNomes=@('ATENDIMENTO_SSH_CHAVE','ATENDIMENTO_SSH_DESTINO','ATENDIMENTO_COFRE_PRIVADO','ATENDIMENTO_RAIZ_REMOTA_OPERACAO','ATENDIMENTO_RAIZ_REMOTA_HOMOLOGACAO')
$taskAnteriores=@{}
function Exigir-Recusa([scriptblock]$Acao,[string]$Codigo) {
  try { & $Acao | Out-Null } catch { if ($_.Exception.Message -eq $Codigo) { return }; throw 'TESTE_RECUSA_DIVERGENTE' }
  throw 'TESTE_RECUSA_AUSENTE'
}
try {
  foreach ($taskNome in $taskNomes) { $taskAnteriores[$taskNome]=[Environment]::GetEnvironmentVariable($taskNome,'Process'); [Environment]::SetEnvironmentVariable($taskNome,$null,'Process') }
  Exigir-Recusa { Obter-AcessoSshPrivado } 'SSH_CHAVE_PRIVADA_OBRIGATORIA'
  Exigir-Recusa { Obter-DiretorioPrivado } 'COFRE_DIRETORIO_PRIVADO_OBRIGATORIO'
  Exigir-Recusa { Obter-RaizRemotaPrivada -Variavel ATENDIMENTO_RAIZ_REMOTA_OPERACAO } 'RAIZ_REMOTA_PRIVADA_OBRIGATORIA'
  $taskChave=Join-Path ([IO.Path]::GetTempPath()) 'chave-ficticia-nao-criada'
  $taskDiretorio=Join-Path ([IO.Path]::GetTempPath()) 'cofre-ficticio-nao-criado'
  $env:ATENDIMENTO_SSH_CHAVE=$taskChave
  $env:ATENDIMENTO_SSH_DESTINO='operador@servidor.example.invalid'
  $env:ATENDIMENTO_COFRE_PRIVADO=$taskDiretorio
  $env:ATENDIMENTO_RAIZ_REMOTA_OPERACAO='/srv/aplicacao-ficticia'
  $taskAcesso=Obter-AcessoSshPrivado
  if ($taskAcesso.Chave -ne $taskChave -or $taskAcesso.Destino -ne $env:ATENDIMENTO_SSH_DESTINO) { throw 'TESTE_AMBIENTE_DIVERGENTE' }
  if ((Obter-DiretorioPrivado) -ne $taskDiretorio -or (Obter-RaizRemotaPrivada -Variavel ATENDIMENTO_RAIZ_REMOTA_OPERACAO) -ne '/srv/aplicacao-ficticia') { throw 'TESTE_AMBIENTE_DIVERGENTE' }
  if ((Obter-AcessoSshPrivado -DestinoSsh 'revisor@outro.example.invalid').Destino -ne 'revisor@outro.example.invalid') { throw 'TESTE_PARAMETRO_DIVERGENTE' }
  foreach ($taskDestino in @('-oProxyCommand=exemplo','operador@host;comando',"operador@host`ncomando","operador@host`n")) { Exigir-Recusa { Obter-AcessoSshPrivado -DestinoSsh $taskDestino } 'SSH_DESTINO_PRIVADO_OBRIGATORIO' }
  foreach ($taskRaiz in @('/srv/../outra','/srv/./outra','/srv/aplicacao;comando','/srv/aplicacao com espaco',"/srv/aplicacao`n")) { Exigir-Recusa { Obter-RaizRemotaPrivada -Raiz $taskRaiz -Variavel ATENDIMENTO_RAIZ_REMOTA_OPERACAO } 'RAIZ_REMOTA_PRIVADA_OBRIGATORIA' }
  Exigir-Recusa { Obter-AcessoSshPrivado -ChaveSsh 'chave-relativa' } 'SSH_CHAVE_PRIVADA_OBRIGATORIA'
  foreach ($taskNome in $taskNomes) { [Environment]::SetEnvironmentVariable($taskNome,$null,'Process') }
  # Os comandos recusam antes de ler cofres, abrir túneis ou iniciar processos remotos.
  $taskCasos=@(
    @{Nome='abrir-tunel.ps1';Argumentos=@{}},
    @{Nome='enviar-configuracao-operacao.ps1';Argumentos=@{}},
    @{Nome='executar-remoto-privado.ps1';Argumentos=@{Arquivo='arquivo-ficticio-nao-criado'}},
    @{Nome='preservar-configuracoes-recuperadas.ps1';Argumentos=@{Diretorio=$taskDiretorio;Node='node-ficticio'}},
    @{Nome='provisionar-servicos.ps1';Argumentos=@{Diretorio=$taskDiretorio;Node='node-ficticio'}},
    @{Nome='publicar-preparacao.ps1';Argumentos=@{Diretorio=$taskDiretorio}},
    @{Nome='testar-consulta.ps1';Argumentos=@{}}
  )
  foreach ($taskCaso in $taskCasos) {
    $taskScript=Join-Path $PSScriptRoot $taskCaso.Nome
    $taskArgumentos=$taskCaso.Argumentos
    Exigir-Recusa { & $taskScript @taskArgumentos } 'SSH_CHAVE_PRIVADA_OBRIGATORIA'
  }
  [pscustomobject]@{Teste='Parâmetros explícitos, precedência e recusa antes de acesso privado/remoto';Aprovado=$true;ScriptsOperacionais=$taskCasos.Count} | ConvertTo-Json -Compress
} finally {
  foreach ($taskNome in $taskAnteriores.Keys) { [Environment]::SetEnvironmentVariable($taskNome,$taskAnteriores[$taskNome],'Process') }
}
