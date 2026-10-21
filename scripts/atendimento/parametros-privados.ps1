# Parâmetros operacionais vêm do usuário ou do ambiente privado. Não há alvo real padrão.
function Obter-AcessoSshPrivado {
  param([string]$ChaveSsh,[string]$DestinoSsh)
  if ([string]::IsNullOrWhiteSpace($ChaveSsh)) { $ChaveSsh=$env:ATENDIMENTO_SSH_CHAVE }
  if ([string]::IsNullOrWhiteSpace($DestinoSsh)) { $DestinoSsh=$env:ATENDIMENTO_SSH_DESTINO }
  if ([string]::IsNullOrWhiteSpace($ChaveSsh) -or -not [IO.Path]::IsPathFullyQualified($ChaveSsh)) { throw 'SSH_CHAVE_PRIVADA_OBRIGATORIA' }
  if ($DestinoSsh -notmatch '^[A-Za-z_][A-Za-z0-9_-]*@[A-Za-z0-9][A-Za-z0-9.-]*\z') { throw 'SSH_DESTINO_PRIVADO_OBRIGATORIO' }
  return @{Chave=[IO.Path]::GetFullPath($ChaveSsh);Destino=$DestinoSsh}
}

function Obter-DiretorioPrivado {
  param([string]$Diretorio)
  if ([string]::IsNullOrWhiteSpace($Diretorio)) { $Diretorio=$env:ATENDIMENTO_COFRE_PRIVADO }
  if ([string]::IsNullOrWhiteSpace($Diretorio) -or -not [IO.Path]::IsPathFullyQualified($Diretorio)) { throw 'COFRE_DIRETORIO_PRIVADO_OBRIGATORIO' }
  return [IO.Path]::GetFullPath($Diretorio)
}

function Obter-RaizRemotaPrivada {
  param([string]$Raiz,[Parameter(Mandatory=$true)][string]$Variavel)
  if ([string]::IsNullOrWhiteSpace($Raiz)) { $Raiz=[Environment]::GetEnvironmentVariable($Variavel,'Process') }
  if ($Raiz -notmatch '^/(?:[A-Za-z0-9._-]+/)*[A-Za-z0-9._-]+\z' -or $Raiz.Split('/') -contains '..' -or $Raiz.Split('/') -contains '.') { throw 'RAIZ_REMOTA_PRIVADA_OBRIGATORIA' }
  return $Raiz
}
