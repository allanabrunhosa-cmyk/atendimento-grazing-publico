-- Manual/aditiva. Exclusivamente aplicação operacional dedicada ou ensaio vazio.
BEGIN;
DO $$ BEGIN IF current_database() NOT IN ('donatella_operacao','donatella_ensaio_operacao') THEN RAISE EXCEPTION 'DESTINO_OPERACAO_RECUSADO'; END IF; END $$;
CREATE SCHEMA IF NOT EXISTS atendimento_operacao;
REVOKE ALL ON SCHEMA atendimento_operacao FROM PUBLIC;
CREATE TABLE IF NOT EXISTS atendimento_operacao.contato (
 id uuid PRIMARY KEY, nome text NOT NULL CHECK(length(nome)<=200), telefone text NOT NULL CHECK(length(telefone)<=40), identidade_canal text UNIQUE,
 hub_cliente_id text, email text CHECK(length(email)<=254), tags text[] NOT NULL DEFAULT '{}', notas text NOT NULL DEFAULT '' CHECK(length(notas)<=8000),
 memoria jsonb NOT NULL DEFAULT '{}', importado boolean NOT NULL DEFAULT false, criada_em timestamptz NOT NULL DEFAULT now(), atualizada_em timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS atendimento_operacao.conversa (
 id uuid PRIMARY KEY, contato_id uuid NOT NULL REFERENCES atendimento_operacao.contato(id),
 estado text NOT NULL DEFAULT 'ia' CHECK(estado IN ('ia','humano','pausado','encerrada')),
 responsavel_id text, equipe_id text, tags text[] NOT NULL DEFAULT '{}', fila text NOT NULL DEFAULT 'novos', versao bigint NOT NULL DEFAULT 1 CHECK(versao>0),
 ultima_mensagem_em timestamptz, ultima_cliente_em timestamptz, criada_em timestamptz NOT NULL DEFAULT now(), importada boolean NOT NULL DEFAULT false, ficticia boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS operacao_conversa_lista ON atendimento_operacao.conversa(ultima_mensagem_em DESC NULLS LAST,id);
CREATE TABLE IF NOT EXISTS atendimento_operacao.anexo (
 id uuid PRIMARY KEY, conversa_id uuid NOT NULL REFERENCES atendimento_operacao.conversa(id), hash text NOT NULL CHECK(hash ~ '^[a-f0-9]{64}$'),
 nome text NOT NULL CHECK(length(nome) BETWEEN 1 AND 160), mime text NOT NULL CHECK(length(mime)<=100), tamanho bigint NOT NULL CHECK(tamanho BETWEEN 1 AND 20971520),
 autor_id text, importado boolean NOT NULL DEFAULT false, criada_em timestamptz NOT NULL DEFAULT now(), UNIQUE(conversa_id,id)
);
CREATE TABLE IF NOT EXISTS atendimento_operacao.mensagem (
 id uuid PRIMARY KEY, conversa_id uuid NOT NULL REFERENCES atendimento_operacao.conversa(id), wamid text UNIQUE,
 autor text NOT NULL CHECK(autor IN ('cliente','humano','ia')), autor_id text, conteudo text NOT NULL DEFAULT '' CHECK(length(conteudo)<=65536),
 tipo text NOT NULL CHECK(tipo IN ('text','image','audio','document','video','template','unsupported')), estado text NOT NULL DEFAULT 'recebido',
 anexo_id uuid REFERENCES atendimento_operacao.anexo(id), citada_id uuid REFERENCES atendimento_operacao.mensagem(id),
 criada_em timestamptz NOT NULL DEFAULT now(), enviada_em timestamptz, entregue_em timestamptz, lida_em timestamptz, importada boolean NOT NULL DEFAULT false,
 metadados jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS operacao_historico ON atendimento_operacao.mensagem(conversa_id,criada_em DESC,id DESC);
CREATE TABLE IF NOT EXISTS atendimento_operacao.nota (
 id uuid PRIMARY KEY, conversa_id uuid NOT NULL REFERENCES atendimento_operacao.conversa(id), autor_id text NOT NULL, texto text NOT NULL CHECK(length(texto) BETWEEN 1 AND 8000), criada_em timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS atendimento_operacao.rascunho (
 conversa_id uuid NOT NULL REFERENCES atendimento_operacao.conversa(id), autor_id text NOT NULL, texto text NOT NULL DEFAULT '' CHECK(length(texto)<=4096), versao bigint NOT NULL DEFAULT 1,
 atualizada_em timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(conversa_id,autor_id)
);
CREATE TABLE IF NOT EXISTS atendimento_operacao.comando (
 id uuid PRIMARY KEY, autor_id text NOT NULL, hash text NOT NULL CHECK(hash ~ '^[a-f0-9]{64}$'), resultado jsonb NOT NULL, criada_em timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS atendimento_operacao.auditoria (
 id uuid PRIMARY KEY, autor_id text NOT NULL, entidade_id text NOT NULL, acao text NOT NULL, versao bigint, criada_em timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS atendimento_operacao.intencao (
 id uuid PRIMARY KEY, conversa_id uuid NOT NULL REFERENCES atendimento_operacao.conversa(id), mensagem_id uuid NOT NULL REFERENCES atendimento_operacao.mensagem(id),
 autor_id text NOT NULL, versao_conversa bigint NOT NULL, hash text NOT NULL CHECK(hash ~ '^[a-f0-9]{64}$'), conteudo jsonb NOT NULL,
 estado text NOT NULL DEFAULT 'pendente' CHECK(estado IN ('pendente','processando','aceito','aceito_simulado','recusado','incerto','entregue','lido','cancelado')),
 wamid text UNIQUE, lease uuid, lease_ate timestamptz, tentativas integer NOT NULL DEFAULT 0 CHECK(tentativas BETWEEN 0 AND 8), proxima_tentativa timestamptz NOT NULL DEFAULT now(),
 codigo text, criada_em timestamptz NOT NULL DEFAULT now(), atualizada_em timestamptz NOT NULL DEFAULT now(),
 CHECK((estado='processando')=(lease IS NOT NULL AND lease_ate IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS operacao_envio_fila ON atendimento_operacao.intencao(proxima_tentativa,criada_em) WHERE estado='pendente';
CREATE TABLE IF NOT EXISTS atendimento_operacao.status_recebido (wamid text NOT NULL, estado text NOT NULL, em timestamptz NOT NULL, codigo text, PRIMARY KEY(wamid,estado,em));
CREATE TABLE IF NOT EXISTS atendimento_operacao.configuracao (chave text PRIMARY KEY, conteudo jsonb NOT NULL, versao bigint NOT NULL DEFAULT 1, atualizada_em timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS atendimento_operacao.modelo (id text PRIMARY KEY, nome text NOT NULL, idioma text NOT NULL, estado text NOT NULL, componentes jsonb NOT NULL DEFAULT '[]', sincronizado_em timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS atendimento_operacao.etapa (id uuid PRIMARY KEY, titulo text NOT NULL CHECK(length(titulo)<=120), posicao integer NOT NULL, ativa boolean NOT NULL DEFAULT true);
CREATE TABLE IF NOT EXISTS atendimento_operacao.negocio (id uuid PRIMARY KEY, contato_id uuid REFERENCES atendimento_operacao.contato(id), conversa_id uuid REFERENCES atendimento_operacao.conversa(id), titulo text NOT NULL CHECK(length(titulo)<=200), etapa_id uuid NOT NULL REFERENCES atendimento_operacao.etapa(id), responsavel_id text, valor numeric(18,2), notas text NOT NULL DEFAULT '', versao bigint NOT NULL DEFAULT 1, criada_em timestamptz NOT NULL DEFAULT now(), atualizada_em timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS atendimento_operacao.compromisso (id uuid PRIMARY KEY, contato_id uuid REFERENCES atendimento_operacao.contato(id), conversa_id uuid REFERENCES atendimento_operacao.conversa(id), titulo text NOT NULL CHECK(length(titulo)<=200), descricao text NOT NULL DEFAULT '', inicio timestamptz NOT NULL, duracao_minutos integer NOT NULL CHECK(duracao_minutos BETWEEN 1 AND 1440), responsavel_id text, estado text NOT NULL DEFAULT 'agendado' CHECK(estado IN ('agendado','concluido','cancelado')), versao bigint NOT NULL DEFAULT 1, criada_em timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS atendimento_operacao.timer (id uuid PRIMARY KEY, conversa_id uuid REFERENCES atendimento_operacao.conversa(id), tipo text NOT NULL, executar_em timestamptz NOT NULL, versao_conversa bigint, estado text NOT NULL DEFAULT 'pendente' CHECK(estado IN ('pendente','cancelado','concluido')), criada_em timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS atendimento_operacao.importacao (id text PRIMARY KEY, origem text NOT NULL, marcador text NOT NULL, resumo jsonb NOT NULL, concluida_em timestamptz NOT NULL DEFAULT now());
REVOKE ALL ON ALL TABLES IN SCHEMA atendimento_operacao FROM PUBLIC;
COMMIT;
