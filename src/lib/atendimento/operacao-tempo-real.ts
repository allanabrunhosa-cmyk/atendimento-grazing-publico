import type { Notification, Pool, PoolClient } from 'pg';

/** Um LISTEN por banco, compartilhado pelas sessões. A notificação só invalida
 * consultas: o histórico continua durável no PostgreSQL e é relido com acesso. */
export class SinalChatOperacao {
 private ouvintes = new Set<(novaMensagem: boolean) => void>();
 private conexao: PoolClient | null = null;
 private conectando = false;
 private retomada: ReturnType<typeof setTimeout> | null = null;
 constructor(private pool: Pool) {}
 observar(avisar: (novaMensagem: boolean) => void) {
  this.ouvintes.add(avisar); void this.conectar();
  return () => { this.ouvintes.delete(avisar); if (!this.ouvintes.size) this.fechar(); };
 }
 private avisar = (evento?: Notification) => { for (const ouvir of this.ouvintes) ouvir(evento?.payload === 'mensagem_cliente'); };
 private async conectar() {
  if (this.conectando || this.conexao || !this.ouvintes.size) return;
  this.conectando = true;
  let cliente: PoolClient | null = null;
  try {
   cliente = await this.pool.connect();
   cliente.on('error', this.falhar);
   await cliente.query('LISTEN donatella_chat_alterado');
   if (!this.ouvintes.size) { cliente.removeListener('error', this.falhar); cliente.release(true); return; }
   this.conexao = cliente; cliente.on('notification', this.avisar); this.avisar();
  } catch { if (cliente) { cliente.removeListener('error', this.falhar); cliente.release(true); } this.reconectar(); }
  finally { this.conectando = false; }
 }
 private falhar = () => { this.fecharConexao(); this.reconectar(); };
 private reconectar() {
  if (!this.ouvintes.size || this.retomada) return;
  this.retomada = setTimeout(() => { this.retomada = null; void this.conectar(); }, 3000);
  this.retomada.unref();
 }
 private fecharConexao() {
  const c = this.conexao; this.conexao = null;
  if (c) { c.removeListener('notification', this.avisar); c.removeListener('error', this.falhar); c.release(true); }
 }
 private fechar() { if (this.retomada) clearTimeout(this.retomada); this.retomada = null; this.fecharConexao(); }
}
