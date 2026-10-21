[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$Diretorio,[switch]$ComMedicao)
$ErrorActionPreference='Stop'
$taskRaiz=[IO.Path]::GetFullPath($Diretorio)
$taskCofre=Join-Path $taskRaiz 'cofre'
$taskHash=[IO.File]::ReadAllText((Join-Path $taskCofre 'fingerprint.txt'))
if ($taskHash -notmatch '^[a-f0-9]{64}$') { throw 'Fingerprint privado inválido.' }
$taskPartes=@('-- CAPTURA REVISADA V2: usar somente com a autorização condicionada e provas registradas.','-- Não executar o SQL antigo do editor. Não altera webhook/jobs/rotinas de negócio.','BEGIN;','SET LOCAL lock_timeout = ''3s'';','SET LOCAL statement_timeout = ''30s'';',"SET LOCAL donatella.coletor_hash = '$taskHash';")
if($ComMedicao){
  $taskMedicao=[IO.File]::ReadAllText((Join-Path $PSScriptRoot 'sql/011-acompanhar-impacto-leitura.sql'))
  $taskInicio=$taskMedicao.IndexOf('WITH atividade AS (',[StringComparison]::Ordinal)
  $taskFim=$taskMedicao.LastIndexOf('ROLLBACK;',[StringComparison]::Ordinal)
  if($taskInicio -lt 0 -or $taskFim -le $taskInicio){throw 'Consulta de acompanhamento inesperada.'}
  $taskConsulta=$taskMedicao.Substring($taskInicio,$taskFim-$taskInicio).Trim().TrimEnd(';')
  # Apenas métricas técnicas temporárias da conexão; nenhuma tabela de negócio.
  $taskPartes+=('CREATE TEMP TABLE donatella_v2_medicao_pre ON COMMIT PRESERVE ROWS AS '+$taskConsulta+';')
}
$taskPartes+='-- INICIO_CAPTURA_REVISADA'
foreach ($taskSql in @('002-captura-origem-proposta.sql','004-snapshot-origem-proposta.sql')) {
  $taskLinhas=[IO.File]::ReadAllLines((Join-Path $PSScriptRoot ('sql/'+$taskSql)))
  $taskPartes+=@($taskLinhas | Where-Object { $_ -notmatch '^(BEGIN|COMMIT);$' })
}
$taskPartes+='-- FIM_CAPTURA_REVISADA'
$taskPartes+='COMMIT;'
if($ComMedicao){
  # Instalação já confirmada neste ponto; falha de medição NÃO desfaz esse COMMIT.
  $taskPartes+=@('-- Se a medição falhar após COMMIT, conferir instalação antes de repetir.','BEGIN READ ONLY;','SET LOCAL statement_timeout = ''10s'';',
    "SELECT jsonb_build_object('antes',(SELECT impacto FROM pg_temp.donatella_v2_medicao_pre),'depois',(SELECT impacto FROM ($taskConsulta) medicao)) AS instalacao;",'ROLLBACK;')
}
$taskDestino=Join-Path $taskCofre $(if($ComMedicao){'INSTALAR-CAPTURA-REVISADA.sql'}else{'captura-proposta.sql'})
[IO.File]::WriteAllText($taskDestino,($taskPartes -join [char]10),[Text.UTF8Encoding]::new($false))
[pscustomobject]@{Estado='Proposta preparada; não executada';Arquivo=$taskDestino;TransacoesDeInstalacao=1;MedicaoAntesDepois=[bool]$ComMedicao;SegredoIncluido=$false}
