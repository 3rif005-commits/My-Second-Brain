type AnyBlockLike = { type: string; children?: AnyBlockLike[]; [key: string]: unknown };

export async function extractCalloutChildren<T extends AnyBlockLike>(
  html: string,
  parseHTML: (html: string) => Promise<T[]>
): Promise<{ strippedHtml: string; calloutChildren: T[][] }> {
  const doc = new window.DOMParser().parseFromString(html, "text/html");
  const calloutDivs = [...doc.querySelectorAll('div[data-type="callout"]')];
  const calloutChildren: T[][] = [];
  for (const el of calloutDivs) {
    const children = await parseHTML(el.innerHTML);
    calloutChildren.push(children);
    el.innerHTML = "";
  }
  return { strippedHtml: doc.body.innerHTML, calloutChildren };
}

export function attachCalloutChildren<T extends AnyBlockLike>(
  blocks: T[],
  calloutChildren: T[][]
): T[] {
  let i = 0;
  function walk(list: T[]): T[] {
    return list.map((b) => {
      const children = Array.isArray(b.children) ? walk(b.children as T[]) : [];
      if (b.type === "callout") {
        return { ...b, children: calloutChildren[i++] ?? [] };
      }
      return { ...b, children };
    });
  }
  return walk(blocks);
}
