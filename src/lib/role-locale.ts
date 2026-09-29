import names from '../data/agency-role-names-zh.json';
import { AGENT_ROLES, type AgentRole } from './office';
import { translate, type Locale } from './i18n';

const bundled = new Map(AGENT_ROLES.map(role => [role.id, role]));
/** Display metadata only. User names and all execution prompts remain intact. */
export function localizeRoles(roles: AgentRole[], locale: Locale): AgentRole[] {
  return roles.map(role => {
    const original = bundled.get(role.id);
    if (!original || role.name !== original.name || role.sourcePath !== original.sourcePath) return role;
    const chinese = (names as Record<string, string>)[role.id] ?? role.name;
    const english = role.originalName ?? original.originalName ?? role.name;
    const description = role.instructions.match(/^description:\s*(.+)$/m)?.[1]?.replace(/^['"]|['"]$/g, '');
    return { ...role, name: locale === 'en' ? english : translate(locale, chinese),
      summary: locale === 'en' && description ? description : translate(locale, role.summary),
      strengths: [...role.strengths, chinese, english, original.name] };
  });
}
