/** Contratos GET inventariados. Não incluir filas, logs crus, auth ou configurações privadas. */
export const recursosTabelasAtendimento = {
  contacts: 'crm.atendimento', contacts_with_stats: 'crm.atendimento',
  conversations: 'crm.atendimento', messages: 'crm.atendimento',
  appointments: 'crm.atendimento', deals: 'crm.atendimento',
  pipeline_stages: 'crm.atendimento', deal_activities: 'crm.atendimento',
  conversation_activities: 'crm.atendimento', conversation_states: 'crm.atendimento',
  tag_definitions: 'crm.atendimento', support_cases: 'crm.atendimento',
  profiles: 'crm.atendimento.equipe', team_members: 'crm.atendimento.equipe',
  teams: 'crm.atendimento.equipe', team_functions: 'crm.atendimento.equipe',
  team_business_hours: 'crm.atendimento.equipe', team_holidays: 'crm.atendimento.equipe',
  whatsapp_templates: 'crm.atendimento.configuracoes', nina_settings: 'crm.atendimento.configuracoes',
  automation_rules: 'crm.atendimento.automacoes', automation_scheduled: 'crm.atendimento.automacoes',
} as const;
export const caminhosDadosAtendimento = Object.keys(recursosTabelasAtendimento)
  .map(tabela => `/api/atendimento/dados/${tabela}`);
