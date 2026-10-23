// Which source sections need the Markdown renderer instead of plain text: tables and lists
// (Word / PowerPoint / Excel keep their shape) and equations (Word's equations arrive as
// `$…$` / `$$…$$` LaTeX, services/office_extract.py).

const TABLE_OR_LIST = /^\s*(\||- )/m;
// Display maths, or inline `$…$` that looks like LaTeX (a backslash command, ^, _ or =):
// a website's "$5 or $10" stays plain text.
const MATH = /\$\$[^$]+\$\$|\$(?=\S)[^$\n]*(\\[a-zA-Z]+|[\^_=])[^$\n]*(?<=\S)\$/;

export function needsMarkdown(text: string | null | undefined): boolean {
  const t = text ?? "";
  return TABLE_OR_LIST.test(t) || MATH.test(t);
}
