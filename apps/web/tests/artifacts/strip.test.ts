import { describe, expect, it } from 'vitest';

import {
  compressArtifactBodyForTranscript,
  compressArtifactsInTranscript,
  splitStreamingArtifact,
  stripArtifact,
  stripRecoveredHtmlFallbackForDisplay,
  stripSupersededArtifacts,
  summarizeArtifactsForTranscript,
} from '../../src/artifacts/strip';

const completeHtml = '<!doctype html><html><head><title>X</title></head><body><h1>X</h1></body></html>';

describe('stripArtifact', () => {
  it('removes a real artifact tag and its body from prose', () => {
    const out = stripArtifact(
      'Header.\n<artifact identifier="x" type="text/html" title="X">\n<h1>x</h1>\n</artifact>\nFooter.',
    );
    expect(out).toBe('Header.\n\nFooter.');
  });

  it('removes multiple real artifact tags and their bodies from prose', () => {
    const out = stripArtifact(
      'Header.\n<artifact identifier="register" type="text/html" title="Register">\n<h1>register</h1>\n</artifact>\nMiddle.\n<artifact identifier="login" type="text/html" title="Login">\n<h1>login</h1>\n</artifact>\nFooter.',
    );
    expect(out).toBe('Header.\n\nMiddle.\n\nFooter.');
  });

  it('preserves an artifact tag wrapped in inline backticks', () => {
    const input = 'Wrap output as `<artifact identifier="x">demo</artifact>` to ship it.';
    expect(stripArtifact(input)).toBe(input);
  });

  it('preserves an artifact tag inside a fenced code block', () => {
    const input = [
      'Example:',
      '```html',
      '<artifact identifier="demo" type="text/html" title="Demo">',
      '<h1>Demo</h1>',
      '</artifact>',
      '```',
      'After.',
    ].join('\n');
    expect(stripArtifact(input)).toBe(input);
  });

  it('preserves a tag wrapped in double backticks', () => {
    const input = 'Use ``<artifact identifier="x" type="text/html" title="X">`` here.';
    expect(stripArtifact(input)).toBe(input);
  });

  it('returns content unchanged when no artifact open tag is present', () => {
    const input = 'Just prose, no markup.';
    expect(stripArtifact(input)).toBe(input);
  });

  it('does not truncate when an open tag has no matching close', () => {
    // A bare orphan open without a close should not nuke the rest of the
    // message (the previous implementation sliced to end-of-string).
    const input = 'Trailing prose<artifact identifier="x"> with no closer.';
    expect(stripArtifact(input)).toBe(input);
  });

  it('preserves a tag inside a fenced literal whose closing fence has no trailing newline', () => {
    // Renderer treats an unclosed-at-EOF fence as a code block extending to
    // end of input. The stripper must do the same, otherwise a literal
    // recitation tucked into a code example at the bottom of a chat reply
    // gets eaten.
    const input = '```js\nconst s = `<artifact identifier="x">demo</artifact>`;\n```';
    expect(stripArtifact(input)).toBe(input);
  });

  it('strips a real artifact that follows an indented pseudo-fence (renderer sees no fence)', () => {
    // The renderer's open-fence regex disallows leading spaces; an indented
    // "   ```html" line is rendered as a paragraph, not a fence. The
    // <artifact …> on the next line is therefore a real protocol tag and
    // must be stripped — not preserved as fictional fenced content.
    const input = [
      '   ```html',
      '<artifact identifier="x" type="text/html" title="X">',
      '<h1>x</h1>',
      '</artifact>',
      'Tail.',
    ].join('\n');
    const out = stripArtifact(input);
    expect(out).not.toContain('<artifact');
    expect(out).toContain('Tail.');
  });

  it('strips a real artifact between paragraphs that each carry a stray backtick', () => {
    // Inline code spans are paragraph-local in the renderer; an unbalanced
    // backtick in one paragraph must not bridge across a blank line to pair
    // with a backtick in another paragraph and accidentally classify a real
    // <artifact …> between them as inline code (mrcfps's 2026-05-11 repro).
    const input = [
      'intro `',
      '',
      '<artifact identifier="x" type="text/plain" title="X">demo</artifact>',
      '',
      'closing `',
    ].join('\n');
    const out = stripArtifact(input);
    expect(out).not.toContain('<artifact');
    expect(out).toContain('intro `');
    expect(out).toContain('closing `');
  });

  it('preserves a tag bridged by stray backticks across HR-shaped lines (renderer keeps HR as paragraph content)', () => {
    // runtime/markdown.tsx:95-104's paragraph-accumulation loop only breaks on
    // blank / fence / heading / ul / ol — it does NOT break on HR. So a buffer
    // shaped `intro \`` / `---` / `<artifact …>…</artifact>` / `---` / `closing \``
    // is one paragraph in the renderer, and the two stray backticks pair to
    // cover the literal artifact recitation. The skip-range walker must mirror
    // that (mrcfps's 2026-05-11 05:46 follow-up).
    const input = [
      'intro `',
      '---',
      '<artifact identifier="x" type="text/plain" title="X">demo</artifact>',
      '---',
      'closing `',
    ].join('\n');
    expect(stripArtifact(input)).toBe(input);
  });

  it('does not strip <artifactual> or other prefix-shared identifiers', () => {
    // The streaming parser only treats `<artifact` as a real open when the
    // next char is whitespace; the stripper must apply the same rule, else
    // literal prose mentioning `<artifactual>` gets silently truncated.
    const input = 'prefix <artifactual>demo</artifact> suffix';
    expect(stripArtifact(input)).toBe(input);
  });

  it('preserves a tag inside a fenced block that contains a `\`\`\`html` line in its body', () => {
    // The renderer closes a fence only on a bare "```\\s*$" — a "```html"
    // line inside an open fence is kept as code content. The stripper must
    // match that semantics or it will exit the fence early and eat a
    // literal <artifact …> recitation that follows.
    const input = [
      '```js',
      'const a = `<p>x</p>`;',
      '```html',
      '<artifact identifier="x" type="text/html" title="X">demo</artifact>',
      '```',
    ].join('\n');
    expect(stripArtifact(input)).toBe(input);
  });
});

describe('splitStreamingArtifact', () => {
  it('surfaces an open-but-unclosed html artifact as a live box', () => {
    const input = 'Building it.\n<artifact identifier="page" type="text/html" title="Landing">\n<h1>Hi';
    const { head, live } = splitStreamingArtifact(input);
    expect(head).toBe('Building it.');
    expect(live).not.toBeNull();
    expect(live?.artifactType).toBe('text/html');
    expect(live?.title).toBe('Landing');
    expect(live?.identifier).toBe('page');
    expect(live?.content).toBe('\n<h1>Hi');
  });

  it('defers a completed artifact to stripArtifact (no live box)', () => {
    const input = 'Done.\n<artifact identifier="x" type="text/html" title="X">\n<h1>x</h1>\n</artifact>';
    const { head, live } = splitStreamingArtifact(input);
    expect(head).toBe(input);
    expect(live).toBeNull();
  });

  it('returns no live box for a non-text/html artifact type', () => {
    const input = 'Generating.\n<artifact identifier="img" type="image/svg+xml" title="Logo"><svg>';
    const { head, live } = splitStreamingArtifact(input);
    expect(head).toBe(input);
    expect(live).toBeNull();
  });

  it('treats an unknown/omitted type as code-eligible', () => {
    const input = 'Writing.\n<artifact identifier="x" title="X">\nsome text';
    const { live } = splitStreamingArtifact(input);
    expect(live).not.toBeNull();
    expect(live?.artifactType).toBe('');
  });

  it('ignores a literal <artifact …> recited inside a code fence', () => {
    const input = [
      'Example:',
      '```html',
      '<artifact identifier="demo" type="text/html" title="Demo">',
      '<h1>Demo</h1>',
    ].join('\n');
    const { head, live } = splitStreamingArtifact(input);
    expect(head).toBe(input);
    expect(live).toBeNull();
  });

  it('shows an empty live box when the open tag attributes are still streaming', () => {
    const input = 'Almost there.\n<artifact identifier="x" type="text/htm';
    const { head, live } = splitStreamingArtifact(input);
    expect(head).toBe('Almost there.');
    expect(live).not.toBeNull();
    expect(live?.content).toBe('');
  });

  it('returns content unchanged when there is no artifact at all', () => {
    const input = 'Just prose, still streaming.';
    const { head, live } = splitStreamingArtifact(input);
    expect(head).toBe(input);
    expect(live).toBeNull();
  });
});

describe('stripRecoveredHtmlFallbackForDisplay', () => {
  it('removes a standalone complete HTML response for display only', () => {
    expect(stripRecoveredHtmlFallbackForDisplay(`\n${completeHtml}\n`)).toBe('');
  });

  it('removes a single complete html fence while preserving prose', () => {
    const input = ['Done — saved as an artifact.', '', '```html', completeHtml, '```'].join('\n');
    expect(stripRecoveredHtmlFallbackForDisplay(input)).toBe('Done — saved as an artifact.');
  });

  it('removes a recovered preceding HTML document using original artifact context', () => {
    const original = [
      'Done — saved as an artifact.',
      '',
      completeHtml,
      '<artifact identifier="demo" type="text/html" title="Demo">summary only</artifact>',
    ].join('\n');
    const stripped = stripArtifact(original);

    expect(stripRecoveredHtmlFallbackForDisplay(stripped, original)).toBe('Done — saved as an artifact.');
  });

  it('leaves partial snippets unchanged', () => {
    const input = '```html\n<main><h1>Snippet</h1></main>\n```';
    expect(stripRecoveredHtmlFallbackForDisplay(input)).toBe(input);
  });

  it('leaves multiple complete html fences unchanged instead of guessing', () => {
    const input = ['```html', completeHtml, '```', '```html', completeHtml, '```'].join('\n');
    expect(stripRecoveredHtmlFallbackForDisplay(input)).toBe(input);
  });
});

describe('summarizeArtifactsForTranscript', () => {
  it('summarizes persisted css, svg, and markdown artifacts', () => {
    const input = [
      '<artifact identifier="theme" type="text/css" title="Theme">',
      'body { color: red; }',
      '</artifact>',
      '<artifact identifier="logo" type="image/svg+xml" title="Logo">',
      '<svg viewBox="0 0 10 10"></svg>',
      '</artifact>',
      '<artifact identifier="brief" type="text/markdown" title="Brief">',
      '# Brief',
      '</artifact>',
    ].join('\n');

    const out = summarizeArtifactsForTranscript(input, [
      { name: 'theme.css' },
      { name: 'logo.svg' },
      { name: 'brief.md' },
    ]);

    expect(out).toContain('project file "theme.css"');
    expect(out).toContain('project file "logo.svg"');
    expect(out).toContain('project file "brief.md"');
    expect(out).not.toContain('body { color: red; }');
    expect(out).not.toContain('<svg viewBox="0 0 10 10"></svg>');
    expect(out).not.toContain('# Brief');
  });
});

describe('stripSupersededArtifacts', () => {
  it('preserves first-seen artifact and strips older superseded ones', () => {
    const seen = new Set<string>();
    const latest = '<artifact identifier="app" type="text/html" title="App"><h1>v2</h1></artifact>';
    const older = '<artifact identifier="app" type="text/html" title="App"><h1>v1</h1></artifact>';

    const latestProcessed = stripSupersededArtifacts(latest, seen);
    expect(latestProcessed).toBe(latest);
    expect(seen.has('app')).toBe(true);

    const olderProcessed = stripSupersededArtifacts(older, seen);
    expect(olderProcessed).toContain('[artifact "app" emitted on this prior turn is superseded by the newer version in a later turn.]');
    expect(olderProcessed).not.toContain('<h1>v1</h1>');
  });

  it('preserves distinct artifacts across different identifiers', () => {
    const seen = new Set<string>();
    const page1 = '<artifact identifier="page1" type="text/html" title="Page 1"><h1>P1</h1></artifact>';
    const page2 = '<artifact identifier="page2" type="text/html" title="Page 2"><h1>P2</h1></artifact>';

    expect(stripSupersededArtifacts(page2, seen)).toBe(page2);
    expect(stripSupersededArtifacts(page1, seen)).toBe(page1);
  });
});

describe('compressArtifactBodyForTranscript', () => {
  it('strips base64 data URIs from artifact body', () => {
    const body = '<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" alt="test">';
    const compressed = compressArtifactBodyForTranscript(body);
    expect(compressed).toContain('[base64-data-omitted]');
    expect(compressed).not.toContain('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ');
  });

  it('strips long SVG path data strings (>200 chars)', () => {
    const longPath = 'M'.padEnd(250, '1');
    const body = `<svg><path d="${longPath}"></svg>`;
    const compressed = compressArtifactBodyForTranscript(body);
    expect(compressed).toContain('d="[path-data-omitted]"');
    expect(compressed).not.toContain(longPath);
  });

  it('preserves short SVG path data strings (<200 chars)', () => {
    const shortPath = 'M10 10 H 90 V 90 H 10 Z';
    const body = `<svg><path d="${shortPath}"></svg>`;
    const compressed = compressArtifactBodyForTranscript(body);
    expect(compressed).toContain(`d="${shortPath}"`);
  });

  it('strips long HTML comments and CSS comments inside style tags', () => {
    const body = [
      '<!-- ' + 'A'.repeat(100) + ' -->',
      '<!-- short comment -->',
      '<style>',
      '  /* long css comment that describes layout in detail */',
      '  .btn {   color:   red;   }',
      '</style>',
    ].join('\n');
    const compressed = compressArtifactBodyForTranscript(body);
    expect(compressed).not.toContain('A'.repeat(100));
    expect(compressed).toContain('<!-- short comment -->');
    expect(compressed).not.toContain('long css comment');
    expect(compressed).toContain('.btn { color: red; }');
  });
});

describe('compressArtifactsInTranscript', () => {
  it('compresses artifact body while keeping surrounding wrapper intact', () => {
    const input = [
      'Assistant header',
      '<artifact identifier="my-app" type="text/html" title="My App">',
      '<img src="data:image/png;base64,' + 'B'.repeat(60) + '">',
      '</artifact>',
    ].join('\n');

    const output = compressArtifactsInTranscript(input);
    expect(output).toContain('<artifact identifier="my-app" type="text/html" title="My App">');
    expect(output).toContain('[base64-data-omitted]');
    expect(output).toContain('</artifact>');
    expect(output).not.toContain('B'.repeat(60));
  });
});

