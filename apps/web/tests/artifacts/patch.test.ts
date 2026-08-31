import { describe, expect, it } from 'vitest';

import {
  applySearchReplacePatch,
  isSearchReplacePatch,
  parseSearchReplaceBlocks,
} from '../../src/artifacts/patch';

describe('isSearchReplacePatch', () => {
  it('detects search-and-replace block format', () => {
    const patch = `
<<<<<<< SEARCH
<button class="btn">Old</button>
=======
<button class="btn">New</button>
>>>>>>> REPLACE
`;
    expect(isSearchReplacePatch(patch)).toBe(true);
  });

  it('returns false for full HTML documents', () => {
    const html = `<!DOCTYPE html><html><head></head><body><h1>Hello</h1></body></html>`;
    expect(isSearchReplacePatch(html)).toBe(false);
  });

  it('returns false for regular text without patch markers', () => {
    expect(isSearchReplacePatch('just plain text')).toBe(false);
  });
});

describe('parseSearchReplaceBlocks', () => {
  it('parses single block correctly', () => {
    const text = `
<<<<<<< SEARCH
const a = 1;
=======
const a = 2;
>>>>>>> REPLACE
`;
    const blocks = parseSearchReplaceBlocks(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.search).toBe('const a = 1;');
    expect(blocks[0]?.replace).toBe('const a = 2;');
  });

  it('parses multiple blocks in sequence', () => {
    const text = `
<<<<<<< SEARCH
<h1>Title 1</h1>
=======
<h1>Updated 1</h1>
>>>>>>> REPLACE

prose in between

<<<<<<< SEARCH
<p>Desc 1</p>
=======
<p>Desc 2</p>
>>>>>>> REPLACE
`;
    const blocks = parseSearchReplaceBlocks(text);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.search).toBe('<h1>Title 1</h1>');
    expect(blocks[0]?.replace).toBe('<h1>Updated 1</h1>');
    expect(blocks[1]?.search).toBe('<p>Desc 1</p>');
    expect(blocks[1]?.replace).toBe('<p>Desc 2</p>');
  });
});

describe('applySearchReplacePatch', () => {
  it('applies exact search and replace', () => {
    const baseHtml = `<!doctype html><html><body><button class="btn" id="btn1">Old Text</button></body></html>`;
    const patch = `
<<<<<<< SEARCH
<button class="btn" id="btn1">Old Text</button>
=======
<button class="btn" id="btn1" style="background: red;">New Text</button>
>>>>>>> REPLACE
`;
    const result = applySearchReplacePatch(baseHtml, patch);
    expect(result.ok).toBe(true);
    expect(result.appliedCount).toBe(1);
    expect(result.html).toContain('style="background: red;"');
    expect(result.html).toContain('New Text');
    expect(result.html).not.toContain('Old Text');
  });

  it('applies line-trimmed match when indentation varies', () => {
    const baseHtml = `<!doctype html>
<html>
  <body>
    <div class="card">
      <span class="badge">Active</span>
    </div>
  </body>
</html>`;

    // Model emits patch without outer indentation
    const patch = `
<<<<<<< SEARCH
<div class="card">
  <span class="badge">Active</span>
</div>
=======
<div class="card">
  <span class="badge">Updated</span>
</div>
>>>>>>> REPLACE
`;
    const result = applySearchReplacePatch(baseHtml, patch);
    expect(result.ok).toBe(true);
    expect(result.html).toContain('Updated');
  });

  it('applies multiple patches to the same document', () => {
    const baseHtml = `<html><body><h1 id="t">Title</h1><p id="d">Desc</p></body></html>`;
    const patch = `
<<<<<<< SEARCH
<h1 id="t">Title</h1>
=======
<h1 id="t">New Title</h1>
>>>>>>> REPLACE
<<<<<<< SEARCH
<p id="d">Desc</p>
=======
<p id="d">New Desc</p>
>>>>>>> REPLACE
`;
    const result = applySearchReplacePatch(baseHtml, patch);
    expect(result.ok).toBe(true);
    expect(result.appliedCount).toBe(2);
    expect(result.html).toContain('New Title');
    expect(result.html).toContain('New Desc');
  });
});
