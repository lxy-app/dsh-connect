'use client';

import { useEffect } from 'react';

export function RevealManager() {
  useEffect(() => {
    const elements = Array.from(document.querySelectorAll<HTMLElement>('.reveal'));
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!('IntersectionObserver' in window) || reducedMotion) {
      elements.forEach(element => element.classList.add('in-view'));
      return;
    }

    document.body.classList.add('motion-ready');
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -35px' });
    elements.forEach(element => observer.observe(element));

    return () => {
      observer.disconnect();
      document.body.classList.remove('motion-ready');
    };
  }, []);

  return null;
}
