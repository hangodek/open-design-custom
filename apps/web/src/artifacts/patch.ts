/**
 * Diff & Patch Engine for Targeted HTML Artifact Revisions.
 *
 * Supports LLM search-and-replace block format:
 * <<<<<<< SEARCH
 * [exact lines from target file]
 * =======
 * [new replacement lines]
 * >>>>>>> REPLACE
 */

export interface SearchReplaceBlock {
  search: string;
  replace: string;
}

export interface PatchResult {
  ok: boolean;
  html: string;
  appliedCount: number;
  errors: string[];
}

const SEARCH_BLOCK_RE = /<{5,9}\s*SEARCH\s*\r?\n([\s\S]*?)\r?\n={5,9}\s*\r?\n([\s\S]*?)\r?\n>{5,9}\s*REPLACE/g;

/**
 * Check if the text contains one or more search-and-replace patch blocks.
 */
export function isSearchReplacePatch(content: string): boolean {
  if (!content) return false;
  const trimmed = content.trim().toLowerCase();
  if (trimmed.startsWith('<!doctype html') || (trimmed.startsWith('<html') && trimmed.includes('</html>'))) {
    return false;
  }
  SEARCH_BLOCK_RE.lastIndex = 0;
  return SEARCH_BLOCK_RE.test(content);
}

/**
 * Parse all search-and-replace blocks from patch content.
 */
export function parseSearchReplaceBlocks(patchText: string): SearchReplaceBlock[] {
  const blocks: SearchReplaceBlock[] = [];
  SEARCH_BLOCK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SEARCH_BLOCK_RE.exec(patchText)) !== null) {
    blocks.push({
      search: match[1] ?? '',
      replace: match[2] ?? '',
    });
  }
  return blocks;
}

/**
 * Apply search-and-replace blocks sequentially to base HTML.
 * Uses 3 matching strategies:
 * 1. Exact string match
 * 2. Line-trimmed match (ignoring indentation differences)
 * 3. Whitespace-normalized match
 */
export function applySearchReplacePatch(baseHtml: string, patchText: string): PatchResult {
  const blocks = parseSearchReplaceBlocks(patchText);
  if (blocks.length === 0) {
    return { ok: false, html: baseHtml, appliedCount: 0, errors: ['No valid search-replace blocks found'] };
  }

  let current = baseHtml;
  let applied = 0;
  const errors: string[] = [];

  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i];
    if (!block) continue;
    const { search, replace } = block;

    if (!search.trim()) {
      errors.push(`Block ${i + 1}: search content is empty`);
      continue;
    }

    // Strategy 1: Exact match
    if (current.includes(search)) {
      current = current.replace(search, replace);
      applied += 1;
      continue;
    }

    // Strategy 2: Line-trimmed match
    const searchLines = search.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (searchLines.length > 0) {
      const docLines = current.split(/\r?\n/);
      let foundIndex = -1;

      for (let d = 0; d <= docLines.length - searchLines.length; d += 1) {
        let allMatch = true;
        for (let s = 0; s < searchLines.length; s += 1) {
          if ((docLines[d + s]?.trim() ?? '') !== searchLines[s]) {
            allMatch = false;
            break;
          }
        }
        if (allMatch) {
          foundIndex = d;
          break;
        }
      }

      if (foundIndex !== -1) {
        const matchedOrigLines = docLines.slice(foundIndex, foundIndex + searchLines.length);
        const origSnippet = matchedOrigLines.join('\n');
        const origSnippetCrlf = matchedOrigLines.join('\r\n');

        if (current.includes(origSnippet)) {
          current = current.replace(origSnippet, replace);
          applied += 1;
          continue;
        } else if (current.includes(origSnippetCrlf)) {
          current = current.replace(origSnippetCrlf, replace);
          applied += 1;
          continue;
        }
      }
    }

    // Strategy 3: Normalized whitespace match
    const escapedTokens = search
      .trim()
      .split(/\s+/)
      .map((tok) => tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

    let matched = false;
    if (escapedTokens.length > 0 && escapedTokens.length < 50) {
      try {
        const flexibleRe = new RegExp(escapedTokens.join('\\s+'));
        if (flexibleRe.test(current)) {
          current = current.replace(flexibleRe, replace);
          applied += 1;
          matched = true;
        }
      } catch {
        // Regex fallback
      }
    }

    if (!matched) {
      errors.push(`Block ${i + 1}: search text could not be located in target document`);
    }
  }

  return {
    ok: applied > 0,
    html: current,
    appliedCount: applied,
    errors,
  };
}

/**
 * Resolves an incoming artifact body. If it is a search-and-replace patch and baseHtml is provided,
 * applies the patch and returns the full patched HTML. Otherwise returns candidateHtml unchanged.
 */
export function resolveLiveArtifactHtml(candidateHtml: string, baseHtml?: string | null): string {
  if (isSearchReplacePatch(candidateHtml) && baseHtml && !isSearchReplacePatch(baseHtml)) {
    const patchResult = applySearchReplacePatch(baseHtml, candidateHtml);
    if (patchResult.ok) {
      return patchResult.html;
    }
  }
  return candidateHtml;
}

