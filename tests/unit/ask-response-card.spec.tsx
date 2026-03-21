import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AskResponseCard } from '../../src/sidepanel/components/AskResponseCard';

describe('AskResponseCard', () => {
  it('uses the locked ask-response semantic labels', () => {
    const html = renderToStaticMarkup(
      <AskResponseCard
        query="when?"
        answer="The speakers have not discussed that recently."
        timestampSeconds={45}
        sources={[
          { title: 'Reuters', url: 'https://example.com/reuters' },
          { title: 'AP' },
        ]}
      />,
    );

    expect(html).toContain('Asked');
    expect(html).toContain('Referenced');
    expect(html).toContain('ask-card-kicker');
    expect(html).toContain('ask-card-answer');
    expect(html).toContain('ask-card-source-link');
    expect(html).toContain('ask-card-source-copy');
  });
});
