'use client';

import { useState } from 'react';
import { faqs } from './content';
import { manualRoot } from './manual';
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
          <p className="section-copy">遇到配对、授权或连接问题，可按症状查看排查步骤。</p>
          <a className="btn btn-outline" style={{ marginTop: 26 }} href={manualRoot + 'troubleshooting/'}>查看排障指南<Icon name="arrowUp" /></a>
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
