export function renderTemplate(template: string, values: Record<string, unknown>): string {
  return template.replace(/\$\{\s*([a-zA-Z0-9_.$-]+)\s*\}/g, (_, key: string) => {
    const value = values[key];
    return value === undefined || value === null ? "--" : String(value);
  });
}

export function extractTemplateVariables(template: string): string[] {
  const variables = new Set<string>();
  for (const match of template.matchAll(/\$\{\s*([a-zA-Z0-9_.$-]+)\s*\}/g)) {
    variables.add(match[1]);
  }
  return [...variables];
}
