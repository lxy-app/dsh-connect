'use client';

import { useState } from 'react';
import { faqs, GITHUB_URL } from './content';
import { Icon } from './Icon';

export function Faq() {
  const [openItems, setOpenItems] = useState<Set<number>>(() => new Set([0]));

  function toggle(index: number) {
    setOpenItems(current => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  return (
    <section className="section" id="faq">
      <div className="container faq-layout">
        <aside className="faq-aside reveal">
          <div className="section-kicker">Questions, answered</div>
          <h2 className="section-title">你可能还想知道。</h2>
          <p className="section-copy">更多架构、协议与部署细节，可以在开源仓库中查看完整文档。</p>
          <a className="btn btn-outline" style={{ marginTop: 26 }} href={GITHUB_URL} target="_blank" rel="noopener noreferrer">查看 GitHub 仓库<Icon name="arrowUp" /></a>
        </aside>
        <div className="faq-list reveal">
          {faqs.map((faq, index) => {
            const open = openItems.has(index);
            return (
              <div className="faq-item" key={faq.question}>
                <button
                  className="faq-question"
                  type="button"
                  id={`faq-q-${index}`}
                  aria-expanded={open}
                  aria-controls={`faq-a-${index}`}
                  onClick={() => toggle(index)}
                >
                  <span>{faq.question}</span><Icon name="plus" />
                </button>
                <div className="faq-answer" id={`faq-a-${index}`} role="region" aria-labelledby={`faq-q-${index}`} hidden={!open}>
                  {faq.answer}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
