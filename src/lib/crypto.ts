import "server-only";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

// Chave derivada do AUTH_SECRET já existente (sessão JWT) — evita precisar de mais
// uma variável de ambiente só pra isso. O contexto padrão preserva os certificados
// existentes; outros segredos usam um contexto próprio para separar as chaves.
// Uma chave explicitamente fornecida permite arquivos de migração independentes,
// sem mudar a chave ou o comportamento dos consumidores atuais.
function obterChave(contexto: string, segredo?: string) {
  const secret = segredo ?? process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET não configurado no .env");
  return scryptSync(secret, contexto, 32);
}

// Formato do payload: base64(IV[12] + authTag[16] + ciphertext).
export function cifrar(texto: string, contexto = "grazing-hub-certificado-digital", segredo?: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", obterChave(contexto,segredo), iv);
  const criptografado = Buffer.concat([cipher.update(texto, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, criptografado]).toString("base64");
}

export function decifrar(payload: string, contexto = "grazing-hub-certificado-digital", segredo?: string): string {
  const buffer = Buffer.from(payload, "base64");
  const iv = buffer.subarray(0, 12);
  const tag = buffer.subarray(12, 28);
  const criptografado = buffer.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", obterChave(contexto,segredo), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(criptografado), decipher.final()]).toString("utf8");
}
